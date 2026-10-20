import { describe, expect, it } from "vite-plus/test";
import { defaultCriteria, withList, withNum } from "./criteria";
import { ALL, BIT, evaluate, searchKey, select } from "./engine";
import { matchesCriteria, type ProfileFacts } from "./filter";
import { pkg } from "./filter.test";

const NOW = Date.UTC(2026, 9, 8);
const none: ProfileFacts = { status: () => "none", present: () => false, profilesOf: () => [] };

describe("engine", () => {
	const pkgs = [
		pkg({ id: "a", name: "EpicLoot", ns: "Randy", cats: ["Items"], dl: 5000 }),
		pkg({ id: "b", name: "Seasons", ns: "Smooth", cats: ["Tweaks"], dl: 50 }),
		pkg({ id: "c", name: "EpicBuild", ns: "Randy", cats: ["Building"], dl: 900, dep: true }),
	];
	const keys = pkgs.map(searchKey);

	it("sets every bit when nothing is active", () => {
		const c = withList(defaultCriteria(), "flags", {});
		expect([...evaluate(pkgs, c, none, NOW, keys)]).toEqual([ALL, ALL, ALL]);
	});

	it("agrees with matchesCriteria and supports skipping one section", () => {
		const c = withNum(withList({ ...withList(defaultCriteria(), "flags", {}), query: "epic" }, "cats", { Items: 1 }), "dl", { op: "gte", from: 100, to: null });
		const masks = evaluate(pkgs, c, none, NOW, keys);
		pkgs.forEach((p, i) => expect(masks[i] === ALL).toBe(matchesCriteria(p, c, none, NOW)));
		expect(select(pkgs, masks).map((p) => p.id)).toEqual(["a"]);
		expect(select(pkgs, masks, { list: "cats" }).map((p) => p.id)).toEqual(["a", "c"]);
		expect(select(pkgs, masks, { num: "dl" }).map((p) => p.id)).toEqual(["a"]);
		expect(masks[2] & BIT.cats).toBe(0);
		expect(masks[2] & BIT.query).toBe(BIT.query);
	});

	it("applies the default deprecated exclusion through the flags bit", () => {
		const masks = evaluate(pkgs, defaultCriteria(), none, NOW, keys);
		expect(select(pkgs, masks).map((p) => p.id)).toEqual(["a", "b"]);
		expect(select(pkgs, masks, { list: "flags" }).map((p) => p.id)).toEqual(["a", "b", "c"]);
	});
});
