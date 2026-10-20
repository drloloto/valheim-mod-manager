// Range filters: operators, histogram buckets and labels. Pure functions.
import { formatBytes, formatDate, formatMonth, formatNumber, formatUnit } from "#lib/format.js";
import { t } from "#lib/i18n/t.js";
import type { DateOp, DateRange, DateUnit, NumKey, NumOp, NumRange } from "./criteria";

const DAY = 86_400_000;
export const UNIT_MS: Record<DateUnit, number> = { day: DAY, week: 7 * DAY, month: 30.4375 * DAY, year: 365.25 * DAY };
export const DATE_OPS: DateOp[] = ["within", "older", "between", "outside"];
export const NUM_OPS: NumOp[] = ["gte", "lte", "between", "outside"];
export const DATE_UNITS: DateUnit[] = ["day", "week", "month", "year"];

export const dateOpLabel = (op: DateOp) => t(`op.${op}`);
export const numOpLabel = (op: NumOp) => t(`op.${op}`);
export const unitLabel = (unit: DateUnit, n = 2) => t(`unit.${unit}.${n === 1 ? "one" : "other"}`);

export function spanMs(n: number, unit: DateUnit): number {
	return n * UNIT_MS[unit];
}

export function matchesDate(ts: number, r: DateRange, now: number): boolean {
	switch (r.op) {
		case "within":
			return ts >= now - spanMs(r.n, r.unit);
		case "older":
			return ts < now - spanMs(r.n, r.unit);
		case "between":
			return (r.from === null || ts >= r.from) && (r.to === null || ts <= r.to);
		case "outside":
			return !((r.from === null || ts >= r.from) && (r.to === null || ts <= r.to));
	}
}

export function matchesNum(v: number, r: NumRange): boolean {
	switch (r.op) {
		case "gte":
			return r.from === null || v >= r.from;
		case "lte":
			return r.to === null || v <= r.to;
		case "between":
			return (r.from === null || v >= r.from) && (r.to === null || v <= r.to);
		case "outside":
			return !((r.from === null || v >= r.from) && (r.to === null || v <= r.to));
	}
}

/** A range only takes effect when it has at least one bound. */
export function numActive(r: NumRange | null): r is NumRange {
	return !!r && (r.from !== null || r.to !== null);
}

export function dateActive(r: DateRange | null): r is DateRange {
	if (!r) return false;
	return r.op === "within" || r.op === "older" ? r.n > 0 : r.from !== null || r.to !== null;
}

/** Half-open interval [from, to); bounds may be ±Infinity. */
export interface Bucket {
	from: number;
	to: number;
	label: string;
}

/** "older" plus the last `months` calendar months (oldest first); the current month is open-ended. */
export function monthBuckets(now: number, months = 24): Bucket[] {
	const d = new Date(now);
	const starts: number[] = [];
	for (let i = months - 1; i >= 0; i--) starts.push(new Date(d.getFullYear(), d.getMonth() - i, 1).getTime());
	const out: Bucket[] = [{ from: -Infinity, to: starts[0], label: t("filter.older") }];
	starts.forEach((s, i) => out.push({ from: s, to: i + 1 < starts.length ? starts[i + 1] : Infinity, label: formatMonth(s) }));
	return out;
}

/** 0, then half-decades 1·10ⁿ and 3·10ⁿ until `max` is covered; the last bucket is open-ended. */
export function logBuckets(max: number, fmt: (v: number) => string = formatNumber): Bucket[] {
	const edges = [0, 1];
	while (edges[edges.length - 1] <= max) {
		const last = edges[edges.length - 1];
		const mag = 10 ** Math.floor(Math.log10(last));
		edges.push(last === mag ? 3 * mag : 10 * mag);
	}
	const out: Bucket[] = [];
	for (let i = 0; i < edges.length; i++) {
		const from = edges[i];
		const to = i + 1 < edges.length ? edges[i + 1] : Infinity;
		out.push({ from, to, label: to === Infinity ? `${fmt(from)}+` : `${fmt(from)}–${fmt(to)}` });
	}
	return out;
}

