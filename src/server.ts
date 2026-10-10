// Valheim server companion: publishes the mod lock, shows configs, manages worlds/backups/env/players and
// the game container. Everything is optional: see config.ts for the COMPANION_* switches. Contract with the
// Mod Manager: docs/superpowers/specs/2026-10-10-server-companion-design.md in the client repo.
import { Hono } from "hono";
import { join } from "path";
import { isAuthed, requireFeature, requireToken } from "./auth";
import { createBackup, deleteBackup, importBackup, inspectBackup, listBackups, restoreFiles, safeId } from "./backups";
import { listConfigFiles, parseConfigFile, saveConfigChanges } from "./bepinexconfig";
import { FEATURES, PUBLIC_URL, VERSION, getTokenSource, resolveToken, tokenConfigured } from "./config";
import { containerAction, containerState, type ContainerAction } from "./docker";
import { envValue, readEnv, writeEnv } from "./env";
import { applyManifest, loadInstalled } from "./install";
import { streamLog, tailLog } from "./logs";
import { configHashes, loadManifest, migrateLegacy, normalizeManifest, saveManifest, type Manifest, type ServerInfo } from "./manifest";
import { BEPINEX_CONFIG_DIR, ensureDirs } from "./paths";
import { LIST_FILES, onlineFrom, readAllLists, sessionsFromLog, writeList, type ListName } from "./players";
import { buildR2z } from "./r2z";
import {
	applyRelease,
	discardRelease,
	pendingRelease,
	playersOnline,
	scheduleRelease,
	stageRelease,
	startScheduler,
	summary,
	type StageBody,
} from "./releases";
import { listWorlds } from "./worlds";

await ensureDirs();
await resolveToken();

async function serverInfo(): Promise<ServerInfo> {
	return {
		name: (await envValue("SERVER_NAME")) || "Valheim",
		world: (await envValue("WORLD_NAME")) || "",
		gameVersion: null,
		bepinex: null,
	};
}

/** The manifest is created once from the old webapp's files; an empty one is a valid "nothing published yet". */
async function currentManifest(): Promise<Manifest> {
	const m = await loadManifest();
	if (m) return m;
	const info = await serverInfo();
	const migrated = (await migrateLegacy(info)) ?? normalizeManifest({ mods: [] }, info, await configHashes());
	await saveManifest(migrated);
	return migrated;
}

// One mutation at a time: installs and restores must not interleave.
let busy: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
	const run = busy.then(fn, fn);
	busy = run.catch(() => {});
	return run;
}

startScheduler(exclusive);

const api = new Hono();
api.use("*", requireToken);

// ---- Always public: enough for the landing page and the client to know what this companion offers ----

api.get("/status", async (c) => {
	const authed = isAuthed(c);
	const detailed = FEATURES.publicRead || authed;
	const info = await serverInfo();
	const [m, container, worlds] = detailed ? await Promise.all([currentManifest(), containerState(), listWorlds()]) : [null, null, []];
	const world = worlds.find((w) => w.name === info.world) ?? null;
	const [pending, online] = detailed ? await Promise.all([pendingRelease(), playersOnline()]) : [null, null];
	return c.json({
		companion: {
			version: VERSION,
			tokenConfigured: tokenConfigured(),
			tokenSource: getTokenSource(),
			publicUrl: PUBLIC_URL || null,
			features: FEATURES,
			authed,
		},
		server: { name: info.name, world: detailed ? info.world : "" },
		container,
		manifest: m ? { hash: m.hash, generatedAt: m.generatedAt, mods: m.mods.length } : null,
		world: world ? { name: world.name, size: world.size, lastSave: world.lastSave } : null,
		release: pending ? summary(pending) : null,
		/** players online from the log; null when logs are off or docker is unreachable */
		online,
	});
});

// ---- Staged releases: publish → check → apply now / when idle / at a time ----

