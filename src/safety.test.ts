import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { stopSeconds, MIN_STOP_SECONDS } from "./docker";

describe("stop timeout", () => {
	it("never goes below the world-save minimum, honours a longer stop_grace_period", () => {
		expect(stopSeconds(undefined)).toBe(MIN_STOP_SECONDS);
		expect(stopSeconds(10)).toBe(MIN_STOP_SECONDS);
		expect(stopSeconds(300)).toBe(300);
	});
});

describe("data safety scenarios (own process, real tar)", async () => {
	const root = await mkdtemp(join(tmpdir(), "companion-safety-"));
	const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "testing", "safety-scenario.ts")], {
		env: { ...process.env, CONFIG_DIR: join(root, "config"), BACKUP_DIR: join(root, "backups"), ENV_FILE: join(root, "valheim.env"), HOSTNAME: "" },
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

	it("restores world and configs atomically and cleans up", () => {
		expect(out.restore).toEqual({
			restored: ["worlds_local/W", "configs"],
			db: "v1-db",
			fwl: "v1-fwl",
			dbOld: null,
			other: "other",
			cfg: "v1-cfg",
			json: "v1-json",
			newCfg: null,
			plugin: "v2-plugin",
			pluginsInArchive: [],
			tmpLeft: [],
			partialLeft: [],
		});
	});
	it("backs up and restores a chunked world with its auto-backup folders", () => {
		expect(out.chunked).toEqual({
			members: [
				"worlds_local/C/",
				"worlds_local/C/_main.1.db2",
				"worlds_local/C_backup_auto-20261011-091040/",
				"worlds_local/C_backup_auto-20261011-091040/_main.0.db2",
			],
			main: "c1",
			auto: "c0",
		});
	});
	it("leaves the world alone when the archive does not have it", () => {
		expect(out.missingWorld.db).toBe("v1-db");
		expect(out.missingWorld.error).toContain("not in this backup");
	});
	it("refuses a restore when it cannot confirm the server is stopped", () => {
		expect(out.restoreWithoutDocker.ran).toBe(false);
		expect(out.restoreWithoutDocker.error).toContain("nothing was changed");
	});
	it("does not change anything when the backup fails", () => {
		expect(out.backupFails.ran).toBe(false);
		expect(out.backupFails.error).toContain("Backup failed");
	});
	it("takes a backup before every change", () => {
		expect(out.applyWithoutControl).toEqual({ value: "done", backupTaken: true, newBackups: 1, restartRequired: true });
	});
	it("proceeds on a fresh server without a world", () => {
		expect(out.freshServer).toEqual({ value: "ok", backup: null });
	});
});
