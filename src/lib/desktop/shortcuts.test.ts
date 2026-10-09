import { describe, expect, it } from "vitest";
import { matches, parseCombo } from "./shortcuts";

const key = (k: string, m: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
	key: k,
	ctrlKey: !!m.ctrl,
	metaKey: !!m.meta,
	shiftKey: !!m.shift,
	altKey: !!m.alt,
});

describe("parseCombo", () => {
	it("parses modifiers and key", () => {
		expect(parseCombo("Mod+Shift+R")).toEqual({ key: "R", mod: true, shift: true, alt: false });
		expect(parseCombo("F5")).toEqual({ key: "F5", mod: false, shift: false, alt: false });
	});
});

describe("matches", () => {
	it("maps Mod to Ctrl on Windows and Meta on Mac", () => {
		expect(matches(key("k", { ctrl: true }), "Mod+K", false)).toBe(true);
		expect(matches(key("k", { meta: true }), "Mod+K", true)).toBe(true);
		expect(matches(key("k", { meta: true }), "Mod+K", false)).toBe(false);
	});
	it("requires exact modifiers", () => {
		expect(matches(key("r", { ctrl: true, shift: true }), "Mod+R", false)).toBe(false);
		expect(matches(key("R", { ctrl: true, shift: true }), "Mod+Shift+R", false)).toBe(true);
	});
	it("supports named keys", () => {
		expect(matches(key("+", { ctrl: true }), "Mod+Plus", false)).toBe(true);
		expect(matches(key(",", { ctrl: true }), "Mod+,", false)).toBe(true);
		expect(matches(key("Enter", { ctrl: true }), "Mod+Enter", false)).toBe(true);
	});
});
