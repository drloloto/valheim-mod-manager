// Central reactive app state (Svelte 5 runes), fed by the Rust core.
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast as toast_ } from "svelte-sonner";
import {
	cycleTri,
	defaultCriteria,
	parseCriteria,
	setTri,
	withDate,
	withList,
	withNum,
	type Criteria,
	type DateKey,
	type DateRange,
	type ListKey,
	type NumKey,
	type NumRange,
	type Tri,
} from "#lib/browse/criteria.js";
import { evaluate, searchKey, select } from "#lib/browse/engine.js";
import { sortPackages, type ProfileFacts, type Skip } from "#lib/browse/filter.js";
import { addView, parseViews, removeView, type View } from "#lib/browse/views.js";
import type { SortState } from "#lib/components/kit/types.js";
import { DEFAULT_PREFS, parsePrefs, type TablePrefs } from "#lib/desktop/columns.js";
import { Persisted } from "#lib/desktop/persisted.svelte.js";
import { emptySelection, type Selection } from "#lib/desktop/selection.js";
import { isRecord } from "#lib/desktop/storage.js";
import { t } from "#lib/i18n/t.js";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, ApiError } from "./client";
import type { ForeignProfile, HealthIssue } from "./types";
import { modStatus, type ModStatus } from "./status";
import { computeReadiness } from "#lib/readiness.js";
import { parseDeepLink } from "#lib/deeplink.js";
import { getCurrent as getCurrentDeepLink, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type {
	ApplyWhen,
	ModpackPreview,
	PublishCategory,
	PublishMeta,
	PublishResult,
	ServerCheck,
	ServerDiscovery,
	ServerLink,
	StageResponse,
	WikiIndex,
} from "./types";
import { formatDateTime } from "#lib/format.js";
import type { AppState, ExportResult, FolderKind, ImportResult, Pkg, ProfileMod, Settings, SlimPkg, SyncDone, SyncProgress } from "./types";

export type ToastKind = "ok" | "err" | "info";

export function modId(m: { namespace: string; name: string }): string {
	return `${m.namespace}-${m.name}`;
}

function errorMessage(e: unknown, fallback: string): string {
	return e instanceof Error && e.message ? e.message : fallback;
}

const EMPTY_STATE: AppState = {
	profiles: [],
	active: null,
	mods: [],
	server: null,
	installed: {},
	plan: null,
	updates: {},
	indexAge: null,
	sync: { running: false, queued: false },
	game: { valheimDir: null, found: true, lastUpdated: null, buildId: null },
	profileMods: {},
	health: [],
	app: { version: "", portable: false, dev: false, dataDir: "" },
};

/** A sync code as the companion hands it out; it may sit at the end of a URL. */
const SYNC_CODE = /vmm1\.[0-9a-f]{20,40}\.[A-Za-z0-9_-]{43}/;

const DEFAULT_SECTIONS: Record<string, boolean> = { status: true, cats: true, owners: true, upd: true };

const parseSections = (v: unknown): Record<string, boolean> | null =>
	isRecord(v) ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "boolean")) as Record<string, boolean>) : null;

/** Filters, sort, selection, views and sections of the Browse page; filters and views survive restarts. */
class BrowseFilters {
	#criteria = new Persisted<Criteria>("werkbank.browse.criteria", defaultCriteria(), (v) => parseCriteria(v));
	#views = new Persisted<View[]>("werkbank.browse.views", [], parseViews);
	#sections = new Persisted<Record<string, boolean>>("werkbank.browse.sections", DEFAULT_SECTIONS, parseSections);
	sort = $state<SortState | null>(null);
	selection = $state.raw<Selection>(emptySelection);
	/** "now" for relative date filters; the page refreshes it periodically. */
	now = $state(Date.now());
	/** Last known setting so that reset() respects it. */
	showNsfw = false;

	constructor() {
		// The search text is not restored: an old search term only surprises after a restart.
		this.#criteria.value = { ...this.#criteria.value, query: "" };
	}

	get criteria(): Criteria {
		return this.#criteria.value;
	}
	set criteria(c: Criteria) {
		this.#criteria.set(c);
	}
	get query(): string {
		return this.criteria.query;
	}
	set query(q: string) {
		this.criteria = { ...this.criteria, query: q };
	}
	get views(): View[] {
		return this.#views.value;
	}
	get sections(): Record<string, boolean> {
		return this.#sections.value;
	}

