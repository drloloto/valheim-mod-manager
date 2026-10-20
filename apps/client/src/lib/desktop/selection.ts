// Selection model like in a file explorer. Purely functional: every operation returns a new state.

export interface Selection {
	readonly ids: ReadonlySet<string>;
	/** Anchor for Shift ranges */
	readonly anchor: string | null;
	/** Last clicked or keyboard-reached row; the detail panel shows it. */
	readonly focus: string | null;
}

export interface ClickMods {
	shift: boolean;
	/** Ctrl or Cmd, or a click on the checkbox */
	toggle: boolean;
}

export const emptySelection: Selection = { ids: new Set(), anchor: null, focus: null };

function range(order: readonly string[], a: string, b: string): string[] {
	const i = order.indexOf(a);
	const j = order.indexOf(b);
	if (i < 0 || j < 0) return [b];
	return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

export function click(sel: Selection, order: readonly string[], id: string, mods: ClickMods): Selection {
	if (mods.shift && sel.anchor !== null && order.includes(sel.anchor)) {
		const r = range(order, sel.anchor, id);
		return { ids: new Set(mods.toggle ? [...sel.ids, ...r] : r), anchor: sel.anchor, focus: id };
	}
	if (mods.toggle) {
		const ids = new Set(sel.ids);
		if (ids.has(id)) ids.delete(id);
		else ids.add(id);
		return { ids, anchor: id, focus: id };
	}
	return { ids: new Set([id]), anchor: id, focus: id };
}

export function selectAll(sel: Selection, order: readonly string[]): Selection {
	return { ids: new Set(order), anchor: order[0] ?? null, focus: sel.focus };
}

export function clear(sel: Selection): Selection {
	return { ids: new Set(), anchor: null, focus: sel.focus };
}

/** Right-click: inside the selection it is kept, otherwise only this row is selected. */
export function forContext(sel: Selection, id: string): Selection {
	if (sel.ids.has(id)) return { ...sel, focus: id };
	return { ids: new Set([id]), anchor: id, focus: id };
}

export function move(sel: Selection, order: readonly string[], delta: number, extend: boolean): Selection {
	if (!order.length) return sel;
	const cur = sel.focus !== null ? order.indexOf(sel.focus) : -1;
	// Without a focus, delta counts from the edge: arrow/page keys as usual (1 → first, -1 → last row),
	// Home/End (delta = ±order.length) land on the first or last row accordingly.
	const target = cur < 0 ? (delta >= 0 ? Math.min(delta, order.length) - 1 : Math.max(0, order.length + delta)) : cur + delta;
	const next = order[Math.max(0, Math.min(order.length - 1, target))];
	if (extend && sel.anchor !== null && order.includes(sel.anchor)) {
		return { ids: new Set(range(order, sel.anchor, next)), anchor: sel.anchor, focus: next };
	}
	return { ids: new Set([next]), anchor: next, focus: next };
}

/** Removes rows that are no longer visible. Returns the same object when nothing changed. */
export function prune(sel: Selection, order: readonly string[]): Selection {
	const visible = new Set(order);
	const ids = [...sel.ids].filter((id) => visible.has(id));
	const anchor = sel.anchor !== null && visible.has(sel.anchor) ? sel.anchor : null;
	const focus = sel.focus !== null && visible.has(sel.focus) ? sel.focus : null;
	if (ids.length === sel.ids.size && anchor === sel.anchor && focus === sel.focus) return sel;
	return { ids: new Set(ids), anchor, focus };
}
