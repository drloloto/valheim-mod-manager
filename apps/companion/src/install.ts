// Installs a manifest (lock) into /config/bepinex. Layout rules are a port of the client's install.rs so a
// profile looks the same on both sides. The BepInEx pack is skipped: the server image ships BepInEx.
import { mkdir, readFile, readdir, rename, rm, stat } from "fs/promises";
import { dirname, join, normalize, sep } from "path";
import { unzipSync } from "fflate";
import { writeAtomic } from "./fsutil";
import { configRel } from "./configdir";
import { BEPINEX_CONFIG_DIR, BEPINEX_DIR, DOWNLOAD_CACHE_DIR, INSTALLED_FILE, UNTRACKED_DIR } from "./paths";
import { isPack, type Manifest, type ManifestMod } from "./manifest";

const EXCLUDED_ROOT_FILES = new Set(["icon.png", "manifest.json", "readme.md", "changelog.md"]);
const BEPINEX_SUBFOLDERS = new Set(["plugins", "patchers", "config", "core", "monomod"]);
const DOWNLOAD_CONCURRENCY = 4;

export type Installed = Record<string, { version: string; files: string[] }>;

export type Layout = { kind: "pack"; root: string } | { kind: "bepinexRoot"; root: string } | { kind: "subfolders" } | { kind: "bare" };

/** Splits a zip entry name; null for unsafe paths. */
export function zipEntryParts(name: string): string[] | null {
	const n = name.replace(/\\/g, "/");
	if (n.startsWith("/")) return null;
	const parts: string[] = [];
	for (const p of n.split("/")) {
		if (p === "" || p === ".") continue;
		if (p === ".." || p.includes(":")) return null;
		parts.push(p);
	}
	return parts;
}

export function detectLayout(entries: { parts: string[]; isDir: boolean }[]): Layout {
	const dirs = new Set(entries.filter((e) => e.parts.length > 1 || e.isDir).map((e) => e.parts[0]));
	for (const d of dirs) if (d.toLowerCase().startsWith("bepinexpack")) return { kind: "pack", root: d };
	for (const d of dirs) if (d.toLowerCase() === "bepinex") return { kind: "bepinexRoot", root: d };
	for (const d of dirs) if (BEPINEX_SUBFOLDERS.has(d.toLowerCase())) return { kind: "subfolders" };
	return { kind: "bare" };
}

/** Target path relative to the BepInEx folder, null = skip. */
export function mapTarget(layout: Layout, parts: string[], id: string): string[] | null {
	const first = parts[0].toLowerCase();
	const rootFileExcluded = parts.length === 1 && EXCLUDED_ROOT_FILES.has(first);
	switch (layout.kind) {
		case "pack":
			return null; // the image provides BepInEx itself
		case "bepinexRoot":
			return parts[0] === layout.root && parts.length > 1 ? parts.slice(1) : null;
		case "subfolders":
			if (parts.length > 1 && BEPINEX_SUBFOLDERS.has(first)) return [first, ...parts.slice(1)];
			return rootFileExcluded ? null : ["plugins", id, ...parts];
		case "bare":
			return rootFileExcluded ? null : ["plugins", id, ...parts];
	}
}

function safeJoin(base: string, rel: string): string {
	const abs = normalize(join(base, rel));
	if (!abs.startsWith(base + sep)) throw new Error(`unsafe path: ${rel}`);
	return abs;
}

/**
 * Extracts one zip into `bepinexDir`; returns the written files (relative, configs excluded). A package's
 * `config/` goes to the config folder (in the image that is /config/bepinex itself) and never overwrites.
 */
export async function extractZip(zipBytes: Uint8Array, bepinexDir: string, id: string, configDir = BEPINEX_CONFIG_DIR): Promise<string[]> {
	const files = unzipSync(zipBytes);
	const entries: { name: string; parts: string[]; isDir: boolean }[] = [];
	for (const name of Object.keys(files)) {
		const parts = zipEntryParts(name);
		if (!parts) throw new Error(`unsafe path in ${id}: ${name}`);
		if (parts.length) entries.push({ name, parts, isDir: name.endsWith("/") });
	}
	const layout = detectLayout(entries);
	const written: string[] = [];
	for (const e of entries) {
		if (e.isDir) continue;
		const target = mapTarget(layout, e.parts, id);
		if (!target) continue;
		const rel = target.join("/");
		const isConfig = target[0] === "config";
		const configPath = isConfig ? configRel(target.slice(1).join("/")) : null;
		if (isConfig && !configPath) continue;
		const dest = configPath ? join(configDir, configPath) : safeJoin(bepinexDir, rel);
		if (isConfig && (await Bun.file(dest).exists())) continue; // never overwrite server configs
		await mkdir(dirname(dest), { recursive: true });
		await Bun.write(dest, files[e.name]);
		if (!isConfig) written.push(rel);
	}
	return [...new Set(written)].sort();
}

