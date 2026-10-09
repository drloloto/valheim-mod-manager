import { describe, expect, it } from "vitest";
import { describeIssue } from "./health";

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
