import { describe, expect, it } from "vitest";
import { describeIssue, groupIssues } from "./health";

describe("describeIssue", () => {
	const nameOf = (id: string) => id.split("-")[1];
	it("renders every kind", () => {
		expect(describeIssue({ kind: "duplicate", ids: ["a-A", "b-B"], detail: "Shared.dll" }, nameOf, null)).toBe("Shared.dll is installed by A, B");
		expect(describeIssue({ kind: "deprecated", ids: ["a-A"], detail: "" }, nameOf, null)).toBe("A is marked deprecated on Thunderstore");
		const when = new Date(2026, 0, 2).getTime();
		const game = new Date(2026, 5, 1).getTime();
		expect(describeIssue({ kind: "stale", ids: ["a-A"], detail: String(when) }, nameOf, game)).toBe(
			"A was last updated 1/2/2026, before the current game update (6/1/2026)",
		);
	});
});

describe("groupIssues", () => {
	const nameOf = (id: string) => id.split("-")[1];
	it("groups by kind and sorts stale mods oldest first", () => {
		const g = groupIssues(
			[
				{ kind: "stale", ids: ["a-Jotunn"], detail: "300" },
				{ kind: "duplicate", ids: ["a-A", "b-B"], detail: "Shared.dll" },
				{ kind: "stale", ids: ["a-EpicLoot"], detail: "100" },
				{ kind: "deprecated", ids: ["z-Zed", "a-Abe"], detail: "" },
			],
			nameOf,
		);
		expect(g.stale.map((s) => s.name)).toEqual(["EpicLoot", "Jotunn"]);
		expect(g.deprecated.map((s) => s.name)).toEqual(["Abe", "Zed"]);
		expect(g.duplicates).toEqual([{ file: "Shared.dll", mods: ["A", "B"] }]);
	});
});