export async function loadInstalled(): Promise<Installed> {
	try {
		return JSON.parse(await readFile(INSTALLED_FILE, "utf-8"));
	} catch {
		return {};
	}
}

async function saveInstalled(map: Installed): Promise<void> {
	await writeAtomic(INSTALLED_FILE, JSON.stringify(map, null, 2));
}

async function pruneEmptyDir(dir: string, base: string): Promise<void> {
	if (!dir.startsWith(base + sep)) return;
	try {
		if ((await readdir(dir)).length === 0) {
			await rm(dir, { recursive: true, force: true });
			await pruneEmptyDir(dirname(dir), base);
		}
	} catch {
		/* already gone */
	}
}

export async function removeFiles(files: string[], bepinexDir = BEPINEX_DIR): Promise<void> {
	const dirs = new Set<string>();
	for (const rel of files) {
		const abs = safeJoin(bepinexDir, rel);
		await rm(abs, { force: true });
		dirs.add(dirname(abs));
	}
	for (const d of [...dirs].sort((a, b) => b.length - a.length)) await pruneEmptyDir(d, bepinexDir);
}

/** The stored pair when the lock carries it, otherwise the id split at its first hyphen. */
export function splitId(mod: { id: string; ns?: string; name?: string }): { ns: string; name: string } {
	if (mod.ns && mod.name) return { ns: mod.ns, name: mod.name };
	const i = mod.id.indexOf("-");
	return { ns: mod.id.slice(0, i), name: mod.id.slice(i + 1) };
}

type Download = { id: string; version: string; ns?: string; name?: string; source?: string };

/** Thunderstore derives the file from the id; Hexium's CDN pattern redirects to the stored file. */
export const downloadUrl = (mod: Download) => {
	const { ns, name } = splitId(mod);
	return mod.source === "hexium"
		? `https://cdn.hexium.gg/uploads/${ns}/${name}/${mod.version}.zip`
		: `https://thunderstore.io/package/download/${ns}/${name}/${mod.version}/`;
};

const UA = { "user-agent": "valheim-companion/0.2" };

/** The zip of a release. When Hexium's CDN pattern does not resolve, its package API names the file. */
async function fetchZip(mod: Download): Promise<Response> {
	const res = await fetch(downloadUrl(mod), { headers: UA });
	if (res.ok || mod.source !== "hexium") return res;
	const { ns, name } = splitId(mod);
	const api = await fetch(`https://valheim.hexium.gg/api/experimental/package/${ns}/${name}/${mod.version}/`, { headers: UA }).catch(() => null);
	if (!api?.ok) return res;
	const body = (await api.json()) as { download_url?: string };
	return body.download_url ? fetch(body.download_url, { headers: UA }) : res;
}

export interface ApplyResult {
	installed: string[];
	removed: string[];
	errors: string[];
	/** hand-installed files moved aside on the first apply (relative to BepInEx) */
	movedAside: string[];
	/** where they went, null when nothing was moved */
	movedAsideTo: string | null;
}

/** No installed.json yet: the companion has never installed anything here, whatever is in plugins/ was put there by hand. */
export const firstTakeover = async () => !(await Bun.file(INSTALLED_FILE).exists());

/** Files under plugins/ and patchers/ that installed.json does not know (relative to the BepInEx folder). */
export async function untrackedFiles(installed: Installed, bepinexDir = BEPINEX_DIR): Promise<string[]> {
	const tracked = new Set(Object.values(installed).flatMap((e) => e.files));
	const out: string[] = [];
	const walk = async (rel: string) => {
		for (const it of await readdir(join(bepinexDir, rel), { withFileTypes: true }).catch(() => [])) {
			const r = `${rel}/${it.name}`;
			if (it.isDirectory()) await walk(r);
			else if (!tracked.has(r)) out.push(r);
		}
	};
	for (const top of ["plugins", "patchers"]) await walk(top);
	return out.sort();
}

/**
 * Moves files out of the BepInEx folder into `targetDir`, keeping their relative paths. Nothing is deleted:
 * the image prunes them from /opt/valheim on the next start because they left /config/bepinex.
 */
