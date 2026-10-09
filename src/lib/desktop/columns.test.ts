import { describe, expect, it } from "vitest";
import {
	DEFAULT_PREFS,
	moveColumn,
	orderedColumns,
	parsePrefs,
	resetColumns,
	resetWidths,
	rowHeight,
	setWidth,
	toggleColumn,
	trackOf,
	visibleColumns,
	type ColumnDef,
} from "./columns";

const defs: ColumnDef[] = [
	{ key: "mod", label: "Mod", width: "minmax(0,1fr)", fixed: true },
	{ key: "author", label: "Autor", width: "120px" },
	{ key: "dl", label: "Downloads", width: "80px" },
	{ key: "created", label: "Erstellt", width: "80px", hidden: true },
];

describe("columns", () => {
	it("applies default visibility, user overrides and fixed columns", () => {
		expect(visibleColumns(defs, DEFAULT_PREFS).map((d) => d.key)).toEqual(["mod", "author", "dl"]);
		let p = toggleColumn(DEFAULT_PREFS, defs[3]);
		expect(visibleColumns(defs, p).map((d) => d.key)).toEqual(["mod", "author", "dl", "created"]);
		p = toggleColumn(p, defs[1]);
		expect(visibleColumns(defs, p).map((d) => d.key)).toEqual(["mod", "dl", "created"]);
		expect(toggleColumn(p, defs[0])).toBe(p);
	});

	it("orders by prefs, ignoring unknown keys and appending new columns", () => {
		const p = { ...DEFAULT_PREFS, order: ["dl", "ghost", "mod"] };
		expect(orderedColumns(defs, p).map((d) => d.key)).toEqual(["dl", "mod", "author", "created"]);
	});

	it("moves columns before or after a target", () => {
		let p = moveColumn(DEFAULT_PREFS, defs, "dl", "mod", "before");
		expect(p.order).toEqual(["dl", "mod", "author", "created"]);
		p = moveColumn(p, defs, "mod", "created", "after");
		expect(p.order).toEqual(["dl", "author", "created", "mod"]);
		expect(moveColumn(p, defs, "dl", "dl", "after")).toBe(p);
		expect(moveColumn(p, defs, "dl", "ghost", "after")).toBe(p);
	});

	it("sets widths only for px tracks, clamps to the minimum and resets", () => {
		let p = setWidth(DEFAULT_PREFS, defs[1], 200.4);
		expect(trackOf(defs[1], p)).toBe("200px");
		p = setWidth(p, defs[1], 10);
		expect(trackOf(defs[1], p)).toBe("48px");
		expect(setWidth(p, defs[0], 300)).toBe(p);
		expect(trackOf(defs[0], p)).toBe("minmax(0,1fr)");
		expect(trackOf(defs[1], resetWidths(p))).toBe("120px");
		expect(resetColumns({ ...p, density: "compact" })).toEqual({ ...DEFAULT_PREFS, density: "compact" });
	});

	it("parses stored prefs defensively", () => {
		expect(parsePrefs({ hidden: { a: true, b: "x" }, order: ["a", 1], widths: { a: 100, b: 10, c: "x" }, density: "compact" })).toEqual({
			hidden: { a: true },
			order: [],
			widths: { a: 100 },
			density: "compact",
		});
		expect(parsePrefs(null)).toBeNull();
		expect(rowHeight("compact")).toBe(38);
		expect(rowHeight("normal", 50)).toBe(50);
	});
});
