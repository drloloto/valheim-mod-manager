import { describe, expect, it } from "vitest";
import { defaultCriteria, withList } from "./criteria";
import { activeView, addView, builtinViews, parseViews, removeView } from "./views";

describe("views", () => {
	const base = defaultCriteria();

	it("builtin views keep the base exclusions and have no query", () => {
		const v = builtinViews({ ...base, query: "x" });
		expect(v.map((x) => x.id)).toEqual(["proven", "new", "nodeps", "updates", "notInProfile"]);
		for (const x of v) {
			expect(x.criteria.lists.flags).toEqual(base.lists.flags);
			expect(x.criteria.query).toBe("");
		}
	});

	it("finds the active view by filters, ignoring the query", () => {
		const v = builtinViews(base);
		expect(activeView(v, { ...v[2].criteria, query: "epic" })?.id).toBe("nodeps");
		expect(activeView(v, base)).toBeUndefined();
	});

	it("adds, replaces and removes user views and parses stored ones", () => {
		const c = withList(base, "owners", { Azumatt: 1 });
		let views = addView([], "u1", "  Azumatt  ", { ...c, query: "q" });
		expect(views).toEqual([{ id: "u1", name: "Azumatt", criteria: c }]);
		views = addView(views, "u1", "Neu", c);
		expect(views).toHaveLength(1);
		expect(views[0].name).toBe("Neu");
		expect(removeView(views, "u1")).toEqual([]);
		expect(parseViews(JSON.parse(JSON.stringify(views)))).toEqual(views);
		expect(parseViews([{ id: "x" }, { id: "y", name: "Y", criteria: {} }])).toEqual([{ id: "y", name: "Y", criteria: base }]);
		expect(parseViews("nope")).toBeNull();
	});
});