export async function moveAside(files: string[], targetDir: string, bepinexDir = BEPINEX_DIR): Promise<void> {
	const dirs = new Set<string>();
	for (const rel of files) {
		const from = safeJoin(bepinexDir, rel);
		const to = join(targetDir, ...rel.split("/"));
		await mkdir(dirname(to), { recursive: true });
		await rename(from, to);
		dirs.add(dirname(from));
	}
	for (const d of [...dirs].sort((a, b) => b.length - a.length)) await pruneEmptyDir(d, bepinexDir);
}

/** What the manifest wants that installed.json does not have, and the other way round. */
export function planChanges(mods: ManifestMod[], installed: Installed): { toInstall: ManifestMod[]; toRemove: string[] } {
	const wanted = mods.filter((m) => !isPack(m.id));
	const ids = new Set(wanted.map((m) => m.id));
	return {
		toInstall: wanted.filter((m) => installed[m.id]?.version !== m.version),
		toRemove: Object.keys(installed).filter((id) => !ids.has(id)),
	};
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
	const queue = [...items];
	await Promise.all(
		Array.from({ length: Math.min(n, queue.length) }, async () => {
			while (queue.length) await fn(queue.shift()!);
		}),
	);
}

export const zipPath = (mod: { id: string; version: string }) => join(DOWNLOAD_CACHE_DIR, `${mod.id}-${mod.version}.zip`);

/**
 * Downloads every zip that is not cached yet and checks that it can be read. Touches nothing live, so a
 * release can be staged while players are on. Returns the problems found.
 */
export async function prefetch(mods: ManifestMod[], log: (line: string) => void = () => {}): Promise<string[]> {
	await mkdir(DOWNLOAD_CACHE_DIR, { recursive: true });
	const problems: string[] = [];
	await pool(
		mods.filter((m) => !isPack(m.id)),
		DOWNLOAD_CONCURRENCY,
		async (mod) => {
			const zip = zipPath(mod);
			try {
				if (!(await Bun.file(zip).exists())) {
					const res = await fetchZip(mod);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					await Bun.write(`${zip}.part`, res);
					await rename(`${zip}.part`, zip);
					log(`downloaded ${mod.id} ${mod.version}`);
				}
				const files = unzipSync(new Uint8Array(await readFile(zip)));
				if (!Object.keys(files).some((f) => f.toLowerCase().endsWith(".dll") || f.toLowerCase().includes("/"))) {
					problems.push(`${mod.id} ${mod.version}: the package contains no files to install`);
				}
			} catch (e) {
				await rm(zip, { force: true });
				problems.push(`Download failed (${mod.id} ${mod.version}): ${(e as Error).message}`);
			}
		},
	);
	return problems;
}

export async function applyManifest(m: Manifest, log: (line: string) => void = () => {}): Promise<ApplyResult> {
	const takeover = await firstTakeover();
	const installed = await loadInstalled();
	const { toInstall, toRemove } = planChanges(m.mods, installed);
	const result: ApplyResult = { installed: [], removed: [], errors: await prefetch(toInstall, log), movedAside: [], movedAsideTo: null };

	// A hand-installed server: the lock replaces whatever is in plugins/, otherwise old and new copies of the
	// same mod would both load. The old files are kept, not deleted.
	if (takeover) {
		const untracked = await untrackedFiles(installed);
		if (untracked.length) {
			const target = join(UNTRACKED_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
			await moveAside(untracked, target);
			result.movedAside = untracked;
			result.movedAsideTo = target;
			log(`moved ${untracked.length} hand-installed files to ${target}`);
		}
	}

	for (const id of toRemove) {
		try {
			await removeFiles(installed[id].files);
			delete installed[id];
			result.removed.push(id);
			log(`removed ${id}`);
		} catch (e) {
			result.errors.push(`Uninstall failed (${id}): ${(e as Error).message}`);
		}
	}
	for (const mod of toInstall) {
		const zip = zipPath(mod);
		if (!(await Bun.file(zip).exists())) continue; // download error already recorded
		try {
			if (installed[mod.id]) await removeFiles(installed[mod.id].files);
			const files = await extractZip(new Uint8Array(await readFile(zip)), BEPINEX_DIR, mod.id);
			installed[mod.id] = { version: mod.version, files };
			result.installed.push(`${mod.id}@${mod.version}`);
			log(`installed ${mod.id} ${mod.version} (${files.length} files)`);
		} catch (e) {
			await rm(zip, { force: true }); // re-download next time
			result.errors.push(`Installation failed (${mod.id}): ${(e as Error).message}`);
		}
	}
	await saveInstalled(installed);
	return result;
}

export async function dirSize(path: string): Promise<number> {
	const s = await stat(path).catch(() => null);
	if (!s) return 0;
	if (s.isFile()) return s.size;
	let total = 0;
	for (const e of await readdir(path)) total += await dirSize(join(path, e));
	return total;
}
