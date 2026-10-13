// Sync through a gist instead of an open port. Two sealed files in one unlisted gist:
//   release.json  written by the admin's Mod Manager: the lock + configs + when to apply
//   server.json   written by the companion: what the server runs now (lock + configs) and the release status
// Players and the admin only ever need the sync code (gist id + secret). The companion polls the gist, hands a
// new release to the existing staging pipeline and reports back. No port is published for any of this.
import { readFile } from "fs/promises";
import { join } from "path";
import { walkConfigs } from "./configdir";
import { writeAtomic } from "./fsutil";
import { GITHUB_API, GistMailbox, RateLimited, type Mailbox } from "./gist";
import { isConfigFile, loadManifest, type Manifest, type ServerInfo } from "./manifest";
import { BEPINEX_CONFIG_DIR, MM_DIR } from "./paths";
import { applyRelease, pendingRelease, scheduleRelease, stageRelease, type Release, type Schedule, type StageBody } from "./releases";
import { deriveKey, isEnvelope, makeSyncCode, newSecret, openJson, parseSyncCode, sealJson } from "./synccrypto";

export const RELEASE_FILE = "release.json";
export const SERVER_FILE = "server.json";
const STATE_FILE = join(MM_DIR, "sync-state.json");
/** one config file above this is left out of server.json, and the whole set is capped. The sealed file is gzipped
 *  (configs are text, ~10:1), so even the cap stays below the gist API's 1 MB truncation mark in practice; a
 *  truncated file is still read whole through raw_url. */
const MAX_CONFIG_FILE = 512 * 1024;
const MAX_CONFIG_TOTAL = 3 * 1024 * 1024;

export interface ConfigFile {
	path: string;
	contentBase64: string;
}

/** release.json as the admin writes it. `id` is the admin's own id; the companion handles each id once. */
export interface ReleaseFile {
	v: 1;
	id: string;
	createdAt: number;
	message?: string;
	mods: unknown;
	configs?: ConfigFile[];
	/** default: "none" (stage only; the admin applies from the companion UI) */
	apply?: { when: "now" | "idle" | "at" | "none"; at?: number };
}

export type ReleaseState = "staged" | "scheduled" | "applied" | "failed" | "rejected" | "discarded";

export interface ReleaseStatus {
	/** the admin's id from release.json */
	id: string;
	/** the companion's pending-release id, while one exists */
	companionId: string | null;
	state: ReleaseState;
	handledAt: number;
	problems: string[];
	error: string | null;
	schedule: Schedule | null;
	plan: { install: number; remove: number; configs: number } | null;
}

/** server.json as the companion writes it. */
export interface ServerFile {
	v: 1;
	updatedAt: number;
	server: { name: string; world: string };
	manifest: Pick<Manifest, "hash" | "generatedAt" | "mods"> | null;
	configs: ConfigFile[];
	configsSkipped: string[];
	release: ReleaseStatus | null;
}

export interface SyncState {
	lastReleaseId: string | null;
	release: ReleaseStatus | null;
	/** hash of the last server.json we wrote (without updatedAt), so an unchanged server writes nothing */
	lastServerHash: string | null;
}

export interface Snapshot {
	server: { name: string; world: string };
	manifest: Manifest | null;
	configs: ConfigFile[];
	configsSkipped: string[];
}

/** Everything syncOnce touches, so the test can run it without a config dir or Docker. */
export interface SyncDeps {
	mailbox: Mailbox;
	key: Buffer;
	canWrite: boolean;
	stage(body: StageBody): Promise<Release>;
	schedule(id: string, s: Schedule | null): Promise<Release>;
	apply(id: string): Promise<void>;
	pending(): Promise<Release | null>;
	snapshot(): Promise<Snapshot>;
	loadState(): Promise<SyncState>;
	saveState(s: SyncState): Promise<void>;
	log(line: string): void;
	now?: () => number;
}

const emptyState = (): SyncState => ({ lastReleaseId: null, release: null, lastServerHash: null });

