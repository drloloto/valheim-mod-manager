// The config folder shares /config/bepinex with plugins/ and patchers/ (see paths.ts). Those two hold mods,
// not configs: every walk, write, backup and restore of "the configs" goes through here and skips them.
import { readdir } from "fs/promises";
import { join, relative, sep } from "path";
import { BEPINEX_CONFIG_DIR, CONFIG_DIR } from "./paths";

const LOADABLES = new Set(["plugins", "patchers"]);

/** the config folder as an archive member relative to /config, e.g. "bepinex" */
export const CONFIG_MEMBER = relative(CONFIG_DIR, BEPINEX_CONFIG_DIR).split(sep).join("/");

export const isConfigEntry = (top: string) => !LOADABLES.has(top);

/** A client-supplied path relative to the config folder, or null when it escapes it or points into plugins/patchers. */
export function configRel(p: string): string | null {
	const rel = p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
	const parts = rel.split("/");
	if (!rel || rel.startsWith("/") || parts.some((x) => x === ".." || x === "." || x === "")) return null;
	return isConfigEntry(parts[0]) ? rel : null;
}

/** top-level entries of the config folder (what a backup takes and a restore swaps) */
export async function configEntries(dir = BEPINEX_CONFIG_DIR): Promise<string[]> {
	return (await readdir(dir).catch(() => [] as string[])).filter(isConfigEntry);
}

/** relative paths of the files below the config folder whose name passes `keep` */
export async function walkConfigs(keep: (name: string) => boolean, dir = BEPINEX_CONFIG_DIR): Promise<string[]> {
	const out: string[] = [];
	async function walk(sub: string) {
		const items = await readdir(join(dir, sub), { withFileTypes: true }).catch(() => []);
		for (const it of items) {
			if (!sub && !isConfigEntry(it.name)) continue;
			const rel = sub ? `${sub}/${it.name}` : it.name;
			if (it.isDirectory()) await walk(rel);
			else if (it.isFile() && keep(it.name)) out.push(rel);
		}
	}
	await walk("");
	return out.sort();
}
