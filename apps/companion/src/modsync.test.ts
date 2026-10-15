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
		expect(classify(["ServerSync", "ConfigSync", "VersionCheck", "ReadConfigValues"])).toEqual({ sync: "serversync", liveReload: true });
		expect(classify(["ServerSync", "ConfigSync"])).toEqual({ sync: "serversync", liveReload: false });
		expect(classify(["SynchronizationManager", "IsAdminOnly", "FileSystemWatcher"])).toEqual({ sync: "jotunn", liveReload: true });
		expect(classify(["SynchronizationManager"])).toEqual({ sync: "none", liveReload: false });
		expect(classify(["IsAdminOnly"])).toEqual({ sync: "jotunn", liveReload: false });
		expect(classify([])).toEqual({ sync: "none", liveReload: false });
	});
});

describe("config → plugin matching", () => {
	const { resemblance } = require("./modsync") as typeof import("./modsync");
	it("prefers the mod whose id or file name looks like the config GUID", () => {
		expect(resemblance("Therzie.Warfare", "Therzie-Warfare", "plugins/Therzie-Warfare/Warfare.dll")).toBeGreaterThan(
			resemblance("Therzie.Warfare", "Therzie-Monstrum", "plugins/Therzie-Monstrum/Monstrum.dll"),
		);
		expect(resemblance("goldenrevolver.quick_stack_store", "Goldenrevolver-Quick_Stack_Store_Sort_Trash_Restock", "plugins/QuickStackStore.dll")).toBeGreaterThan(
			resemblance("goldenrevolver.quick_stack_store", "Tenemo-EpicLoot_ProgressionFix", "plugins/EpicLootProgressionFix.dll"),
		);
		expect(resemblance("randyknapp.mods.epicloot", "RandyKnapp-EpicLoot", "plugins/EpicLoot.dll")).toBeGreaterThan(
			resemblance("randyknapp.mods.epicloot", "ValheimModding-Jotunn", "plugins/Jotunn.dll"),
		);
		expect(resemblance("valheim.epiclootprogressionfix", "Tenemo-EpicLoot_ProgressionFix", "plugins/EpicLootProgressionFix.dll")).toBeGreaterThan(
			resemblance("valheim.epiclootprogressionfix", "RandyKnapp-EpicLoot", "plugins/EpicLoot.dll"),
		);
	});
});