	update(fn: (c: Criteria) => Criteria) {
		this.criteria = fn(this.criteria);
	}
	cycle(key: ListKey, value: string) {
		this.update((c) => withList(c, key, cycleTri(c.lists[key], value)));
	}
	setTri(key: ListKey, value: string, tri: Tri | 0) {
		this.update((c) => withList(c, key, setTri(c.lists[key], value, tri)));
	}
	/** Right-click in lists: exclude, or lift the exclusion. */
	toggleExclude(key: ListKey, value: string) {
		this.setTri(key, value, this.criteria.lists[key][value] === -1 ? 0 : -1);
	}
	/** Include only this value (replaces the list). */
	only(key: ListKey, value: string) {
		this.update((c) => withList(c, key, { [value]: 1 }));
	}
	setDate(key: DateKey, r: DateRange | null) {
		this.update((c) => withDate(c, key, r));
	}
	setNum(key: NumKey, r: NumRange | null) {
		this.update((c) => withNum(c, key, r));
	}
	setCatMode(mode: "any" | "all") {
		this.update((c) => ({ ...c, catMode: mode }));
	}
	/** "Show NSFW" setting: lifts or applies the default exclusion. */
	setNsfw(show: boolean) {
		this.showNsfw = show;
		this.setTri("flags", "nsfw", show ? 0 : -1);
	}
	reset() {
		this.criteria = defaultCriteria({ showNsfw: this.showNsfw });
	}

	applyView(v: View) {
		this.criteria = { ...v.criteria, query: this.query };
	}
	saveView(name: string) {
		this.#views.update((vs) => addView(vs, `u${Date.now().toString(36)}`, name, this.criteria));
	}
	deleteView(id: string) {
		this.#views.update((vs) => removeView(vs, id));
	}

	toggleSection(key: string) {
		this.#sections.update((s) => ({ ...s, [key]: !(s[key] ?? false) }));
	}
	openSection(key: string) {
		if (!this.sections[key]) this.#sections.update((s) => ({ ...s, [key]: true }));
	}
}

class ModManagerStore {
	state = $state<AppState>(EMPTY_STATE);
	loaded = $state(false);
	packages = $state.raw<SlimPkg[]>([]);
	byId = $state.raw<Map<string, SlimPkg>>(new Map());
	indexFetchedAt = $state<number | null>(null);
	indexLoading = $state(false);
	indexError = $state<string | null>(null);
	indexRefreshing = $state(false);
	syncProgress = $state<SyncProgress | null>(null);
	launching = $state(false);
	settings = $state<Settings | null>(null);
	settingsError = $state<string | null>(null);
	browse = new BrowseFilters();
	/** Column configuration per table. */
	tables = {
		browse: new Persisted<TablePrefs>("werkbank.table.browse", DEFAULT_PREFS, parsePrefs),
		installed: new Persisted<TablePrefs>("werkbank.table.installed", DEFAULT_PREFS, parsePrefs),
	};

	modsMap = $derived(new Map(this.state.mods.map((m) => [modId(m), m])));
	syncing = $derived(this.state.sync.running || this.syncProgress !== null);
	/** Missing installations and resolver errors of the active profile; Play asks before starting an incomplete profile. */
	readiness = $derived(computeReadiness(this.state, this.syncing));
	/** Mod IDs the plan still wants to install (missing or wrong version). */
	missingIds = $derived(new Set(this.readiness.missing.map((m) => m.id)));
	/** Open the "start anyway?" dialog of the Play button. */
	launchConfirm = $state(false);
	/** Linked companion server of the active profile and the last comparison with it. */
	server = $derived(this.state.server);
	serverStatus = $state<ServerCheck | null>(null);
	/** Publishing is possible: the gist token for a gist link, the companion token for an HTTP link. */
	get serverAdmin(): boolean {
		const s = this.state.server;
		return !!s && (s.gist ? s.hasGistToken : s.hasToken);
	}
	serverChecking = $state(false);
	serverDialog = $state<"link" | "publish" | "diff" | "add" | null>(null);
	/** Linked profiles whose server runs other versions (from the start-up check). */
	serverUpdates = $state<Record<string, ServerCheck>>({});
	/** Result of the last stage (publish step 1), shown in the publish dialog until applied or discarded. */
	staged = $state.raw<StageResponse | null>(null);
	/** Set by "adopt and start": launch once the sync that follows has finished. */
	private launchAfterSync = false;
	/** Mods waiting in the "what changed" dialog; the update runs only after confirmation. */
	updateDialog = $state<string[] | null>(null);
	/** "Publish as modpack…" for the active profile. */
	publishDialog = $state(false);
	updateCount = $derived(Object.keys(this.state.updates).length);
	otherProfiles = $derived(this.state.profiles.filter((p) => p !== this.state.active));
	/** Mod ID → other profiles that contain it. */
	profilesByMod = $derived.by(() => {
		const m = new Map<string, string[]>();
		for (const [name, ids] of Object.entries(this.state.profileMods)) {
			if (name === this.state.active) continue;
			for (const id of ids) {
				const l = m.get(id);
				if (l) l.push(name);
				else m.set(id, [name]);
			}
		}
		return m;
	});
	/** Profile facts for the filter logic. */
	readonly facts: ProfileFacts = {
		status: (id) => this.modStatus(id),
		present: (id) => this.modsMap.has(id) || !!this.state.plan?.resolved[id],
		profilesOf: (id) => this.profilesByMod.get(id) ?? [],
	};
	/** Search key per package, recomputed only when the index changes. */
	searchKeys = $derived(this.packages.map(searchKey));
	/** One evaluation of all criteria per package (bitmask); the result list and the facets read from it. */
	masks = $derived(evaluate(this.packages, this.browse.criteria, this.facts, this.browse.now, this.searchKeys));
	/** Results of the Browse page, sorted. */
	filtered = $derived(sortPackages(select(this.packages, this.masks), this.browse.sort, this.browse.criteria.query));

