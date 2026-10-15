import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { setLocaleSource } from "#lib/i18n/t.js";
import { defaultCriteria, withDate, withList, withNum } from "./criteria";
import { buildTokens, flipToken, removeToken } from "./tokens";

// Labels are checked in German; the catalog parity test covers English.
beforeAll(() => setLocaleSource(() => "de"));
afterAll(() => setLocaleSource(() => "en"));

describe("tokens", () => {
	const c = withNum(
		withDate(withList(withList(defaultCriteria({ showNsfw: true }), "cats", { Items: 1, Tweaks: 1, Modpacks: -1 }), "status", { update: 1 }), "upd", {
			op: "within",
			n: 30,
			unit: "day",
			from: null,
			to: null,
		}),
		"dl",
		{ op: "gte", from: 1000, to: null },
	);

	it("builds one token per field and sign, lists before ranges", () => {
		const t = buildTokens(c);
		expect(t.map((x) => `${x.field} ${x.op} ${x.value}`)).toEqual([
			"Status ist Update verfügbar",
			"Kategorie ist Items, Tweaks",
			"Kategorie ist nicht Modpacks",
			"Merkmale ist nicht Veraltet",
			"Aktualisiert innerhalb 30 Tage",
			"Downloads ≥ 1.000",
		]);
		expect(t.filter((x) => x.negative).map((x) => x.field)).toEqual(["Kategorie", "Merkmale"]);
		expect(buildTokens({ ...c, catMode: "all" })[1].op).toBe("hat alle");
	});

	it("flips signs and operators", () => {
		const t = buildTokens(c);
		expect(flipToken(c, t[1]).lists.cats).toEqual({ Items: -1, Tweaks: -1, Modpacks: -1 });
		expect(flipToken(c, t[4]).dates.upd?.op).toBe("older");
		expect(flipToken(c, t[5]).nums.dl).toEqual({ op: "lte", from: null, to: 1000 });
		const between = withNum(c, "dl", { op: "between", from: 1, to: 2 });
		expect(flipToken(between, buildTokens(between)[5]).nums.dl).toEqual({ op: "outside", from: 1, to: 2 });
	});

	it("removes exactly the token's part", () => {
		const t = buildTokens(c);
		expect(removeToken(c, t[2]).lists.cats).toEqual({ Items: 1, Tweaks: 1 });
		expect(removeToken(c, t[4]).dates.upd).toBeNull();
		expect(removeToken(c, t[5]).nums.dl).toBeNull();
		expect(buildTokens(defaultCriteria({ showNsfw: true })).length).toBe(1);
	});
});
