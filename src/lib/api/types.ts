// Data shapes of the Rust commands (src-tauri/src/commands.rs).

export interface SlimPkg {
	id: string; // "Namespace-Name"
	ns: string;
	name: string;
	desc: string;
	icon: string;
	ver: string;
	cats: string[];
	rating: number;
	dl: number;
	upd: number;
	dep: boolean;
	nsfw: boolean;
	pinned: boolean;
	ndeps: number;
	size: number;
	created: number;
	/** Number of versions */
	nver: number;
	/** Dependency IDs of the latest version (without version) */
	deps: string[];
}

export interface IndexPayload {
	fetchedAt: number;
	packages: SlimPkg[];
}

export interface Version {
	v: string;
	deps: string[];
	size: number;
	date: number;
}

export interface Pkg {
	id: string;
	ns: string;
	name: string;
	desc: string;
	icon: string;
	cats: string[];
	rating: number;
	dl: number;
	upd: number;
	created: number;
	dep: boolean;
	nsfw: boolean;
	pinned: boolean;
	url: string;
	web: string;
	versions: Version[];
}

export type ModSource = "thunderstore" | "local";

export interface ProfileMod {
	namespace: string;
	name: string;
	version: string;
	enabled: boolean;
	source: ModSource;
	deps?: string[];
}

export interface Plan {
	resolved: Record<string, { version: string; requiredBy: string[] }>;
	toInstall: { id: string; from?: string; to: string }[];
	toRemove: string[];
	errors: string[];
}

export interface SyncStatus {
	running: boolean;
	queued: boolean;
}

export interface AppState {
	profiles: string[];
	active: string | null;
	mods: ProfileMod[];
	installed: Record<string, string>;
	plan: Plan | null;
	updates: Record<string, string>;
	indexAge: number | null;
	sync: SyncStatus;
	game: { valheimDir: string | null; found: boolean; lastUpdated: number | null; buildId: string | null };
	/** Mod IDs per profile (all profiles) */
	profileMods: Record<string, string[]>;
	health: HealthIssue[];
	app: AppInfo;
}

export interface HealthIssue {
	kind: "duplicate" | "deprecated" | "stale";
	ids: string[];
	/** duplicate: file name; stale: last update of the mod (ms); deprecated: empty */
	detail: string;
}

export interface AppInfo {
	version: string;
	portable: boolean;
	dataDir: string;
}

/** A profile of r2modman or the Thunderstore Mod Manager found on this machine. */
export interface ForeignProfile {
	manager: "r2modman" | "tmm";
	name: string;
	path: string;
	mods: number;
}

export interface ImportResult extends AppState {
	imported: { name: string; mods: number; configs: number; skipped: string[] };
}

export interface ExportResult {
	code: string | null;
	skippedLocal: string[];
}

export interface SyncProgress {
	id: string;
	phase: "download" | "remove" | "extract";
	done: number;
	total: number;
}

export interface SyncDone {
	profile: string;
	installed: string[];
	removed: string[];
	errors: string[];
}

export interface Settings {
	valheimDir: string | null;
	steamExe: string | null;
	downloadConcurrency: number;
	indexTtlMinutes: number;
	showNsfw: boolean;
}

export interface GameInfo {
	valheimDir: string | null;
	steamExe: string | null;
}

export interface LogChunk {
	lines: string[];
	reset: boolean;
}

export interface ConfigSetting {
	section: string;
	key: string;
	value: string;
	description: string;
	type?: string;
	defaultValue?: string;
	acceptableValues?: string;
}

export interface ParsedConfig {
	file: string;
	settings: ConfigSetting[];
}

export interface ConfigChange {
	section: string;
	key: string;
	value: string;
}

export type FolderKind = "profile" | "game" | "config" | "data";
