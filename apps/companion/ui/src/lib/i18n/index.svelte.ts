// Same shape as the client's i18n (t(key, vars), {var} placeholders), German or English from the browser.
import { de } from "./de";
import { en, type MessageKey } from "./en";

export type Locale = "de" | "en";
export type { MessageKey };

export function pickLocale(tag: string | undefined | null): Locale {
	return (tag ?? "").toLowerCase().split(/[-_]/)[0] === "de" ? "de" : "en";
}

export const locale: Locale = pickLocale(typeof navigator === "undefined" ? undefined : navigator.language);
const catalog: Record<MessageKey, string> = locale === "de" ? de : en;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
	const template = catalog[key] ?? en[key] ?? key;
	return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}
