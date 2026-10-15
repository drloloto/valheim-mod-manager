import { describe, expect, it } from "vitest";
import { externalHref, shouldBlockKey } from "./guards";

const k = (key: string, ctrl = false, shift = false) => ({ key, ctrlKey: ctrl, metaKey: false, shiftKey: shift, altKey: false });

describe("shouldBlockKey", () => {
	it("blocks reload, print, find and zoom in release", () => {
		for (const e of [k("F5"), k("r", true), k("R", true, true), k("p", true), k("f", true), k("+", true), k("-", true), k("0", true)]) {
			expect(shouldBlockKey(e, false)).toBe(true);
		}
	});
	it("allows reload and devtools in dev", () => {
		expect(shouldBlockKey(k("F5"), true)).toBe(false);
		expect(shouldBlockKey(k("r", true), true)).toBe(false);
		expect(shouldBlockKey(k("I", true, true), true)).toBe(false);
	});
	it("does not block editing shortcuts", () => {
		for (const c of ["a", "c", "v", "x", "z", "y"]) expect(shouldBlockKey(k(c, true), false)).toBe(false);
	});
});

describe("externalHref", () => {
	const origin = "http://localhost:1420";
	it("returns links that leave the app", () => {
		expect(externalHref("https://thunderstore.io/c/valheim/", origin)).toBe("https://thunderstore.io/c/valheim/");
		expect(externalHref("mailto:a@b.c", origin)).toBe("mailto:a@b.c");
	});
	it("keeps in-app routes, anchors and odd schemes in the app", () => {
		expect(externalHref("/installed", origin)).toBeNull();
		expect(externalHref("#top", origin)).toBeNull();
		expect(externalHref("javascript:alert(1)", origin)).toBeNull();
		expect(externalHref("", origin)).toBeNull();
	});
});
