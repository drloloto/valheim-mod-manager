import { describe, expect, it } from "vitest";
import type { SlimPkg } from "#lib/api/types.js";
import { defaultCriteria, withDate, withList, withNum, type Criteria } from "./criteria";
import { countBy, depsState, listValues, matchesCriteria, matchesList, sortPackages, type ProfileFacts } from "./filter";

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86_400_000;
export const pkg = (o: Partial<SlimPkg>): SlimPkg => ({
	id: "A-Mod",
	ns: "A",
	name: "Mod",
	desc: "",
	icon: "",
	ver: "1.0.0",
	cats: [],
	rating: 0,
	dl: 0,
	upd: NOW,
	created: NOW,
	dep: false,
	nsfw: false,
	pinned: false,
	ndeps: 0,
	ndependants: 0,
	nver: 1,
	size: 0,
	deps: [],
	...o,
});
/** Everything allowed, including deprecated and NSFW. */
const open = (): Criteria => withList(defaultCriteria(), "flags", {});
const none: ProfileFacts = { status: () => "none", present: () => false, profilesOf: () => [] };

describe("matchesList", () => {
	it("needs any included and no excluded value", () => {
		expect(matchesList(["a"], {})).toBe(true);
		expect(matchesList(["a"], { a: 1, b: 1 })).toBe(true);
		expect(matchesList(["c"], { a: 1, b: 1 })).toBe(false);
		expect(matchesList(["a", "b"], { a: 1, b: -1 })).toBe(false);
		expect(matchesList([], { b: -1 })).toBe(true);
	});
	it("requires all included values in mode all", () => {
		expect(matchesList(["a"], { a: 1, b: 1 }, "all")).toBe(false);
		expect(matchesList(["a", "b"], { a: 1, b: 1 }, "all")).toBe(true);
	});
});

