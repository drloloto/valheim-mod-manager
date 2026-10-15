import { describe, expect, it } from "vitest";
import { clear, click, emptySelection, forContext, move, prune, selectAll } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const ids = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort();
const plain = { shift: false, toggle: false };

describe("click", () => {
	it("plain click selects only the row and sets anchor and focus", () => {
		const s = click({ ids: new Set(["a", "b"]), anchor: "a", focus: "b" }, order, "c", plain);
		expect(ids(s)).toEqual(["c"]);
		expect(s.anchor).toBe("c");
		expect(s.focus).toBe("c");
	});
	it("toggle click adds and removes", () => {
		let s = click(emptySelection, order, "a", plain);
		s = click(s, order, "c", { shift: false, toggle: true });
		expect(ids(s)).toEqual(["a", "c"]);
		s = click(s, order, "a", { shift: false, toggle: true });
		expect(ids(s)).toEqual(["c"]);
	});
	it("shift click selects the range from the anchor, in both directions", () => {
		let s = click(emptySelection, order, "b", plain);
		s = click(s, order, "d", { shift: true, toggle: false });
		expect(ids(s)).toEqual(["b", "c", "d"]);
		expect(s.anchor).toBe("b");
		s = click(s, order, "a", { shift: true, toggle: false });
		expect(ids(s)).toEqual(["a", "b"]);
	});
	it("ctrl+shift click adds the range to the existing selection", () => {
		let s = click(emptySelection, order, "a", plain);
		s = click(s, order, "c", { shift: false, toggle: true });
		s = click(s, order, "e", { shift: true, toggle: true });
		expect(ids(s)).toEqual(["a", "c", "d", "e"]);
	});
	it("shift-click falls back to single when anchor is gone", () => {
		const s = click({ ids: new Set(["x"]), anchor: "x", focus: "x" }, order, "c", { shift: true, toggle: false });
		expect(ids(s)).toEqual(["c"]);
		expect(s.anchor).toBe("c");
	});
});

describe("forContext", () => {
	it("keeps the selection when right-clicking inside it", () => {
		const sel = { ids: new Set(["a", "b"]), anchor: "a", focus: "a" };
		const s = forContext(sel, "b");
		expect(ids(s)).toEqual(["a", "b"]);
		expect(s.focus).toBe("b");
	});
	it("replaces the selection when right-clicking outside it", () => {
		const s = forContext({ ids: new Set(["a", "b"]), anchor: "a", focus: "a" }, "d");
		expect(ids(s)).toEqual(["d"]);
	});
});

describe("move", () => {
	it("moves focus and selection, clamped to the list", () => {
		let s = click(emptySelection, order, "d", plain);
		s = move(s, order, 1, false);
		expect(s.focus).toBe("e");
		s = move(s, order, 1, false);
		expect(s.focus).toBe("e");
		s = move(s, order, -10, false);
		expect(ids(s)).toEqual(["a"]);
	});
	it("starts at the first row without focus", () => {
		expect(move(emptySelection, order, 1, false).focus).toBe("a");
		expect(move(emptySelection, order, -1, false).focus).toBe("e");
	});
	it("Home/End without focus jump to the first/last row, not the reverse", () => {
		expect(move(emptySelection, order, -order.length, false).focus).toBe("a");
		expect(move(emptySelection, order, order.length, false).focus).toBe("e");
	});
	it("extends from the anchor with shift", () => {
		let s = click(emptySelection, order, "b", plain);
		s = move(s, order, 2, true);
		expect(ids(s)).toEqual(["b", "c", "d"]);
		expect(s.anchor).toBe("b");
	});
	it("returns the same object for an empty list", () => {
		expect(move(emptySelection, [], 1, false)).toBe(emptySelection);
	});
});

describe("selectAll / clear / prune", () => {
	it("selects all and keeps focus", () => {
		const s = selectAll({ ids: new Set(), anchor: null, focus: "c" }, order);
		expect(ids(s)).toEqual(order);
		expect(s.focus).toBe("c");
	});
	it("clear keeps focus so the detail panel stays", () => {
		const s = clear({ ids: new Set(["a"]), anchor: "a", focus: "a" });
		expect(s.ids.size).toBe(0);
		expect(s.focus).toBe("a");
	});
	it("prune drops vanished rows and returns the same object when nothing changed", () => {
		const sel = { ids: new Set(["a", "x"]), anchor: "x", focus: "x" };
		const s = prune(sel, order);
		expect(ids(s)).toEqual(["a"]);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
		expect(prune(s, order)).toBe(s);
	});
});
