import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Installed } from "./install";
import { normalizeManifest, type ServerInfo } from "./manifest";
import { renderTable, reparse } from "./reparse";
import type { PackageApi, PackageVersion } from "./takeover";

function fakeDll(product: string): Uint8Array {
	return new Uint8Array(
		Buffer.concat([Buffer.from("MZ junk"), Buffer.from("ProductVersion\0", "utf16le"), Buffer.alloc(2), Buffer.from(`${product}\0`, "utf16le")]),
	);
}
const server: ServerInfo = { name: "S", world: "W", gameVersion: null, bepinex: null };
const day = 86_400_000;
const T0 = Date.parse("2026-10-10T15:29:12Z");
const ver = (version: string, createdAt: number, dependencies: string[] = []): PackageVersion => ({ version, createdAt, dependencies });
const api: PackageApi = {
	async latest(ns, name) {
		if (ns === "Therzie" && name === "Warfare") return ver("1.9.4", T0 - 18 * day, ["denikson-BepInExPack_Valheim-5.4.2351"]);
		if (ns === "New" && name === "Hand") return ver("3.0.0", T0 - 2 * day, []);
		return null;
	},
	async version() {
		return null;
	},
};

describe("reparse: disk versus lock", () => {
	let dir: string;
	const installed: Installed = {
		"RandyKnapp-EpicLoot": { version: "0.14.13", files: ["plugins/EpicLoot.dll"] },
		"Vanished-Mod": { version: "1.0.0", files: ["plugins/Vanished.dll"] },
	};
	const lock = normalizeManifest(
		{
			mods: [
				{ id: "RandyKnapp-EpicLoot", version: "0.14.13", explicit: true, requiredBy: [] },
				{ id: "Therzie-Warfare", version: "1.9.3", explicit: true, requiredBy: [] },
				{ id: "Vanished-Mod", version: "1.0.0", explicit: true, requiredBy: [] },
				{ id: "Gone-Dep", version: "2.0.0", explicit: false, requiredBy: ["Vanished-Mod"] },
				{ id: "denikson-BepInExPack_Valheim", version: "5.4.2351", explicit: false, requiredBy: ["RandyKnapp-EpicLoot"] },
			],
		},
		server,
		{},
	);
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "reparse-"));
		const put = async (rel: string, bytes: Uint8Array) => {
			await mkdir(join(dir, "plugins", rel, ".."), { recursive: true });
			await writeFile(join(dir, "plugins", rel), bytes);
			await utimes(join(dir, "plugins", rel), new Date(T0), new Date(T0));
		};
		await put("EpicLoot.dll", fakeDll("0.13.0")); // companion-installed, flattened, tracked
		await put("Therzie-Warfare/Warfare.dll", fakeDll("1.9.4")); // hand-installed, lock has an older version
		await put("New-Hand/New.dll", fakeDll("3.0.0")); // hand-installed, not in the lock
		await put("Ghost-Mod/Ghost.dll", fakeDll("1.0.0")); // hand-installed, unknown to Thunderstore
		await put("stray.dll", fakeDll("0.0.1")); // nobody's
	});
	afterAll(() => rm(dir, { recursive: true, force: true }));

	it("reports every package with its source and status", async () => {
		const r = await reparse(server, { bepinexDir: dir, api, configs: {}, lock, installed, pendingRelease: false });
		const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
		expect(by["RandyKnapp-EpicLoot"]).toMatchObject({ source: "companion", status: "ok", lock: "0.14.13", disk: "0.14.13" });
		expect(by["Vanished-Mod"]).toMatchObject({ source: "companion", status: "not-on-disk" });
		expect(by["Therzie-Warfare"]).toMatchObject({ source: "hand", status: "version", lock: "1.9.3", disk: "1.9.4" });
		expect(by["New-Hand"]).toMatchObject({ source: "hand", status: "not-in-lock", disk: "3.0.0" });
		expect(by["Ghost-Mod"]).toMatchObject({ source: "hand", status: "unresolved" });
		expect(by["Gone-Dep"]).toMatchObject({ source: "lock-only", status: "not-on-disk" });
		expect(by["denikson-BepInExPack_Valheim"]).toMatchObject({ source: "image", status: "ok" });
		expect(r.unidentified).toEqual(["plugins/stray.dll"]);
		expect(r.inSync).toBe(false);
		expect(renderTable(r)).toContain("Therzie-Warfare");
	});

	it("proposes a lock from what is on disk and blocks the write while something is unresolved or would be dropped", async () => {
		const r = await reparse(server, { bepinexDir: dir, api, configs: {}, lock, installed, pendingRelease: true });
		expect(r.proposed!.mods.map((m) => `${m.id}@${m.version}`)).toEqual([
			"denikson-BepInExPack_Valheim@5.4.2351",
			"New-Hand@3.0.0",
			"RandyKnapp-EpicLoot@0.14.13",
			"Therzie-Warfare@1.9.4",
		]);
		expect(r.proposed!.mods.find((m) => m.id === "denikson-BepInExPack_Valheim")).toMatchObject({ explicit: false, requiredBy: ["Therzie-Warfare"] });
		expect(r.rows.find((x) => x.id === "denikson-BepInExPack_Valheim")?.status).toBe("ok");
		expect(r.dropped.sort()).toEqual(["Gone-Dep", "Vanished-Mod"]);
		expect(r.blockers.some((b) => b.includes("Ghost-Mod"))).toBe(true);
		expect(r.blockers.some((b) => b.includes("staged release"))).toBe(true);
		expect(r.blockers.some((b) => b.includes("drop 2"))).toBe(true);
		const forced = await reparse(server, { bepinexDir: dir, api, configs: {}, lock, installed, pendingRelease: true, force: true });
		expect(forced.blockers).toHaveLength(1); // only the unresolved package stays a blocker
	});

	it("is in sync when the lock equals what is on disk", async () => {
		const clean = await mkdtemp(join(tmpdir(), "reparse-clean-"));
		await mkdir(join(clean, "plugins", "Therzie-Warfare"), { recursive: true });
		await writeFile(join(clean, "plugins", "Therzie-Warfare", "Warfare.dll"), fakeDll("1.9.4"));
		await utimes(join(clean, "plugins", "Therzie-Warfare", "Warfare.dll"), new Date(T0), new Date(T0));
		const l = normalizeManifest(
			{
				mods: [
					{ id: "Therzie-Warfare", version: "1.9.4", explicit: true, requiredBy: [] },
					{ id: "denikson-BepInExPack_Valheim", version: "5.4.2351", explicit: false, requiredBy: ["Therzie-Warfare"] },
				],
			},
			server,
			{},
		);
		const r = await reparse(server, { bepinexDir: clean, api, configs: {}, lock: l, installed: {}, pendingRelease: false });
		expect(r.rows.map((x) => x.status)).toEqual(["ok", "ok"]);
		expect(r.inSync).toBe(true);
		expect(r.blockers).toEqual([]);
		await rm(clean, { recursive: true, force: true });
	});
});
