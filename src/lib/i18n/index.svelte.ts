// Reactive language choice: "system" follows the browser language, otherwise fixed. Imported in +layout.svelte.
import { Persisted } from "#lib/desktop/persisted.svelte.js";
import { pickLocale, setLocaleSource, type Locale } from "./t";

export type LocaleSetting = "system" | Locale;

const parse = (v: unknown): LocaleSetting | null => (v === "system" || v === "de" || v === "en" ? v : null);

export const localeSetting = new Persisted<LocaleSetting>("werkbank.locale", "system", parse);

export function resolveLocale(setting: LocaleSetting, systemTag: string | undefined): Locale {
	return setting === "system" ? pickLocale(systemTag) : setting;
}

setLocaleSource(() => resolveLocale(localeSetting.value, typeof navigator === "undefined" ? undefined : navigator.language));

export function setLocaleSetting(s: LocaleSetting) {
	localeSetting.set(s);
	if (typeof document !== "undefined") document.documentElement.lang = resolveLocale(s, navigator.language);
}

export { getLocale, t, tn, type Locale } from "./t";