	private packageCache = new Map<string, Promise<Pkg>>();

	/** Updater: one silent check at startup when enabled, manual checks from Settings. */
	autoUpdate = new Persisted<boolean>("werkbank.autoUpdate", true, (v) => (typeof v === "boolean" ? v : null));
	update = $state.raw<Update | null>(null);
	updateStatus = $state<"idle" | "checking" | "none" | "available" | "installing" | "error">("idle");
	updateError = $state<string | null>(null);
	/** Health issues grouped by mod id. */
	healthByMod = $derived.by(() => {
		const m = new Map<string, HealthIssue[]>();
		for (const h of this.state.health) for (const id of h.ids) m.set(id, [...(m.get(id) ?? []), h]);
		return m;
	});

	/** Results without the given section, for facet counts and histograms. */
	context(skip: Skip): SlimPkg[] {
		return select(this.packages, this.masks, skip);
	}

	toast(message: string, kind: ToastKind = "info") {
		if (kind === "ok") toast_.success(message);
		else if (kind === "err") toast_.error(message);
		else toast_.message(message);
	}

	/** Loads everything and subscribes to the backend events. Returns the cleanup function. */
	async init(): Promise<() => void> {
		const unlisten: UnlistenFn[] = await Promise.all([
			listen<SyncProgress>("sync://progress", (e) => (this.syncProgress = e.payload)),
			listen<SyncDone>("sync://done", (e) => this.onSyncDone(e.payload)),
			listen("index://updated", () => {
				this.packageCache.clear();
				this.loadIndex();
				this.loadState();
			}),
		]);
		await Promise.all([this.loadState(), this.loadIndex(), this.loadSettings()]);
		if (this.autoUpdate.value && !this.state.app.portable) this.checkUpdate();
		this.refreshServerStatus();
		this.checkAllServers();
		// The linked server is re-checked every five minutes while the app is open (gist reads are ETag-cached).
		const serverClock = setInterval(() => this.refreshServerStatus(), 300_000);
		// `valheim-mod-manager://import?…` from a companion page, at startup or while running.
		const handle = (urls: string[]) => {
			for (const u of urls) {
				const d = parseDeepLink(u);
				if (d) this.importFromUrl(d.url, d.name, d.link);
				else this.toast(t("toast.deepLinkInvalid"), "err");
			}
		};
		try {
			const current = await getCurrentDeepLink();
			if (current?.length) handle(current);
			unlisten.push(await onOpenUrl(handle));
		} catch {
			/* plugin unavailable (browser preview) */
		}
		return () => {
			clearInterval(serverClock);
			unlisten.forEach((u) => u());
		};
	}

	private onSyncDone(r: SyncDone) {
		this.syncProgress = null;
		const parts: string[] = [];
		if (r.installed.length) parts.push(t("toast.installedN", { n: r.installed.length }));
		if (r.removed.length) parts.push(t("toast.removedN", { n: r.removed.length }));
		if (parts.length) this.toast(`${r.profile}: ${parts.join(", ")}`, "ok");
		for (const err of r.errors) this.toast(err, "err");
		this.loadState().then(() => {
			this.refreshServerStatus();
			if (this.launchAfterSync && r.profile === this.state.active) {
				this.launchAfterSync = false;
				if (!r.errors.length) this.launch(true);
			}
		});
	}

	private async applyState(fn: () => Promise<AppState>, fallback: string): Promise<boolean> {
		const before = `${this.state.active}|${this.state.server?.url}`;
		try {
			this.state = await fn();
			this.loaded = true;
			if (`${this.state.active}|${this.state.server?.url}` !== before) this.refreshServerStatus();
			return true;
		} catch (e) {
			this.toast(errorMessage(e, fallback), "err");
			return false;
		}
	}

