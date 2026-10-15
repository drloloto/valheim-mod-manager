// Desktop-style keyboard shortcuts. "Mod" = Ctrl (Windows/Linux) or Cmd (macOS).

export interface KeyLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface Combo {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const NAMED: Record<string, string> = { Plus: "+", Space: " " };

export function parseCombo(combo: string): Combo {
	const parts = combo.split("+");
	const key = parts.pop() ?? "";
	return { key, mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt") };
}

export function matches(e: KeyLike, combo: string, mac = IS_MAC): boolean {
	const c = parseCombo(combo);
	const mod = mac ? e.metaKey : e.ctrlKey;
	if (mod !== c.mod || e.shiftKey !== c.shift || e.altKey !== c.alt) return false;
	return e.key.toLowerCase() === (NAMED[c.key] ?? c.key).toLowerCase();
}

export function isEditable(t: EventTarget | null): boolean {
	return t instanceof HTMLElement && (t.isContentEditable || t.closest("input, textarea, select") !== null);
}

/** True while a modal dialog is open (bits-ui Dialog/AlertDialog content). */
export function hasOpenDialog(): boolean {
	if (typeof document === "undefined") return false;
	return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}

/**
 * Registers app-wide shortcuts. In input fields only shortcuts with Mod or F keys apply,
 * so normal typing and Esc inside the field stay untouched. While a modal dialog is open no
 * global shortcut applies at all, so the dialog gets its own keys (e.g. Enter/Esc).
 */
export function bindShortcuts(map: Record<string, (e: KeyboardEvent) => void>, target: Window = window): () => void {
	const onKey = (e: KeyboardEvent) => {
		if (e.isComposing || hasOpenDialog()) return;
		for (const [combo, fn] of Object.entries(map)) {
			if (!matches(e, combo)) continue;
			const c = parseCombo(combo);
			if (isEditable(e.target) && !c.mod && !/^F\d+$/.test(c.key)) continue;
			e.preventDefault();
			fn(e);
			return;
		}
	};
	target.addEventListener("keydown", onKey);
	return () => target.removeEventListener("keydown", onKey);
}
