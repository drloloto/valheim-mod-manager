// The working state ("pending release"): everything the admin wants to change on the server, collected
// from the Mod Manager (a published lock, optionally configs), the gist mailbox and the web UI's config
// editor. Nothing of it is live until the admin releases it: now, when nobody is online, or at a time. The
// release then stops the server (only when something needs a restart), backs the world up, installs the
// lock, writes the configs and starts the server again. Nobody gets kicked by accident.
import { mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { applyConfigChanges, parseConfigText, type ConfigChange, type ConfigSetting } from "./bepinexconfig";
import { FEATURES } from "./config";
import { activeWorld } from "./env";
import { writeAtomic } from "./fsutil";
import { applyManifest, firstTakeover, loadInstalled, planChanges, prefetch, untrackedFiles, type ApplyResult } from "./install";
import { withServerStopped } from "./maintenance";
import { tailLog } from "./logs";
import { configHashes, hashMods, isPack, loadManifest, normalizeManifest, sameMods, saveManifest, type Manifest, type ServerInfo } from "./manifest";
import { configRel } from "./configdir";
import { configSyncInfo, type ConfigSync } from "./modsync";
import { BEPINEX_CONFIG_DIR, MM_DIR } from "./paths";
import { onlineFrom, sessionsFromLog } from "./players";

const RELEASES_DIR = join(MM_DIR, "releases");
const PENDING_FILE = join(RELEASES_DIR, "pending.json");
/** a config file larger than this is staged but not shown as a diff */
export const MAX_DIFF_BYTES = 512 * 1024;

export type Source = "client" | "web" | "gist";

export interface ReleasePlan {
	install: { id: string; from: string | null; to: string }[];
	remove: string[];
	configsChanged: string[];
	configsNew: string[];
	/** staged files whose live copy changed after the working copy was taken (an in-game write-back, a hand edit) */
	conflicts: string[];
	/** first apply on a hand-installed server: these plugin files are moved aside (kept, not deleted) */
	untracked?: string[];
	/** mods change, or a changed config belongs to a mod that does not re-read its file */
	restartRequired: boolean;
	/** what each staged config reaches (see modsync.ts) */
	effects: Record<string, ConfigSync>;
}

export type Schedule = { when: "idle"; setAt: number } | { when: "at"; at: number; setAt: number };

export interface ConfigMeta {
	source: Source;
	at: number;
	/** sha256 of the live file when the working copy was taken; null when the file did not exist */
	baseHash: string | null;
}

export interface Release {
	id: string;
	createdAt: number;
	updatedAt: number;
	/** what the admin calls it: the profile that was published; null for web edits and older files */
	name?: string | null;
	manifest: Manifest;
	/** who provided the lock; null = the mods are the server's current ones (config-only working state) */
	modsFrom: Source | null;
	modsAt: number | null;
	/** staged config files (relative paths), stored under releases/<id>/config/ */
	configs: string[];
	configMeta: Record<string, ConfigMeta>;
	plan: ReleasePlan;
	problems: string[];
	schedule: Schedule | null;
	/** last scheduler / apply error, shown to the admin */
	lastError: string | null;
}

export interface ReleaseSummary {
	id: string;
	name: string | null;
	createdAt: number;
	updatedAt: number;
	modsFrom: Source | null;
	install: number;
	remove: number;
	configs: number;
	conflicts: number;
	/** hand-installed files that the first apply moves aside */
	untracked: number;
	restartRequired: boolean;
	/** nothing differs from the server: releasing it changes nothing */
	empty: boolean;
	problems: string[];
	schedule: Schedule | null;
	lastError: string | null;
}

export const isEmptyPlan = (p: ReleasePlan) => !p.install.length && !p.remove.length && !p.configsChanged.length && !p.configsNew.length;

export const summary = (r: Release): ReleaseSummary => ({
	id: r.id,
	name: r.name ?? null,
	createdAt: r.createdAt,
	updatedAt: r.updatedAt ?? r.createdAt,
	modsFrom: r.modsFrom ?? null,
	install: r.plan.install.length,
	remove: r.plan.remove.length,
	configs: r.plan.configsChanged.length + r.plan.configsNew.length,
	conflicts: r.plan.conflicts?.length ?? 0,
	untracked: r.plan.untracked?.length ?? 0,
	restartRequired: r.plan.restartRequired ?? true,
	empty: isEmptyPlan(r.plan),
	problems: r.problems,
	schedule: r.schedule,
	lastError: r.lastError,
});

export async function pendingRelease(): Promise<Release | null> {
	try {
		const r = JSON.parse(await readFile(PENDING_FILE, "utf-8")) as Release;
		// files written by 0.3 lack the working-state fields
		r.updatedAt ??= r.createdAt;
		r.modsFrom ??= "client";
		r.modsAt ??= r.createdAt;
		r.configMeta ??= {};
		r.plan.conflicts ??= [];
		r.plan.restartRequired ??= true;
		r.plan.effects ??= {};
		return r;
	} catch {
		return null;
	}
}

export async function savePending(r: Release | null): Promise<void> {
	if (r) await writeAtomic(PENDING_FILE, JSON.stringify(r, null, 2));
	else await rm(PENDING_FILE, { force: true });
}

export async function discardRelease(id?: string): Promise<boolean> {
	const r = await pendingRelease();
	if (!r || (id && r.id !== id)) return false;
	await rm(join(RELEASES_DIR, r.id), { recursive: true, force: true });
	await savePending(null);
	return true;
}

const draftDir = (r: Release) => join(RELEASES_DIR, r.id, "config");
const liveFile = (rel: string) => join(BEPINEX_CONFIG_DIR, rel);

function sha256(bytes: Uint8Array): string {
	const h = new Bun.CryptoHasher("sha256");
	h.update(bytes);
	return `sha256:${h.digest("hex")}`;
}

async function liveHash(rel: string): Promise<string | null> {
	const f = Bun.file(liveFile(rel));
	return (await f.exists()) ? sha256(new Uint8Array(await f.arrayBuffer())) : null;
}

/** The server's current lock; without one, what installed.json says is on disk (never an empty lock, which would plan to remove everything). */
async function currentMods(info: ServerInfo): Promise<Manifest> {
	const m = await loadManifest();
	if (m) return m;
	const mods = Object.entries(await loadInstalled()).map(([id, { version }]) => ({ id, version, explicit: true, requiredBy: [] }));
	return normalizeManifest({ mods }, info, {});
}

async function newRelease(info: ServerInfo): Promise<Release> {
	const id = `r${Date.now().toString(36)}`;
	await mkdir(join(RELEASES_DIR, id, "config"), { recursive: true });
	return {
		id,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		manifest: await currentMods(info),
		modsFrom: null,
		modsAt: null,
		configs: [],
		configMeta: {},
		plan: { install: [], remove: [], configsChanged: [], configsNew: [], conflicts: [], restartRequired: false, effects: {} },
		problems: [],
		schedule: null,
		lastError: null,
	};
}

/** Recomputes the plan against the server as it is now (installed mods, live config hashes, sync info). */
export async function refreshPlan(r: Release): Promise<Release> {
	const installed = await loadInstalled();
	const { toInstall, toRemove } = planChanges(r.manifest.mods, installed);
	const current = await configHashes();
	const configsChanged: string[] = [];
	const configsNew: string[] = [];
	const conflicts: string[] = [];
	const kept: string[] = [];
	for (const rel of r.configs) {
		const f = Bun.file(join(draftDir(r), rel));
		if (!(await f.exists())) continue;
		kept.push(rel);
		const hash = sha256(new Uint8Array(await f.arrayBuffer()));
		if (!(rel in current)) configsNew.push(rel);
		else if (current[rel] !== hash) configsChanged.push(rel);
		const base = r.configMeta[rel]?.baseHash;
		if (base !== undefined && (current[rel] ?? null) !== base && current[rel] !== hash) conflicts.push(rel);
	}
	r.configs = kept;
	const staged = [...configsChanged, ...configsNew];
	const effects = staged.length ? await configSyncInfo(staged) : {};
	const modsChange = toInstall.length > 0 || toRemove.length > 0;
	r.plan = {
		install: toInstall.map((m) => ({ id: m.id, from: installed[m.id]?.version ?? null, to: m.version })),
		remove: toRemove,
		configsChanged,
		configsNew,
		conflicts,
		untracked: modsChange && (await firstTakeover()) ? await untrackedFiles(installed) : [],
		// Any config change restarts the server. The live-reload hint in `effects` is a string scan of the DLL and
		// cannot tell which file is watched; skipping the restart on it once left edits silently ineffective.
		restartRequired: modsChange || staged.length > 0,
		effects,
	};
	r.updatedAt = Date.now();
	return r;
}

export interface StageBody {
	mods?: unknown;
	/** what the admin calls the release: the profile's name */
	name?: unknown;
	configs?: { path: string; contentBase64: string }[];
}

/**
 * A lock from the Mod Manager or the gist: becomes the working state's mods (replacing an earlier lock),
 * its config files are staged on top of what the web editor already holds. Every zip is pulled and checked;
 * nothing changes live.
 */
export async function stageRelease(body: StageBody, info: ServerInfo, log: (l: string) => void = () => {}, source: Source = "client"): Promise<Release> {
	const manifest = normalizeManifest(body, info, {});
	const r = (await pendingRelease()) ?? (await newRelease(info));
	r.manifest = manifest;
	r.modsFrom = source;
	r.modsAt = Date.now();
	r.name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : null;
	r.schedule = null;
	r.lastError = null;
	for (const f of Array.isArray(body.configs) ? body.configs : []) {
		if (typeof f?.path !== "string" || typeof f?.contentBase64 !== "string") continue;
		const rel = configRel(f.path);
		if (!rel) continue;
		await writeAtomic(join(draftDir(r), rel), new Uint8Array(Buffer.from(f.contentBase64, "base64")));
		if (!r.configs.includes(rel)) r.configs.push(rel);
		r.configMeta[rel] = { source, at: Date.now(), baseHash: await liveHash(rel) };
	}
	const installed = await loadInstalled();
	r.problems = await prefetch(planChanges(manifest.mods, installed).toInstall, log);
	await refreshPlan(r);
	await savePending(r);
	return r;
}

/** The working copy of a config (staged text) or the live file when nothing is staged. */
export async function workingConfig(rel: string): Promise<{ text: string; staged: boolean; meta: ConfigMeta | null }> {
	const r = await pendingRelease();
	if (r && r.configs.includes(rel)) {
		const f = Bun.file(join(draftDir(r), rel));
		if (await f.exists()) return { text: await f.text(), staged: true, meta: r.configMeta[rel] ?? null };
	}
	return { text: await readFile(liveFile(rel), "utf-8"), staged: false, meta: null };
}

/**
 * A value edit from the web UI: the live file is copied into the working state once, the change applied to
 * that copy. A copy that ends up identical to the live file is dropped again.
 */
export async function stageConfigChanges(rel: string, changes: ConfigChange[], info: ServerInfo, source: Source = "web"): Promise<Release> {
	const r = (await pendingRelease()) ?? (await newRelease(info));
	const path = join(draftDir(r), rel);
	let base: string;
	if (r.configs.includes(rel) && (await Bun.file(path).exists())) base = await Bun.file(path).text();
	else {
		base = await readFile(liveFile(rel), "utf-8");
		r.configMeta[rel] = { source, at: Date.now(), baseHash: await liveHash(rel) };
	}
	const next = applyConfigChanges(base, changes);
	const live = (await Bun.file(liveFile(rel)).exists()) ? await readFile(liveFile(rel), "utf-8") : null;
	if (next === live) {
		await rm(path, { force: true });
		r.configs = r.configs.filter((x) => x !== rel);
		delete r.configMeta[rel];
	} else {
		await writeAtomic(path, next);
		if (!r.configs.includes(rel)) r.configs.push(rel);
		r.configMeta[rel] = { ...(r.configMeta[rel] ?? { baseHash: await liveHash(rel) }), source, at: Date.now() };
	}
	await refreshPlan(r);
	await savePending(r);
	return r;
}

/** Drops one staged file: the server's live file stays what it is. */
export async function revertConfig(rel: string): Promise<Release | null> {
	const r = await pendingRelease();
	if (!r || !r.configs.includes(rel)) return r;
	await rm(join(draftDir(r), rel), { force: true });
	r.configs = r.configs.filter((x) => x !== rel);
	delete r.configMeta[rel];
	await refreshPlan(r);
	await savePending(r);
	return r;
}

/** Drops the staged lock: the working state keeps its configs, the mods fall back to the server's current ones. */
export async function revertMods(info: ServerInfo): Promise<Release | null> {
	const r = await pendingRelease();
	if (!r) return null;
	r.manifest = await currentMods(info);
	r.modsFrom = null;
	r.modsAt = null;
	r.problems = [];
	await refreshPlan(r);
	await savePending(r);
	return r;
}

export interface ConfigDiff {
	path: string;
	status: "changed" | "new";
	/** live text, null for a new file */
	before: string | null;
	after: string | null;
	/** both texts omitted: the file is over MAX_DIFF_BYTES */
	tooLarge: boolean;
	conflict: boolean;
	meta: ConfigMeta | null;
	effect: ConfigSync | null;
	/** value-level view of the same change for the review step */
	changes: { section: string; key: string; from: string | null; to: string | null }[];
}

function settingMap(settings: ConfigSetting[]): Map<string, string> {
	return new Map(settings.map((s) => [`${s.section}::${s.key}`, s.value]));
}

/** Side-by-side material for the review step: every staged file as text and as changed values. */
export async function draftDiff(r: Release): Promise<ConfigDiff[]> {
	const out: ConfigDiff[] = [];
	for (const rel of [...r.plan.configsChanged, ...r.plan.configsNew]) {
		const after = Bun.file(join(draftDir(r), rel));
		const live = Bun.file(liveFile(rel));
		const isNew = !(await live.exists());
		const tooLarge = after.size > MAX_DIFF_BYTES || (!isNew && live.size > MAX_DIFF_BYTES);
		const texts = tooLarge ? { before: null, after: null } : { before: isNew ? null : await live.text(), after: await after.text() };
		const changes: ConfigDiff["changes"] = [];
		if (!tooLarge && rel.toLowerCase().endsWith(".cfg")) {
			const a = settingMap(parseConfigText(texts.before ?? ""));
			const b = settingMap(parseConfigText(texts.after ?? ""));
			for (const [k, v] of b) if (a.get(k) !== v) changes.push({ section: k.split("::")[0], key: k.split("::")[1], from: a.get(k) ?? null, to: v });
			for (const [k, v] of a) if (!b.has(k)) changes.push({ section: k.split("::")[0], key: k.split("::")[1], from: v, to: null });
		}
		out.push({
			path: rel,
			status: isNew ? "new" : "changed",
			...texts,
			tooLarge,
			conflict: r.plan.conflicts.includes(rel),
			meta: r.configMeta[rel] ?? null,
			effect: r.plan.effects[rel] ?? null,
			changes,
		});
	}
	return out;
}

export async function scheduleRelease(id: string, schedule: Schedule | null): Promise<Release> {
	const r = await pendingRelease();
	if (!r || r.id !== id) throw new Error("no such pending release");
	if (schedule?.when === "idle" && !FEATURES.logs) throw new Error('"when nobody is online" needs the log feature (COMPANION_ALLOW_LOGS)');
	if (schedule?.when === "idle" && (await playersOnline()) === null)
		throw new Error("cannot read the player count from the server log; apply now or at a time instead");
	r.schedule = schedule;
	r.lastError = null;
	await savePending(r);
	return r;
}

export interface ApplyOptions {
	/** take a backup first (default true) */
	backup?: boolean;
	/** overwrite files whose live copy changed since they were staged (default: refuse) */
	force?: boolean;
}

export interface ApplyReport {
	backup: { id: string; size: number } | null;
	stopped: { ok: boolean; message: string } | null;
	result: ApplyResult;
	configsWritten: string[];
	started: { ok: boolean; message: string } | null;
	/** the companion could not restart the server although the change needs it: the admin restarts it */
	restartRequired: boolean;
	/** the server was not stopped because nothing needed a restart */
	stayedUp: boolean;
	/** nothing differed from the server any more; the working state was dropped */
	nothingToDo: boolean;
}

const emptyResult = (): ApplyResult => ({ installed: [], removed: [], errors: [], movedAside: [], movedAsideTo: null });

/**
 * stop (verified, only when something needs a restart) → backup (unless skipped) → install lock → write
 * configs → save manifest → start. A failed stop or backup aborts before anything changes. The caller serializes.
 */
export async function applyRelease(id: string, log: (l: string) => void = () => {}, opts: ApplyOptions = {}): Promise<ApplyReport> {
	const r = await pendingRelease();
	if (!r || r.id !== id) throw new Error("no such pending release");
	await refreshPlan(r);
	if (isEmptyPlan(r.plan)) {
		log("nothing differs from the server; working state dropped");
		await discardRelease(r.id);
		return { backup: null, stopped: null, result: emptyResult(), configsWritten: [], started: null, restartRequired: false, stayedUp: true, nothingToDo: true };
	}
	if (r.plan.conflicts.length && !opts.force)
		throw new Error(
			`${r.plan.conflicts.length} staged file(s) changed on the server meanwhile: ${r.plan.conflicts.join(", ")}. Review them, revert or release with force.`,
		);
	const restart = r.plan.restartRequired;
	try {
		const { value, ...report } = await withServerStopped(
			{ world: await activeWorld(), label: "pre-release", control: restart, requireStopped: false, backup: opts.backup !== false, log },
			async () => {
				const result = r.plan.install.length || r.plan.remove.length ? await applyManifest(r.manifest, log) : emptyResult();
				const configsWritten: string[] = [];
				for (const rel of [...r.plan.configsChanged, ...r.plan.configsNew]) {
					await writeAtomic(liveFile(rel), new Uint8Array(await readFile(join(draftDir(r), rel))));
					configsWritten.push(rel);
				}
				if (configsWritten.length) log(`wrote ${configsWritten.length} config file(s)`);
				// The saved manifest describes what is really installed: a mod whose download failed stays out, so
				// clients keep seeing it as missing on the server instead of "in sync".
				const m = r.manifest;
				const inst = await loadInstalled();
				m.mods = m.mods.filter((x) => isPack(x.id) || inst[x.id]?.version === x.version);
				m.hash = hashMods(m.mods);
				m.generatedAt = Date.now();
				m.configs = await configHashes();
				m.release = { id: r.id, name: r.name ?? null, appliedAt: Date.now(), source: r.modsFrom ?? null };
				await saveManifest(m);
				await discardRelease(r.id);
				return { result, configsWritten };
			},
		);
		return { ...report, ...value, restartRequired: restart && report.restartRequired, stayedUp: !restart, nothingToDo: false };
	} catch (e) {
		r.lastError = (e as Error).message;
		// the release is still pending unless the apply got as far as discarding it
		if ((await pendingRelease())?.id === r.id) await savePending(r);
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

/** True when the working state carries no lock of its own and no configs: the server's state, unchanged. */
export const sameAsServer = async (r: Release): Promise<boolean> => {
	const m = await loadManifest();
	return !r.configs.length && (!m || sameMods(m.mods, r.manifest.mods));
};

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
				await savePending(r);
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