	/** Background comparison for the status bar; never throws, never toasts. */
	async refreshServerStatus(): Promise<ServerCheck | null> {
		const active = this.state.active;
		if (!active || !this.state.server) {
			this.serverStatus = null;
			return null;
		}
		this.serverChecking = true;
		try {
			const c = await api.checkServer(active);
			this.serverStatus = c;
			return c;
		} catch {
			this.serverStatus = null;
			return null;
		} finally {
			this.serverChecking = false;
		}
	}

	/** `url` may be a sync code (vmm1.…): then the profile syncs through the gist and the token is the gist token. */
	async linkServer(url: string, token: string): Promise<boolean> {
		const active = this.state.active;
		if (!active) return false;
		const name = this.state.server?.name ?? "";
		// A sync code anywhere in the address (alone or at the end of a URL) means a gist link; the token next to it is the gist token.
		const code = SYNC_CODE.exec(url)?.[0];
		const link: ServerLink = code ? { url: "", name, syncCode: code, gistToken: token || null } : { url, name, token: token || null };
		const ok = await this.applyState(() => api.setServerLink(active, link), t("toast.serverLinkFailed"));
		if (!ok) return false;
		const c = await this.refreshServerStatus();
		if (c?.reachable && c.name && c.name !== this.state.server?.name) {
			await this.applyState(() => api.setServerLink(active, { ...link, name: c.name, token: null, gistToken: null }), t("toast.serverLinkFailed"));
		}
		this.toast(
			c?.reachable ? t("toast.serverLinked", { name: c.name || url }) : t("server.unreachable", { error: c?.error ?? "" }),
			c?.reachable ? "ok" : "err",
		);
		return true;
	}

	async unlinkServer() {
		const active = this.state.active;
		if (!active) return;
		if (await this.applyState(() => api.setServerLink(active, null), t("toast.serverLinkFailed"))) {
			this.serverStatus = null;
			this.toast(t("toast.serverUnlinked"), "ok");
		}
	}

	/** Rewrites the profile to the server's versions; optionally starts the game once installed. */
	async adoptServer(thenLaunch: boolean, withConfigs = true, intoNew: string | null = null): Promise<boolean> {
		const active = this.state.active;
		if (!active) return false;
		this.launchAfterSync = thenLaunch;
		const ok = await this.applyState(() => api.adoptServer(active, withConfigs, intoNew), t("toast.adoptFailed"));
		if (ok) {
			this.toast(intoNew ? t("toast.adoptedInto", { name: this.state.active ?? intoNew }) : t("toast.adopted"), "ok");
			delete this.serverUpdates[active];
		} else this.launchAfterSync = false;
		return ok;
	}

	/** "Autoconfig": resolve whatever the player pasted to a companion. */
	async discoverServer(url: string): Promise<ServerDiscovery | null> {
		try {
			return await api.discoverServer(url);
		} catch (e) {
			this.toast(errorMessage(e, t("toast.discoverFailed")), "err");
			return null;
		}
	}

	/** New profile straight from a companion: its mods, versions and configs, linked for later checks. */
	async addServer(d: ServerDiscovery, installAll = true): Promise<boolean> {
		if (d.syncCode) return this.addGistServer(d, installAll);
		return this.importFromUrl(`${d.url}/api/profile.r2z`, d.name || d.world || "Server", d.url, installAll);
	}

	/** A gist server has no .r2z to fetch: a new profile, linked by its code, then adopted from server.json. */
	private async addGistServer(d: ServerDiscovery, installAll: boolean): Promise<boolean> {
		const fail = t("toast.importFailed");
		if (!(await this.applyState(() => api.createProfile(d.name || d.world || "Server"), fail))) return false;
		const name = this.state.active;
		if (!name) return false;
		if (!(await this.applyState(() => api.setServerLink(name, { url: "", name: d.name, syncCode: d.syncCode }), fail))) return false;
		if (!(await this.applyState(() => api.adoptServer(name, true, null, installAll), fail))) return false;
		this.toast(t("toast.adoptedInto", { name }), "ok");
		this.refreshServerStatus();
		return true;
	}

	/** App start: every linked profile vs its server; results feed the profile menu markers and one toast. */
	async checkAllServers(): Promise<void> {
		try {
			const results = await api.checkAllServers();
			const updates: Record<string, ServerCheck> = {};
			for (const r of results) if (r.check.reachable && !r.check.inSync) updates[r.profile] = r.check;
			this.serverUpdates = updates;
			const others = Object.keys(updates).filter((p) => p !== this.state.active);
			if (others.length) this.toast(t("toast.serverUpdates", { profiles: others.join(", ") }), "info");
		} catch {
			/* offline or no linked profiles: nothing to say */
		}
	}

