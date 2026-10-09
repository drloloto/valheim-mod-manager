// Suppresses browser behavior that is out of place in a desktop app.
import { isEditable, matches, type KeyLike } from "./shortcuts";

const ALWAYS = ["Mod+P", "Mod+F", "Mod+G", "Mod+U", "Mod+J", "Mod+Plus", "Mod+=", "Mod+-", "Mod+0"];
const RELEASE_ONLY = ["F5", "Mod+R", "Mod+Shift+R", "Mod+Shift+I", "F12"];

export function shouldBlockKey(e: KeyLike, dev: boolean): boolean {
	const list = dev ? ALWAYS : [...ALWAYS, ...RELEASE_ONLY];
	return list.some((c) => matches(e, c));
}

export function installDesktopGuards(dev = import.meta.env.DEV): () => void {
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
	window.addEventListener("contextmenu", onContext);
	window.addEventListener("keydown", onKey);
	window.addEventListener("wheel", onWheel, { passive: false });
	return () => {
		window.removeEventListener("contextmenu", onContext);
		window.removeEventListener("keydown", onKey);
		window.removeEventListener("wheel", onWheel);
	};
}
