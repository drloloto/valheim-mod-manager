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
	/** px tracks: resize floor (default MIN_WIDTH). fr tracks: the minimum the column keeps when space is short (default FLEX_MIN). */
	minWidth?: number;
	/** When the table is narrower than its columns, lower priority is dropped first (default 0; ties: rightmost first). */
	priority?: number;
}

export interface FitOptions {
	/** Gap between tracks in px. */
	gap: number;
	/** Horizontal padding of the row in px (both sides together). */
	padding: number;
	/** Width of a leading non-column track (selection checkbox), 0 when none. */
	lead?: number;
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
/** Minimum of a flexible (fr) column; below this, other columns are dropped instead. */
export const FLEX_MIN = 160;

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

/** Width a column needs at least: its px track (user-resized or default) or the flexible minimum. */
export function minTrackWidth(def: ColumnDef, prefs: TablePrefs): number {
	if (isResizable(def)) return prefs.widths[def.key] ?? parseInt(def.width, 10);
	return def.minWidth ?? FLEX_MIN;
}

export function trackOf(def: ColumnDef, prefs: TablePrefs): string {
	if (isResizable(def)) return `${minTrackWidth(def, prefs)}px`;
	return def.width.includes("fr") ? `minmax(${minTrackWidth(def, prefs)}px,1fr)` : def.width;
}

/** Total width the given columns need, including gaps, padding and the lead track. */
export function requiredWidth(cols: readonly ColumnDef[], prefs: TablePrefs, opts: FitOptions): number {
	const lead = opts.lead ?? 0;
	const tracks = cols.length + (lead ? 1 : 0);
	return opts.padding + lead + cols.reduce((sum, c) => sum + minTrackWidth(c, prefs), 0) + Math.max(0, tracks - 1) * opts.gap;
}

/**
 * The subset of `cols` that fits into `width`: columns are dropped by ascending priority, ties from the
 * right, fixed columns never. Returns the same array when everything fits or the width is unknown (<= 0).
 */
export function fitColumns(cols: ColumnDef[], prefs: TablePrefs, width: number, opts: FitOptions): ColumnDef[] {
	if (width <= 0 || requiredWidth(cols, prefs, opts) <= width) return cols;
	let out = cols;
	while (requiredWidth(out, prefs, opts) > width) {
		let drop = -1;
		for (let i = 0; i < out.length; i++) {
			if (out[i].fixed) continue;
			if (drop < 0 || (out[i].priority ?? 0) <= (out[drop].priority ?? 0)) drop = i;
		}
		if (drop < 0) break;
		out = out.filter((_, i) => i !== drop);
	}
	return out;
}

export function rowHeight(density: Density, normal = 54, compact = 38): number {
	return density === "compact" ? compact : normal;
}
