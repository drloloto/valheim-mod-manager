import { afterEach, describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { getLocale, pickLocale, setLocaleSource, t, tn } from "./t";

describe("i18n", () => {
	afterEach(() => setLocaleSource(() => "en"));

	it("both catalogs have the same keys and no empty texts", () => {
		expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
		for (const v of [...Object.values(de), ...Object.values(en)]) expect(v.trim()).not.toBe("");
	});

	it("keeps placeholders consistent between languages", () => {
		for (const k of Object.keys(de) as (keyof typeof de)[]) {
			const p = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
			expect(p(en[k]), k).toEqual(p(de[k]));
		}
	});

	it("translates with variables and follows the locale source", () => {
		expect(t("browse.count", { n: 5, total: 100 })).toBe("5 of 100");
		setLocaleSource(() => "de");
		expect(getLocale()).toBe("de");
		expect(t("browse.count", { n: 5, total: 100 })).toBe("5 von 100");
		setLocaleSource(() => "en");
		expect(t("nav.shortcut", { label: "Browse", n: 1 })).toBe("Browse (Ctrl+1)");
	});

	it("picks plural forms", () => {
		expect(tn("unit.day", 1)).toBe("day");
		setLocaleSource(() => "de");
		expect(tn("unit.day", 3)).toBe("Tage");
	});

	it("maps system tags to supported locales", () => {
		expect(pickLocale("de-AT")).toBe("de");
		expect(pickLocale("en-US")).toBe("en");
		expect(pickLocale("fr")).toBe("en");
		expect(pickLocale(undefined)).toBe("en");
	});
});
