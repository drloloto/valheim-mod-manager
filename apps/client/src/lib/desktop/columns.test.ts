import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_PREFS,
	fitColumns,
	moveColumn,
	orderedColumns,
	parsePrefs,
	requiredWidth,
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
		expect(trackOf(defs[0], p)).toBe("minmax(160px,1fr)");
		expect(trackOf({ ...defs[0], minWidth: 120 }, p)).toBe("minmax(120px,1fr)");
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

	describe("fitColumns", () => {
		const cols: ColumnDef[] = [
			{ key: "mod", label: "Mod", width: "minmax(0,1fr)", fixed: true },
			{ key: "author", label: "Autor", width: "120px", priority: 1 },
			{ key: "version", label: "Version", width: "80px" },
			{ key: "dl", label: "Downloads", width: "80px" },
			{ key: "status", label: "Status", width: "100px", priority: 2 },
		];
		const opts = { gap: 12, padding: 32, lead: 14 };
		const keys = (w: number, p = DEFAULT_PREFS) => fitColumns(cols, p, w, opts).map((c) => c.key);

		it("sums px tracks, the flexible minimum, gaps, padding and the lead track", () => {
			expect(requiredWidth(cols, DEFAULT_PREFS, opts)).toBe(32 + 14 + 160 + 120 + 80 + 80 + 100 + 5 * 12);
			expect(requiredWidth(cols.slice(0, 1), DEFAULT_PREFS, { gap: 12, padding: 0 })).toBe(160);
		});

		it("returns the same array when everything fits or the width is unknown", () => {
			expect(fitColumns(cols, DEFAULT_PREFS, 700, opts)).toBe(cols);
			expect(fitColumns(cols, DEFAULT_PREFS, 0, opts)).toBe(cols);
		});

		it("drops the lowest priority first, ties from the right, fixed columns never", () => {
			expect(keys(600)).toEqual(["mod", "author", "version", "status"]);
			expect(keys(500)).toEqual(["mod", "author", "status"]);
			expect(keys(400)).toEqual(["mod", "status"]);
			expect(keys(200)).toEqual(["mod"]);
		});

		it("keeps columns the user switched on over default columns", () => {
			const p = { ...DEFAULT_PREFS, hidden: { dl: false } };
			expect(keys(600, p)).toEqual(["mod", "author", "dl", "status"]);
			expect(keys(400, p)).toEqual(["mod", "dl"]);
		});

		it("counts user-resized widths", () => {
			const p = setWidth(DEFAULT_PREFS, cols[1], 300);
			expect(keys(600, p)).toEqual(["mod", "status"]);
		});
	});
});
