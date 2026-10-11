// Everything optional is switched here. Defaults are "on" for an admin's own LAN box; every write path can
// be turned off, and the whole API can be made token-only with COMPANION_PUBLIC_READ=false.
import { join } from "path";
import { writeAtomic } from "./fsutil";
import { MM_DIR } from "./paths";

const flag = (name: string, def: boolean): boolean => {
	const v = process.env[name]?.trim().toLowerCase();
	if (v === undefined || v === "") return def;
	return !["0", "false", "no", "off"].includes(v);
};

/** Feature switches, reported by /api/status so pages and the client can hide what is off. */
export const FEATURES = {
	/** Manifest, .r2z, configs and worlds readable without a token. */
	publicRead: flag("COMPANION_PUBLIC_READ", true),
	/** Deep-link / r2z profile export for the Mod Manager. */
	modManager: flag("COMPANION_MOD_MANAGER", true),
	/** PUT /api/manifest (client publishes the lock, server installs). */
	publish: flag("COMPANION_ALLOW_PUBLISH", true),
	/** start / stop / restart of the game container. */
	control: flag("COMPANION_ALLOW_CONTROL", true),
	backups: flag("COMPANION_ALLOW_BACKUPS", true),
	/** valheim.env editing. */
	env: flag("COMPANION_ALLOW_ENV", true),
	configEdit: flag("COMPANION_ALLOW_CONFIG_EDIT", true),
	/** admin / permitted / banned lists. */
	players: flag("COMPANION_ALLOW_PLAYERS", true),
	/** Container log tail and stream. */
	logs: flag("COMPANION_ALLOW_LOGS", true),
};

export type Feature = keyof typeof FEATURES;

export const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
export const VERSION = "0.3.0";

const TOKEN_FILE = join(MM_DIR, "companion-token");
let token = process.env.COMPANION_TOKEN?.trim() || "";
let tokenSource: "env" | "file" | "generated" | "none" = token ? "env" : "none";

/**
 * Token resolution for easy onboarding: COMPANION_TOKEN env wins; otherwise a token is generated once,
 * stored in /config/modmanager/companion-token and printed to the container log, so
 * `docker compose logs companion` is the whole setup. COMPANION_TOKEN=none keeps the companion read-only.
 */
export async function resolveToken(): Promise<void> {
	if (token.toLowerCase() === "none") {
		token = "";
		tokenSource = "none";
		return;
	}
	if (token) return;
	const f = Bun.file(TOKEN_FILE);
	if (await f.exists()) {
		token = (await f.text()).trim();
		tokenSource = token ? "file" : "none";
		if (token) return;
	}
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	await writeAtomic(TOKEN_FILE, token + "\n");
	tokenSource = "generated";
	console.log(`\n==> Companion admin token (also in ${TOKEN_FILE}):\n==> ${token}\n==> Set COMPANION_TOKEN in docker-compose.yaml to choose your own.\n`);
}

export const getToken = () => token;
export const tokenConfigured = () => token.length > 0;
export const getTokenSource = () => tokenSource;
