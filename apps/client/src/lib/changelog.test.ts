import { describe, expect, it } from "vitest";
import { compareVersions, sliceChangelog } from "./changelog";

const JOTUNN = `# Changelog

## Version 2.26.0
- New thing

## Version 2.25.0
- Fix A
- Fix B

## Version 2.24.3
- Old
`;

const PLANT = `### 1.21.3\r\n* Hotfix\r\n\r\n### 1.21.2\r\n* Compiled against Valheim v1.0.7\r\n\r\n### 1.21.0\r\n* Big\r\n`;

describe("compareVersions", () => {
	it("compares numerically and tolerates prefixes and missing segments", () => {
		expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
		expect(compareVersions("v2.0", "2.0.0")).toBe(0);
		expect(compareVersions("5.4.2351", "5.4.2333")).toBeGreaterThan(0);
		expect(compareVersions("1.2.3.4", "1.2.3")).toBeGreaterThan(0);
	});
});

describe("sliceChangelog", () => {
	it("keeps the sections between installed (exclusive) and target (inclusive)", () => {
		const s = sliceChangelog(JOTUNN, "2.24.3", "2.26.0");
		expect(s.versions).toEqual(["2.26.0", "2.25.0"]);
		expect(s.markdown).toContain("Fix B");
		expect(s.markdown).not.toContain("Old");
		expect(s.markdown).not.toContain("# Changelog");
		expect(s.hasHeadings).toBe(true);
	});

	it("handles ### headings and CRLF", () => {
		const s = sliceChangelog(PLANT, "1.21.0", "1.21.3");
		expect(s.versions).toEqual(["1.21.3", "1.21.2"]);
		expect(s.markdown).toContain("Compiled against");
	});

	it("reports an empty range and a changelog without version headings", () => {
		expect(sliceChangelog(JOTUNN, "2.26.0", "2.26.0")).toMatchObject({ versions: [], hasHeadings: true, markdown: "" });
		const free = sliceChangelog("Just some notes.\n\n- bullet", "1.0.0", "1.1.0");
		expect(free.hasHeadings).toBe(false);
		expect(free.markdown).toContain("bullet");
	});
});
