// Evaluates all criteria in one pass: one bitmask per package, one bit per criterion.
// Match = all bits set; "all except section X" = all bits except X set. This way the result
// list, the facet counts and the histograms together cost one pass instead of one per section.
import type { SlimPkg } from "#lib/api/types.js";
import { DATE_KEYS, LIST_KEYS, NUM_KEYS, type Criteria, type DateKey, type ListKey, type NumKey } from "./criteria";
import { listValues, matchesList, type ProfileFacts, type Skip } from "./filter";
import { isEmptyQuery, matchesQuery, parseQuery, type SearchKey, type SearchScope } from "./query";
import { dateActive, matchesDate, matchesNum, numActive } from "./ranges";

export const BIT: Record<ListKey | DateKey | NumKey | "query", number> = {
	status: 1 << 0,
	cats: 1 << 1,
	owners: 1 << 2,
	profiles: 1 << 3,
	deps: 1 << 4,
	flags: 1 << 5,
	upd: 1 << 6,
	created: 1 << 7,
	dl: 1 << 8,
	rating: 1 << 9,
	size: 1 << 10,
	ndeps: 1 << 11,
	query: 1 << 12,
	ndependants: 1 << 13,
	stores: 1 << 14,
};
export const ALL = (1 << 15) - 1;

export { searchKey } from "./query";

/** Bitmask per package (same order as `pkgs`). Inactive criteria always set their bit. */
export function evaluate(
	pkgs: readonly SlimPkg[],
	c: Criteria,
	f: ProfileFacts,
	now: number,
	keys: readonly SearchKey[],
	scope: SearchScope = "all",
): Uint16Array {
	const out = new Uint16Array(pkgs.length);
	const lists = LIST_KEYS.filter((k) => Object.keys(c.lists[k]).length);
	const dates = DATE_KEYS.filter((k) => dateActive(c.dates[k]));
	const nums = NUM_KEYS.filter((k) => numActive(c.nums[k]));
	const query = parseQuery(c.query, scope);
	const q = !isEmptyQuery(query);
	let base = ALL;
	for (const k of lists) base &= ~BIT[k];
	for (const k of dates) base &= ~BIT[k];
	for (const k of nums) base &= ~BIT[k];
	if (q) base &= ~BIT.query;

	for (let i = 0; i < pkgs.length; i++) {
		const p = pkgs[i];
		let m = base;
		for (const k of lists) if (matchesList(listValues(k, p, f), c.lists[k], k === "cats" ? c.catMode : "any")) m |= BIT[k];
		for (const k of dates) if (matchesDate(p[k], c.dates[k]!, now)) m |= BIT[k];
		for (const k of nums) if (matchesNum(p[k], c.nums[k]!)) m |= BIT[k];
		if (q && matchesQuery(keys[i], query)) m |= BIT.query;
		out[i] = m;
	}
	return out;
}

export function skipBits(skip: Skip): number {
	return (skip.list ? BIT[skip.list] : 0) | (skip.date ? BIT[skip.date] : 0) | (skip.num ? BIT[skip.num] : 0);
}

/** Packages that match all criteria, optionally except the skipped section. */
export function select(pkgs: readonly SlimPkg[], masks: Uint16Array, skip: Skip = {}): SlimPkg[] {
	const ignore = skipBits(skip);
	const out: SlimPkg[] = [];
	for (let i = 0; i < pkgs.length; i++) if ((masks[i] | ignore) === ALL) out.push(pkgs[i]);
	return out;
}