function validateRelease(raw: unknown): ReleaseFile {
	const r = raw as Partial<ReleaseFile> | null;
	if (!r || r.v !== 1) throw new Error("release.json: unsupported version");
	if (typeof r.id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(r.id)) throw new Error("release.json: id missing or invalid");
	if (!Array.isArray(r.mods)) throw new Error("release.json: mods must be an array");
	const when = r.apply?.when ?? "none";
	if (!["now", "idle", "at", "none"].includes(when)) throw new Error("release.json: apply.when must be now, idle, at or none");
	if (when === "at" && typeof r.apply?.at !== "number") throw new Error("release.json: apply.at (epoch ms) is required for when=at");
	return { ...r, v: 1, id: r.id, mods: r.mods, createdAt: typeof r.createdAt === "number" ? r.createdAt : 0, apply: { when, at: r.apply?.at } };
}

function sha(text: string): string {
	const h = new Bun.CryptoHasher("sha256");
	h.update(text);
	return h.digest("hex");
}

/** One poll: pick up a new release, refresh the status of the current one, publish server.json when it changed. */
export async function syncOnce(d: SyncDeps): Promise<{ handled: string | null; wrote: boolean }> {
	const now = d.now ?? Date.now;
	const state = await d.loadState();
	let handled: string | null = null;

	const files = await d.mailbox.fetch();
	if (files?.[RELEASE_FILE] && isEnvelope(files[RELEASE_FILE].text)) {
		let rel: ReleaseFile | null = null;
		let bad: string | null = null;
		// A file we cannot open or validate is still "a release we saw": remembered by its own id when it has
		// one, else by its content hash, so the log shows the problem once and not every poll.
		let id = `invalid:${sha(files[RELEASE_FILE].text).slice(0, 12)}`;
		try {
			const raw = openJson<{ id?: unknown }>(d.key, RELEASE_FILE, files[RELEASE_FILE].text);
			if (typeof raw?.id === "string" && raw.id) id = raw.id;
			rel = validateRelease(raw);
		} catch (e) {
			bad = (e as Error).message;
		}
		if (id !== state.lastReleaseId) {
			state.lastReleaseId = id;
			handled = id;
			if (!rel) {
				d.log(`release rejected: ${bad}`);
				state.release = { id, companionId: null, state: "rejected", handledAt: now(), problems: [], error: bad, schedule: null, plan: null };
			} else {
				state.release = await handleRelease(d, rel, now);
			}
			await d.saveState(state);
		}
	}

	// A staged or scheduled release is finished by the companion's scheduler or the admin in the UI: follow it.
	if (state.release && (state.release.state === "staged" || state.release.state === "scheduled")) {
		const p = await d.pending();
		const s = state.release;
		if (p && p.id === s.companionId) {
			s.schedule = p.schedule;
			s.problems = p.problems;
			if (p.lastError) {
				s.state = "failed";
				s.error = p.lastError;
			} else s.state = p.schedule ? "scheduled" : "staged";
		} else if (!p) {
			const m = await d.snapshot().then((x) => x.manifest);
			s.state = m && m.generatedAt >= s.handledAt ? "applied" : "discarded";
			s.companionId = null;
			s.schedule = null;
		}
	}

	const snap = await d.snapshot();
	const body: Omit<ServerFile, "updatedAt"> = {
		v: 1,
		server: snap.server,
		manifest: snap.manifest ? { hash: snap.manifest.hash, generatedAt: snap.manifest.generatedAt, mods: snap.manifest.mods } : null,
		configs: snap.configs,
		configsSkipped: snap.configsSkipped,
		release: state.release,
	};
	// What the server runs, without the timestamp the manifest gets on every regeneration: a server that stands
	// still writes nothing. That matters because gist writes are limited to 100 per hour per user, and the
	// admin's publishes come out of the same bucket.
	const hash = sha(JSON.stringify({ ...body, manifest: body.manifest && { hash: body.manifest.hash, mods: body.manifest.mods } }));
	let wrote = false;
	if (hash !== state.lastServerHash) {
		if (d.canWrite) {
			await d.mailbox.put(SERVER_FILE, sealJson(d.key, SERVER_FILE, { ...body, updatedAt: now() } satisfies ServerFile));
			state.lastServerHash = hash;
			wrote = true;
		} else if (!state.lastServerHash) d.log("no gist token: the server state is not published (release.json is still read)");
	}
	await d.saveState(state);
	return { handled, wrote };
}