	/** Step 1 of a publish: the server pulls and checks; nothing changes live. */
	async publish(withConfigs: boolean): Promise<StageResponse | null> {
		const active = this.state.active;
		if (!active) return null;
		try {
			const r = await api.publishProfile(active, withConfigs);
			this.staged = r;
			if (r.skippedLocal.length) this.toast(t("toast.localSkipped", { names: r.skippedLocal.join(", ") }), "info");
			this.refreshServerStatus();
			return r;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.publishFailed")), "err");
			return null;
		}
	}

	/** Gist links: publish and schedule in one step; the companion reports back through the gist. */
	async publishGist(withConfigs: boolean, when: ApplyWhen, at: number | null = null): Promise<boolean> {
		const active = this.state.active;
		if (!active) return false;
		try {
			const r = await api.publishGist(active, withConfigs, when, at);
			this.toast(t("toast.gistPublished", { id: r.id }), "ok");
			if (r.skippedLocal.length) this.toast(t("toast.localSkipped", { names: r.skippedLocal.join(", ") }), "info");
			this.refreshServerStatus();
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.publishFailed")), "err");
			return false;
		}
	}

	/** Step 2: apply now, schedule (idle / at), or clear the schedule. */
	async applyRelease(id: string, when: ApplyWhen, at: number | null = null): Promise<boolean> {
		const active = this.state.active;
		if (!active) return false;
		try {
			const r = await api.applyRelease(active, id, when, at);
			if (r.applied) {
				const res = r.result ?? { installed: [], removed: [], errors: [] };
				const tail = r.restartRequired
					? t("server.restartRequired")
					: r.started
						? r.started.ok
							? t("server.restarted")
							: t("server.restartFailed", { message: r.started.message })
						: "";
				this.toast(
					t("toast.applied", { installed: res.installed.length, removed: res.removed.length, configs: r.configsWritten.length, tail }),
					res.errors.length ? "info" : "ok",
				);
				for (const e of res.errors) this.toast(e, "err");
				this.staged = null;
			} else if (when === "none") {
				this.toast(t("toast.scheduleCleared"), "ok");
			} else {
				this.toast(when === "idle" ? t("toast.scheduledIdle") : t("toast.scheduledAt", { time: formatDateTime(at ?? Date.now()) }), "ok");
			}
			this.refreshServerStatus();
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.applyFailed")), "err");
			return false;
		}
	}

	async discardRelease(id: string): Promise<boolean> {
		const active = this.state.active;
		if (!active) return false;
		try {
			await api.discardRelease(active, id);
			this.staged = null;
			this.toast(t("toast.releaseDiscarded"), "ok");
			this.refreshServerStatus();
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.applyFailed")), "err");
			return false;
		}
	}

	async importFromUrl(url: string, name: string, link: string | null, installAll = true): Promise<boolean> {
		try {
			this.onImported(await api.importProfileUrl(url, name, true, installAll, link ? { url: link, name, token: null } : null));
			this.refreshServerStatus();
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.importFailed")), "err");
			return false;
		}
	}

	loadState() {
		return this.applyState(() => api.state(), t("toast.stateFailed"));
	}

	async loadIndex() {
		this.indexLoading = true;
		this.indexError = null;
		try {
			const data = await api.index(this.indexFetchedAt);
			if (data) {
				this.packages = data.packages;
				this.byId = new Map(data.packages.map((p) => [p.id, p]));
				this.indexFetchedAt = data.fetchedAt;
			}
		} catch (e) {
			this.indexError = errorMessage(e, t("toast.indexFailed"));
		} finally {
			this.indexLoading = false;
		}
	}

	async refreshIndex() {
		if (this.indexRefreshing) return;
		this.indexRefreshing = true;
		try {
			await api.refreshIndex();
			this.toast(t("toast.indexRefreshed"), "ok");
		} catch (e) {
			this.toast(errorMessage(e, t("toast.refreshFailed")), "err");
		} finally {
			this.indexRefreshing = false;
		}
	}

	async loadSettings() {
		try {
			this.settings = await api.getSettings();
			this.browse.setNsfw(this.settings.showNsfw);
		} catch (e) {
			this.toast(errorMessage(e, t("toast.settingsLoadFailed")), "err");
		}
	}

	/** quiet: autosave; no success toast, errors go to settingsError instead of a toast. */
	async saveSettings(s: Settings, quiet = false): Promise<boolean> {
		const prevNsfw = this.settings?.showNsfw;
		try {
			this.settings = await api.saveSettings(s);
			this.settingsError = null;
			// Apply only when this save actually changed the NSFW value; otherwise an unrelated
			// autosave would overwrite the user's Browse filter.
			if (this.settings.showNsfw !== prevNsfw) this.browse.setNsfw(this.settings.showNsfw);
			await this.loadState();
			if (!quiet) this.toast(t("toast.settingsSaved"), "ok");
			return true;
		} catch (e) {
			const msg = errorMessage(e, t("toast.saveFailed"));
			if (quiet) this.settingsError = msg;
			else this.toast(msg, "err");
			return false;
		}
	}

