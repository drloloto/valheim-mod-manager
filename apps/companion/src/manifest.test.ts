import { describe, expect, it } from "bun:test";
import { diffMods, hashMods, normalizeManifest, sameMods, type ManifestMod } from "./manifest";

const mod = (id: string, version: string, explicit = true): ManifestMod => ({
	id,
	version,
	explicit,
	requiredBy: [],
});
const server = { name: "s", world: "w", gameVersion: null, bepinex: null };

describe("hashMods", () => {
	it("ignores order and the BepInEx pack", () => {
		const a = [mod("a-A", "1.0.0"), mod("b-B", "2.0.0"), mod("denikson-BepInExPack_Valheim", "5.4.2351")];
		const b = [mod("b-B", "2.0.0"), mod("a-A", "1.0.0")];
		expect(hashMods(a)).toBe(hashMods(b));
		expect(hashMods(a)).not.toBe(hashMods([mod("a-A", "1.0.1"), mod("b-B", "2.0.0")]));
	});
});

describe("diffMods", () => {
	it("reports added, removed and changed", () => {
		const d = diffMods([mod("a-A", "1.0.0"), mod("b-B", "1.0.0"), mod("denikson-BepInExPack_Valheim", "1")], [mod("a-A", "2.0.0"), mod("c-C", "1.0.0")]);
		expect(d.added.map((m) => m.id)).toEqual(["c-C"]);
		expect(d.removed.map((m) => m.id)).toEqual(["b-B"]);
		expect(d.changed).toEqual([{ id: "a-A", from: "1.0.0", to: "2.0.0" }]);
		expect(sameMods([mod("a-A", "1.0.0")], [mod("a-A", "1.0.0"), mod("denikson-BepInExPack_Valheim", "2")])).toBe(true);
	});
});

describe("normalizeManifest", () => {
	it("validates, dedupes and sorts", () => {
		const m = normalizeManifest(
			{
				mods: [
					{ id: "b-B", version: "1.0" },
					{ id: "a-A", version: "1.0.0", explicit: false, requiredBy: ["b-B"] },
					{ id: "b-B", version: "9" },
				],
			},
			server,
			{},
		);
		expect(m.mods.map((x) => x.id)).toEqual(["a-A", "b-B"]);
		expect(m.mods[0]).toEqual({
			id: "a-A",
			version: "1.0.0",
			explicit: false,
			requiredBy: ["b-B"],
		});
		expect(m.mods[1].version).toBe("1.0");
		expect(m.hash).toBe(hashMods(m.mods));
	});
	it("rejects garbage", () => {
		expect(() => normalizeManifest({ mods: "x" }, server, {})).toThrow();
		expect(() => normalizeManifest({ mods: [{ id: "../x", version: "1" }] }, server, {})).toThrow();
		expect(() => normalizeManifest({ mods: [{ id: "a-A", version: "v1" }] }, server, {})).toThrow();
	});
});