/** One bucket each for 0, 1, …, cap-1; the last one is open from cap. */
export function linearBuckets(cap = 8): Bucket[] {
	const out: Bucket[] = [];
	for (let i = 0; i < cap; i++) out.push({ from: i, to: i + 1, label: String(i) });
	out.push({ from: cap, to: Infinity, label: `${cap}+` });
	return out;
}

export function countBuckets(values: Iterable<number>, buckets: Bucket[]): number[] {
	const counts = Array.from({ length: buckets.length }, () => 0);
	for (const v of values) {
		for (let i = buckets.length - 1; i >= 0; i--) {
			if (v >= buckets[i].from) {
				counts[i]++;
				break;
			}
		}
	}
	return counts;
}

/** "between" range from a bucket; values are integers or milliseconds, hence `to - 1`. */
export function bucketNumRange(b: Bucket): NumRange {
	return { op: "between", from: b.from === -Infinity ? null : b.from, to: b.to === Infinity ? null : b.to - 1 };
}

export function bucketDateRange(b: Bucket): DateRange {
	return { op: "between", n: 0, unit: "day", from: b.from === -Infinity ? null : b.from, to: b.to === Infinity ? null : b.to - 1 };
}

/** Extends an existing "between" range by the bucket (Shift+click). */
export function extendNumRange(r: NumRange | null, b: Bucket): NumRange {
	const n = bucketNumRange(b);
	if (!r || r.op !== "between") return n;
	return {
		op: "between",
		from: r.from === null || n.from === null ? null : Math.min(r.from, n.from),
		to: r.to === null || n.to === null ? null : Math.max(r.to, n.to),
	};
}

export function extendDateRange(r: DateRange | null, b: Bucket): DateRange {
	const n = bucketDateRange(b);
	if (!r || r.op !== "between") return n;
	return { ...n, from: r.from === null || n.from === null ? null : Math.min(r.from, n.from), to: r.to === null || n.to === null ? null : Math.max(r.to, n.to) };
}

/** Representative value of a bucket for the question "is this bar inside the range?". */
function sample(b: Bucket): number {
	if (b.from === -Infinity) return b.to - 1;
	if (b.to === Infinity) return b.from;
	return b.from + (b.to - b.from) / 2;
}

export function bucketInNum(b: Bucket, r: NumRange | null): boolean {
	return numActive(r) && matchesNum(sample(b), r);
}

export function bucketInDate(b: Bucket, r: DateRange | null, now: number): boolean {
	return dateActive(r) && matchesDate(sample(b), r, now);
}

export function formatNum(key: NumKey, v: number): string {
	if (key === "size") return formatBytes(v);
	if (key === "dl") return formatNumber(v);
	return String(v);
}

export function describeDate(r: DateRange): { op: string; value: string } {
	const op = dateOpLabel(r.op);
	if (r.op === "within" || r.op === "older") return { op, value: formatUnit(r.n, r.unit) };
	const f = r.from === null ? "…" : formatDate(r.from);
	const to = r.to === null ? "…" : formatDate(r.to);
	return { op, value: `${f} – ${to}` };
}

export function describeNum(key: NumKey, r: NumRange): { op: string; value: string } {
	const op = numOpLabel(r.op);
	if (r.op === "gte") return { op, value: r.from === null ? "…" : formatNum(key, r.from) };
	if (r.op === "lte") return { op, value: r.to === null ? "…" : formatNum(key, r.to) };
	const f = r.from === null ? "…" : formatNum(key, r.from);
	const to = r.to === null ? "…" : formatNum(key, r.to);
	return { op, value: `${f} – ${to}` };
}

/** Inversion as exclusion: within ↔ older than, between ↔ outside. */
export function flipDateOp(op: DateOp): DateOp {
	return op === "within" ? "older" : op === "older" ? "within" : op === "between" ? "outside" : "between";
}

export function flipNumOp(op: NumOp): NumOp {
	return op === "gte" ? "lte" : op === "lte" ? "gte" : op === "between" ? "outside" : "between";
}