async function handleRelease(d: SyncDeps, rel: ReleaseFile, now: () => number): Promise<ReleaseStatus> {
	const status: ReleaseStatus = { id: rel.id, companionId: null, state: "staged", handledAt: now(), problems: [], error: null, schedule: null, plan: null };
	d.log(`release ${rel.id} received${rel.message ? `: ${rel.message}` : ""}`);
	try {
		const r = await d.stage({ mods: rel.mods, configs: rel.configs });
		status.companionId = r.id;
		status.problems = r.problems;
		status.plan = { install: r.plan.install.length, remove: r.plan.remove.length, configs: r.plan.configsChanged.length + r.plan.configsNew.length };
		const when = rel.apply?.when ?? "none";
		if (when === "now") {
			await d.apply(r.id);
			status.state = "applied";
			status.companionId = null;
			d.log(`release ${rel.id} applied`);
		} else if (when === "idle" || when === "at") {
			const s: Schedule = when === "idle" ? { when: "idle", setAt: now() } : { when: "at", at: rel.apply!.at!, setAt: now() };
			await d.schedule(r.id, s);
			status.state = "scheduled";
			status.schedule = s;
			d.log(`release ${rel.id} staged and scheduled (${when})`);
		} else d.log(`release ${rel.id} staged; apply it from the companion UI`);
	} catch (e) {
		status.state = status.companionId ? "failed" : "rejected";
		status.error = (e as Error).message;
		d.log(`release ${rel.id} ${status.state}: ${status.error}`);
	}
	return status;
}

/** The config files as the client should have them; big ones are listed in `configsSkipped` instead. */
export async function readConfigs(dir = BEPINEX_CONFIG_DIR): Promise<{ configs: ConfigFile[]; configsSkipped: string[] }> {
	const configs: ConfigFile[] = [];
	const configsSkipped: string[] = [];
	let total = 0;
	for (const rel of await walkConfigs(isConfigFile, dir)) {
		const bytes = await readFile(join(dir, rel));
		if (bytes.length > MAX_CONFIG_FILE || total + bytes.length > MAX_CONFIG_TOTAL) {
			configsSkipped.push(rel);
			continue;
		}
		total += bytes.length;
		configs.push({ path: rel, contentBase64: bytes.toString("base64") });
	}
	return { configs, configsSkipped };
}

async function loadStateFile(): Promise<SyncState> {
	try {
		return { ...emptyState(), ...(JSON.parse(await readFile(STATE_FILE, "utf-8")) as Partial<SyncState>) };
	} catch {
		return emptyState();
	}
}

export interface GistSyncEnv {
	code?: string;
	token?: string;
	api?: string;
	pollSeconds?: number;
}

export function envConfig(env: NodeJS.ProcessEnv = process.env): GistSyncEnv {
	return {
		code: env.COMPANION_SYNC_CODE?.trim() || undefined,
		token: env.COMPANION_GIST_TOKEN?.trim() || undefined,
		api: env.COMPANION_GIST_API?.trim().replace(/\/$/, "") || GITHUB_API,
		pollSeconds: Math.max(10, Number(env.COMPANION_GIST_POLL) || 60),
	};
}