	status(id: string) {
		const p = this.byId.get(id);
		const m = this.modsMap.get(id);
		const inst = this.state.installed[id];
		const asDep = !m ? this.state.plan?.resolved[id] : undefined;
		const update: string | undefined = this.state.updates[id];
		return { p, m, inst, asDep, update };
	}

	/** One status per package for lists and the detail panel (see status.ts). */
	modStatus(id: string): ModStatus {
		return modStatus(id, { mods: this.modsMap, updates: this.state.updates, resolved: this.state.plan?.resolved });
	}

	async ensureActiveProfile(): Promise<string | null> {
		if (this.state.active) return this.state.active;
		if (await this.applyState(() => api.createProfile("default"), t("toast.profileCreateFailed"))) {
			this.toast(t("toast.profileCreated", { name: "default" }), "ok");
		}
		return this.state.active;
	}

	async setMods(mods: ProfileMod[]): Promise<boolean> {
		const name = await this.ensureActiveProfile();
		if (!name) return false;
		return this.applyState(() => api.setMods(name, mods), t("toast.saveFailed"));
	}

	/** Plus button / detail panel: add, remove or set a version. */
	async toggleMod(id: string, version?: string) {
		const { p, m, update } = this.status(id);
		if (m && !update && !version) return this.removeMod(id);
		if (m) {
			const to = version ?? update ?? m.version;
			// Picking anything but the newest version is a deliberate choice: pin it so "Update all" keeps it.
			const pinned = version ? version !== p?.ver : false;
			return this.setMods(this.state.mods.map((x) => (modId(x) === id ? { ...x, version: to, pinned } : x)));
		}
		if (!p) return;
		await this.setMods([...this.state.mods, { namespace: p.ns, name: p.name, version: version || p.ver, enabled: true, source: "thunderstore" }]);
	}

	removeMod(id: string) {
		return this.setMods(this.state.mods.filter((x) => modId(x) !== id));
	}

	/** Every update goes through the "what changed" dialog first. */
	requestUpdate(ids: string[]) {
		const withUpdate = ids.filter((id) => id in this.state.updates);
		if (withUpdate.length) this.updateDialog = withUpdate;
	}

	cancelUpdate() {
		this.updateDialog = null;
	}

	async confirmUpdate() {
		const ids = this.updateDialog;
		this.updateDialog = null;
		if (ids) await this.updateMods(ids);
	}

	updateAll() {
		this.requestUpdate(Object.keys(this.state.updates));
	}

	togglePin(id: string) {
		return this.setMods(this.state.mods.map((x) => (modId(x) === id ? { ...x, pinned: !x.pinned } : x)));
	}

	/** Multi-select: add missing packages in their latest version. */
	async addMods(ids: string[]) {
		const add = ids
			.filter((id) => !this.modsMap.has(id))
			.map((id) => this.byId.get(id))
			.filter((p): p is SlimPkg => !!p)
			.map((p) => ({ namespace: p.ns, name: p.name, version: p.ver, enabled: true, source: "thunderstore" as const }));
		if (!add.length) return;
		const ok = await this.setMods([...this.state.mods, ...add]);
		if (ok) this.toast(add.length === 1 ? t("toast.added", { name: add[0].name }) : t("toast.addedN", { n: add.length }), "ok");
	}

	async removeMods(ids: string[]) {
		const drop = new Set(ids);
		const next = this.state.mods.filter((m) => !drop.has(modId(m)));
		if (next.length === this.state.mods.length) return;
		await this.setMods(next);
	}

	async updateMods(ids: string[]) {
		const pick = new Set(ids);

		const next = this.state.mods.map((m) => (pick.has(modId(m)) ? { ...m, version: this.state.updates[modId(m)] ?? m.version } : m));

		if (!next.some((m, i) => m.version !== this.state.mods[i].version)) return;
		await this.setMods(next);
	}

	async setEnabled(id: string, enabled: boolean) {
		const active = this.state.active;
		if (!active) return;
		await this.applyState(() => api.setModEnabled(active, id, enabled), t("toast.toggleFailed"));
	}

	/** Multi-select: enable or disable mods in one step. */
	async setEnabledMany(ids: string[], enabled: boolean) {
		const pick = new Set(ids);
		const next = this.state.mods.map((m) => (pick.has(modId(m)) ? { ...m, enabled } : m));
		if (!next.some((m, i) => m.enabled !== this.state.mods[i].enabled)) return;
		await this.setMods(next);
	}

