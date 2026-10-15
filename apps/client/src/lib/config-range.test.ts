import { describe, expect, it } from "vitest";
import { parseRange } from "./config-range";

describe("parseRange", () => {
	it("reads BepInEx ranges and picks a step by type", () => {
		expect(parseRange("From 0 to 100", "Int32")).toEqual({ min: 0, max: 100, step: 1 });
		expect(parseRange("From 0 to 1", "Single")).toEqual({ min: 0, max: 1, step: 0.01 });
		expect(parseRange("From 0.5 to 5", "Single")).toEqual({ min: 0.5, max: 5, step: 0.05 });
		expect(parseRange("From -10 to 10", "Single")).toEqual({ min: -10, max: 10, step: 0.5 });
	});

	it("ignores lists and nonsense", () => {
		expect(parseRange("None, A, B", "KeyCode")).toBeNull();
		expect(parseRange("From 5 to 1", "Int32")).toBeNull();
		expect(parseRange(undefined, "Int32")).toBeNull();
	});
});
