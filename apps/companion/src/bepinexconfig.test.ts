import { describe, expect, it } from "bun:test";
import { applyConfigChanges, parseConfigText } from "./bepinexconfig";

const text = [
	"## Settings file was created by plugin Warfare",
	"",
	"[General]",
	"",
	"## Lock configuration [Synced with Server]",
	"# Setting type: Toggle",
	"# Default value: On",
	"# Acceptable values: Off, On",
	"Lock Configuration = On",
	"",
	"## Which log levels to show.",
	"# Setting type: LogLevel",
	"# Default value: Fatal, Error",
	"# Acceptable values: None, Fatal, Error, Debug, All",
	"# Multiple values can be set at the same time by separating them with , (e.g. Debug, Warning)",
	"LogLevels = Fatal, Error",
	"",
	"## Item costs [Not Synced with Server]",
	"# Setting type: String",
	"# Default value: BjornMeat:1,Honey:1",
	"Crafting Costs = BjornMeat:1,Honey:1",
].join("\r\n");

describe("BepInEx config parser", () => {
	it("extracts type, default, acceptable values, the multiple-values hint and the sync tags", () => {
		const s = parseConfigText(text);
		expect(s.map((x) => x.key)).toEqual(["Lock Configuration", "LogLevels", "Crafting Costs"]);
		expect(s[0]).toMatchObject({ section: "General", type: "Toggle", defaultValue: "On", acceptableValues: "Off, On", synced: true, description: "Lock configuration" });
		expect(s[1]).toMatchObject({ type: "LogLevel", multiple: true, acceptableValues: "None, Fatal, Error, Debug, All", description: "Which log levels to show." });
		expect(s[1].synced).toBeUndefined();
		expect(s[2]).toMatchObject({ synced: false, description: "Item costs", value: "BjornMeat:1,Honey:1" });
	});
	it("rewrites only the changed lines and keeps the line endings", () => {
		const next = applyConfigChanges(text, [{ section: "General", key: "LogLevels", value: "All" }]);
		expect(next).toContain("\r\nLogLevels = All\r\n");
		expect(next.split("\r\n").length).toBe(text.split("\r\n").length);
		expect(next.replace("LogLevels = All", "LogLevels = Fatal, Error")).toBe(text);
	});
});