/** Starts the poller when COMPANION_SYNC_CODE is set; otherwise the feature is off and nothing happens. */
export function startGistSync(exclusive: <T>(fn: () => Promise<T>) => Promise<T>, serverInfo: () => Promise<ServerInfo>, cfg = envConfig()): boolean {
	if (!cfg.code) return false;
	let code;
	try {
		code = parseSyncCode(cfg.code);
	} catch (e) {
		console.error(`[sync] COMPANION_SYNC_CODE ignored: ${(e as Error).message}`);
		return false;
	}
	const log = (l: string) => console.log(`[sync] ${l}`);
	const deps: SyncDeps = {
		mailbox: new GistMailbox(code.gistId, cfg.token ?? null, cfg.api),
		key: deriveKey(code.secret),
		canWrite: !!cfg.token,
		stage: (body) => exclusive(async () => stageRelease(body, await serverInfo(), log, "gist")),
		schedule: scheduleRelease,
		apply: async (id) => {
			await exclusive(() => applyRelease(id, log));
		},
		pending: pendingRelease,
		snapshot: async () => {
			const info = await serverInfo();
			return { server: { name: info.name, world: info.world }, manifest: await loadManifest(), ...(await readConfigs()) };
		},
		loadState: loadStateFile,
		saveState: (s) => writeAtomic(STATE_FILE, JSON.stringify(s, null, 2)),
		log,
	};
	log(`gist ${code.gistId} every ${cfg.pollSeconds}s via ${cfg.api}${cfg.token ? "" : " (read-only: no COMPANION_GIST_TOKEN)"}`);
	let busy = false;
	let lastError = "";
	const tick = async () => {
		if (busy) return;
		busy = true;
		try {
			await syncOnce(deps);
			if (lastError) log("sync works again");
			lastError = "";
		} catch (e) {
			// The same failure (a used-up rate limit, an unreachable API) is logged once, not every poll. A
			// rate-limit message counts down the minutes, so it is compared by its bucket, not its text.
			const key = e instanceof RateLimited ? `rate-limited:${e.resource}` : (e as Error).message;
			if (key !== lastError) {
				console.error(`[sync] ${(e as Error).message}`);
				if (process.env.COMPANION_DEBUG) console.error((e as Error).stack);
			}
			lastError = key;
		} finally {
			busy = false;
		}
	};
	void tick();
	setInterval(tick, cfg.pollSeconds! * 1000);
	return true;
}

// ---- CLI: what the Mod Manager does, runnable from a shell (create a gist, publish, read) ----
//   bun run src/gistsync.ts create  --token T [--api URL]            → new gist + sync code
//   bun run src/gistsync.ts publish <code> <release.json> --token T  → seal and upload release.json
//   bun run src/gistsync.ts read    <code> [--token T]               → print server.json (and release.json) decrypted
//   bun run src/gistsync.ts code    <gist id>                        → sync code with a fresh secret for an existing gist
if (import.meta.main) {
	const args = process.argv.slice(2);
	const opt = (name: string) => {
		const i = args.indexOf(`--${name}`);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
	const api = opt("api") ?? GITHUB_API;
	const token = opt("token") ?? process.env.COMPANION_GIST_TOKEN;
	const cmd = pos[0];
	try {
		if (cmd === "create") {
			if (!token) throw new Error("--token is required");
			const secret = newSecret();
			const gistId = await GistMailbox.create(token, { [SERVER_FILE]: "{}", [RELEASE_FILE]: "{}" }, "Valheim Mod Manager sync (sealed)", api);
			console.log(makeSyncCode({ gistId, secret }));
		} else if (cmd === "code") {
			console.log(makeSyncCode({ gistId: pos[1] ?? "", secret: newSecret() }));
		} else if (cmd === "publish") {
			if (!token) throw new Error("--token is required");
			const code = parseSyncCode(pos[1] ?? "");
			const rel = JSON.parse(await readFile(pos[2], "utf-8")) as Partial<ReleaseFile>;
			rel.v = 1;
			rel.id ||= `rel-${Date.now().toString(36)}`;
			rel.createdAt ||= Date.now();
			const box = new GistMailbox(code.gistId, token, api);
			await box.put(RELEASE_FILE, sealJson(deriveKey(code.secret), RELEASE_FILE, validateRelease(rel)));
			console.log(`published ${rel.id}`);
		} else if (cmd === "read") {
			const code = parseSyncCode(pos[1] ?? "");
			const box = new GistMailbox(code.gistId, token ?? null, api);
			const files = (await box.fetch()) ?? {};
			const key = deriveKey(code.secret);
			const out: Record<string, unknown> = {};
			for (const name of [SERVER_FILE, RELEASE_FILE]) {
				if (!files[name]) continue;
				try {
					out[name] = openJson(key, name, files[name].text);
				} catch (e) {
					out[name] = { error: (e as Error).message };
				}
			}
			console.log(JSON.stringify(out, null, 2));
		} else {
			console.error("usage: gistsync.ts create|code|publish|read ...");
			process.exit(2);
		}
	} catch (e) {
		console.error((e as Error).message);
		process.exit(1);
	}
}
