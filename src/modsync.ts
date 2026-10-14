// What a config edit on the server reaches, per mod. Each plugin DLL is scanned once (plain string search
// over the file, cached by hash) for the markers of the two sync libraries and of a file watcher:
//   ServerSync + ConfigSync            → ServerSync: the server's values reach clients when they join
//   IsAdminOnly (± SynchronizationManager) → Jötunn: only entries marked IsAdminOnly are synced
//   FileSystemWatcher / SetupWatcher / ReadConfigValues / ConfigFileWatcher → the mod probably re-reads its
//                                        file (a hint for the admin; a release restarts the server anyway)
//   nothing                            → client-side config: a server edit reaches nobody
// A config file is matched to the DLL that contains its base name (the BepInEx GUID, e.g. "Therzie.Warfare").
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { writeAtomic } from "./fsutil";
import { loadInstalled } from "./install";
import { BEPINEX_DIR, MM_DIR } from "./paths";

export type SyncKind = "serversync" | "jotunn" | "none" | "unknown";

export interface ConfigSync {
	sync: SyncKind;
	/** the DLL mentions a file watcher, so the mod may re-read its config while running. A hint only: the string
	 *  does not say which file is watched, so a release never skips the restart because of it. */
	liveReload: boolean;
	/** the mod (manifest id) whose DLL matched, when installed.json knows the file */
	mod: string | null;
	/** the DLL relative to the BepInEx folder, null when no plugin mentions the config's name */
	dll: string | null;
}

export const MARKERS = [
	"ServerSync",
	"ConfigSync",
	"SynchronizationManager",
	"IsAdminOnly",
	"FileSystemWatcher",
	"SetupWatcher",
	"ReadConfigValues",
	"ConfigFileWatcher",
] as const;
export type Marker = (typeof MARKERS)[number];

const WATCHERS: Marker[] = ["FileSystemWatcher", "SetupWatcher", "ReadConfigValues", "ConfigFileWatcher"];

interface ScanEntry {
	size: number;
	mtimeMs: number;
	hash: string;
	markers: Marker[];
	/** config base names already looked for in this DLL → found or not */
	names: Record<string, boolean>;
}

const CACHE_FILE = join(MM_DIR, "plugin-scan.json");

/** Pure classification of a DLL's markers, shared with the tests. */
export function classify(markers: readonly string[]): Pick<ConfigSync, "sync" | "liveReload"> {
	const has = (m: Marker) => markers.includes(m);
	// Jötunn syncs the entries marked IsAdminOnly; a mod sets that through ConfigurationManagerAttributes and
	// need not mention SynchronizationManager itself (EpicLootProgressionFix does not).
	const sync: SyncKind = has("ServerSync") && has("ConfigSync") ? "serversync" : has("IsAdminOnly") ? "jotunn" : "none";
	return { sync, liveReload: WATCHERS.some(has) };
}

/** Which of `needles` occur as plain ASCII bytes in `bytes` (the .NET metadata string heap is UTF-8). */
export function findStrings(bytes: Uint8Array, needles: readonly string[]): string[] {
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return needles.filter((n) => buf.includes(n, 0, "latin1"));
}

async function walkDlls(dir: string, rel = ""): Promise<string[]> {
	const out: string[] = [];
	for (const it of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const r = rel ? `${rel}/${it.name}` : it.name;
		if (it.isDirectory()) out.push(...(await walkDlls(join(dir, it.name), r)));
		else if (it.isFile() && it.name.toLowerCase().endsWith(".dll")) out.push(r);
	}
	return out.sort();
}

async function loadCache(): Promise<Record<string, ScanEntry>> {
	try {
		return JSON.parse(await readFile(CACHE_FILE, "utf-8")) as Record<string, ScanEntry>;
	} catch {
		return {};
	}
}

const baseName = (configPath: string) => (configPath.split("/").pop() ?? configPath).replace(/\.[^.]+$/, "");

