// `valheim-mod-manager://import?url=<r2z url>&name=<profile name>&link=<companion url>` from the companion's
// landing page. Anything else is ignored.
export interface ImportLink {
	kind: "import";
	url: string;
	name: string;
	/** Companion base URL to remember as the profile's server, when given and http(s). */
	link: string | null;
}

const http = (s: string | null) => (s && /^https?:\/\/\S+$/i.test(s) ? s.replace(/\/+$/, "") : null);

export function parseDeepLink(raw: string): ImportLink | null {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return null;
	}
	if (u.protocol !== "valheim-mod-manager:") return null;
	// Both `scheme://import?...` (host) and `scheme:import?...` (path) arrive depending on the launcher.
	const action = (u.host || u.pathname.replace(/^\/+/, "")).toLowerCase();
	if (action !== "import") return null;
	const url = http(u.searchParams.get("url"));
	if (!url) return null;
	const name = (u.searchParams.get("name") ?? "").trim().slice(0, 64);
	return { kind: "import", url, name, link: http(u.searchParams.get("link")) };
}
