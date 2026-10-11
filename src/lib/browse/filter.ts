// Filter and sort logic of the Browse page, without a Svelte dependency.
import type { ModStatus } from "#lib/api/status.js";
import type { SlimPkg } from "#lib/api/types.js";
import type { SortState } from "#lib/components/kit/types.js";
import { DATE_KEYS, LIST_KEYS, NUM_KEYS, type Criteria, type DateKey, type ListKey, type NumKey, type TriMap } from "./criteria";
import { collator } from "#lib/format.js";
import { dateActive, matchesDate, matchesNum, numActive } from "./ranges";

export const SORT_KEYS = ["dl", "rating", "upd", "created", "mod", "author", "size", "ndeps", "ndependants", "nver"] as const;

/** Facts from the active profile that the index does not know. */
export interface ProfileFacts {
	status(id: string): ModStatus;
	/** In the profile or resolved as a dependency */
	present(id: string): boolean;
	/** Other profiles that contain this mod */
	profilesOf(id: string): readonly string[];
}

export function normalize(s: string): string {
	return s.toLowerCase().replace(/[\s_-]/g, "");
}

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

export function matchesCriteria(p: SlimPkg, c: Criteria, f: ProfileFacts, now: number, skip: Skip = {}): boolean {
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
	if (c.query && !normalize(`${p.name} ${p.ns} ${p.desc}`).includes(normalize(c.query))) return false;
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
	const q = normalize(query);
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
