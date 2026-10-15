// Valheim server companion: publishes the mod lock, shows configs, manages worlds/backups/env/players and
// the game container. Everything is optional: see config.ts for the COMPANION_* switches. Contract with the
// Mod Manager: docs/superpowers/specs/2026-10-10-server-companion-design.md in the client repo.
import { Hono, type Context } from "hono";
import { join } from "path";
import { isAuthed, requireFeature, requireToken } from "./auth";
import { createBackup, deleteBackup, importBackup, inspectBackup, listBackups, restoreFiles, safeId } from "./backups";
import { listConfigFiles, parseConfigText, type ConfigChange } from "./bepinexconfig";
import { DEEPLINK_SCHEME, FEATURES, INVITE_URL, PUBLIC_URL, VERSION, getTokenSource, resolveToken, tokenConfigured } from "./config";
import { containerAction, containerState, type ContainerAction } from "./docker";
import { activeWorld, envValue, readEnv, writeEnv } from "./env";
import { writeAtomic } from "./fsutil";
import { withServerStopped } from "./maintenance";
import { applyManifest, loadInstalled } from "./install";
import { streamLog, tailLog } from "./logs";
import { configHashes, loadManifest, migrateLegacy, normalizeManifest, saveManifest, type Manifest, type ServerInfo } from "./manifest";
import { configRel } from "./configdir";
import { configSyncInfo } from "./modsync";
import { BEPINEX_CONFIG_DIR, ensureDirs } from "./paths";
import { LIST_FILES, onlineFrom, readAllLists, sessionsFromLog, writeList, type ListName } from "./players";
import { buildR2z } from "./r2z";
import {
	applyRelease,
	discardRelease,
	draftDiff,
	pendingRelease,
	playersOnline,
	refreshPlan,
	savePending,
	revertConfig,
	revertMods,
	scheduleRelease,
	stageConfigChanges,
	stageRelease,
	startScheduler,
	summary,
	workingConfig,
	type Release,
	type StageBody,
} from "./releases";
import { SyncError, SyncManager } from "./syncsetup";
import { describe as describeTakeover, scanPlugins, takeover, type Takeover } from "./takeover";
import { securityHeaders, serveUi } from "./web";
import { listWorlds } from "./worlds";

await ensureDirs();
await resolveToken();

async function serverInfo(): Promise<ServerInfo> {
	return {
		name: (await envValue("SERVER_NAME")) || "Valheim",
		world: await activeWorld(),
		gameVersion: null,
		bepinex: null,
	};
}

/** The manifest is created once from the old webapp's files; an empty one is a valid "nothing published yet". */
/**
 * A server without a lock gets one: from the old webapp's installed.json, else from the packages that lie in
 * plugins/ by hand (takeover.ts, once per start so Thunderstore is not asked on every request), else empty.
 */
let takeoverRun: Promise<Takeover | null> | null = null;
let lastTakeover: Takeover | null = null;
function runTakeover(info: ServerInfo): Promise<Takeover | null> {
	takeoverRun ??= takeover(info)
		.then((t) => {
			lastTakeover = t;
			if (t.resolved.length || t.unresolved.length || t.unidentified.length) console.log(`[takeover] plugins/: ${describeTakeover(t)}`);
			return t;
		})
		.catch((e) => {
			console.error(`[takeover] ${(e as Error).message}`);
			return null;
		});
	return takeoverRun;
}
async function currentManifest(): Promise<Manifest> {
	const m = await loadManifest();
	if (m && (m.mods.length || takeoverRun)) return m;
	const info = await serverInfo();
	let next = m ?? (await migrateLegacy(info));
	if (!next?.mods.length) {
		const t = await runTakeover(info);
		if (t?.manifest) {
			next = t.manifest;
			console.log(`[takeover] lock seeded with ${next.mods.length} mods from plugins/`);
		}
	}
	next ??= normalizeManifest({ mods: [] }, info, await configHashes());
	if (!m || next !== m) await saveManifest(next);
	return next;
}

// One mutation at a time: installs and restores must not interleave.
let busy: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
	const run = busy.then(fn, fn);
	busy = run.catch(() => {});
	return run;
}

startScheduler(exclusive);
const sync = SyncManager.forServer(exclusive, serverInfo);
await sync.start();

const api = new Hono();
api.use("*", requireToken);

// ---- Always public: enough for the landing page and the client to know what this companion offers ----

/** Docker's HEALTHCHECK and install.sh: the process serves requests. Cheap, no disk or Docker access. */
api.get("/health", (c) => c.json({ ok: true, version: VERSION }));

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
			scheme: DEEPLINK_SCHEME,
			inviteUrl: INVITE_URL || null,
			features: FEATURES,
			authed,
		},
		sync: sync.summary(),
		server: { name: info.name, world: detailed ? info.world : "" },
		container,
		manifest: m ? { hash: m.hash, generatedAt: m.generatedAt, mods: m.mods.length } : null,
		world: world ? { name: world.name, size: world.size, lastSave: world.lastSave } : null,
		release: pending ? summary(pending) : null,
		/** players online from the log; null when logs are off or docker is unreachable */
		online,
	});
});

