// Installs a manifest (lock) into /config/bepinex. Layout rules are a port of the client's install.rs so a
// profile looks the same on both sides. The BepInEx pack is skipped: the server image ships BepInEx.
import { mkdir, readFile, readdir, rm, stat } from "fs/promises";
import { dirname, join, normalize, sep } from "path";
import { unzipSync } from "fflate";
import { BEPINEX_DIR, DOWNLOAD_CACHE_DIR, INSTALLED_FILE } from "./paths";
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

/** Extracts one zip into `bepinexDir`; returns the written files (relative, configs excluded). */
export async function extractZip(zipBytes: Uint8Array, bepinexDir: string, id: string): Promise<string[]> {
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
		const dest = safeJoin(bepinexDir, rel);
		const isConfig = rel.startsWith("config/");
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
	await Bun.write(INSTALLED_FILE, JSON.stringify(map, null, 2));
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

export function splitId(id: string): { ns: string; name: string } {
	const i = id.indexOf("-");
	return { ns: id.slice(0, i), name: id.slice(i + 1) };
}

export const downloadUrl = (id: string, version: string) => {
	const { ns, name } = splitId(id);
	return `https://thunderstore.io/package/download/${ns}/${name}/${version}/`;
};

export interface ApplyResult {
	installed: string[];
	removed: string[];
	errors: string[];
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
					const res = await fetch(downloadUrl(mod.id, mod.version), {
						headers: { "user-agent": "valheim-companion/0.2" },
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					await Bun.write(`${zip}.part`, res);
					await Bun.write(zip, Bun.file(`${zip}.part`));
					await rm(`${zip}.part`, { force: true });
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
	const installed = await loadInstalled();
	const { toInstall, toRemove } = planChanges(m.mods, installed);
	const result: ApplyResult = { installed: [], removed: [], errors: await prefetch(toInstall, log) };

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
