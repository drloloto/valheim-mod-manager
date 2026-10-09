import { describe, expect, it } from "vitest";
import { modStatus } from "./status";

const base = {
	mods: new Map([
		["A-Mod", { enabled: true }],
		["B-Off", { enabled: false }],
	]),
	updates: { "A-Mod": "2.0.0" },
	resolved: { "C-Dep": {} },
};

describe("modStatus", () => {
	it("prefers update over in-profile", () => expect(modStatus("A-Mod", base)).toBe("update"));
	it("reports disabled mods", () => expect(modStatus("B-Off", base)).toBe("disabled"));
	it("reports automatic dependencies", () => expect(modStatus("C-Dep", base)).toBe("dependency"));
	it("reports none otherwise", () => expect(modStatus("D-X", { ...base, resolved: undefined })).toBe("none"));
	it("reports in-profile", () => expect(modStatus("A-Mod", { ...base, updates: {} })).toBe("inProfile"));
});