	async newProfile(name: string): Promise<boolean> {
		const ok = await this.applyState(() => api.createProfile(name), t("toast.profileCreateFailed"));
		if (ok) this.toast(t("toast.profileCreated", { name }), "ok");
		return ok;
	}

	activateProfile(name: string) {
		return this.applyState(() => api.activateProfile(name), t("toast.switchFailed"));
	}

	async deleteActiveProfile() {
		const active = this.state.active;
		if (!active) return;
		if (await this.applyState(() => api.deleteProfile(active), t("toast.deleteFailed"))) {
			this.toast(t("toast.profileDeleted", { name: active }), "ok");
		}
	}

	async renameActive(to: string): Promise<boolean> {
		const active = this.state.active;
		return !!active && this.applyState(() => api.renameProfile(active, to), t("toast.renameFailed"));
	}

	async cloneActive(to: string): Promise<boolean> {
		const active = this.state.active;
		const ok = !!active && (await this.applyState(() => api.cloneProfile(active, to), t("toast.cloneFailed")));
		if (ok) this.toast(t("toast.profileCreated", { name: to }), "ok");
		return ok;
	}

	async repair() {
		const active = this.state.active;
		if (!active) return;
		if (await this.applyState(() => api.repairProfile(active), t("toast.repairFailed"))) {
			this.toast(t("toast.repairing"), "info");
		}
	}

	private onImported(r: ImportResult) {
		const { imported, ...state } = r;
		this.state = state;
		const skipped = imported.skipped.length ? t("toast.skipped", { names: imported.skipped.join(", ") }) : "";
		this.toast(t("toast.imported", { name: imported.name, mods: imported.mods, configs: imported.configs, skipped }), "ok");
	}

	async importCode(code: string, name: string, withConfigs: boolean, installAll: boolean): Promise<boolean> {
		try {
			this.onImported(await api.importProfileCode(code, name, withConfigs, installAll));
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.importFailed")), "err");
			return false;
		}
	}

	listForeignProfiles(): Promise<ForeignProfile[]> {
		return api.listForeignProfiles();
	}

	/** Import a profile folder of r2modman or the Thunderstore Mod Manager. */
	async importForeign(path: string, name: string, withConfigs: boolean, installAll: boolean): Promise<boolean> {
		try {
			this.onImported(await api.importForeignProfile(path, name, withConfigs, installAll));
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.importFailed")), "err");
			return false;
		}
	}

	async checkUpdate(): Promise<void> {
		if (this.updateStatus === "checking" || this.updateStatus === "installing") return;
		this.updateStatus = "checking";
		this.updateError = null;
		try {
			const u = await checkForUpdate();
			this.update = u;
			this.updateStatus = u ? "available" : "none";
		} catch (e) {
			this.updateError = errorMessage(e, String(e));
			this.updateStatus = "error";
		}
	}

	/** Downloads the pending update, installs it and restarts the app. */
	async installUpdate(): Promise<void> {
		const u = this.update;
		if (!u || this.updateStatus === "installing") return;
		this.updateStatus = "installing";
		try {
			await u.downloadAndInstall();
			await relaunch();
		} catch (e) {
			this.updateError = errorMessage(e, String(e));
			this.updateStatus = "error";
		}
	}

	async importFile(path: string, name: string, withConfigs: boolean, installAll: boolean): Promise<boolean> {
		try {
			this.onImported(await api.importProfileFile(path, name, withConfigs, installAll));
			return true;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.importFailed")), "err");
			return false;
		}
	}

	private warnSkipped(r: ExportResult) {
		if (r.skippedLocal.length) {
			this.toast(t("toast.localSkipped", { names: r.skippedLocal.join(", ") }), "info");
		}
	}

	async exportCode(): Promise<string | null> {
		const active = this.state.active;
		if (!active) return null;
		try {
			const r = await api.exportProfileCode(active);
			this.warnSkipped(r);
			return r.code;
		} catch (e) {
			this.toast(errorMessage(e, t("toast.shareFailed")), "err");
			return null;
		}
	}

	async exportFile(path: string) {
		const active = this.state.active;
		if (!active) return;
		try {
			this.warnSkipped(await api.exportProfileFile(active, path));
			this.toast(t("toast.exported"), "ok");
		} catch (e) {
			this.toast(errorMessage(e, t("toast.exportFailed")), "err");
		}
	}

	async addLocalMods(paths: string[]) {
		const name = await this.ensureActiveProfile();
		if (!name || !paths.length) return;
		if (await this.applyState(() => api.addLocalMods(name, paths), t("toast.localFailed"))) {
			this.toast(t("toast.localAdded", { n: paths.length }), "ok");
		}
	}

	/** Re-submit the current mod list; the core enqueues a sync, which retries failed downloads and installs. */
	retrySync() {
		return this.setMods(this.state.mods);
	}

