import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { strToU8, zipSync } from "fflate";
import { detectLayout, downloadUrl, extractZip, mapTarget, moveAside, planChanges, removeFiles, splitId, untrackedFiles, zipEntryParts } from "./install";

describe("splitId", () => {
	it("prefers the pair the lock carries over splitting at the first hyphen", () => {
		expect(splitId({ id: "LVH-IT-UseEquipmentInWater" })).toEqual({ ns: "LVH", name: "IT-UseEquipmentInWater" });
		expect(splitId({ id: "LVH-IT-UseEquipmentInWater", ns: "LVH-IT", name: "UseEquipmentInWater" })).toEqual({ ns: "LVH-IT", name: "UseEquipmentInWater" });
		expect(downloadUrl({ id: "a-B", version: "1.0.0" })).toBe("https://thunderstore.io/package/download/a/B/1.0.0/");
		expect(downloadUrl({ id: "a-B", version: "1.0.0", source: "hexium" })).toBe("https://cdn.hexium.gg/uploads/a/B/1.0.0.zip");
	});
});

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe("layout detection", () => {
	it("recognises the four conventions", () => {
		const e = (names: string[]) => names.map((n) => ({ parts: zipEntryParts(n)!, isDir: n.endsWith("/") }));
		expect(detectLayout(e(["BepInExPack_Valheim/BepInEx/core/x.dll"])).kind).toBe("pack");
		expect(detectLayout(e(["BepInEx/plugins/A.dll"])).kind).toBe("bepinexRoot");
		expect(detectLayout(e(["plugins/A.dll", "manifest.json"])).kind).toBe("subfolders");
		expect(detectLayout(e(["A.dll", "manifest.json", "icon.png"])).kind).toBe("bare");
	});
	it("maps targets relative to the BepInEx folder", () => {
		expect(mapTarget({ kind: "bepinexRoot", root: "BepInEx" }, ["BepInEx", "plugins", "A.dll"], "a-A")).toEqual(["plugins", "A.dll"]);
		expect(mapTarget({ kind: "subfolders" }, ["config", "a.cfg"], "a-A")).toEqual(["config", "a.cfg"]);
		expect(mapTarget({ kind: "subfolders" }, ["extra.txt"], "a-A")).toEqual(["plugins", "a-A", "extra.txt"]);
		expect(mapTarget({ kind: "subfolders" }, ["manifest.json"], "a-A")).toBeNull();
		expect(mapTarget({ kind: "bare" }, ["A.dll"], "a-A")).toEqual(["plugins", "a-A", "A.dll"]);
		expect(mapTarget({ kind: "pack", root: "BepInExPack_Valheim" }, ["BepInExPack_Valheim", "winhttp.dll"], "p")).toBeNull();
		expect(zipEntryParts("../x")).toBeNull();
		expect(zipEntryParts("C:/x")).toBeNull();
	});
});

describe("extractZip", () => {
	it("writes plugin files, keeps existing configs, removes cleanly", async () => {
		const dir = await mkdtemp(join(tmpdir(), "companion-"));
		// The image's layout: the config folder is the BepInEx folder itself.
		await Bun.write(join(dir, "a.cfg"), "user = 1");
		const bytes = zip({
			"plugins/A.dll": "dll",
			"config/a.cfg": "default = 0",
			"config/new.cfg": "n",
			"config/plugins/evil.dll": "e",
			"manifest.json": "{}",
			"README.md": "r",
		});
		const files = await extractZip(bytes, dir, "a-A", dir);
		expect(files).toEqual(["plugins/A.dll"]);
		expect(await readFile(join(dir, "a.cfg"), "utf-8")).toBe("user = 1");
		expect(await Bun.file(join(dir, "new.cfg")).exists()).toBe(true);
		expect(await Bun.file(join(dir, "plugins", "evil.dll")).exists()).toBe(false);
		expect(await Bun.file(join(dir, "plugins", "manifest.json")).exists()).toBe(false);
		await removeFiles(files, dir);
		expect(await Bun.file(join(dir, "plugins", "A.dll")).exists()).toBe(false);
	});
});

describe("hand-installed server takeover", () => {
	it("finds untracked plugin files and moves them aside instead of deleting them", async () => {
		const dir = await mkdtemp(join(tmpdir(), "companion-"));
		const aside = await mkdtemp(join(tmpdir(), "companion-aside-"));
		await Bun.write(join(dir, "plugins", "Hand.dll"), "hand");
		await Bun.write(join(dir, "plugins", "Folder", "x.dll"), "x");
		await Bun.write(join(dir, "plugins", "a-A", "A.dll"), "tracked");
		await Bun.write(join(dir, "patchers", "P.dll"), "p");
		await Bun.write(join(dir, "config", "keep.cfg"), "cfg");
		const installed = { "a-A": { version: "1.0.0", files: ["plugins/a-A/A.dll"] } };
		const untracked = await untrackedFiles(installed, dir);
		expect(untracked).toEqual(["patchers/P.dll", "plugins/Folder/x.dll", "plugins/Hand.dll"]);
		await moveAside(untracked, aside, dir);
		expect(await readFile(join(aside, "plugins", "Hand.dll"), "utf-8")).toBe("hand");
		expect(await readFile(join(aside, "plugins", "Folder", "x.dll"), "utf-8")).toBe("x");
		expect(await Bun.file(join(dir, "plugins", "Hand.dll")).exists()).toBe(false);
		expect(await Bun.file(join(dir, "plugins", "a-A", "A.dll")).exists()).toBe(true);
		expect(await Bun.file(join(dir, "config", "keep.cfg")).exists()).toBe(true);
	});
});

describe("planChanges", () => {
	it("diffs against installed.json and skips the pack", () => {
		const mods = [
			{ id: "a-A", version: "2.0.0", explicit: true, requiredBy: [] },
			{ id: "b-B", version: "1.0.0", explicit: false, requiredBy: ["a-A"] },
			{
				id: "denikson-BepInExPack_Valheim",
				version: "5.4.2351",
				explicit: false,
				requiredBy: [],
			},
		];
		const p = planChanges(mods, {
			"a-A": { version: "1.0.0", files: [] },
			"b-B": { version: "1.0.0", files: [] },
			"old-Old": { version: "1", files: [] },
		});
		expect(p.toInstall.map((m) => m.id)).toEqual(["a-A"]);
		expect(p.toRemove).toEqual(["old-Old"]);
	});
});
