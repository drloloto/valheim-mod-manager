/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { check, format, isDefault, kindOf, parse, searchSettings } from "./configmeta";
import type { ConfigSetting } from "./types";

const s = (p: Partial<ConfigSetting>): ConfigSetting => ({ section: "General", key: "K", value: "", description: "", ...p });

describe("setting kinds", () => {
	it("recognises the BepInEx types and the value shapes", () => {
		expect(kindOf(s({ type: "Boolean", value: "true" }))).toEqual({ kind: "bool", on: "true", off: "false" });
		expect(kindOf(s({ type: "Toggle", value: "On", acceptableValues: "Off, On" }))).toEqual({ kind: "bool", on: "On", off: "Off" });
		expect(kindOf(s({ type: "Int32", value: "5", acceptableValues: "From 0 to 100" }))).toEqual({ kind: "number", integer: true, min: 0, max: 100 });
		expect(kindOf(s({ type: "Single", value: "0.5" }))).toEqual({ kind: "number", integer: false, min: undefined, max: undefined });
		expect(kindOf(s({ type: "CraftingTable", value: "Forge", acceptableValues: "Disabled, Forge, Cauldron" }))).toEqual({
			kind: "enum",
			options: ["Disabled", "Forge", "Cauldron"],
		});
		expect(kindOf(s({ type: "LogLevel", value: "Fatal, Error", acceptableValues: "None, Fatal, Error, All", multiple: true }))).toEqual({
			kind: "flags",
			options: ["None", "Fatal", "Error", "All"],
		});
		expect(kindOf(s({ type: "Color", value: "FFD800FF" }))).toEqual({ kind: "color" });
		expect(kindOf(s({ type: "Vector3", value: '{"x":0.0,"y":0.05,"z":0.0}' }))).toEqual({ kind: "vector", axes: ["x", "y", "z"] });
		expect(kindOf(s({ type: "Range", value: "5 - 1000" }))).toEqual({ kind: "range" });
		expect(kindOf(s({ type: "String", value: "BjornMeat:1,Honey:1" }))).toEqual({ kind: "records", fields: 2 });
		expect(kindOf(s({ type: "String", value: "GreydwarfEye:1-1:1:unrestricted:multiplyByLevel,RoundLog:1-1:0.5:unrestricted:multiplyByLevel" }))).toEqual({
			kind: "records",
			fields: 5,
		});
		expect(kindOf(s({ type: "String", value: "", defaultValue: "Wood:2" }))).toEqual({ kind: "records", fields: 2 });
		expect(kindOf(s({ type: "String", value: "http://example.test:8080" }))).toEqual({ kind: "text" });
		expect(kindOf(s({ type: "String", value: "Hello, World" }))).toEqual({ kind: "text" });
		expect(kindOf(s({ type: "KeyboardShortcut", value: "F5 + LeftControl" }))).toEqual({ kind: "text" });
	});
});

describe("parse / format round trips", () => {
	it("keeps the .cfg text for every kind", () => {
		const cases: [ConfigSetting, string][] = [
			[s({ type: "Boolean" }), "false"],
			[s({ type: "Toggle", acceptableValues: "Off, On" }), "On"],
			[s({ type: "Int32" }), "42"],
			[s({ type: "LogLevel", acceptableValues: "None, Fatal, Error, All", multiple: true }), "Fatal, Error"],
			[s({ type: "Color" }), "FFD800FF"],
			[s({ type: "Vector2" }), '{"x":150,"y":170}'],
			[s({ type: "Range" }), "5 - 1000"],
			[s({ type: "String" }), "BjornMeat:1,Honey:1"],
		];
		for (const [setting, raw] of cases) {
			const kind = kindOf({ ...setting, value: raw });
			expect(format(kind, parse(kind, raw))).toBe(raw);
		}
	});
	it("writes None or 0 for no flags and pads short records", () => {
		const flags = kindOf(s({ value: "Misc", acceptableValues: "Misc, Food, None", multiple: true }));
		expect(format(flags, [])).toBe("None");
		expect(format({ kind: "flags", options: ["A", "B"] }, [])).toBe("0");
		expect(parse({ kind: "flags", options: ["A", "B"] }, "0")).toEqual([]);
		expect(parse({ kind: "records", fields: 3 }, "Wood:2")).toEqual([["Wood", "2", ""]]);
	});
});

describe("validation", () => {
	it("explains what is wrong, with message keys", () => {
		const n = kindOf(s({ type: "Int32", acceptableValues: "From 0 to 10", value: "1" }));
		expect(check(n, "5")).toBeNull();
		expect(check(n, "x")?.key).toBe("cfg.err.number");
		expect(check(n, "2.5")?.key).toBe("cfg.err.integer");
		expect(check(n, "11")).toEqual({ key: "cfg.err.max", vars: { min: 0, max: 10 } });
		expect(check(n, "-1")?.key).toBe("cfg.err.min");
		expect(check({ kind: "enum", options: ["A", "B"] }, "C")?.key).toBe("cfg.err.option");
		expect(check({ kind: "flags", options: ["A", "B"] }, "A, C")?.key).toBe("cfg.err.option");
		expect(check({ kind: "flags", options: ["A", "B"] }, "A, B")).toBeNull();
		expect(check({ kind: "color" }, "GG0000")?.key).toBe("cfg.err.color");
		expect(check({ kind: "vector", axes: ["x", "y"] }, '{"x":1}')?.key).toBe("cfg.err.vector");
		expect(check({ kind: "range" }, "10 - 5")?.key).toBe("cfg.err.range");
		expect(check({ kind: "records", fields: 2 }, "Wood:2,:3")?.key).toBe("cfg.err.records");
		expect(check({ kind: "records", fields: 2 }, "Wood:2,Stone:1")).toBeNull();
		expect(check({ kind: "text" }, "anything: goes, here")).toBeNull();
		expect(check({ kind: "text" }, "two\nlines")?.key).toBe("cfg.err.line");
	});
	it("compares with the default by kind", () => {
		expect(isDefault(s({ type: "Single", defaultValue: "1", value: "1.0" }), "1.0")).toBe(true);
		expect(isDefault(s({ defaultValue: "A, B", value: "B, A", acceptableValues: "A, B, C", multiple: true }), "B, A")).toBe(true);
		expect(isDefault(s({ defaultValue: "A", value: "B" }), "B")).toBe(false);
		expect(isDefault(s({ value: "B" }), "B")).toBe(true);
	});
});

describe("search", () => {
	const index = {
		"a.cfg": [s({ key: "Lock Configuration", description: "Lock the config" }), s({ key: "Log Levels", section: "Logging" })],
		"b.cfg": [s({ key: "Crafting Costs", description: "Item costs to craft Bear Jerky", value: "BjornMeat:1" })],
	};
	it("ranks key matches over description matches and needs every word", () => {
		expect(searchSettings(index, "lo").map((h) => h.setting.key)).toEqual(["Lock Configuration", "Log Levels"]);
		expect(searchSettings(index, "config").map((h) => h.setting.key)).toEqual(["Lock Configuration"]);
		expect(searchSettings(index, "log levels").map((h) => h.setting.key)).toEqual(["Log Levels"]);
		expect(searchSettings(index, "jerky").map((h) => h.file)).toEqual(["b.cfg"]);
		expect(searchSettings(index, "bjorn").map((h) => h.setting.key)).toEqual(["Crafting Costs"]);
		expect(searchSettings(index, "")).toEqual([]);
	});
});
