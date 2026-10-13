import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ServerInfo } from "./manifest";
import { dllVersions, lockFrom, resolveCandidate, scanPlugins, takeover, type PackageApi, type PackageVersion } from "./takeover";

/** a fake .NET DLL: some bytes, then a VERSIONINFO-like block with the UTF-16 keys and values */
function fakeDll(product: string, file?: string): Uint8Array {
	const parts = [Buffer.from("MZ junk junk junk"), Buffer.from("ProductVersion\0", "utf16le"), Buffer.alloc(2), Buffer.from(`${product}\0`, "utf16le")];
	if (file) parts.push(Buffer.from("FileVersion\0", "utf16le"), Buffer.from(`${file}\0`, "utf16le"));
	return new Uint8Array(Buffer.concat(parts));
}

const server: ServerInfo = { name: "S", world: "W", gameVersion: null, bepinex: null };
const day = 86_400_000;
const T0 = Date.parse("2026-10-10T15:29:12Z");

const ver = (version: string, createdAt: number, dependencies: string[] = []): PackageVersion => ({ version, createdAt, dependencies });
/** EpicLoot: latest predates the copy; Warfare: latest came out after the copy, the DLL version exists; Ghost: unknown */
const api: PackageApi = {
	async latest(ns, name) {
		if (ns === "RandyKnapp" && name === "EpicLoot")
			return ver("0.14.13", T0 - 16 * day, ["denikson-BepInExPack_Valheim-5.4.2333", "ValheimModding-JsonDotNET-13.0.4", "ValheimModding-Jotunn-2.29.2"]);
		if (ns === "Therzie" && name === "Warfare") return ver("1.9.5", T0 + 5 * day, ["denikson-BepInExPack_Valheim-5.4.2351", "ValheimModding-Jotunn-2.30.2"]);
		if (ns === "ValheimModding" && name === "Jotunn") return ver("2.30.2", T0 - 19 * day, ["denikson-BepInExPack_Valheim-5.4.2202"]);
		if (ns === "Boom" && name === "Later") return ver("2.0.0", T0 + 5 * day, []);
		return null;
	},
	async version(ns, name, version) {
		if (ns === "Therzie" && name === "Warfare" && version === "1.9.4") return ver("1.9.4", T0 - 18 * day, ["ValheimModding-Jotunn-2.30.2"]);
		return null;
	},
};

