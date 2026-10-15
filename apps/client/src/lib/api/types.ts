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
	/** How many packages depend on this one (latest versions) */
	ndependants: number;
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

/** Text tabs of the detail panel; readme and changelog are per version, the wiki per package. */
export type DocTab = "readme" | "changelog" | "wiki";

export interface WikiIndex {
	title: string;
	pages: { id: string; title: string }[];
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
	/** Skipped by update detection and "Update all"; set when an older version is picked on purpose. */
	pinned?: boolean;
	deps?: string[];
	/** Listed by the linked server: adoption sets its version and removes it when the server drops it. */
	managed?: boolean;
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

/** Companion server a profile is linked to (profile.json `server`); the token never leaves the core. */
export interface ServerLink {
	url: string;
	name: string;
	token?: string | null;
	/** `vmm1.<gist id>.<secret>`: sync through a sealed gist instead of the companion's API (url may be empty). */
	syncCode?: string | null;
	/** Admin only: GitHub token with the gist scope, needed to publish. */
	gistToken?: string | null;
}

export interface ServerLinkInfo {
	url: string;
	name: string;
	hasToken: boolean;
	gist: boolean;
	hasGistToken: boolean;
}

/** What became of the last release published through the gist (server.json.release). */
export interface GistRelease {
	id: string;
	companionId: string | null;
	state: "staged" | "scheduled" | "applied" | "failed" | "rejected" | "discarded";
	handledAt: number;
	problems: string[];
	error: string | null;
	schedule: { when: string; at?: number; setAt: number } | null;
	plan: { install: number; remove: number; configs: number } | null;
}

export interface ManifestMod {
	id: string;
	version: string;
	explicit: boolean;
	requiredBy: string[];
}

export interface ServerDiff {
	onlyServer: ManifestMod[];
	onlyLocal: ManifestMod[];
	changed: { id: string; local: string; server: string }[];
}

export interface ServerCheck {
	reachable: boolean;
	error?: string;
	name: string;
	world: string;
	inSync: boolean;
	diff: ServerDiff;
	serverMods: number;
	serverConfigs: number;
	hash: string;
	generatedAt: number;
	/** Companion switches, e.g. `publish: false`. */
	features: Record<string, boolean>;
	/** A staged release waiting on the server. */
	release: ReleaseSummary | null;
	/** Players online per the server log; null when unknown. */
	online: number | null;
	/** Gist links: server config files that differ from the profile's. */
	configsChanged: string[];
	/** Gist links: status of the last published release. */
	gistRelease: GistRelease | null;
}

/** What a pasted address resolved to (autoconfig). */
export interface ServerDiscovery {
	/** empty for a gist server */
	url: string;
	/** set when the pasted text held a sync code: the server is reached through its gist */
	syncCode?: string | null;
	/** the gist's id, shortened: the server's identity as the companion page shows it */
	gist?: string | null;
	name: string;
	world: string;
	mods: number;
	features: Record<string, boolean>;
}

export interface ProfileServerCheck {
	profile: string;
	check: ServerCheck;
}

/** A release staged on the companion: pulled and checked, not applied yet. */
export interface ReleaseSummary {
	id: string;
	createdAt: number;
	install: number;
	remove: number;
	configs: number;
	problems: string[];
	schedule: { when: "idle" | "at"; at?: number; setAt: number } | null;
	lastError: string | null;
}

export interface ReleasePlan {
	install: { id: string; from: string | null; to: string }[];
	remove: string[];
	configsChanged: string[];
	configsNew: string[];
}

/** What publish_gist wrote: the release id, and the local mods that stayed out of it. */
export interface GistPublishResult {
	id: string;
	skippedLocal: string[];
}

export interface StageResponse {
	release: { id: string; plan: ReleasePlan; problems: string[] };
	summary: ReleaseSummary;
	online: number | null;
	log: string[];
	skippedLocal: string[];
}

export type ApplyWhen = "now" | "idle" | "at" | "none";

export interface ApplyResponse {
	applied: boolean;
	summary?: ReleaseSummary | null;
	result?: { installed: string[]; removed: string[]; errors: string[] } | null;
	configsWritten: string[];
	stopped: { ok: boolean; message: string } | null;
	started: { ok: boolean; message: string } | null;
	restartRequired: boolean;
	log: string[];
}

export interface AppState {
	profiles: string[];
	active: string | null;
	mods: ProfileMod[];
	server: ServerLinkInfo | null;
	installed: Record<string, string>;
	plan: Plan | null;
	updates: Record<string, string>;
	indexAge: number | null;
	sync: SyncStatus;
	game: { valheimDir: string | null; found: boolean; lastUpdated: number | null; buildId: string | null };
	/** Mod IDs per profile (all profiles) */
	profileMods: Record<string, string[]>;
	/** Adopted from the server as its dependencies: pinned, shown as dependencies even when nothing local needs them. */
	implicitMods: string[];
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
	/** Built with tauri.dev.conf.json: own data dir, marked window, `window.vmm` test hook. */
	dev: boolean;
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
	/** Thunderstore team service-account token for publishing modpacks (local only). */
	thunderstoreToken: string | null;
}

export interface PublishCategory {
	name: string;
	slug: string;
}

export interface ModpackPreview {
	dependencies: string[];
	readme: string;
	configs: number;
	hasToken: boolean;
}

export interface PublishMeta {
	team: string;
	name: string;
	version: string;
	description: string;
	websiteUrl: string;
	readme: string;
	changelog: string;
	categories: string[];
	nsfw: boolean;
	iconPath: string | null;
	includeConfigs: boolean;
}

export interface PublishResult {
	fullName: string;
	url: string;
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
