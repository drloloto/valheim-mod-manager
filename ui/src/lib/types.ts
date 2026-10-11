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

export interface ReleaseSummary {
	id: string;
	createdAt: number;
	install: number;
	remove: number;
	configs: number;
	untracked: number;
	problems: string[];
	schedule: { when: "idle" | "at"; at?: number; setAt: number } | null;
	lastError: string | null;
}

export interface Status {
	companion: {
		version: string;
		tokenConfigured: boolean;
		tokenSource: "env" | "file" | "generated" | "none";
		publicUrl: string | null;
		features: Features;
		authed: boolean;
	};
	server: { name: string; world: string };
	container: { id: string; name: string; state: string; status: string; startedAt: string | null } | null;
	manifest: { hash: string; generatedAt: number; mods: number } | null;
	world: { name: string; size: number; lastSave: number | null } | null;
	release: ReleaseSummary | null;
	online: number | null;
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
	untracked?: string[];
}

export interface PendingRelease {
	release: { id: string; plan: ReleasePlan; problems: string[] } | null;
	summary: ReleaseSummary | null;
	online: number | null;
}

export interface ApplyResponse {
	applied: boolean;
	result?: { installed: string[]; removed: string[]; errors: string[] };
	backup?: { id: string; size: number } | null;
	started?: ActionResult | null;
	restartRequired?: boolean;
}

export interface RestoreResponse {
	restored: string[];
	safety: { id: string } | null;
	started: ActionResult | null;
	restartRequired: boolean;
}
