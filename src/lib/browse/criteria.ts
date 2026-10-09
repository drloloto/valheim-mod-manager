// Filter criteria of the Browse page: plain data, serializable, no Svelte.
import { isRecord } from "#lib/desktop/storage.js";
import { t } from "#lib/i18n/t.js";

/** 1 = include, -1 = exclude; missing entry = off. */
export type Tri = 1 | -1;
export type TriMap = Readonly<Record<string, Tri>>;

export const LIST_KEYS = ["status", "cats", "owners", "profiles", "deps", "flags"] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export const DATE_KEYS = ["upd", "created"] as const;
export type DateKey = (typeof DATE_KEYS)[number];

export const NUM_KEYS = ["dl", "rating", "size", "ndeps"] as const;
export type NumKey = (typeof NUM_KEYS)[number];

export type RangeKey = DateKey | NumKey;

export type DateOp = "within" | "older" | "between" | "outside";
export type DateUnit = "day" | "week" | "month" | "year";
export interface DateRange {
	op: DateOp;
	/** relative (within/older): number of units */
	n: number;
	unit: DateUnit;
	/** absolute (between/outside): timestamps in ms, null = open */
	from: number | null;
	to: number | null;
}

export type NumOp = "gte" | "lte" | "between" | "outside";
export interface NumRange {
	op: NumOp;
	from: number | null;
	to: number | null;
}

export interface Criteria {
	query: string;
	lists: Readonly<Record<ListKey, TriMap>>;
	/** Category: "any" = at least one included, "all" = every included one */
	catMode: "any" | "all";
	dates: Readonly<Record<DateKey, DateRange | null>>;
	nums: Readonly<Record<NumKey, NumRange | null>>;
}

export const STATUS_ITEMS = ["inProfile", "update", "disabled", "dependency", "none"] as const;
export const DEPS_ITEMS = ["none", "inProfile", "missing"] as const;
export const FLAG_ITEMS = ["deprecated", "nsfw", "pinned"] as const;

export function fieldLabel(key: ListKey | RangeKey): string {
	return t(`field.${key}`);
}

/** Fixed list values (status, dependencies, flags) have translations; categories, authors and profiles do not. */
export function itemLabel(key: ListKey, value: string): string {
	if (key === "status" || key === "deps" || key === "flags") return t(`item.${key}.${value}` as Parameters<typeof t>[0]);
	return value;
}

export function defaultCriteria(opts: { showNsfw?: boolean } = {}): Criteria {
	const flags: Record<string, Tri> = { deprecated: -1 };
	if (!opts.showNsfw) flags.nsfw = -1;
	return {
		query: "",
		lists: { status: {}, cats: {}, owners: {}, profiles: {}, deps: {}, flags },
		catMode: "any",
		dates: { upd: null, created: null },
		nums: { dl: null, rating: null, size: null, ndeps: null },
	};
}

/** Next state on click: off → included → excluded → off. */
export function cycleTri(map: TriMap, key: string): TriMap {
	const cur = map[key];
	return setTri(map, key, cur === undefined ? 1 : cur === 1 ? -1 : 0);
}

export function setTri(map: TriMap, key: string, value: Tri | 0): TriMap {
	const next: Record<string, Tri> = { ...map };
	if (value === 0) delete next[key];
	else next[key] = value;
	return next;
}

/** Flips every entry with the given sign (is ↔ is not). */
export function flipSign(map: TriMap, sign: Tri): TriMap {
	const next: Record<string, Tri> = {};
	for (const [k, v] of Object.entries(map)) next[k] = v === sign ? (-v as Tri) : v;
	return next;
}

export function dropSign(map: TriMap, sign: Tri): TriMap {
	const next: Record<string, Tri> = {};
	for (const [k, v] of Object.entries(map)) if (v !== sign) next[k] = v;
	return next;
}

export function entries(map: TriMap, sign: Tri): string[] {
	return Object.entries(map)
		.filter(([, v]) => v === sign)
		.map(([k]) => k);
}

