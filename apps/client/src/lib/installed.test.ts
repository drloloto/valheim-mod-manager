import { describe, expect, it } from "vite-plus/test";
import type { ProfileMod } from "#lib/api/types.js";
import { buildRows, countSources, LOADER_ID, sortRows, type RowsInput } from "./installed";

const mod = (namespace: string, name: string, o: Partial<ProfileMod> = {}): ProfileMod => ({
	namespace,
	name,
	version: "1.0.0",
	enabled: true,
	source: "thunderstore",
	...o,
});

const input = (o: Partial<RowsInput> = {}): RowsInput => ({
	mods: [
		mod("b", "Zeta"),
		mod("a", "Alpha", { managed: true }),
		mod("c", "Local", { source: "local" }),
		mod("d", "Off", { enabled: false }),
		mod("e", "Opt", { optional: true }),
	],
	plan: {
		resolved: {
			"b-Zeta": { version: "1.0.0", requiredBy: [] },
			"x-Lib": { version: "2.0.0", requiredBy: ["b-Zeta"] },
			"y-ServerLib": { version: "3.0.0", requiredBy: [] },
			[LOADER_ID]: { version: "5.4.0", requiredBy: [] },
		},
		toInstall: [],
		toRemove: [],
		errors: [],
	},
	implicitMods: ["y-ServerLib"],
	updates: { "b-Zeta": "1.1.0" },
	missing: new Set(),
	syncing: false,
	nameOf: () => undefined,
	...o,
});

describe("installed rows", () => {
	it("gives every row one source and one state", () => {
		const rows = Object.fromEntries(buildRows(input()).map((r) => [r.id, `${r.source}/${r.state}`]));
		expect(rows).toEqual({
			"b-Zeta": "own/update",
			"a-Alpha": "server/ok",
			"c-Local": "local/ok",
			"d-Off": "own/disabled",
			"e-Opt": "optional/ok",
			"x-Lib": "dependency/ok",
			"y-ServerLib": "server/ok",
			[LOADER_ID]: "dependency/ok",
		});
	});

	it("reports missing and installing before anything else", () => {
		const missing = new Set(["b-Zeta", "x-Lib"]);
		const rows = buildRows(input({ missing }));
		expect(rows.find((r) => r.id === "b-Zeta")?.state).toBe("missing");
		expect(buildRows(input({ missing, syncing: true })).find((r) => r.id === "x-Lib")?.state).toBe("installing");
	});

	it("sorts the loader first, then by source, then name, independent of the install order", () => {
		const a = sortRows(buildRows(input()), null).map((r) => r.name);
		const shuffled = input();
		const b = sortRows(buildRows({ ...shuffled, mods: [...shuffled.mods].reverse() }), null).map((r) => r.name);
		expect(a).toEqual(["BepInExPack_Valheim", "Alpha", "ServerLib", "Opt", "Off", "Zeta", "Local", "Lib"]);
		expect(b).toEqual(a);
	});

	it("sorts by a column with the name as tie breaker, the loader staying on top", () => {
		expect(sortRows(buildRows(input()), { key: "status", dir: "asc" }).map((r) => r.name)).toEqual([
			"BepInExPack_Valheim",
			"Zeta",
			"Off",
			"Alpha",
			"Lib",
			"Local",
			"Opt",
			"ServerLib",
		]);
		const byNameDesc = sortRows(buildRows(input()), { key: "mod", dir: "desc" }).map((r) => r.name);
		expect(byNameDesc.slice(0, 2)).toEqual(["BepInExPack_Valheim", "Zeta"]);
	});

	it("counts sources", () => {
		expect(countSources(buildRows(input()))).toEqual({ server: 2, optional: 1, own: 2, local: 1, dependency: 2 });
	});
});
