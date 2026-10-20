import { describe, expect, it } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { strFromU8, unzipSync } from "fflate";
import { buildR2x, buildR2z } from "./r2z";

describe("r2z", () => {
	it("writes the YAML shape the client parses", () => {
		const y = buildR2x("Peters Welte", [
			{ id: "a-A", version: "1.2.3" },
			{ id: "b-B", version: "2.0" },
		]);
		expect(y).toBe(
			'profileName: "Peters Welte"\nmods:\n  - name: "a-A"\n    version:\n      major: 1\n      minor: 2\n      patch: 3\n    enabled: true\n  - name: "b-B"\n    version:\n      major: 2\n      minor: 0\n      patch: 0\n    enabled: true\n',
		);
	});
	it("bundles configs under BepInEx/config", async () => {
		const dir = await mkdtemp(join(tmpdir(), "companion-cfg-"));
		await Bun.write(join(dir, "A.cfg"), "k = v");
		await Bun.write(join(dir, "sub", "b.json"), "{}");
		await Bun.write(join(dir, "ignore.dll"), "x");
		const zip = await buildR2z(
			{
				schema: 1,
				generatedAt: 0,
				server: { name: "s", world: "w", gameVersion: null, bepinex: null },
				mods: [],
				configs: {},
				hash: "",
			},
			dir,
		);
		const files = unzipSync(zip);
		expect(Object.keys(files).sort()).toEqual(["BepInEx/config/A.cfg", "BepInEx/config/sub/b.json", "export.r2x"]);
		expect(strFromU8(files["export.r2x"])).toContain('profileName: "s"');
	});
});
