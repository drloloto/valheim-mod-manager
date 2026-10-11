// Thin layer over the Tauri commands of the Rust core (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import type { ForeignProfile } from "./types";
import type {
	AppState,
	ConfigChange,
	ExportResult,
	FolderKind,
	GameInfo,
	ImportResult,
	IndexPayload,
	ParsedConfig,
	Pkg,
	ProfileMod,
	ApplyResponse,
	ApplyWhen,
	ProfileServerCheck,
	ServerCheck,
	ServerDiscovery,
	StageResponse,
	WikiIndex,
	ServerLink,
	Settings,
} from "./types";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly kind: string = "unknown",
	) {
		super(message);
	}
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	try {
		return await invoke<T>(cmd, args);
	} catch (e) {
		if (e && typeof e === "object" && "message" in e) {
			const err = e as { message: unknown; kind?: unknown };
			throw new ApiError(String(err.message), String(err.kind ?? "unknown"));
		}
		throw new ApiError(String(e));
	}
}

export const api = {
	state: () => call<AppState>("get_state"),

	/** `null` when the index has not changed since `since`. */
	index: async (since: number | null): Promise<IndexPayload | null> => {
		const buf = await call<ArrayBuffer>("get_index", { since });
		if (!buf.byteLength) return null;
		return JSON.parse(new TextDecoder().decode(buf)) as IndexPayload;
	},
	refreshIndex: () => call<number | null>("refresh_index"),
	getPackage: (id: string) => call<Pkg>("get_package", { id }),
	getPackageDoc: (id: string, version: string, kind: "readme" | "changelog") => call<string>("get_package_doc", { id, version, kind }),
	getPackageWiki: (id: string) => call<WikiIndex | null>("get_package_wiki", { id }),
	getWikiPage: (page: string) => call<string>("get_wiki_page", { page }),

	createProfile: (name: string) => call<AppState>("create_profile", { name }),
	deleteProfile: (name: string) => call<AppState>("delete_profile", { name }),
	activateProfile: (name: string) => call<AppState>("activate_profile", { name }),
	renameProfile: (from: string, to: string) => call<AppState>("rename_profile", { from, to }),
	cloneProfile: (from: string, to: string) => call<AppState>("clone_profile", { from, to }),
	setMods: (profile: string, mods: ProfileMod[]) => call<AppState>("set_mods", { profile, mods }),
	setModEnabled: (profile: string, id: string, enabled: boolean) => call<AppState>("set_mod_enabled", { profile, id, enabled }),
	repairProfile: (profile: string) => call<AppState>("repair_profile", { profile }),
	addLocalMods: (profile: string, paths: string[]) => call<AppState>("add_local_mods", { profile, paths }),

	importProfileCode: (code: string, name: string, withConfigs: boolean, installAll: boolean) =>
		call<ImportResult>("import_profile_code", { code, name, withConfigs, installAll }),
	importProfileFile: (path: string, name: string, withConfigs: boolean, installAll: boolean) =>
		call<ImportResult>("import_profile_file", { path, name, withConfigs, installAll }),
	importProfileUrl: (url: string, name: string, withConfigs: boolean, installAll: boolean, link: ServerLink | null) =>
		call<ImportResult>("import_profile_url", { url, name, withConfigs, installAll, link }),
	setServerLink: (profile: string, link: ServerLink | null) => call<AppState>("set_server_link", { profile, link }),
	checkServer: (profile: string) => call<ServerCheck>("check_server", { profile }),
	checkAllServers: () => call<ProfileServerCheck[]>("check_all_servers"),
	discoverServer: (url: string) => call<ServerDiscovery>("discover_server", { url }),
	adoptServer: (profile: string, withConfigs: boolean, intoNew: string | null) => call<AppState>("adopt_server", { profile, withConfigs, intoNew }),
	publishProfile: (profile: string, withConfigs: boolean) => call<StageResponse>("publish_profile", { profile, withConfigs }),
	applyRelease: (profile: string, id: string, when: ApplyWhen, at: number | null) => call<ApplyResponse>("apply_release", { profile, id, when, at }),
	discardRelease: (profile: string, id: string) => call<void>("discard_release", { profile, id }),
	listForeignProfiles: () => call<ForeignProfile[]>("list_foreign_profiles"),
	importForeignProfile: (path: string, name: string, withConfigs: boolean, installAll: boolean) =>
		call<ImportResult>("import_foreign_profile", { path, name, withConfigs, installAll }),
	exportProfileCode: (profile: string) => call<ExportResult>("export_profile_code", { profile }),
	exportProfileFile: (profile: string, path: string) => call<ExportResult>("export_profile_file", { profile, path }),

	launchGame: (modded: boolean) => call<void>("launch_game", { modded }),
	getSettings: () => call<Settings>("get_settings"),
	saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
	detectGame: () => call<GameInfo>("detect_game"),
	clearDownloadCache: () => call<number>("clear_download_cache"),
	openFolder: (kind: FolderKind) => call<void>("open_folder", { kind }),

	listConfigFiles: () => call<string[]>("list_config_files"),
	getConfigFile: (file: string) => call<ParsedConfig>("get_config_file", { file }),
	saveConfigFile: (file: string, changes: ConfigChange[]) => call<void>("save_config_file", { file, changes }),

	startLogTail: () => call<string[]>("start_log_tail"),
	stopLogTail: () => call<void>("stop_log_tail"),
};
