// Where the sync code and the gist token come from, and the switch that starts and stops the poller at runtime.
// The admin sets the sync up once on the landing page (a GitHub token of an account made for the server); the
// companion creates the gist, keeps token and code in config/modmanager/sync.json (owner-only) and hands the
// code to players through the page's button. COMPANION_SYNC_CODE in the environment still wins and then the
// page cannot change the setup.
import { chmod, readFile, rm } from "fs/promises";
import { join } from "path";
import { writeAtomic } from "./fsutil";
import { GistMailbox } from "./gist";
import {
	envConfig,
	loadSyncState,
	RELEASE_FILE,
	SERVER_FILE,
	STATE_FILE,
	startGistSync,
	type GistSyncEnv,
	type ReleaseStatus,
	type SyncHandle,
} from "./gistsync";
import type { ServerInfo } from "./manifest";
import { MM_DIR } from "./paths";
import { makeSyncCode, newSecret, parseSyncCode } from "./synccrypto";

export const SYNC_FILE = join(MM_DIR, "sync.json");

export type SyncSource = "env" | "file" | "none";

export interface SyncConfig extends GistSyncEnv {
	source: SyncSource;
}

/** What the page and the client get from GET /api/sync. The code is public read data like the manifest. */
export interface SyncInfo {
	enabled: boolean;
	source: SyncSource;
	code: string | null;
	gistId: string | null;
	canWrite: boolean;
	lastError: string | null;
	release: ReleaseStatus | null;
}

export class SyncError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** Environment first, then sync.json; a token in the environment also serves a code from the file. */
export async function loadSyncConfig(env: NodeJS.ProcessEnv = process.env, file = SYNC_FILE): Promise<SyncConfig> {
	const e = envConfig(env);
	if (e.code) return { ...e, source: "env" };
	try {
		const f = JSON.parse(await readFile(file, "utf-8")) as { code?: unknown; token?: unknown };
		if (typeof f.code === "string" && f.code) {
			return { ...e, code: f.code, token: typeof f.token === "string" && f.token ? f.token : e.token, source: "file" };
		}
	} catch {
		/* no file yet */
	}
	return { ...e, code: undefined, source: "none" };
}

export async function saveSyncConfig(file: string, cfg: { code: string; token: string }): Promise<void> {
	await writeAtomic(file, JSON.stringify({ code: cfg.code, token: cfg.token, createdAt: Date.now() }, null, 2) + "\n");
	await chmod(file, 0o600).catch(() => {});
}

export interface SyncManagerDeps {
	/** starts a poller for the config; the real one is `startGistSync` */
	start(cfg: GistSyncEnv): SyncHandle | null;
	/** verifies a token (and an existing gist id when joining) against the API; the real one asks GitHub */
	createGist?: (token: string, api: string) => Promise<string>;
	file?: string;
	stateFile?: string;
	env?: NodeJS.ProcessEnv;
}

export class SyncManager {
	private handle: SyncHandle | null = null;
	private cfg: SyncConfig = { source: "none" };
	private readonly file: string;
	private readonly stateFile: string;
	private readonly env: NodeJS.ProcessEnv;

	constructor(private readonly deps: SyncManagerDeps) {
		this.file = deps.file ?? SYNC_FILE;
		this.stateFile = deps.stateFile ?? STATE_FILE;
		this.env = deps.env ?? process.env;
	}

	static forServer(exclusive: <T>(fn: () => Promise<T>) => Promise<T>, serverInfo: () => Promise<ServerInfo>): SyncManager {
		return new SyncManager({ start: (cfg) => startGistSync(exclusive, serverInfo, cfg) });
	}

	async start(): Promise<void> {
		this.apply(await loadSyncConfig(this.env, this.file));
	}

	private apply(cfg: SyncConfig): void {
		this.handle?.stop();
		this.handle = null;
		this.cfg = cfg;
		if (cfg.code) this.handle = this.deps.start(cfg);
	}

	/** For /api/status: enough for the page to know whether to ask for the code. */
	summary(): { enabled: boolean; canWrite: boolean } {
		return { enabled: !!this.handle, canWrite: !!this.handle?.canWrite };
	}

	async info(): Promise<SyncInfo> {
		const state = this.handle ? await loadSyncState(this.stateFile) : null;
		return {
			enabled: !!this.handle,
			source: this.handle ? this.cfg.source : "none",
			code: this.handle ? (this.cfg.code ?? null) : null,
			gistId: this.handle?.gistId ?? null,
			canWrite: !!this.handle?.canWrite,
			lastError: this.handle?.lastError() ?? null,
			release: state?.release ?? null,
		};
	}

	/**
	 * Turns the sync on with a gist token: a new gist with a fresh secret, or `code` to join a gist that exists.
	 * A code that differs from the previous one drops the poller's state, which belonged to the old gist.
	 */
	async setup(token: string, code?: string): Promise<SyncInfo> {
		if (this.cfg.source === "env") throw new SyncError("The sync is configured by COMPANION_SYNC_CODE; unset it to manage it here.", 409);
		token = token.trim();
		if (!token) throw new SyncError("A GitHub token with the gist scope is required.", 400);
		const api = envConfig(this.env).api!;
		let newCode: string;
		if (code?.trim()) {
			let parsed;
			try {
				parsed = parseSyncCode(code);
			} catch (e) {
				throw new SyncError((e as Error).message, 400);
			}
			try {
				await new GistMailbox(parsed.gistId, token, api).fetch();
			} catch (e) {
				throw new SyncError(`The gist could not be read with this token: ${(e as Error).message}`, 400);
			}
			newCode = code.trim();
		} else {
			let gistId: string;
			try {
				gistId = await (this.deps.createGist ?? createSyncGist)(token, api);
			} catch (e) {
				throw new SyncError(`GitHub did not accept the token: ${(e as Error).message}`, 400);
			}
			newCode = makeSyncCode({ gistId, secret: newSecret() });
		}
		if (newCode !== this.cfg.code) await rm(this.stateFile, { force: true });
		await saveSyncConfig(this.file, { code: newCode, token });
		this.apply({ ...envConfig(this.env), code: newCode, token, source: "file" });
		return this.info();
	}

	/** Stops the poller and forgets code and token. The gist stays on GitHub; players lose the connection. */
	async remove(): Promise<SyncInfo> {
		if (this.cfg.source === "env") throw new SyncError("The sync is configured by COMPANION_SYNC_CODE; unset it to turn it off.", 409);
		this.apply({ ...envConfig(this.env), code: undefined, token: undefined, source: "none" });
		await rm(this.file, { force: true });
		return this.info();
	}
}

/** The gist as the Mod Manager's CLI creates it: two placeholder files, unlisted. */
export function createSyncGist(token: string, api: string): Promise<string> {
	return GistMailbox.create(token, { [SERVER_FILE]: "{}", [RELEASE_FILE]: "{}" }, "Valheim Mod Manager sync (sealed)", api);
}
