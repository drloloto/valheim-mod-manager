// Links inside readmes that point at another Valheim package on Thunderstore open in-app
// (detail panel) instead of the browser. Everything else goes to the system browser.

const PACKAGE_URL = /^https?:\/\/(?:www\.|old\.)?thunderstore\.io\/c\/valheim\/p\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i;
const LEGACY_URL = /^https?:\/\/(?:www\.)?valheim\.thunderstore\.io\/package\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i;

/** `ns-name` for a Thunderstore Valheim package page, otherwise null. Version pages and wikis count too. */
export function packageIdFromUrl(href: string): string | null {
	const m = PACKAGE_URL.exec(href.trim()) ?? LEGACY_URL.exec(href.trim());
	if (!m) return null;
	const [, ns, name] = m;
	return `${decodeURIComponent(ns)}-${decodeURIComponent(name)}`;
}
