import { describe, expect, it } from "vitest";
import { activeCount, cycleTri, defaultCriteria, dropSign, entries, flipSign, parseCriteria, sameFilters, withDate, withList, withNum } from "./criteria";

describe("criteria", () => {
	it("defaults exclude deprecated and, unless allowed, nsfw", () => {
		expect(defaultCriteria().lists.flags).toEqual({ deprecated: -1, nsfw: -1 });
		expect(defaultCriteria({ showNsfw: true }).lists.flags).toEqual({ deprecated: -1 });
		expect(activeCount(defaultCriteria())).toBe(1);
	});

	it("cycles off → include → exclude → off", () => {
		let m = cycleTri({}, "Items");
		expect(m).toEqual({ Items: 1 });
		m = cycleTri(m, "Items");
		expect(m).toEqual({ Items: -1 });
		m = cycleTri(m, "Items");
		expect(m).toEqual({});
	});

	it("flips, drops and lists by sign", () => {
		const m = { a: 1, b: -1, c: 1 } as const;
		expect(flipSign(m, 1)).toEqual({ a: -1, b: -1, c: -1 });
		expect(dropSign(m, -1)).toEqual({ a: 1, c: 1 });
		expect(entries(m, 1)).toEqual(["a", "c"]);
	});

	it("counts active filters per section and compares without query", () => {
		let c = defaultCriteria();
		c = withList(c, "cats", { Items: 1 });
		c = withDate(c, "upd", { op: "within", n: 30, unit: "day", from: null, to: null });
		c = withNum(c, "dl", { op: "gte", from: 1000, to: null });
		expect(activeCount(c)).toBe(4);
		expect(sameFilters(c, { ...c, query: "x" })).toBe(true);
		expect(sameFilters(c, withNum(c, "dl", null))).toBe(false);
		expect(sameFilters(c, { ...c, catMode: "all" })).toBe(false);
	});

	it("parses stored criteria and repairs broken parts", () => {
		const c = withNum(withList(defaultCriteria(), "owners", { Azumatt: -1 }), "size", { op: "between", from: 1, to: 2 });
		expect(parseCriteria(JSON.parse(JSON.stringify(c)))).toEqual(c);
		const broken = parseCriteria({
			query: 5,
			lists: { owners: { x: 2 }, cats: { y: 1 } },
			dates: { upd: { op: "nope" } },
			nums: { dl: { op: "gte", from: "1" } },
			catMode: "all",
		});
		expect(broken).toEqual({ ...defaultCriteria(), lists: { ...defaultCriteria().lists, cats: { y: 1 } }, catMode: "all" });
		expect(parseCriteria("text")).toBeNull();
	});
});
