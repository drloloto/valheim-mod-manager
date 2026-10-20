// Mechanical half of the layout rules (docs/specs/2026-10-11-small-window-layout-design.md):
// scroll containers use the `scroll-y` utility so an appearing scrollbar never shifts content and nothing
// scrolls sideways by accident. The generated shadcn components are exempt (they are hardened in CSS).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = join(__dirname, "..", "..");

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return e.name === "ui" ? [] : svelteFiles(p);
		return e.name.endsWith(".svelte") ? [p] : [];
	});
}

describe("layout rules", () => {
	const files = [...svelteFiles(join(root, "lib")), ...svelteFiles(join(root, "routes"))];

	it("finds the components", () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it("scrolls only through the scroll-y utility", () => {
		const offenders = files.filter((f) => /\boverflow-(y-)?auto\b|\boverflow-y-scroll\b/.test(readFileSync(f, "utf8")));
		expect(offenders.map((f) => relative(root, f).split(sep).join("/"))).toEqual([]);
	});
});
