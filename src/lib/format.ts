// Number, size and time formats, locale-aware via the active locale (i18n/t.ts).
import { getLocale, t, type Locale } from "#lib/i18n/t.js";

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.Collator>();
function memo<T>(key: string, make: () => T): T {
	const k = `${getLocale()}:${key}`;
	let f = cache.get(k) as T | undefined;
	if (!f) {
		f = make();
		cache.set(k, f as never);
	}
	return f;
}

const tag = (l: Locale) => (l === "de" ? "de-DE" : "en-US");

/** Integer with thousands separators: 3.102.455 or 3,102,455. */
export function formatNumber(n: number): string {
	return memo("int", () => new Intl.NumberFormat(tag(getLocale()), { maximumFractionDigits: 0 })).format(n);
}

/**
 * Compact with at most three digits and a short suffix: 980 · 9.9K · 566K · 1.6M. One decimal only below 10
 * of a unit, so a cell never reads "561.1K"; a value that rounds up to 1000 moves to the next unit. For table cells.
 */
export function formatCompact(n: number): string {
	const abs = Math.abs(n);
	if (abs < 1_000) return formatNumber(n);
	const one = memo("one", () => new Intl.NumberFormat(tag(getLocale()), { maximumFractionDigits: 1 }));
	const units: [number, string][] = [
		[1_000, "K"],
		[1_000_000, "M"],
		[1_000_000_000, "B"],
	];
	for (let i = 0; i < units.length; i++) {
		const [size, suffix] = units[i];
		const v = abs / size;
		const rounded = v < 9.95 ? Math.round(v * 10) / 10 : Math.round(v);
		if (rounded >= 1000 && i < units.length - 1) continue;
		const sign = n < 0 ? "-" : "";
		return `${sign}${rounded < 10 ? one.format(rounded) : formatNumber(rounded)}${suffix}`;
	}
	return formatNumber(n);
}

/** Bytes with a fitting unit: 12 B · 640 KB · 15.6 MB · 1.2 GB. KB without, MB/GB with one decimal. */
export function formatBytes(n: number): string {
	const one = memo("one", () => new Intl.NumberFormat(tag(getLocale()), { maximumFractionDigits: 1 }));
	if (n < 1024) return `${n} B`;
	const kb = n / 1024;
	if (kb < 1024) return `${Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${one.format(mb)} MB`;
	return `${one.format(mb / 1024)} GB`;
}

/** Date without time: 8.10.2026 or 10/8/2026. */
export function formatDate(ts: number): string {
	return memo("date", () => new Intl.DateTimeFormat(tag(getLocale()))).format(new Date(ts));
}

/** Month and year: "Mär 2023" or "Mar 2023", for "created" columns. */
export function formatMonth(ts: number): string {
	return memo("month", () => new Intl.DateTimeFormat(tag(getLocale()), { month: "short", year: "numeric" })).format(new Date(ts));
}

/** Date with time, for tooltips. */
export function formatDateTime(ts: number): string {
	return memo("datetime", () => new Intl.DateTimeFormat(tag(getLocale()), { dateStyle: "medium", timeStyle: "short" })).format(new Date(ts));
}

/** Relative and natural: "5 days ago", "last month", "2 years ago". */
export function relativeTime(ts: number, now = Date.now()): string {
	const rtf = memo("rtf", () => new Intl.RelativeTimeFormat(tag(getLocale()), { numeric: "auto" }));
	const days = Math.round((ts - now) / 86_400_000);
	if (Math.abs(days) < 31) return rtf.format(days, "day");
	if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month");
	return rtf.format(Math.round(days / 365), "year");
}

/** Locale-aware comparison for names (case and accents ignored). */
export function collator(): Intl.Collator {
	return memo("collator", () => new Intl.Collator(tag(getLocale()), { sensitivity: "base", numeric: true }));
}

/** Two letters for avatars: the capitals of the name, otherwise the first two characters. */
export function initials(name: string): string {
	const caps = name.replace(/[^A-Z]/g, "").slice(0, 2);
	return caps.length === 2 ? caps : name.slice(0, 2).toUpperCase();
}

/** Number plus unit from the catalog, e.g. "30 days". */
export function formatUnit(n: number, unit: "day" | "week" | "month" | "year"): string {
	return `${n} ${t(`unit.${unit}.${n === 1 ? "one" : "other"}`)}`;
}
