// The lock that server and client agree on. The client resolves and publishes it; the companion installs it.
import { readFile } from "fs/promises";
import { join } from "path";
import { walkConfigs } from "./configdir";
import { writeAtomic } from "./fsutil";
import { BEPINEX_CONFIG_DIR, INSTALLED_FILE, MANIFEST_FILE, MM_DIR } from "./paths";

export const BEPINEX_PACK_ID = "denikson-BepInExPack_Valheim";
export const CONFIG_EXTS = ["cfg", "txt", "json", "yml", "yaml", "ini"];
export const isConfigFile = (name: string) => CONFIG_EXTS.includes(name.split(".").pop()?.toLowerCase() ?? "");

export interface ManifestMod {
	/** "Namespace-Name" */
	id: string;
	version: string;
	/** In the profile itself, as opposed to a resolved dependency. */
	explicit: boolean;
	requiredBy: string[];
	/** Namespace and name as the store knows them, when the client sent them: `id` alone cannot be split
	 *  when the team name has a hyphen (`LVH-IT-UseEquipmentInWater`). */
	ns?: string;
	name?: string;
	/** The store the release is downloaded from; missing means Thunderstore. */
	source?: "thunderstore" | "hexium";
}

export interface ServerInfo {
	name: string;
	world: string;
	gameVersion: string | null;
	bepinex: string | null;
}

export interface Manifest {
	schema: 1;
	generatedAt: number;
	server: ServerInfo;
	mods: ManifestMod[];
	/** config file path → sha256 */
	configs: Record<string, string>;
	hash: string;
}

export interface ModDiff {
	added: ManifestMod[];
	removed: ManifestMod[];
	changed: { id: string; from: string; to: string }[];
}

export const isPack = (id: string) => id.toLowerCase().startsWith("denikson-bepinexpack");

function sha256(input: string | Uint8Array): string {
	const h = new Bun.CryptoHasher("sha256");
	h.update(input);
	return h.digest("hex");
}

/** Order-independent hash over id@version, BepInExPack excluded (the image ships it). */
export function hashMods(mods: ManifestMod[]): string {
	const lines = mods
		.filter((m) => !isPack(m.id))
		.map((m) => `${m.id}@${m.version}`)
		.sort();
	return `sha256:${sha256(lines.join("\n"))}`;
}

/** Current vs incoming, BepInExPack ignored. */
export function diffMods(current: ManifestMod[], incoming: ManifestMod[]): ModDiff {
	const cur = new Map(current.filter((m) => !isPack(m.id)).map((m) => [m.id, m]));
	const inc = new Map(incoming.filter((m) => !isPack(m.id)).map((m) => [m.id, m]));
	const added = [...inc.values()].filter((m) => !cur.has(m.id));
	const removed = [...cur.values()].filter((m) => !inc.has(m.id));
	const changed = [...inc.values()]
		.filter((m) => cur.has(m.id) && cur.get(m.id)!.version !== m.version)
		.map((m) => ({ id: m.id, from: cur.get(m.id)!.version, to: m.version }));
	return { added, removed, changed };
}

export function sameMods(a: ManifestMod[], b: ManifestMod[]): boolean {
	const d = diffMods(a, b);
	return !d.added.length && !d.removed.length && !d.changed.length;
}

function cleanMod(raw: unknown): ManifestMod | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const id = typeof r.id === "string" ? r.id.trim() : "";
	const version = typeof r.version === "string" ? r.version.trim() : "";
	// Team and package names may themselves contain hyphens; versions may carry a semver pre-release tag.
	if (!/^[A-Za-z0-9_]+(-[A-Za-z0-9_]+)+$/.test(id) || !/^\d+(\.\d+)*(-[A-Za-z0-9.]+)?$/.test(version)) return null;
	const part = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v) ? v : "");
	const ns = part(r.ns);
	const name = part(r.name);
	return {
		id,
		version,
		explicit: r.explicit !== false,
		requiredBy: Array.isArray(r.requiredBy) ? r.requiredBy.filter((x): x is string => typeof x === "string") : [],
		...(ns && name && `${ns}-${name}` === id ? { ns, name } : {}),
		...(r.source === "hexium" ? { source: "hexium" as const } : {}),
	};
}

/** Validates an incoming manifest body and stamps it. Throws on an unusable body. */
export function normalizeManifest(body: unknown, server: ServerInfo, configs: Record<string, string>): Manifest {
	if (!body || typeof body !== "object" || !Array.isArray((body as { mods?: unknown }).mods)) {
		throw new Error("manifest.mods must be an array");
	}
	const seen = new Set<string>();
	const mods: ManifestMod[] = [];
	for (const raw of (body as { mods: unknown[] }).mods) {
		const m = cleanMod(raw);
		if (!m) throw new Error(`invalid mod entry: ${JSON.stringify(raw)}`);
		if (seen.has(m.id)) continue;
		seen.add(m.id);
		mods.push(m);
	}
	mods.sort((a, b) => a.id.localeCompare(b.id));
	return {
		schema: 1,
		generatedAt: Date.now(),
		server,
		mods,
		configs,
		hash: hashMods(mods),
	};
}

export async function loadManifest(): Promise<Manifest | null> {
	try {
		const raw = JSON.parse(await readFile(MANIFEST_FILE, "utf-8"));
		return normalizeManifest(raw, raw.server, raw.configs ?? {});
	} catch {
		return null;
	}
}

export async function saveManifest(m: Manifest): Promise<void> {
	await writeAtomic(MANIFEST_FILE, JSON.stringify(m, null, 2));
}

/** sha256 per config file (relative path → hash), so the client can tell "same mods, other configs". */
export async function configHashes(dir = BEPINEX_CONFIG_DIR): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const rel of await walkConfigs(isConfigFile, dir)) out[rel] = `sha256:${sha256(new Uint8Array(await readFile(join(dir, rel))))}`;
	return out;
}

/**
 * First start on a server that was managed by the old webapp: its profiles/<name>.json (explicit mods)
 * and installed.json (everything) become the manifest. Hand-installed servers without installed.json get
 * an empty manifest and are filled by the first publish.
 */
export async function migrateLegacy(server: ServerInfo): Promise<Manifest | null> {
	let installed: Record<string, { version: string }> = {};
	try {
		installed = JSON.parse(await readFile(INSTALLED_FILE, "utf-8"));
	} catch {
		return null;
	}
	const explicit = new Set<string>();
	try {
		const active = (await readFile(join(MM_DIR, "active.txt"), "utf-8")).trim();
		const p = JSON.parse(await readFile(join(MM_DIR, "profiles", `${active}.json`), "utf-8"));
		for (const m of p.mods ?? []) explicit.add(`${m.namespace}-${m.name}`);
	} catch {
		/* no legacy profile: everything counts as explicit */
	}
	const mods = Object.entries(installed).map(([id, e]) => ({
		id,
		version: e.version,
		explicit: !explicit.size || explicit.has(id),
		requiredBy: [],
	}));
	return normalizeManifest({ mods }, server, await configHashes());
}