/**
 * Sync info for config files (paths relative to the config folder). DLLs are read only when they are new,
 * changed, or have not been searched for one of the names yet.
 */
export async function configSyncInfo(configFiles: string[], bepinexDir = BEPINEX_DIR): Promise<Record<string, ConfigSync>> {
	const pluginsDir = join(bepinexDir, "plugins");
	const dlls = await walkDlls(pluginsDir, "plugins");
	const cache = await loadCache();
	const names = [...new Set(configFiles.map(baseName))].filter((n) => n.length >= 3);
	let dirty = false;

	for (const rel of dlls) {
		const abs = join(bepinexDir, rel);
		const st = await stat(abs).catch(() => null);
		if (!st) continue;
		let entry = cache[rel];
		let bytes: Uint8Array | null = null;
		if (!entry || entry.size !== st.size || entry.mtimeMs !== st.mtimeMs) {
			bytes = new Uint8Array(await readFile(abs));
			const h = new Bun.CryptoHasher("sha256");
			h.update(bytes);
			const hash = h.digest("hex");
			const same = entry?.hash === hash ? entry : Object.values(cache).find((e) => e.hash === hash);
			entry = same
				? { ...same, size: st.size, mtimeMs: st.mtimeMs }
				: { size: st.size, mtimeMs: st.mtimeMs, hash, markers: findStrings(bytes, MARKERS) as Marker[], names: {} };
			dirty = true;
		}
		const missing = names.filter((n) => !(n in entry!.names));
		if (missing.length) {
			bytes ??= new Uint8Array(await readFile(abs));
			const found = new Set(findStrings(bytes, missing));
			for (const n of missing) entry.names[n] = found.has(n);
			dirty = true;
		}
		cache[rel] = entry;
	}
	for (const rel of Object.keys(cache)) if (!dlls.includes(rel)) ((dirty = true), delete cache[rel]);
	if (dirty) await writeAtomic(CACHE_FILE, JSON.stringify(cache, null, 2)).catch(() => {});

	const installed = await loadInstalled();
	const modOf = new Map<string, string>();
	for (const [id, { files }] of Object.entries(installed)) for (const f of files) modOf.set(f.replaceAll("\\", "/"), id);

	const out: Record<string, ConfigSync> = {};
	const unknown = (): ConfigSync => ({ sync: "unknown", liveReload: false, mod: null, dll: null });
	for (const file of configFiles) {
		const name = baseName(file);
		// A dependent mod's DLL mentions the GUID too (Monstrum references Therzie.Warfare), and a name every
		// DLL contains (BepInEx) says nothing: pick the DLL whose mod id or file name resembles the config name.
		const hits = dlls.filter((d) => cache[d]?.names[name]);
		if (!hits.length || (dlls.length > 2 && hits.length > dlls.length / 2)) {
			out[file] = unknown();
			continue;
		}
		const best = hits.map((d) => ({ d, score: resemblance(name, modOf.get(d) ?? null, d) })).sort((a, b) => b.score - a.score)[0].d;
		out[file] = { ...classify(cache[best].markers), mod: modOf.get(best) ?? null, dll: best };
	}
	return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && x !== "mods" && x !== "valheim"));

/** How much a config name (BepInEx GUID) looks like the mod id from installed.json or the DLL's file name. */
export function resemblance(configName: string, modId: string | null, dll: string): number {
	const ct = tokens(configName);
	// the GUID without filler words: "valheim.epiclootprogressionfix" → "epiclootprogressionfix"
	const c = [...ct].join("") || norm(configName);
	let score = 0;
	if (modId) {
		const m = norm(modId);
		if (m === c) score += 6;
		else if (m.includes(c) || c.includes(m)) score += 4;
		score += [...tokens(modId)].filter((x) => ct.has(x)).length;
	}
	const f = norm((dll.split("/").pop() ?? "").replace(/\.dll$/i, ""));
	if (f && f === c) score += 3;
	else if (f && (c.includes(f) || f.includes(c))) score += 2;
	return score;
}