describe("matchesCriteria", () => {
	it("hides deprecated and nsfw by default, shows them when the exclusion is lifted", () => {
		expect(matchesCriteria(pkg({ dep: true }), defaultCriteria(), none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ nsfw: true }), defaultCriteria(), none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ dep: true }), open(), none, NOW)).toBe(true);
		expect(matchesCriteria(pkg({}), withList(open(), "flags", { pinned: 1 }), none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ pinned: true }), withList(open(), "flags", { pinned: 1 }), none, NOW)).toBe(true);
	});
	it("matches query across name, author and description, ignoring spaces, dashes and case", () => {
		const p = pkg({ name: "EpicLoot", ns: "RandyKnapp", desc: "Magic items" });
		expect(matchesCriteria(p, { ...open(), query: "epic loot" }, none, NOW)).toBe(true);
		expect(matchesCriteria(p, { ...open(), query: "randy-knapp" }, none, NOW)).toBe(true);
		expect(matchesCriteria(p, { ...open(), query: "seasons" }, none, NOW)).toBe(false);
	});
	it("filters categories by any/all and excludes", () => {
		const p = pkg({ cats: ["Items", "Client-side"] });
		expect(matchesCriteria(p, withList(open(), "cats", { Items: 1, Tweaks: 1 }), none, NOW)).toBe(true);
		expect(matchesCriteria(p, { ...withList(open(), "cats", { Items: 1, Tweaks: 1 }), catMode: "all" }, none, NOW)).toBe(false);
		expect(matchesCriteria(p, withList(open(), "cats", { "Client-side": -1 }), none, NOW)).toBe(false);
		expect(matchesCriteria(p, withList(open(), "cats", { Tweaks: 1 }), none, NOW, { list: "cats" })).toBe(true);
	});
	it("filters owners, status, dependencies and other profiles", () => {
		const facts: ProfileFacts = {
			status: (id) => (id === "A-Mod" ? "update" : "none"),
			present: (id) => id === "denikson-BepInExPack_Valheim",
			profilesOf: (id) => (id === "A-Mod" ? ["Hardcore"] : []),
		};
		expect(matchesCriteria(pkg({ ns: "Therzie" }), withList(open(), "owners", { Azumatt: 1, Therzie: 1 }), none, NOW)).toBe(true);
		expect(matchesCriteria(pkg({ ns: "Therzie" }), withList(open(), "owners", { Therzie: -1 }), none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({}), withList(open(), "status", { update: 1 }), facts, NOW)).toBe(true);
		expect(matchesCriteria(pkg({ id: "B-X" }), withList(open(), "status", { none: -1 }), facts, NOW)).toBe(false);
		expect(matchesCriteria(pkg({}), withList(open(), "profiles", { Hardcore: 1 }), facts, NOW)).toBe(true);
		expect(matchesCriteria(pkg({ id: "B-X" }), withList(open(), "profiles", { Hardcore: 1 }), facts, NOW)).toBe(false);
		expect(depsState(pkg({ deps: ["denikson-BepInExPack_Valheim"] }), facts)).toBe("inProfile");
		expect(depsState(pkg({ deps: ["denikson-BepInExPack_Valheim", "Z-Lib"] }), facts)).toBe("missing");
		expect(depsState(pkg({}), facts)).toBe("none");
		expect(matchesCriteria(pkg({ deps: ["Z-Lib"] }), withList(open(), "deps", { missing: -1 }), facts, NOW)).toBe(false);
		expect(listValues("flags", pkg({ dep: true, pinned: true }), none)).toEqual(["deprecated", "pinned"]);
	});
	it("filters date and number ranges, skipping the requested one", () => {
		const c = withNum(withDate(open(), "upd", { op: "within", n: 30, unit: "day", from: null, to: null }), "dl", { op: "gte", from: 100, to: null });
		expect(matchesCriteria(pkg({ upd: NOW - 40 * DAY, dl: 500 }), c, none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ upd: NOW - 40 * DAY, dl: 500 }), c, none, NOW, { date: "upd" })).toBe(true);
		expect(matchesCriteria(pkg({ upd: NOW - 2 * DAY, dl: 5 }), c, none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ upd: NOW - 2 * DAY, dl: 5 }), c, none, NOW, { num: "dl" })).toBe(true);
		expect(matchesCriteria(pkg({ upd: NOW - 2 * DAY, dl: 500 }), c, none, NOW)).toBe(true);
		// a range without bounds has no effect
		expect(matchesCriteria(pkg({ size: 5 }), withNum(open(), "size", { op: "gte", from: null, to: null }), none, NOW)).toBe(true);
	});
});

describe("sortPackages", () => {
	const list = [
		pkg({ id: "a", name: "Beta", dl: 5, rating: 9, created: 3 }),
		pkg({ id: "b", name: "alpha", dl: 50, rating: 1, created: 1 }),
		pkg({ id: "c", name: "Gamma", dl: 1, rating: 5, created: 2 }),
	];
	it("sorts by column and direction without mutating the input", () => {
		expect(sortPackages(list, { key: "dl", dir: "desc" }, "").map((p) => p.id)).toEqual(["b", "a", "c"]);
		expect(sortPackages(list, { key: "mod", dir: "asc" }, "").map((p) => p.id)).toEqual(["b", "a", "c"]);
		expect(sortPackages(list, { key: "created", dir: "asc" }, "").map((p) => p.id)).toEqual(["b", "c", "a"]);
		expect(list.map((p) => p.id)).toEqual(["a", "b", "c"]);
	});
	it("breaks ties by rating", () => {
		const tie = [pkg({ id: "x", size: 1, rating: 1 }), pkg({ id: "y", size: 1, rating: 9 })];
		expect(sortPackages(tie, { key: "size", dir: "desc" }, "").map((p) => p.id)).toEqual(["y", "x"]);
	});
	it("defaults to rating, and puts exact name matches first when searching", () => {
		expect(sortPackages(list, null, "").map((p) => p.id)).toEqual(["a", "c", "b"]);
		expect(sortPackages(list, null, "gamma")[0].id).toBe("c");
	});
});

describe("countBy", () => {
	it("counts keys over packages", () => {
		const m = countBy([pkg({ cats: ["X", "Y"] }), pkg({ cats: ["X"] })], (p) => p.cats);
		expect(m.get("X")).toBe(2);
		expect(m.get("Y")).toBe(1);
	});
});
