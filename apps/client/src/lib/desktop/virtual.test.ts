import { describe, expect, it } from "vite-plus/test";
import { scrollToReveal, visibleRange } from "./virtual";

describe("visibleRange", () => {
	it("returns the rows in view plus overscan", () => {
		expect(visibleRange(500, 300, 50, 1000, 2)).toEqual({ start: 8, end: 18 });
	});
	it("is empty for no rows", () => {
		expect(visibleRange(0, 300, 50, 0)).toEqual({ start: 0, end: 0 });
	});
	it("visibleRange clamps scrollTop beyond content", () => {
		// a filter reduced 6844 → 12 rows while scrollTop is still far down
		expect(visibleRange(300_000, 400, 50, 12, 2)).toEqual({ start: 2, end: 12 });
	});
});

describe("scrollToReveal", () => {
	it("scrolls up, down or not at all", () => {
		expect(scrollToReveal(2, 50, 200, 300)).toBe(100);
		expect(scrollToReveal(10, 50, 0, 300)).toBe(250);
		expect(scrollToReveal(5, 50, 200, 300)).toBe(200);
	});
});
