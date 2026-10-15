import { locale } from "./i18n/index.svelte";

export const bytes = (n: number) =>
	n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;

export const dateTime = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—");

const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

export function relative(ms: number | null | undefined): string {
	if (!ms) return "—";
	const s = Math.round((ms - Date.now()) / 1000);
	const abs = Math.abs(s);
	if (abs < 60) return rtf.format(s, "second");
	if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
	return rtf.format(Math.round(s / 86400), "day");
}

/** "Namespace-Name" → Thunderstore page. */
export function thunderstoreUrl(id: string): string {
	const i = id.indexOf("-");
	return `https://thunderstore.io/c/valheim/p/${encodeURIComponent(id.slice(0, i))}/${encodeURIComponent(id.slice(i + 1))}/`;
}
