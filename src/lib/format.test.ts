import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocaleSource } from "#lib/i18n/t.js";
import { formatBytes, formatCompact, formatMonth, formatNumber, formatUnit, initials, relativeTime } from "./format";

describe("initials", () => {
	it("uses capitals", () => {
		expect(initials("EpicLoot")).toBe("EL");
		expect(initials("Hardcore-Server")).toBe("HS");
		expect(initials("BepInExPack_Valheim")).toBe("BI");
	});
	it("falls back to the first two letters", () => {
		expect(initials("default")).toBe("DE");
		expect(initials("x")).toBe("X");
	});
});

describe("numbers and sizes", () => {
	beforeEach(() => setLocaleSource(() => "de"));
	afterEach(() => setLocaleSource(() => "en"));

	it("formats full and compact numbers per locale", () => {
		expect(formatNumber(3_102_455)).toBe("3.102.455");
		expect(formatCompact(980)).toBe("980");
		expect(formatCompact(41_230)).toBe("41,2k");
		expect(formatCompact(3_102_455)).toBe("3,1M");
		setLocaleSource(() => "en");
		expect(formatNumber(3_102_455)).toBe("3,102,455");
		expect(formatCompact(41_230)).toBe("41.2k");
	});

	it("formats bytes with a unit that fits", () => {
		expect(formatBytes(12)).toBe("12 B");
		expect(formatBytes(655_360)).toBe("640 KB");
		expect(formatBytes(16_357_785)).toBe("15,6 MB");
		expect(formatBytes(1.2 * 1024 ** 3)).toBe("1,2 GB");
	});

	it("formats months, units and relative times", () => {
		expect(formatMonth(new Date(2023, 2, 15).getTime())).toMatch(/^Mär(z)?.? 2023$/);
		expect(formatUnit(1, "day")).toBe("1 Tag");
		expect(formatUnit(30, "day")).toBe("30 Tage");
		const now = new Date(2026, 9, 8).getTime();
		expect(relativeTime(now - 5 * 86_400_000, now)).toBe("vor 5 Tagen");
		expect(relativeTime(now - 400 * 86_400_000, now)).toBe("letztes Jahr");
	});
});
