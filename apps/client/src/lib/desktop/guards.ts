// Suppresses browser behavior that is out of place in a desktop app.
import { isEditable, matches, type KeyLike } from "./shortcuts";

const ALWAYS = ["Mod+P", "Mod+F", "Mod+G", "Mod+U", "Mod+J", "Mod+Plus", "Mod+=", "Mod+-", "Mod+0"];
const RELEASE_ONLY = ["F5", "Mod+R", "Mod+Shift+R", "Mod+Shift+I", "F12"];

export function shouldBlockKey(e: KeyLike, dev: boolean): boolean {
	const list = dev ? ALWAYS : [...ALWAYS, ...RELEASE_ONLY];
	return list.some((c) => matches(e, c));
}

/** The URL a link leads to when it leaves the app (http, https, mailto), else null (in-app routes, anchors). */
export function externalHref(href: string | null | undefined, origin: string): string | null {
	if (!href || href.startsWith("#")) return null;
	let url: URL;
	try {
		url = new URL(href, origin);
	} catch {
		return null;
	}
	if (url.protocol === "mailto:") return url.href;
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	return url.origin === origin ? null : url.href;
}

/**
 * `openExternal`: every link that leaves the app goes there (the system browser after the user's confirmation),
 * whether it is an anchor somewhere in the page or a `window.open` call; the WebView itself never navigates away.
 */
export function installDesktopGuards(dev = import.meta.env.DEV, openExternal?: (url: string) => void): () => void {
	// Context menu only in input fields (copy/paste); our own menus (bits-ui) call preventDefault themselves.
	const onContext = (e: MouseEvent) => {
		if (!isEditable(e.target)) e.preventDefault();
	};
	const onKey = (e: KeyboardEvent) => {
		if (shouldBlockKey(e, dev)) e.preventDefault();
	};
	const onWheel = (e: WheelEvent) => {
		if (e.ctrlKey) e.preventDefault(); // zoom via Ctrl+wheel
	};
	const onClick = (e: MouseEvent) => {
		if (!openExternal || e.defaultPrevented) return;
		const a = (e.target as Element | null)?.closest?.("a[href]");
		const url = externalHref(a?.getAttribute("href"), location.origin);
		if (!url) return;
		e.preventDefault();
		openExternal(url);
	};
	const nativeOpen = window.open;
	if (openExternal) {
		window.open = (target?: string | URL) => {
			const url = externalHref(target ? String(target) : null, location.origin);
			if (url) openExternal(url);
			return null;
		};
	}
	window.addEventListener("click", onClick, true);
	window.addEventListener("auxclick", onClick, true);
	window.addEventListener("contextmenu", onContext);
	window.addEventListener("keydown", onKey);
	window.addEventListener("wheel", onWheel, { passive: false });
	return () => {
		window.removeEventListener("click", onClick, true);
		window.removeEventListener("auxclick", onClick, true);
		window.open = nativeOpen;
		window.removeEventListener("contextmenu", onContext);
		window.removeEventListener("keydown", onKey);
		window.removeEventListener("wheel", onWheel);
	};
}
