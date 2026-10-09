// Translation without a Svelte dependency. A replaceable source provides the active language
// (index.svelte.ts points it at the reactive user setting) so that pure modules can translate too.
import { de } from "./de";
import { en, type MessageKey } from "./en";

export type Locale = "de" | "en";
export type { MessageKey };
export const LOCALES: Locale[] = ["de", "en"];

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { de, en };

let source: () => Locale = () => "en";

/** Sets the source of the active language; when read inside a $derived, t() is reactive. */
export function setLocaleSource(fn: () => Locale) {
	source = fn;
}

export function getLocale(): Locale {
	return source();
}

/** Supported language from a BCP 47 tag (e.g. "de-AT"); unknown → English. */
export function pickLocale(tag: string | undefined | null): Locale {
	const lang = (tag ?? "").toLowerCase().split(/[-_]/)[0];
	return lang === "de" ? "de" : "en";
}

export type Vars = Record<string, string | number>;

function fill(template: string, vars?: Vars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function t(key: MessageKey, vars?: Vars): string {
	const locale = source();
	return fill(CATALOGS[locale][key] ?? en[key] ?? key, vars);
}

/** Plural form: `${key}.one` for 1, otherwise `${key}.other`; {n} is always set. */
export function tn(key: string, n: number, vars?: Vars): string {
	const k = `${key}.${n === 1 ? "one" : "other"}` as MessageKey;
	return t(k, { n, ...vars });
}