	/** Play button and Mod+Enter: an incomplete profile asks first, a linked server is compared, then launch. */
	async requestLaunch(modded: boolean) {
		if (this.launching) return;
		if (modded && this.readiness.status === "incomplete" && this.readiness.missing.length) {
			this.launchConfirm = true;
			return;
		}
		if (modded && this.state.server) {
			// The Play button shows "Starting…" while the server is asked (a few seconds at most when it is down).
			this.launching = true;
			try {
				const c = await this.refreshServerStatus();
				if (c?.reachable && !c.inSync) {
					this.serverDialog = "diff";
					return;
				}
			} finally {
				this.launching = false;
			}
		}
		return this.launch(modded);
	}

	async launch(modded: boolean) {
		this.launching = true;
		try {
			await api.launchGame(modded);
			this.toast(modded ? t("toast.launchModded") : t("toast.launchVanilla"), "ok");
		} catch (e) {
			const message = errorMessage(e, t("toast.launchFailed"));
			if (e instanceof ApiError && e.kind === "gameNotFound") {
				toast_.error(message, {
					action: {
						label: t("common.settings"),
						onClick: () => goto(resolve("settings")),
					},
				});
			} else {
				this.toast(message, "err");
			}
		} finally {
			this.launching = false;
		}
	}

	async openFolder(kind: FolderKind) {
		try {
			await api.openFolder(kind);
		} catch (e) {
			this.toast(errorMessage(e, t("toast.openFolderFailed")), "err");
		}
	}

	/** Open an external link without letting an error escape as an unhandled rejection. */
	async openExternal(url: string) {
		try {
			await openUrl(url);
		} catch (e) {
			this.toast(errorMessage(e, t("toast.openLinkFailed")), "err");
		}
	}

	/** Copy to the clipboard; okMsg is toasted only on success. */
	async copyText(text: string, okMsg?: string) {
		try {
			await writeText(text);
			if (okMsg) this.toast(okMsg, "ok");
		} catch (e) {
			this.toast(errorMessage(e, t("common.copyFailed")), "err");
		}
	}

	getPackage(id: string): Promise<Pkg> {
		let p = this.packageCache.get(id);
		if (!p) {
			p = api.getPackage(id);
			p.catch(() => this.packageCache.delete(id));
			this.packageCache.set(id, p);
		}
		return p;
	}

	/** Readme / changelog / wiki text, fetched once per session (the core caches readme and changelog on disk). */
	private docCache = new Map<string, Promise<unknown>>();
	private cached<T>(key: string, fetch: () => Promise<T>): Promise<T> {
		let p = this.docCache.get(key) as Promise<T> | undefined;
		if (!p) {
			p = fetch();
			p.catch(() => this.docCache.delete(key));
			this.docCache.set(key, p);
		}
		return p;
	}
	getDoc(id: string, version: string, kind: "readme" | "changelog"): Promise<string> {
		return this.cached(`${kind}:${id}:${version}`, () => api.getPackageDoc(id, version, kind));
	}
	getWiki(id: string): Promise<WikiIndex | null> {
		return this.cached(`wiki:${id}`, () => api.getPackageWiki(id));
	}
	getWikiPage(page: string): Promise<string> {
		return this.cached(`wikipage:${page}`, () => api.getWikiPage(page));
	}

	publishCategories(): Promise<PublishCategory[]> {
		return this.cached("publish:categories", () => api.thunderstoreCategories());
	}

	modpackPreview(name: string, description: string): Promise<ModpackPreview> {
		if (!this.state.active) return Promise.reject(new Error(t("installed.noProfile")));
		return api.modpackPreview(this.state.active, name, description);
	}

	/** Builds, validates, uploads and submits; the caller shows the error text, success is toasted too. */
	async publishModpack(meta: PublishMeta): Promise<PublishResult> {
		if (!this.state.active) throw new Error(t("installed.noProfile"));
		const r = await api.publishModpack(this.state.active, meta);
		this.toast(t("toast.published", { name: r.fullName }), "ok");
		return r;
	}

	/** From a readme link: select this package so the Browse detail panel shows it (the caller navigates). */
	focusPackage(id: string): boolean {
		if (!this.byId.has(id)) return false;
		this.browse.selection = { ids: new Set([id]), anchor: id, focus: id };
		return true;
	}

	/** From the detail panel: include a category or author (again: off). */
	filterCategory(cat: string) {
		this.browse.setTri("cats", cat, this.browse.criteria.lists.cats[cat] === 1 ? 0 : 1);
	}

	filterOwner(owner: string) {
		this.browse.setTri("owners", owner, this.browse.criteria.lists.owners[owner] === 1 ? 0 : 1);
	}
}

export const store = new ModManagerStore();