export function withList(c: Criteria, key: ListKey, map: TriMap): Criteria {
	return { ...c, lists: { ...c.lists, [key]: map } };
}

export function withDate(c: Criteria, key: DateKey, r: DateRange | null): Criteria {
	return { ...c, dates: { ...c.dates, [key]: r } };
}

export function withNum(c: Criteria, key: NumKey, r: NumRange | null): Criteria {
	return { ...c, nums: { ...c.nums, [key]: r } };
}

/** Number of active filters: every non-empty list and every set range counts once. */
export function activeCount(c: Criteria): number {
	let n = 0;
	for (const k of LIST_KEYS) if (Object.keys(c.lists[k]).length) n++;
	for (const k of DATE_KEYS) if (c.dates[k]) n++;
	for (const k of NUM_KEYS) if (c.nums[k]) n++;
	return n;
}

function sameMap(a: TriMap, b: TriMap): boolean {
	const ka = Object.keys(a);
	return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function sameRange<T extends object>(a: T | null, b: T | null): boolean {
	if (a === null || b === null) return a === b;
	return (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);
}

/** Filter equality (ignoring the search text). */
export function sameFilters(a: Criteria, b: Criteria): boolean {
	return (
		a.catMode === b.catMode &&
		LIST_KEYS.every((k) => sameMap(a.lists[k], b.lists[k])) &&
		DATE_KEYS.every((k) => sameRange(a.dates[k], b.dates[k])) &&
		NUM_KEYS.every((k) => sameRange(a.nums[k], b.nums[k]))
	);
}

const DATE_OPS = new Set<DateOp>(["within", "older", "between", "outside"]);
const NUM_OPS = new Set<NumOp>(["gte", "lte", "between", "outside"]);
const UNITS = new Set<DateUnit>(["day", "week", "month", "year"]);

const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseTriMap(v: unknown): TriMap | null {
	if (!isRecord(v)) return null;
	const out: Record<string, Tri> = {};
	for (const [k, x] of Object.entries(v)) {
		if (x !== 1 && x !== -1) return null;
		out[k] = x;
	}
	return out;
}

export function parseDateRange(v: unknown): DateRange | null {
	if (!isRecord(v) || !DATE_OPS.has(v.op as DateOp) || !UNITS.has(v.unit as DateUnit)) return null;
	const from = numOrNull(v.from);
	const to = numOrNull(v.to);
	if (typeof v.n !== "number" || from === undefined || to === undefined) return null;
	return { op: v.op as DateOp, n: v.n, unit: v.unit as DateUnit, from, to };
}

export function parseNumRange(v: unknown): NumRange | null {
	if (!isRecord(v) || !NUM_OPS.has(v.op as NumOp)) return null;
	const from = numOrNull(v.from);
	const to = numOrNull(v.to);
	if (from === undefined || to === undefined) return null;
	return { op: v.op as NumOp, from, to };
}

/** Reads stored criteria; unknown or broken parts are replaced by defaults. */
export function parseCriteria(v: unknown, base: Criteria = defaultCriteria()): Criteria | null {
	if (!isRecord(v)) return null;
	const lists = { ...base.lists };
	if (isRecord(v.lists)) for (const k of LIST_KEYS) lists[k] = parseTriMap(v.lists[k]) ?? base.lists[k];
	const dates = { ...base.dates };
	if (isRecord(v.dates)) for (const k of DATE_KEYS) dates[k] = v.dates[k] == null ? null : (parseDateRange(v.dates[k]) ?? null);
	const nums = { ...base.nums };
	if (isRecord(v.nums)) for (const k of NUM_KEYS) nums[k] = v.nums[k] == null ? null : (parseNumRange(v.nums[k]) ?? null);
	return {
		query: typeof v.query === "string" ? v.query : "",
		lists,
		catMode: v.catMode === "all" ? "all" : "any",
		dates,
		nums,
	};
}
