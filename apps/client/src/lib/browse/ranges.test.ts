import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { setLocaleSource } from "#lib/i18n/t.js";
import type { DateRange, NumRange } from "./criteria";
import {
	bucketDateRange,
	bucketInDate,
	bucketInNum,
	bucketNumRange,
	countBuckets,
	dateActive,
	describeDate,
	describeNum,
	extendNumRange,
	flipDateOp,
	flipNumOp,
	linearBuckets,
	logBuckets,
	matchesDate,
	matchesNum,
	monthBuckets,
	numActive,
} from "./ranges";

// Labels are checked in German; the catalog parity test covers English.
beforeAll(() => setLocaleSource(() => "de"));
afterAll(() => setLocaleSource(() => "en"));

const NOW = new Date(2026, 9, 8, 12).getTime();
const DAY = 86_400_000;
const rel = (op: "within" | "older", n: number, unit: DateRange["unit"] = "day"): DateRange => ({ op, n, unit, from: null, to: null });
const abs = (op: "between" | "outside", from: number | null, to: number | null): DateRange => ({ op, n: 0, unit: "day", from, to });

describe("matchesDate", () => {
	it("handles relative operators", () => {
		expect(matchesDate(NOW - 10 * DAY, rel("within", 30), NOW)).toBe(true);
		expect(matchesDate(NOW - 40 * DAY, rel("within", 30), NOW)).toBe(false);
		expect(matchesDate(NOW - 40 * DAY, rel("older", 30), NOW)).toBe(true);
		expect(matchesDate(NOW - 400 * DAY, rel("within", 1, "year"), NOW)).toBe(false);
		expect(matchesDate(NOW - 10 * DAY, rel("within", 2, "week"), NOW)).toBe(true);
	});
	it("handles absolute operators with open bounds", () => {
		expect(matchesDate(5, abs("between", 1, 10), NOW)).toBe(true);
		expect(matchesDate(11, abs("between", 1, 10), NOW)).toBe(false);
		expect(matchesDate(11, abs("between", 1, null), NOW)).toBe(true);
		expect(matchesDate(11, abs("outside", 1, 10), NOW)).toBe(true);
		expect(matchesDate(5, abs("outside", null, 10), NOW)).toBe(false);
	});
});

describe("matchesNum", () => {
	const r = (op: NumRange["op"], from: number | null, to: number | null): NumRange => ({ op, from, to });
	it("covers all operators", () => {
		expect(matchesNum(5, r("gte", 5, null))).toBe(true);
		expect(matchesNum(4, r("gte", 5, null))).toBe(false);
		expect(matchesNum(4, r("lte", null, 4))).toBe(true);
		expect(matchesNum(7, r("between", 5, 6))).toBe(false);
		expect(matchesNum(7, r("outside", 5, 6))).toBe(true);
		expect(matchesNum(7, r("gte", null, null))).toBe(true);
	});
	it("knows when a range is effective", () => {
		expect(numActive(r("gte", null, null))).toBe(false);
		expect(numActive(r("gte", 1, null))).toBe(true);
		expect(dateActive(rel("within", 0))).toBe(false);
		expect(dateActive(abs("between", null, null))).toBe(false);
		expect(dateActive(abs("between", 1, null))).toBe(true);
	});
});

describe("buckets", () => {
	it("builds month buckets oldest first with an open 'older' bucket", () => {
		const b = monthBuckets(NOW, 3);
		expect(b).toHaveLength(4);
		expect(b[0]).toMatchObject({ from: -Infinity, label: "älter" });
		expect(b[1].label).toMatch(/^Aug.? 2026$/);
		expect(b[3]).toMatchObject({ from: new Date(2026, 9, 1).getTime(), to: Infinity, label: expect.stringMatching(/^Okt.? 2026$/) });
		expect(b[0].to).toBe(b[1].from);
	});
	it("builds half-decade log buckets covering max", () => {
		const b = logBuckets(250, String);
		expect(b.map((x) => x.from)).toEqual([0, 1, 3, 10, 30, 100, 300]);
		expect(b[b.length - 1].to).toBe(Infinity);
		expect(b[1].label).toBe("1–3");
		expect(b[6].label).toBe("300+");
	});
	it("builds linear buckets with open tail", () => {
		const b = linearBuckets(3);
		expect(b.map((x) => x.label)).toEqual(["0", "1", "2", "3+"]);
	});
	it("counts values into buckets", () => {
		expect(countBuckets([0, 1, 2, 50, 999, 1_000_000], logBuckets(999, String))).toEqual([1, 2, 0, 0, 1, 0, 1, 1]);
	});
	it("turns buckets into inclusive ranges and extends them", () => {
		const b = logBuckets(10, String);
		expect(bucketNumRange(b[2])).toEqual({ op: "between", from: 3, to: 9 });
		expect(bucketNumRange(b[4])).toEqual({ op: "between", from: 30, to: null });
		expect(extendNumRange(bucketNumRange(b[1]), b[3])).toEqual({ op: "between", from: 1, to: 29 });
		expect(extendNumRange({ op: "gte", from: 1, to: null }, b[3])).toEqual(bucketNumRange(b[3]));
		const m = monthBuckets(NOW, 2);
		expect(bucketDateRange(m[0])).toEqual({ op: "between", n: 0, unit: "day", from: null, to: m[0].to - 1 });
	});
	it("tells whether a bar lies inside the range", () => {
		const b = logBuckets(100, String);
		expect(bucketInNum(b[3], { op: "gte", from: 10, to: null })).toBe(true);
		expect(bucketInNum(b[2], { op: "gte", from: 10, to: null })).toBe(false);
		expect(bucketInNum(b[2], { op: "gte", from: null, to: null })).toBe(false);
		const m = monthBuckets(NOW, 2);
		expect(bucketInDate(m[2], rel("within", 10), NOW)).toBe(true);
		expect(bucketInDate(m[0], rel("within", 10), NOW)).toBe(false);
	});
});

describe("labels", () => {
	it("describes ranges for tokens", () => {
		expect(describeDate(rel("within", 1, "year"))).toEqual({ op: "innerhalb", value: "1 Jahr" });
		expect(describeDate(rel("older", 3, "month"))).toEqual({ op: "älter als", value: "3 Monate" });
		expect(describeDate(abs("between", null, new Date(2026, 0, 2).getTime())).value).toBe("… – 2.1.2026");
		expect(describeNum("dl", { op: "gte", from: 10_000, to: null })).toEqual({ op: "≥", value: "10.000" });
		expect(describeNum("size", { op: "between", from: 1024, to: null }).value).toBe("1 KB – …");
	});
	it("flips operators into their exclusion form", () => {
		expect(flipDateOp("within")).toBe("older");
		expect(flipDateOp("outside")).toBe("between");
		expect(flipNumOp("gte")).toBe("lte");
		expect(flipNumOp("between")).toBe("outside");
	});
});
