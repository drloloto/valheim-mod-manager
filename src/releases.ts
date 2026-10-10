// Staged releases: the client publishes a lock + configs, the companion pulls everything it needs and
// checks it, but changes nothing live. The admin then applies it: now, when nobody is online, or at a time.
// Nobody gets kicked by accident.
import { mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { createBackup } from "./backups";
import { FEATURES } from "./config";
import { containerAction } from "./docker";
import { envValue } from "./env";
import { applyManifest, loadInstalled, planChanges, prefetch, type ApplyResult } from "./install";
import { tailLog } from "./logs";
import { configHashes, hashMods, isPack, normalizeManifest, saveManifest, type Manifest, type ServerInfo } from "./manifest";
import { BEPINEX_CONFIG_DIR, MM_DIR } from "./paths";
import { onlineFrom, sessionsFromLog } from "./players";

const RELEASES_DIR = join(MM_DIR, "releases");
const PENDING_FILE = join(RELEASES_DIR, "pending.json");

export interface ReleasePlan {
	install: { id: string; from: string | null; to: string }[];
	remove: string[];
	configsChanged: string[];
	configsNew: string[];
}

export type Schedule = { when: "idle"; setAt: number } | { when: "at"; at: number; setAt: number };

export interface Release {
	id: string;
	createdAt: number;
	manifest: Manifest;
	/** staged config files (relative paths), stored under releases/<id>/config/ */
	configs: string[];
	plan: ReleasePlan;
	problems: string[];
	schedule: Schedule | null;
	/** last scheduler / apply error, shown to the admin */
	lastError: string | null;
}

export interface ReleaseSummary {
	id: string;
	createdAt: number;
	install: number;
	remove: number;
	configs: number;
	problems: string[];
	schedule: Schedule | null;
	lastError: string | null;
}

export const summary = (r: Release): ReleaseSummary => ({
	id: r.id,
	createdAt: r.createdAt,
	install: r.plan.install.length,
	remove: r.plan.remove.length,
	configs: r.plan.configsChanged.length + r.plan.configsNew.length,
	problems: r.problems,
	schedule: r.schedule,
	lastError: r.lastError,
});

export async function pendingRelease(): Promise<Release | null> {
	try {
		return JSON.parse(await readFile(PENDING_FILE, "utf-8")) as Release;
	} catch {
		return null;
	}
}

async function save(r: Release | null): Promise<void> {
	if (r) await Bun.write(PENDING_FILE, JSON.stringify(r, null, 2));
	else await rm(PENDING_FILE, { force: true });
}

export async function discardRelease(id?: string): Promise<boolean> {
	const r = await pendingRelease();
	if (!r || (id && r.id !== id)) return false;
	await rm(join(RELEASES_DIR, r.id), { recursive: true, force: true });
	await save(null);
	return true;
}

const safeRel = (p: string): string | null => {
	const rel = p.replace(/\\/g, "/");
	return rel.startsWith("/") || rel.split("/").some((x) => x === "..") ? null : rel;
};

export interface StageBody {
	mods?: unknown;
	configs?: { path: string; contentBase64: string }[];
}

/** Pulls and checks everything; replaces a previously pending release. */
export async function stageRelease(body: StageBody, info: ServerInfo, log: (l: string) => void = () => {}): Promise<Release> {
	const manifest = normalizeManifest(body, info, {});
	await discardRelease();
	const id = `r${Date.now().toString(36)}`;
	const dir = join(RELEASES_DIR, id, "config");
	await mkdir(dir, { recursive: true });

	const current = await configHashes();
	const configs: string[] = [];
	const configsChanged: string[] = [];
	const configsNew: string[] = [];
	for (const f of Array.isArray(body.configs) ? body.configs : []) {
		if (typeof f?.path !== "string" || typeof f?.contentBase64 !== "string") continue;
		const rel = safeRel(f.path);
		if (!rel) continue;
		const bytes = Buffer.from(f.contentBase64, "base64");
		await Bun.write(join(dir, rel), bytes);
		configs.push(rel);
		const h = new Bun.CryptoHasher("sha256");
		h.update(new Uint8Array(bytes));
		const hash = `sha256:${h.digest("hex")}`;
		if (!(rel in current)) configsNew.push(rel);
		else if (current[rel] !== hash) configsChanged.push(rel);
	}

	const installed = await loadInstalled();
	const { toInstall, toRemove } = planChanges(manifest.mods, installed);
	const problems = await prefetch(toInstall, log);
	const release: Release = {
		id,
		createdAt: Date.now(),
		manifest,
		configs,
		plan: {
			install: toInstall.map((m) => ({ id: m.id, from: installed[m.id]?.version ?? null, to: m.version })),
			remove: toRemove,
			configsChanged,
			configsNew,
		},
		problems,
		schedule: null,
		lastError: null,
	};
	await save(release);
	return release;
}

export async function scheduleRelease(id: string, schedule: Schedule | null): Promise<Release> {
	const r = await pendingRelease();
	if (!r || r.id !== id) throw new Error("no such pending release");
	if (schedule?.when === "idle" && !FEATURES.logs) throw new Error('"when nobody is online" needs the log feature (COMPANION_ALLOW_LOGS)');
	if (schedule?.when === "idle" && (await playersOnline()) === null)
		throw new Error("cannot read the player count from the server log; apply now or at a time instead");
	r.schedule = schedule;
	r.lastError = null;
	await save(r);
	return r;
}

export interface ApplyReport {
	backup: { id: string; size: number } | null;
	stopped: { ok: boolean; message: string } | null;
	result: ApplyResult;
	configsWritten: string[];
	started: { ok: boolean; message: string } | null;
	restartRequired: boolean;
}

/** stop → backup → install lock → write configs → save manifest → start. The caller serializes. */
export async function applyRelease(id: string, log: (l: string) => void = () => {}): Promise<ApplyReport> {
	const r = await pendingRelease();
	if (!r || r.id !== id) throw new Error("no such pending release");
	const stopped = FEATURES.control ? await containerAction("stop") : null;
	try {
		let backup: ApplyReport["backup"] = null;
		if (FEATURES.backups) {
			const world = (await envValue("WORLD_NAME")) || "";
			try {
				const b = await createBackup(world, "pre-release");
				backup = { id: b.id, size: b.size };
				log(`backup ${b.id}`);
			} catch (e) {
				log(`backup skipped: ${(e as Error).message}`);
			}
		}
		const result = await applyManifest(r.manifest, log);
		const configsWritten: string[] = [];
		for (const rel of r.configs) {
			await Bun.write(join(BEPINEX_CONFIG_DIR, rel), Bun.file(join(RELEASES_DIR, r.id, "config", rel)));
			configsWritten.push(rel);
		}
		// The saved manifest describes what is really installed: a mod whose download failed stays out, so
		// clients keep seeing it as missing on the server instead of "in sync".
		const m = r.manifest;
		const inst = await loadInstalled();
		m.mods = m.mods.filter((x) => isPack(x.id) || inst[x.id]?.version === x.version);
		m.hash = hashMods(m.mods);
		m.configs = await configHashes();
		await saveManifest(m);
		await discardRelease(r.id);
		const started = FEATURES.control ? await containerAction("start") : null;
		return { backup, stopped, result, configsWritten, started, restartRequired: !FEATURES.control };
	} catch (e) {
		if (FEATURES.control) await containerAction("start");
		r.lastError = (e as Error).message;
		await save(r);
		throw e;
	}
}

export async function playersOnline(): Promise<number | null> {
	if (!FEATURES.logs) return null;
	try {
		return onlineFrom(sessionsFromLog(await tailLog(2000))).length;
	} catch {
		return null;
	}
}

/** Runs every 30 s: applies the pending release when its schedule says so. */
export function startScheduler(exclusive: <T>(fn: () => Promise<T>) => Promise<T>) {
	let busy = false;
	setInterval(async () => {
		if (busy) return;
		const r = await pendingRelease();
		if (!r?.schedule) return;
		let due = false;
		if (r.schedule.when === "at") due = Date.now() >= r.schedule.at;
		else {
			const n = await playersOnline();
			due = n === 0;
			if (n === null) {
				r.lastError = "cannot read the player count from the log; apply manually";
				r.schedule = null;
				await save(r);
				return;
			}
		}
		if (!due) return;
		busy = true;
		try {
			await exclusive(() => applyRelease(r.id, (l) => console.log(`[release ${r.id}] ${l}`)));
			console.log(`[release ${r.id}] applied by schedule`);
		} catch (e) {
			console.error(`[release ${r.id}] failed: ${(e as Error).message}`);
		} finally {
			busy = false;
		}
	}, 30_000);
}
