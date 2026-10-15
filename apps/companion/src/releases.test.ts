import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { isEmptyPlan, summary, type Release, type ReleasePlan } from "./releases";

const plan = (p: Partial<ReleasePlan> = {}): ReleasePlan => ({
	install: [],
	remove: [],
	configsChanged: [],
	configsNew: [],
	conflicts: [],
	restartRequired: false,
	effects: {},
	...p,
});

describe("release summary", () => {
	it("counts the plan and keeps problems and schedule", () => {
		const r: Release = {
			id: "r1",
			createdAt: 1,
			updatedAt: 2,
			manifest: { schema: 1, generatedAt: 1, server: { name: "s", world: "w", gameVersion: null, bepinex: null }, mods: [], configs: {}, hash: "" },
			modsFrom: "client",
			modsAt: 1,
			configs: ["A.cfg", "B.cfg"],
			configMeta: {},
			plan: plan({
				install: [{ id: "a-A", from: null, to: "1.0.0" }],
				remove: ["b-B"],
				configsChanged: ["A.cfg"],
				configsNew: ["B.cfg"],
				conflicts: ["A.cfg"],
				restartRequired: true,
			}),
			problems: ["Download failed (c-C 1.0.0): HTTP 404"],
			schedule: { when: "idle", setAt: 2 },
			lastError: null,
		};
		expect(summary(r)).toEqual({
			id: "r1",
			createdAt: 1,
			updatedAt: 2,
			modsFrom: "client",
			install: 1,
			remove: 1,
			configs: 2,
			conflicts: 1,
			untracked: 0,
			restartRequired: true,
			empty: false,
			problems: r.problems,
			schedule: r.schedule,
			lastError: null,
		});
	});
	it("counts hand-installed files the first apply moves aside and knows an empty plan", () => {
		const p = plan({ untracked: ["plugins/A.dll", "plugins/B/b.dll"] });
		const r = { id: "r2", createdAt: 1, configs: [], plan: p, problems: [], schedule: null, lastError: null } as unknown as Release;
		expect(summary(r).untracked).toBe(2);
		expect(summary(r).empty).toBe(true);
		expect(isEmptyPlan(plan({ configsNew: ["x.cfg"] }))).toBe(false);
	});
});

describe("working state (own process, real files)", async () => {
	const root = await mkdtemp(join(tmpdir(), "companion-draft-"));
	const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "testing", "draft-scenario.ts")], {
		env: {
			...process.env,
			CONFIG_DIR: join(root, "config"),
			BACKUP_DIR: join(root, "backups"),
			ENV_FILE: join(root, "valheim.env"),
			COMPANION_ALLOW_CONTROL: "0",
			HOSTNAME: "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	await proc.exited;
	await rm(root, { recursive: true, force: true });
	const lines = stdout.trim().split("\n");
	const out = (() => {
		try {
			return JSON.parse(lines[lines.length - 1]);
		} catch {
			throw new Error(`scenario failed:\n${stdout}\n${stderr}`);
		}
	})();

	it("stages a web edit as a copy and leaves the live file alone", () => {
		expect(out.stagedFiles).toEqual(["Mod.Alpha.cfg"]);
		expect(out.liveAfterEdit).toContain("Speed = 1");
		expect(out.working).toContain("Speed = 5");
		expect(out.plan1).toMatchObject({ changed: ["Mod.Alpha.cfg"], restart: true, empty: false, modsFrom: null });
		expect(out.plan1.effect).toMatchObject({ sync: "serversync", liveReload: true, mod: "Mod-Alpha", dll: "plugins/Mod/Alpha.dll" });
	});
	it("drops a copy that equals the live file again", () => {
		expect(out.afterUndo).toEqual({ configs: [], empty: true });
	});
	it("needs a restart for every config change and flags a hand edit as a conflict", () => {
		expect(out.plan3).toEqual({ restart: true, effect: "unknown", conflicts: [] });
		expect(out.conflicts).toEqual(["Other.cfg"]);
		expect(out.diff).toEqual([
			{ path: "Other.cfg", status: "changed", conflict: true, before: "[X]\nA = 3\n", changes: [{ section: "X", key: "A", from: "3", to: "2" }] },
		]);
		expect(out.refused).toContain("changed on the server meanwhile");
	});
	it("releases the staged file, records it in the manifest and clears the working state", () => {
		expect(out.report).toEqual({ written: ["Mod.Alpha.cfg"], stayedUp: false, restartRequired: true, backup: null, nothingToDo: false });
		expect(out.liveAfterRelease).toContain("Speed = 7");
		expect(out.pendingAfterRelease).toBeNull();
		expect(out.manifestConfigs).toEqual(["Mod.Alpha.cfg", "Other.cfg"]);
	});
	it("releases an empty working state to nothing", () => {
		expect(out.emptyRelease).toEqual({ nothingToDo: true, pending: null });
	});
});