// ---- Hand-installed servers: what lies in plugins/ and the takeover into the lock ----

/** The last takeover result of this start and what plugins/ holds right now. */
api.get("/takeover", async (c) => c.json({ last: lastTakeover, scan: await scanPlugins(), lock: (await currentManifest()).mods.length }));
/** Runs the takeover again (admin): only while the lock is empty, so a published lock is never overwritten. */
api.post("/takeover", requireFeature("publish"), async (c) => {
	const m = await currentManifest();
	if (m.mods.length) return c.json({ error: "The lock is not empty; publish from the Mod Manager to change it." }, 409);
	takeoverRun = null;
	const t = await exclusive(async () => {
		const r = await runTakeover(await serverInfo());
		if (r?.manifest) await saveManifest(r.manifest);
		return r;
	});
	return c.json({ last: t, scan: await scanPlugins(), lock: t?.manifest?.mods.length ?? 0 });
});

// ---- Sync through a gist: the admin sets it up here, players get the code through the page's button ----

const syncError = (c: Context, e: unknown) => c.json({ error: (e as Error).message }, e instanceof SyncError ? (e.status as 400 | 409) : 400);

/** Code (public read data, like the manifest), gist id, whether the companion can write, last error, release status. */
api.get("/sync", async (c) => c.json(await sync.info()));
/** `{ token, code? }`: a new gist for the token, or join the gist the code names. */
api.post("/sync", async (c) => {
	const body = (await c.req.json().catch(() => null)) as { token?: unknown; code?: unknown } | null;
	if (!body || typeof body.token !== "string") return c.json({ error: "JSON body with a token expected" }, 400);
	try {
		return c.json(await sync.setup(body.token, typeof body.code === "string" ? body.code : undefined));
	} catch (e) {
		return syncError(c, e);
	}
});
api.delete("/sync", async (c) => {
	try {
		return c.json(await sync.remove());
	} catch (e) {
		return syncError(c, e);
	}
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
/** The working state with its plan checked against the server as it is right now. */
async function freshPending(): Promise<Release | null> {
	const r = await pendingRelease();
	if (!r) return null;
	const before = JSON.stringify(r.plan);
	await refreshPlan(r);
	if (JSON.stringify(r.plan) !== before) await savePending(r);
	return r;
}
const pendingJson = async (r: Release | null) => ({ release: r, summary: r ? summary(r) : null, online: await playersOnline() });

api.get("/releases/pending", requireFeature("publish"), async (c) => c.json(await pendingJson(await freshPending())));
/** The review step: every staged config as before/after text plus the changed values. */
api.get("/releases/pending/diff", requireFeature("publish"), async (c) => {
	const r = await freshPending();
	return c.json({ release: r, summary: r ? summary(r) : null, files: r ? await draftDiff(r) : [], online: await playersOnline() });
});
/** Drop one staged config file or the staged lock; the rest of the working state stays. */
api.delete("/releases/pending/configs/:file{.+}", requireFeature("publish"), async (c) => {
	const rel = configRel(c.req.param("file") ?? "");
	if (!rel) return c.json({ error: "invalid config path" }, 400);
	return c.json(await pendingJson(await exclusive(() => revertConfig(rel))));
});
api.delete("/releases/pending/mods", requireFeature("publish"), async (c) =>
	c.json(await pendingJson(await exclusive(async () => revertMods(await serverInfo())))),
);
// { when: "now" | "idle" | "at" | "none", at?: epoch ms, backup?: boolean (default true), force?: boolean }
api.post("/releases/:id/apply", requireFeature("publish"), async (c) => {
	const id = c.req.param("id") ?? "";
	const { when, at, backup, force } = (await c.req.json().catch(() => ({}))) as { when?: string; at?: number; backup?: boolean; force?: boolean };
	try {
		if (when === "now") {
			const log: string[] = [];
			const report = await exclusive(() => applyRelease(id, (l) => log.push(l), { backup: backup !== false, force: force === true }));
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
		const log: string[] = [];
		try {
			// Same safety as a release: verified stop, backup first, start again. `restart: false` leaves the
			// container alone (the admin restarts it); the backup is taken either way.
			const { value, ...report } = await withServerStopped(
				{ world: info.world, label: "pre-manifest", control: body.restart !== false, requireStopped: false, log: (l) => log.push(l) },
				async () => {
					const written: string[] = [];
					for (const f of Array.isArray(body.configs) ? body.configs : []) {
						if (typeof f?.path !== "string" || typeof f?.contentBase64 !== "string") continue;
						const rel = configRel(f.path);
						if (!rel) continue;
						await writeAtomic(join(BEPINEX_CONFIG_DIR, rel), new Uint8Array(Buffer.from(f.contentBase64, "base64")));
						written.push(rel);
					}
					const result = await applyManifest(m, (l) => log.push(l));
					m.configs = await configHashes();
					await saveManifest(m);
					return { ...result, configsWritten: written };
				},
			);
			return c.json({ manifest: m, ...value, ...report, restart: report.started, log });
		} catch (e) {
			return c.json({ error: (e as Error).message, log }, 500);
		}
	});
});

api.get("/installed", async (c) => c.json(await loadInstalled()));

// ---- Configs ----

// The editor works on the working state: a value edit copies the live file into the pending release once
// and changes that copy; the server's file changes when the admin releases. `info` says what an edit
// reaches (ServerSync / Jötunn / client-side) and whether the mod re-reads its file (no restart).
api.get("/configs", async (c) => {
	const files = await listConfigFiles();
	const [info, pending] = await Promise.all([configSyncInfo(files), pendingRelease()]);
	const staged = pending?.configs.filter((f) => files.includes(f)) ?? [];
	const body: Record<string, unknown> = { files, info, staged };
	if (c.req.query("settings") === "1") {
		// Every setting of every file, from the working copies: the search across all configs.
		const settings: Record<string, ReturnType<typeof parseConfigText>> = {};
		for (const f of files) settings[f] = parseConfigText((await workingConfig(f).catch(() => ({ text: "" }))).text);
		body.settings = settings;
	}
	return c.json(body);
});
api.get("/configs/:file{.+}", async (c) => {
	const rel = configRel(c.req.param("file") ?? "");
	if (!rel) return c.json({ error: "invalid config path" }, 400);
	try {
		const w = await workingConfig(rel);
		const settings = parseConfigText(w.text);
		// Values the working copy changes against the live file, so the editor can show "on the server: …".
		const live: Record<string, string> = {};
		if (w.staged) {
			const liveText = await Bun.file(join(BEPINEX_CONFIG_DIR, rel))
				.text()
				.catch(() => "");
			const cur = new Map(parseConfigText(liveText).map((s) => [`${s.section}::${s.key}`, s.value]));
			for (const s of settings) {
				const k = `${s.section}::${s.key}`;
				if (cur.has(k) && cur.get(k) !== s.value) live[k] = cur.get(k)!;
			}
		}
		const info = (await configSyncInfo([rel]))[rel];
		return c.json({ file: rel, settings, staged: w.staged, meta: w.meta, live, info });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
api.put("/configs/:file{.+}", requireFeature("configEdit"), async (c) => {
	const rel = configRel(c.req.param("file") ?? "");
	if (!rel) return c.json({ error: "invalid config path" }, 400);
	const { changes } = ((await c.req.json().catch(() => ({}))) ?? {}) as { changes?: ConfigChange[] };
	// One value per line: a line break would inject further keys or sections into the .cfg.
	if (!Array.isArray(changes) || changes.some((x) => [x?.section, x?.key, x?.value].some((v) => typeof v !== "string" || /[\r\n\0]/.test(v))))
		return c.json({ error: "changes must be single-line strings" }, 400);
	try {
		const r = await exclusive(async () => stageConfigChanges(rel, changes, await serverInfo()));
		return c.json({ ok: true, staged: r.configs.includes(rel), summary: summary(r), effect: r.plan.effects[rel] ?? null });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
});

// ---- Env, control, logs ----

api.get("/env", requireFeature("env"), async (c) => c.json({ entries: await readEnv() }));
api.put("/env", requireFeature("env"), async (c) => {
	const changes = (await c.req.json()) as Record<string, string>;
	try {
		const w = await writeEnv(changes);
		// Compose reads env_file when it creates the container; a restart keeps the old values.
		return c.json({ ...w, recreateRequired: w.changed, applyWith: `docker compose up -d ${process.env.VALHEIM_SERVICE || "valheim"}` });
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
	const name = world || (await activeWorld());
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
		try {
			// A running server would save over the restored world: the restore refuses unless it is down.
			const { value, backup, ...report } = await withServerStopped({ world, label: "pre-restore", control: true, requireStopped: true }, async () => {
				const r = await restoreFiles(id, { world, configs: !!opts.configs });
				let install = null;
				if (opts.mods && contents.manifest && FEATURES.publish) {
					const m = normalizeManifest(contents.manifest, await serverInfo(), {});
					install = await applyManifest(m);
					m.configs = await configHashes();
					await saveManifest(m);
				}
				return { ...r, install };
			});
			return c.json({ ...value, safety: backup, ...report });
		} catch (e) {
			return c.json({ error: (e as Error).message }, 500);
		}
	});
});

const app = new Hono();
app.use("*", securityHeaders);
app.route("/api", api);

// Everything else is the UI. Only GET/HEAD reach it.
app.on(["GET", "HEAD"], "*", (c) => serveUi(c));
const port = Number(process.env.PORT || 9002);
export default { port, fetch: app.fetch, idleTimeout: 255 };
const off = Object.entries(FEATURES)
	.filter(([, v]) => !v)
	.map(([k]) => k);
console.log(`Valheim companion ${VERSION} on http://localhost:${port}  token: ${getTokenSource()}${off.length ? `  disabled: ${off.join(", ")}` : ""}`);
