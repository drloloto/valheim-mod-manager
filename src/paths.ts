// Every path the companion touches, derived from the three mounts: /config (the game's bind mount),
// /backups and the env file. Tests override CONFIG_DIR/BACKUP_DIR before importing.
import { join } from "path";
import { mkdir } from "fs/promises";

export const CONFIG_DIR = process.env.CONFIG_DIR || "/config";
export const BACKUP_DIR = process.env.BACKUP_DIR || "/backups";
export const ENV_FILE = process.env.ENV_FILE || "/env/valheim.env";

export const BEPINEX_DIR = join(CONFIG_DIR, "bepinex");
export const BEPINEX_CONFIG_DIR = join(BEPINEX_DIR, "config");
export const WORLDS_DIR = join(CONFIG_DIR, "worlds_local");

export const MM_DIR = join(CONFIG_DIR, "modmanager");
export const MANIFEST_FILE = join(MM_DIR, "manifest.json");
export const INSTALLED_FILE = join(MM_DIR, "installed.json");
export const DOWNLOAD_CACHE_DIR = join(MM_DIR, "cache", "downloads");

export async function ensureDirs() {
	for (const dir of [join(BEPINEX_DIR, "plugins"), BEPINEX_CONFIG_DIR, join(BEPINEX_DIR, "patchers"), MM_DIR, DOWNLOAD_CACHE_DIR, BACKUP_DIR]) {
		await mkdir(dir, { recursive: true });
	}
}
