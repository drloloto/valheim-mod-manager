import { describe, expect, it } from "bun:test";
import { classify, findStrings, MARKERS } from "./modsync";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("plugin sync markers", () => {
	it("finds marker strings in raw bytes", () => {
		const dll = bytes("\0\0MZ..ServerSync..ConfigSync..Therzie.Warfare..ReadConfigValues\0");
		expect(findStrings(dll, MARKERS)).toEqual(["ServerSync", "ConfigSync", "ReadConfigValues"]);
		expect(findStrings(dll, ["Therzie.Warfare", "Therzie.Monstrum"])).toEqual(["Therzie.Warfare"]);
	});
	it("classifies ServerSync, Jötunn and client-side mods", () => {
		expect(classify(["ServerSync", "ConfigSync", "VersionCheck", "ReadConfigValues"])).toEqual({ sync: "serversync", liveReload: true, versionCheck: true });
		expect(classify(["ServerSync", "ConfigSync"])).toEqual({ sync: "serversync", liveReload: false, versionCheck: false });
		expect(classify(["SynchronizationManager", "IsAdminOnly", "FileSystemWatcher"])).toEqual({ sync: "jotunn", liveReload: true, versionCheck: false });
		expect(classify(["SynchronizationManager"])).toEqual({ sync: "none", liveReload: false, versionCheck: false });
		expect(classify([])).toEqual({ sync: "none", liveReload: false, versionCheck: false });
	});
});