describe("takeover of a hand-installed server", () => {
	let dir: string;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "takeover-"));
		const plugins = join(dir, "plugins");
		const put = async (rel: string, bytes: Uint8Array, mtime = T0) => {
			await mkdir(join(plugins, rel, ".."), { recursive: true });
			await writeFile(join(plugins, rel), bytes);
			await utimes(join(plugins, rel), new Date(mtime), new Date(mtime));
		};
		await put("RandyKnapp-EpicLoot/EpicLoot.dll", fakeDll("0.13.0", "0.13.0"));
		await put("Therzie-Warfare/Warfare.dll", fakeDll("1.9.4", "1.9.4"));
		await put("ValheimModding-Jotunn/Jotunn.dll", fakeDll("2.30.2+671c486ac8123a9b240eae80639b6c33f63b3884", "2.30.2.0"));
		await put("ValheimModding-Jotunn/Jotunn.xml", new Uint8Array([1, 2, 3]));
		await put("Ghost-Mod/Ghost.dll", fakeDll("1.0.0"));
		await put("Boom-Later/Boom.dll", fakeDll("9.9.9"));
		await put("LooseMod.dll", fakeDll("1.0.0"));
		await put("not a package/x.dll", fakeDll("1.0.0"));
	});
	afterAll(() => rm(dir, { recursive: true, force: true }));

	it("reads x.y.z out of VERSIONINFO, without build tags or a fourth part", () => {
		expect(dllVersions(fakeDll("2.30.2+671c486a", "2.30.2.0"))).toEqual(["2.30.2"]);
		expect(dllVersions(fakeDll("13.0.3+0a2e291c", "13.0.3.27908"))).toEqual(["13.0.3"]);
		expect(dllVersions(fakeDll("1.0.1.0", "1.0.1.0"))).toEqual(["1.0.1"]);
		expect(dllVersions(fakeDll("1.2", "1.3.4"))).toEqual(["1.2.0", "1.3.4"]);
		expect(dllVersions(new Uint8Array([1, 2, 3]))).toEqual([]);
	});

	it("scans plugins/: package folders become candidates, the rest is unidentified", async () => {
		const s = await scanPlugins(dir);
		expect(s.candidates.map((c) => c.id)).toEqual(["Boom-Later", "Ghost-Mod", "RandyKnapp-EpicLoot", "Therzie-Warfare", "ValheimModding-Jotunn"]);
		expect(s.unidentified).toEqual(["plugins/LooseMod.dll", "plugins/not a package"]);
		const jotunn = s.candidates.find((c) => c.id === "ValheimModding-Jotunn")!;
		expect(jotunn.dllVersions).toEqual(["2.30.2"]);
		expect(Math.abs(jotunn.copiedAt - T0)).toBeLessThan(2000);
	});

	it("picks the newest release that existed at copy time, else the DLL's own version, else guesses latest", async () => {
		const s = await scanPlugins(dir);
		const by = (id: string) => s.candidates.find((c) => c.id === id)!;
		expect(await resolveCandidate(by("RandyKnapp-EpicLoot"), api)).toMatchObject({ version: "0.14.13", from: "latest" });
		expect(await resolveCandidate(by("Therzie-Warfare"), api)).toMatchObject({ version: "1.9.4", from: "dll" });
		expect(await resolveCandidate(by("Boom-Later"), api)).toMatchObject({ version: "2.0.0", from: "guess" });
		expect(await resolveCandidate(by("Ghost-Mod"), api)).toBeNull();
	});

	it("builds the lock with pinned dependencies, the newest pin wins, explicit packages keep their version", () => {
		const mods = lockFrom([
			{
				id: "RandyKnapp-EpicLoot",
				version: "0.14.13",
				from: "latest",
				dependencies: ["denikson-BepInExPack_Valheim-5.4.2333", "ValheimModding-Jotunn-2.29.2", "junk"],
			},
			{ id: "Therzie-Warfare", version: "1.9.4", from: "dll", dependencies: ["denikson-BepInExPack_Valheim-5.4.2351", "ValheimModding-Jotunn-2.30.2"] },
			{ id: "ValheimModding-Jotunn", version: "2.30.2", from: "latest", dependencies: ["denikson-BepInExPack_Valheim-5.4.2202"] },
		]);
		expect(mods).toEqual([
			{
				id: "denikson-BepInExPack_Valheim",
				version: "5.4.2351",
				explicit: false,
				requiredBy: ["RandyKnapp-EpicLoot", "Therzie-Warfare", "ValheimModding-Jotunn"],
			},
			{ id: "RandyKnapp-EpicLoot", version: "0.14.13", explicit: true, requiredBy: [] },
			{ id: "Therzie-Warfare", version: "1.9.4", explicit: true, requiredBy: [] },
			{ id: "ValheimModding-Jotunn", version: "2.30.2", explicit: true, requiredBy: ["RandyKnapp-EpicLoot", "Therzie-Warfare"] },
		]);
	});

	it("takeover: a manifest from what could be resolved, the rest reported", async () => {
		const t = await takeover(server, { bepinexDir: dir, api, configs: {} });
		expect(t.resolved.map((r) => `${r.id}@${r.version}`)).toEqual([
			"Boom-Later@2.0.0",
			"RandyKnapp-EpicLoot@0.14.13",
			"Therzie-Warfare@1.9.4",
			"ValheimModding-Jotunn@2.30.2",
		]);
		expect(t.unresolved).toEqual(["Ghost-Mod: not on Thunderstore"]);
		expect(t.unidentified).toEqual(["plugins/LooseMod.dll", "plugins/not a package"]);
		expect(t.manifest!.mods.map((m) => m.id)).toContain("denikson-BepInExPack_Valheim");
		expect(t.manifest!.mods.find((m) => m.id === "ValheimModding-JsonDotNET")).toMatchObject({ version: "13.0.4", explicit: false });
		expect(t.manifest!.hash).toMatch(/^sha256:/);
	});

	it("takeover with nothing to find returns no manifest and does not touch the API", async () => {
		const empty = await mkdtemp(join(tmpdir(), "takeover-empty-"));
		const t = await takeover(server, {
			bepinexDir: empty,
			configs: {},
			api: {
				latest: async () => {
					throw new Error("must not be called");
				},
				version: async () => null,
			},
		});
		expect(t).toMatchObject({ resolved: [], unresolved: [], unidentified: [], manifest: null });
		await rm(empty, { recursive: true, force: true });
	});
});