api.post("/releases", requireFeature("publish"), async (c) => {
	const body = (await c.req.json().catch(() => null)) as StageBody | null;
	if (!body) return c.json({ error: "JSON body expected" }, 400);
	try {
		const log: string[] = [];
		const r = await exclusive(async () => stageRelease(body, await serverInfo(), (l) => log.push(l)));
		return c.json({ release: r, summary: summary(r), online: await playersOnline(), log });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
});
api.get("/releases/pending", requireFeature("publish"), async (c) => {
	const r = await pendingRelease();
	return c.json({ release: r, summary: r ? summary(r) : null, online: await playersOnline() });
});
// { when: "now" | "idle" | "at" | "none", at?: epoch ms }
api.post("/releases/:id/apply", requireFeature("publish"), async (c) => {
	const id = c.req.param("id") ?? "";
	const { when, at } = (await c.req.json().catch(() => ({}))) as { when?: string; at?: number };
	try {
		if (when === "now") {
			const log: string[] = [];
			const report = await exclusive(() => applyRelease(id, (l) => log.push(l)));
			return c.json({ applied: true, ...report, log });
		}
		const schedule =
			when === "idle"
				? { when: "idle" as const, setAt: Date.now() }
				: when === "at" && typeof at === "number"
					? { when: "at" as const, at, setAt: Date.now() }
					: null;
		if (when !== "none" && !schedule) return c.json({ error: "when must be now, idle, at (with at) or none" }, 400);
		const r = await scheduleRelease(id, schedule);
		return c.json({ applied: false, summary: summary(r) });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
});
api.delete("/releases/:id", requireFeature("publish"), async (c) => c.json({ ok: await discardRelease(c.req.param("id") ?? "") }));

/** The client verifies a pasted token here before it stores it. */
api.post("/auth/check", (c) => c.json({ ok: isAuthed(c), tokenConfigured: tokenConfigured() }));

// ---- Mod lock ----

api.get("/manifest", async (c) => {
	const m = await currentManifest();
	if (c.req.header("if-none-match") === `"${m.hash}"`) return c.body(null, 304);
	return c.json({ ...m, features: { publish: FEATURES.publish, modManager: FEATURES.modManager } }, 200, { ETag: `"${m.hash}"`, "Cache-Control": "no-cache" });
});

api.get("/profile.r2z", requireFeature("modManager"), async (c) => {
	const m = await currentManifest();
	const bytes = await buildR2z(m);
	const name = (m.server.name || "server").replace(/[^\w.-]+/g, "_");
	const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	return new Response(body, {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${name}.r2z"`,
		},
	});
});

// PUT /api/manifest: direct apply without staging (scripts, restore). The client uses /api/releases.
api.put("/manifest", requireFeature("publish"), async (c) => {
	const body = (await c.req.json().catch(() => null)) as {
		mods?: unknown;
		configs?: { path: string; contentBase64: string }[];
		restart?: boolean;
	} | null;
	if (!body) return c.json({ error: "JSON body expected" }, 400);
	return exclusive(async () => {
		const info = await serverInfo();
		let m: Manifest;
		try {
			m = normalizeManifest(body, info, {});
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
		const written: string[] = [];
		for (const f of Array.isArray(body.configs) ? body.configs : []) {
			if (typeof f?.path !== "string" || typeof f?.contentBase64 !== "string") continue;
			const rel = f.path.replace(/\\/g, "/");
			if (rel.startsWith("/") || rel.split("/").some((p) => p === "..")) continue;
			await Bun.write(join(BEPINEX_CONFIG_DIR, rel), Buffer.from(f.contentBase64, "base64"));
			written.push(rel);
		}
		const log: string[] = [];
		const result = await applyManifest(m, (l) => log.push(l));
		m.configs = await configHashes();
		await saveManifest(m);
		const changed = result.installed.length + result.removed.length + written.length > 0;
		const restart = body.restart !== false && changed && FEATURES.control ? await containerAction("restart") : null;
		return c.json({ manifest: m, ...result, configsWritten: written, restart, log });
	});
});

api.get("/installed", async (c) => c.json(await loadInstalled()));

// ---- Configs ----

api.get("/configs", async (c) => c.json({ files: await listConfigFiles() }));
api.get("/configs/:file{.+}", async (c) => {
	try {
		return c.json(await parseConfigFile(c.req.param("file")));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
api.put("/configs/:file{.+}", requireFeature("configEdit"), async (c) => {
	const { changes } = (await c.req.json()) as {
		changes: { section: string; key: string; value: string }[];
	};
	await saveConfigChanges(c.req.param("file") ?? "", changes);
	const m = await currentManifest();
	m.configs = await configHashes();
	await saveManifest(m);
	return c.json({ ok: true });
});

// ---- Env, control, logs ----

api.get("/env", requireFeature("env"), async (c) => c.json({ entries: await readEnv() }));
api.put("/env", requireFeature("env"), async (c) => {
	const changes = (await c.req.json()) as Record<string, string>;
	try {
		return c.json({ entries: await writeEnv(changes), restartRequired: true });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
});

api.post("/server/:action", requireFeature("control"), async (c) => {
	const action = c.req.param("action") ?? "";
	if (!["restart", "stop", "start"].includes(action)) return c.json({ error: "unknown action" }, 400);
	return c.json(await containerAction(action as ContainerAction));
});

// Logs can carry IPs and ids: token required even when reads are public.
const requireAuth = async (c: import("hono").Context, next: import("hono").Next) => (isAuthed(c) ? next() : c.json({ error: "unauthorized" }, 401));

api.get("/logs", requireFeature("logs"), requireAuth, async (c) => {
	try {
		return c.json({ lines: await tailLog(Number(c.req.query("tail") || 300)) });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 502);
	}
});
api.get("/logs/stream", requireFeature("logs"), requireAuth, async (c) => {
	try {
		const stream = await streamLog(c.req.raw.signal);
		return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 502);
	}
});

// ---- Players ----

api.get("/players", requireFeature("players"), requireAuth, async (c) => {
	const lists = await readAllLists();
	let sessions: ReturnType<typeof sessionsFromLog> = [];
	let logError: string | null = null;
	if (FEATURES.logs) {
		try {
			sessions = sessionsFromLog(await tailLog(2000));
		} catch (e) {
			logError = (e as Error).message;
		}
	}
	return c.json({ lists, files: LIST_FILES, online: onlineFrom(sessions), recent: sessions.slice(-20).reverse(), logError });
});
api.put("/players/:list", requireFeature("players"), async (c) => {
	const name = c.req.param("list") as ListName;
	if (!(name in LIST_FILES)) return c.json({ error: "unknown list" }, 404);
	const { entries } = (await c.req.json()) as { entries: { id: string; note?: string }[] };
	if (!Array.isArray(entries)) return c.json({ error: "entries must be an array" }, 400);
	return c.json({
		entries: await writeList(
			name,
			entries.map((e) => ({ id: e.id, note: e.note ?? "" })),
		),
	});
});

// ---- Worlds and backups ----

api.get("/worlds", async (c) => c.json({ worlds: await listWorlds() }));

api.get("/backups", requireFeature("backups"), async (c) => c.json({ backups: await listBackups() }));
api.post("/backups", requireFeature("backups"), async (c) => {
	const { world, label } = (await c.req.json().catch(() => ({}))) as { world?: string; label?: string };
	const name = world || (await envValue("WORLD_NAME")) || "";
	try {
		return c.json(await exclusive(() => createBackup(name, label)));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
});
api.post("/backups/import", requireFeature("backups"), async (c) => {
	try {
		return c.json(await importBackup(await c.req.arrayBuffer()));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
});
api.get("/backups/:id", requireFeature("backups"), async (c) => {
	try {
		return c.json(await inspectBackup(c.req.param("id") ?? ""));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
api.delete("/backups/:id", requireFeature("backups"), async (c) => {
	await deleteBackup(c.req.param("id") ?? "");
	return c.json({ ok: true });
});
// { world?: string, configs?: boolean, mods?: boolean }: stop → safety backup → restore → (install manifest) → start
api.post("/backups/:id/restore", requireFeature("backups"), async (c) => {
	const id = safeId(c.req.param("id") ?? "");
	const opts = (await c.req.json().catch(() => ({}))) as { world?: string; configs?: boolean; mods?: boolean };
	return exclusive(async () => {
		const contents = await inspectBackup(id);
		const world = opts.world || contents.worlds[0];
		if (!world) return c.json({ error: "backup contains no world" }, 400);
		const stopped = FEATURES.control ? await containerAction("stop") : null;
		try {
			const r = await restoreFiles(id, { world, configs: !!opts.configs });
			let install = null;
			if (opts.mods && contents.manifest && FEATURES.publish) {
				const m = normalizeManifest(contents.manifest, await serverInfo(), {});
				install = await applyManifest(m);
				m.configs = await configHashes();
				await saveManifest(m);
			}
			return c.json({ ...r, install, stopped, started: FEATURES.control ? await containerAction("start") : null });
		} catch (e) {
			if (FEATURES.control) await containerAction("start");
			return c.json({ error: (e as Error).message }, 500);
		}
	});
});

const app = new Hono();
app.route("/api", api);

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const page = (file: string) => async (c: import("hono").Context) =>
	c.body(await Bun.file(join(PUBLIC_DIR, file)).text(), 200, { "Content-Type": "text/html; charset=utf-8" });
app.get("/", page("index.html"));
app.get("/configs", page("configs.html"));
app.get("/public/:file", async (c) => {
	const f = Bun.file(join(PUBLIC_DIR, c.req.param("file").replace(/[^\w.-]/g, "")));
	return (await f.exists()) ? new Response(f) : c.notFound();
});

const port = Number(process.env.PORT || 9002);
export default { port, fetch: app.fetch, idleTimeout: 255 };
const off = Object.entries(FEATURES)
	.filter(([, v]) => !v)
	.map(([k]) => k);
console.log(`Valheim companion ${VERSION} on http://localhost:${port}  token: ${getTokenSource()}${off.length ? `  disabled: ${off.join(", ")}` : ""}`);
