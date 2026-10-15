// Filter and sort logic of the Browse page, without a Svelte dependency.
import type { ModStatus } from "#lib/api/status.js";
import type { SlimPkg } from "#lib/api/types.js";
import type { SortState } from "#lib/components/kit/types.js";
import { DATE_KEYS, LIST_KEYS, NUM_KEYS, type Criteria, type DateKey, type ListKey, type NumKey, type TriMap } from "./criteria";
import { collator } from "#lib/format.js";
import { dateActive, matchesDate, matchesNum, numActive } from "./ranges";
import { isEmptyQuery, matchesQuery, nameNeedle, normalize, parseQuery, searchKey, type SearchScope } from "./query";

export const SORT_KEYS = ["dl", "rating", "upd", "created", "mod", "author", "size", "ndeps", "ndependants", "nver"] as const;

/** Facts from the active profile that the index does not know. */
export interface ProfileFacts {
	status(id: string): ModStatus;
	/** In the profile or resolved as a dependency */
	present(id: string): boolean;
	/** Other profiles that contain this mod */
	profilesOf(id: string): readonly string[];
}

export { normalize } from "./query";

export function depsState(p: SlimPkg, f: ProfileFacts): "none" | "inProfile" | "missing" {
	if (!p.deps.length) return "none";
	return p.deps.every((d) => f.present(d)) ? "inProfile" : "missing";
}

export function flagsOf(p: SlimPkg): string[] {
	const out: string[] = [];
	if (p.dep) out.push("deprecated");
	if (p.nsfw) out.push("nsfw");
	if (p.pinned) out.push("pinned");
	return out;
}

/** Values of a package for a list facet. */
export function listValues(key: ListKey, p: SlimPkg, f: ProfileFacts): readonly string[] {
	switch (key) {
		case "status":
			return [f.status(p.id)];
		case "cats":
			return p.cats;
		case "owners":
			return [p.ns];
		case "profiles":
			return f.profilesOf(p.id);
		case "deps":
			return [depsState(p, f)];
		case "flags":
			return flagsOf(p);
	}
}

/** At least one included value (or all of them in "all" mode) and no excluded value. */
export function matchesList(values: readonly string[], map: TriMap, mode: "any" | "all" = "any"): boolean {
	let hasInc = false;
	let hit = 0;
	let incCount = 0;
	for (const k in map) {
		if (map[k] === -1) {
			if (values.includes(k)) return false;
		} else {
			hasInc = true;
			incCount++;
			if (values.includes(k)) hit++;
		}
	}
	if (!hasInc) return true;
	return mode === "all" ? hit === incCount : hit > 0;
}

export interface Skip {
	list?: ListKey;
	date?: DateKey;
	num?: NumKey;
}

export function matchesCriteria(p: SlimPkg, c: Criteria, f: ProfileFacts, now: number, skip: Skip = {}, scope: SearchScope = "all"): boolean {
	for (const k of LIST_KEYS) {
		if (k === skip.list) continue;
		const map = c.lists[k];
		if (!matchesList(listValues(k, p, f), map, k === "cats" ? c.catMode : "any")) return false;
	}
	for (const k of DATE_KEYS) {
		if (k === skip.date) continue;
		const r = c.dates[k];
		if (dateActive(r) && !matchesDate(p[k], r, now)) return false;
	}
	for (const k of NUM_KEYS) {
		if (k === skip.num) continue;
		const r = c.nums[k];
		if (numActive(r) && !matchesNum(p[k], r)) return false;
	}
	const q = parseQuery(c.query, scope);
	if (!isEmptyQuery(q) && !matchesQuery(searchKey(p), q)) return false;
	return true;
}

const COMPARE: Record<string, (a: SlimPkg, b: SlimPkg) => number> = {
	mod: (a, b) => collator().compare(a.name, b.name),
	author: (a, b) => collator().compare(a.ns, b.ns),
	dl: (a, b) => a.dl - b.dl,
	upd: (a, b) => a.upd - b.upd,
	created: (a, b) => a.created - b.created,
	rating: (a, b) => a.rating - b.rating,
	size: (a, b) => a.size - b.size,
	ndeps: (a, b) => a.ndeps - b.ndeps,
	ndependants: (a, b) => a.ndependants - b.ndependants,
	nver: (a, b) => a.nver - b.nver,
};

/** Returns a new, sorted list. Without a column sort: exact name matches first, then rating. */
export function sortPackages(list: SlimPkg[], sort: SortState | null, query: string): SlimPkg[] {
	const out = [...list];
	const cmp = sort ? COMPARE[sort.key] : undefined;
	if (cmp) {
		const dir = sort!.dir === "asc" ? 1 : -1;
		return out.sort((a, b) => dir * cmp(a, b) || b.rating - a.rating);
	}
	const q = nameNeedle(parseQuery(query));
	return out.sort((a, b) => {
		if (q) {
			const d = Number(normalize(b.name) === q) - Number(normalize(a.name) === q);
			if (d) return d;
		}
		return b.rating - a.rating;
	});
}

export function countBy(list: Iterable<SlimPkg>, keys: (p: SlimPkg) => Iterable<string>): Map<string, number> {
	const m = new Map<string, number>();
	for (const p of list) for (const k of keys(p)) m.set(k, (m.get(k) ?? 0) + 1);
	return m;
}

export interface FacetCount {
	count: number;
	/** "+N": rows that adding this value would bring in, not rows that have it among the current results. */
	additive: boolean;
}

/**
 * Counts of a list section that follow its own selection, not only the other sections:
 * - nothing included: rows per value among the results of the other sections (classic facets);
 * - "all" mode (categories): rows per value among the current results, so every count shrinks as you narrow;
 * - "any" mode with an inclusion: included and excluded values count what they bring or hide, every other
 *   value counts the rows it would add ("+N"), so a picked "Not in profile" no longer shows "In profile 28".
 */
export function facetCounts(
	key: ListKey,
	map: TriMap,
	mode: "any" | "all",
	context: readonly SlimPkg[],
	result: readonly SlimPkg[],
	f: ProfileFacts,
): Map<string, FacetCount> {
	const out = new Map<string, FacetCount>();
	const add = (v: string, additive: boolean) => {
		const cur = out.get(v);
		if (cur) cur.count++;
		else out.set(v, { count: 1, additive });
	};
	const hasInc = Object.values(map).some((x) => x === 1);
	if (!hasInc || mode === "all") {
		for (const p of hasInc ? result : context) for (const v of listValues(key, p, f)) add(v, false);
		return out;
	}
	const inResult = new Set(result);
	for (const p of context) {
		const values = listValues(key, p, f);
		const hit = inResult.has(p);
		const blocked = values.some((v) => map[v] === -1);
		for (const v of values) {
			if (v in map) add(v, false);
			else if (!hit && !blocked) add(v, true);
		}
	}
	return out;
}
