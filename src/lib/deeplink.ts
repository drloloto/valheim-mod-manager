// `valheim-mod-manager://import?...` from the companion's landing page. Two shapes, both with `name=<profile name>`:
//   `code=<sync code>`                      the server is reached through its gist: link by code, adopt
//   `url=<r2z url>&link=<companion url>`    the HTTP companion: download the .r2z, remember the address
// A link that carries both is a gist link (the code wins). Anything else is ignored.
// The DEV build registers `valheim-mod-manager-dev://` so a test companion never opens the installed app.
export interface ImportLink {
	kind: "import";
	/** r2z URL for the HTTP path; null for a gist link */
	url: string | null;
	name: string;
	/** Companion base URL to remember as the profile's server, when given and http(s). */
	link: string | null;
	/** `vmm1.<gist id>.<secret>` for a gist link; null for the HTTP path */
	code: string | null;
}

export const SCHEMES = ["valheim-mod-manager:", "valheim-mod-manager-dev:"];
const SYNC_CODE = /^vmm1\.[0-9a-f]{20,40}\.[A-Za-z0-9_-]{43}$/;

const http = (s: string | null) => (s && /^https?:\/\/\S+$/i.test(s) ? s.replace(/\/+$/, "") : null);
const syncCode = (s: string | null) => (s && SYNC_CODE.test(s.trim()) ? s.trim() : null);

export function parseDeepLink(raw: string): ImportLink | null {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return null;
	}
	if (!SCHEMES.includes(u.protocol)) return null;
	// Both `scheme://import?...` (host) and `scheme:import?...` (path) arrive depending on the launcher.
	const action = (u.host || u.pathname.replace(/^\/+/, "")).toLowerCase();
	if (action !== "import") return null;
	const code = syncCode(u.searchParams.get("code"));
	const url = http(u.searchParams.get("url"));
	if (!code && !url) return null;
	const name = (u.searchParams.get("name") ?? "").trim().slice(0, 64);
	return { kind: "import", url: code ? null : url, name, link: code ? null : http(u.searchParams.get("link")), code };
}
