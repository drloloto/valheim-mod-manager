// Column configuration of a table: visibility, order, width, density. Purely functional.
import { isRecord, isStringArray } from "./storage";

export interface ColumnDef {
	key: string;
	label: string;
	/** CSS grid track, e.g. "116px" or "minmax(0,1fr)"; only px tracks are resizable. */
	width: string;
	align?: "left" | "right";
	sortable?: boolean;
	/** Direction on the first click on this column (default: "desc"). */
	defaultDir?: "asc" | "desc";
	/** Hidden by default. */
	hidden?: boolean;
	/** Cannot be hidden (e.g. the name column). */
	fixed?: boolean;
	minWidth?: number;
}

export type Density = "compact" | "normal";

export interface TablePrefs {
	hidden: Readonly<Record<string, boolean>>;
	order: readonly string[];
	widths: Readonly<Record<string, number>>;
	density: Density;
}

export const DEFAULT_PREFS: TablePrefs = { hidden: {}, order: [], widths: {}, density: "normal" };
export const MIN_WIDTH = 48;

export function parsePrefs(v: unknown): TablePrefs | null {
	if (!isRecord(v)) return null;
	const hidden: Record<string, boolean> = {};
	if (isRecord(v.hidden)) for (const [k, x] of Object.entries(v.hidden)) if (typeof x === "boolean") hidden[k] = x;
	const widths: Record<string, number> = {};
	if (isRecord(v.widths)) for (const [k, x] of Object.entries(v.widths)) if (typeof x === "number" && x >= MIN_WIDTH) widths[k] = Math.round(x);
	return {
		hidden,
		order: isStringArray(v.order) ? v.order : [],
		widths,
		density: v.density === "compact" ? "compact" : "normal",
	};
}

export function isHidden(def: ColumnDef, prefs: TablePrefs): boolean {
	if (def.fixed) return false;
	return prefs.hidden[def.key] ?? def.hidden ?? false;
}

/** All columns in user order; unknown keys in `order` are ignored, new columns are appended. */
export function orderedColumns(defs: readonly ColumnDef[], prefs: TablePrefs): ColumnDef[] {
	const byKey = new Map(defs.map((d) => [d.key, d]));
	const out: ColumnDef[] = [];
	for (const k of prefs.order) {
		const d = byKey.get(k);
		if (d && !out.includes(d)) out.push(d);
	}
	for (const d of defs) if (!out.includes(d)) out.push(d);
	return out;
}

export function visibleColumns(defs: readonly ColumnDef[], prefs: TablePrefs): ColumnDef[] {
	return orderedColumns(defs, prefs).filter((d) => !isHidden(d, prefs));
}

export function toggleColumn(prefs: TablePrefs, def: ColumnDef): TablePrefs {
	if (def.fixed) return prefs;
	return { ...prefs, hidden: { ...prefs.hidden, [def.key]: !isHidden(def, prefs) } };
}

/** Moves `key` before or after `target`. */
export function moveColumn(prefs: TablePrefs, defs: readonly ColumnDef[], key: string, target: string, side: "before" | "after"): TablePrefs {
	if (key === target) return prefs;
	const order = orderedColumns(defs, prefs)
		.map((d) => d.key)
		.filter((k) => k !== key);
	const i = order.indexOf(target);
	if (i < 0) return prefs;
	order.splice(side === "before" ? i : i + 1, 0, key);
	return { ...prefs, order };
}

export function isResizable(def: ColumnDef): boolean {
	return /^\d+px$/.test(def.width);
}

export function setWidth(prefs: TablePrefs, def: ColumnDef, px: number): TablePrefs {
	if (!isResizable(def)) return prefs;
	const min = def.minWidth ?? MIN_WIDTH;
	return { ...prefs, widths: { ...prefs.widths, [def.key]: Math.round(Math.max(min, px)) } };
}

export function resetWidths(prefs: TablePrefs): TablePrefs {
	return { ...prefs, widths: {} };
}

export function resetColumns(prefs: TablePrefs): TablePrefs {
	return { ...DEFAULT_PREFS, density: prefs.density };
}

export function trackOf(def: ColumnDef, prefs: TablePrefs): string {
	const w = prefs.widths[def.key];
	return w && isResizable(def) ? `${w}px` : def.width;
}

export function rowHeight(density: Density, normal = 54, compact = 38): number {
	return density === "compact" ? compact : normal;
}
