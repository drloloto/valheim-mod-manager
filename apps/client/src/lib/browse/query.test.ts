import { describe, expect, it } from "vite-plus/test";
import type { SlimPkg } from "#lib/api/types.js";
import { isEmptyQuery, matchesQuery, nameNeedle, parseQuery, parseScope, searchKey } from "./query";

const pkg = (name: string, ns: string, desc: string) => ({ name, ns, desc }) as SlimPkg;
const epic = searchKey(pkg("EpicLoot", "RandyKnapp", "Loot drops with magic arrows"));
const arrows = searchKey(pkg("BetterArrows", "Azumatt", "More arrow types"));
const hit = (q: string, scope?: Parameters<typeof parseQuery>[1]) => [epic, arrows].filter((k) => matchesQuery(k, parseQuery(q, scope))).length;

describe("search query", () => {
	it("keeps free text as one needle over all fields, spaces ignored", () => {
		expect(parseQuery("epic loot").terms).toEqual([{ field: "all", text: "epicloot", negate: false }]);
		expect(hit("epic loot")).toBe(1);
		expect(hit("arrow")).toBe(2);
		expect(hit("azumatt")).toBe(1);
		expect(isEmptyQuery(parseQuery("   "))).toBe(true);
	});

	it("restricts terms to a field, with English and German prefixes and quotes", () => {
		expect(hit("name:arrow")).toBe(1);
		expect(hit("title:Arrow")).toBe(1);
		expect(hit('titel:"better arrows"')).toBe(1);
		expect(hit("desc:arrow")).toBe(2);
		expect(hit("beschreibung:magic")).toBe(1);
		expect(hit("author:randy")).toBe(1);
		expect(hit("autor:randy name:arrow")).toBe(0);
	});

	it("excludes words and field terms with a minus", () => {
		expect(hit("arrow -epic")).toBe(1);
		expect(hit("-name:arrow")).toBe(1);
		expect(hit("-author:azumatt arrow")).toBe(1);
	});

	it("searches free text in the chosen scope", () => {
		expect(hit("arrow", "name")).toBe(1);
		expect(hit("magic", "name")).toBe(0);
		expect(hit("magic", "desc")).toBe(1);
		expect(hit("knapp", "author")).toBe(1);
	});

	it("treats unknown prefixes and an empty field as text being typed", () => {
		expect(parseQuery("c:x").terms).toEqual([{ field: "all", text: "c:x", negate: false }]);
		expect(parseQuery("name:").terms).toEqual([]);
		expect(parseQuery('desc:"fire ar').terms).toEqual([{ field: "desc", text: "firear", negate: false }]);
	});

	it("finds the needle for exact name matches", () => {
		expect(nameNeedle(parseQuery("Epic Loot"))).toBe("epicloot");
		expect(nameNeedle(parseQuery("author:x name:EpicLoot"))).toBe("epicloot");
		expect(nameNeedle(parseQuery("-epic"))).toBe("");
	});

	it("parses stored scopes", () => {
		expect(parseScope("desc")).toBe("desc");
		expect(parseScope("x")).toBeNull();
	});
});
