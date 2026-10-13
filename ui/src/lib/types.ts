// Response shapes of the companion API (src/server.ts in the companion).

export interface Features {
	publicRead: boolean;
	modManager: boolean;
	publish: boolean;
	control: boolean;
	backups: boolean;
	env: boolean;
	configEdit: boolean;
	players: boolean;
	logs: boolean;
}

export type Source = "client" | "web" | "gist";
export type Schedule = { when: "idle"; at?: undefined; setAt: number } | { when: "at"; at: number; setAt: number };

export interface ReleaseSummary {
	id: string;
	createdAt: number;
	updatedAt: number;
	modsFrom: Source | null;
	install: number;
	remove: number;
	configs: number;
	conflicts: number;
	untracked: number;
	restartRequired: boolean;
	empty: boolean;
	problems: string[];
	schedule: Schedule | null;
	lastError: string | null;
}

export interface Status {
	companion: {
		version: string;
		tokenConfigured: boolean;
		tokenSource: "env" | "file" | "generated" | "none";
		publicUrl: string | null;
		/** URL scheme of the "Open in Mod Manager" button (the client's DEV build has its own) */
		scheme: string;
		features: Features;
		authed: boolean;
	};
	/** gist sync on this companion; details from GET /api/sync */
	sync: { enabled: boolean; canWrite: boolean };
	server: { name: string; world: string };
	container: { id: string; name: string; state: string; status: string; startedAt: string | null } | null;
	manifest: { hash: string; generatedAt: number; mods: number } | null;
	world: { name: string; size: number; lastSave: number | null } | null;
	release: ReleaseSummary | null;
	online: number | null;
}

/** GET/POST /api/takeover: packages found in plugins/ on a hand-installed server and what became of them. */
export interface TakeoverInfo {
	last: {
		resolved: { id: string; version: string; from: "latest" | "dll" | "guess" }[];
		unresolved: string[];
		unidentified: string[];
		at: number;
	} | null;
	scan: { candidates: { id: string; dir: string }[]; unidentified: string[] };
	/** mods in the lock right now */
	lock: number;
}

/** GET /api/sync: the sync through a sealed gist (no open port). */
export interface SyncInfo {
	enabled: boolean;
	/** "env" = COMPANION_SYNC_CODE, "file" = set up on this page, "none" = off */
	source: "env" | "file" | "none";
	/** `vmm1.<gist id>.<secret>`: what players paste or get through the button */
	code: string | null;
	gistId: string | null;
	/** false without a gist token: releases are read, server.json is not written */
	canWrite: boolean;
	lastError: string | null;
	release: { id: string; state: string; handledAt: number; error: string | null } | null;
}

export interface ManifestMod {
	id: string;
	version: string;
	explicit: boolean;
	requiredBy: string[];
}

export interface Manifest {
	mods: ManifestMod[];
	hash: string;
	generatedAt: number;
}

export interface ConfigSetting {
	section: string;
	key: string;
	value: string;
	description: string;
	type?: string;
	defaultValue?: string;
	acceptableValues?: string;
	/** several of the acceptable values may be combined, comma separated */
	multiple?: boolean;
	/** the mod tags the entry [Synced with Server] / [Not Synced with Server] */
	synced?: boolean;
}

export type SyncKind = "serversync" | "jotunn" | "none" | "unknown";

/** What a server-side edit of a config file reaches; from the plugin DLL (companion modsync.ts). */
export interface ConfigSync {
	sync: SyncKind;
	liveReload: boolean;
	versionCheck: boolean;
	mod: string | null;
	dll: string | null;
}

export interface ConfigMeta {
	source: Source;
	at: number;
	baseHash: string | null;
}

export interface ConfigsIndex {
	files: string[];
	info: Record<string, ConfigSync>;
	/** files with a staged working copy */
	staged: string[];
	/** with ?settings=1: every setting of every file (working copies) */
	settings?: Record<string, ConfigSetting[]>;
}

export interface ConfigFile {
	file: string;
	settings: ConfigSetting[];
	staged: boolean;
	meta: ConfigMeta | null;
	/** "section::key" → value on the server, for settings the working copy changes */
	live: Record<string, string>;
	info: ConfigSync;
}

export interface ConfigSaved {
	ok: boolean;
	staged: boolean;
	summary: ReleaseSummary;
	effect: ConfigSync | null;
}

export interface EnvEntry {
	key: string;
	value: string;
}

export interface EnvWrite {
	entries: EnvEntry[];
	changed: boolean;
	previous: string | null;
	recreateRequired: boolean;
	applyWith: string;
}

export interface PlayerEntry {
	id: string;
	note: string;
}

export type ListName = "admin" | "permitted" | "banned";

export interface Session {
	id: string;
	name: string | null;
	joinedAt: string | null;
	leftAt: string | null;
}

export interface Players {
	lists: Record<ListName, PlayerEntry[]>;
	online: Session[];
	recent: Session[];
	logError: string | null;
}

export interface Backup {
	id: string;
	world: string | null;
	size: number;
	createdAt: number;
	imported: boolean;
}

export interface ModDiff {
	added: ManifestMod[];
	removed: ManifestMod[];
	changed: { id: string; from: string; to: string }[];
}

export interface BackupContents {
	id: string;
	worlds: string[];
	hasConfigs: boolean;
	diff: ModDiff | null;
}

export interface ActionResult {
	ok: boolean;
	message: string;
}

export interface ReleasePlan {
	install: { id: string; from: string | null; to: string }[];
	remove: string[];
	configsChanged: string[];
	configsNew: string[];
	conflicts: string[];
	untracked?: string[];
	restartRequired: boolean;
	effects: Record<string, ConfigSync>;
}

export interface Release {
	id: string;
	createdAt: number;
	updatedAt: number;
	manifest: Manifest & { mods: ManifestMod[] };
	modsFrom: Source | null;
	modsAt: number | null;
	configs: string[];
	configMeta: Record<string, ConfigMeta>;
	plan: ReleasePlan;
	problems: string[];
	schedule: Schedule | null;
	lastError: string | null;
}

export interface PendingRelease {
	release: Release | null;
	summary: ReleaseSummary | null;
	online: number | null;
}

export interface ConfigDiff {
	path: string;
	status: "changed" | "new";
	before: string | null;
	after: string | null;
	tooLarge: boolean;
	conflict: boolean;
	meta: ConfigMeta | null;
	effect: ConfigSync | null;
	changes: { section: string; key: string; from: string | null; to: string | null }[];
}

export interface PendingDiff {
	online: number | null;
	release: Release | null;
	summary: ReleaseSummary | null;
	files: ConfigDiff[];
}

export interface ApplyResponse {
	applied: boolean;
	result?: { installed: string[]; removed: string[]; errors: string[] };
	backup?: { id: string; size: number } | null;
	started?: ActionResult | null;
	stopped?: ActionResult | null;
	configsWritten?: string[];
	restartRequired?: boolean;
	stayedUp?: boolean;
	nothingToDo?: boolean;
	log?: string[];
	summary?: ReleaseSummary;
}

export interface RestoreResponse {
	restored: string[];
	safety: { id: string } | null;
	started: ActionResult | null;
	restartRequired: boolean;
}
