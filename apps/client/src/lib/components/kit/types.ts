import type { ModStatus } from "#lib/api/status.js";
import type { ColumnDef } from "#lib/desktop/columns.js";

export type TriState = 1 | -1 | 0 | "mixed";
export type { ModStatus };
export type { ColumnDef as Column, Density, TablePrefs } from "#lib/desktop/columns.js";

export interface SegmentOption {
	value: string;
	label: string;
	badge?: string | number;
	tone?: "default" | "primary";
}

export interface SortState {
	key: string;
	dir: "asc" | "desc";
}

/** Entry of a filter list. */
export interface FilterItem {
	value: string;
	label: string;
	count: number;
	/** The count is what picking this value would add ("+N"), not how many results have it. */
	additive?: boolean;
}
