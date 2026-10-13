import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { GistSyncEnv, SyncHandle } from "./gistsync";
import { SyncError, SyncManager, loadSyncConfig } from "./syncsetup";
import { parseSyncCode } from "./synccrypto";
import { startFakeGist } from "./testing/fakegist";

const CODE = "vmm1.5f2964a03b693a8655578dfdcbd4b6b6.4okNMk4QDw6NEzsno2auxfX_CZ3Xs-XnfjeD0LCFp-M";

describe("sync setup", () => {
	let dir: string;
	const fake = startFakeGist(0, "127.0.0.1");
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "syncsetup-"));
	});
	afterAll(async () => {
		fake.stop();
		await rm(dir, { recursive: true, force: true });
	});

	const started: GistSyncEnv[] = [];
	const stopped: string[] = [];
	const start = (cfg: GistSyncEnv): SyncHandle => {
		started.push(cfg);
		const gistId = parseSyncCode(cfg.code!).gistId;
		return { gistId, canWrite: !!cfg.token, lastError: () => null, stop: () => stopped.push(gistId) };
	};
	const manager = (name: string, env: NodeJS.ProcessEnv = {}) =>
		new SyncManager({ start, file: join(dir, `${name}.json`), stateFile: join(dir, `${name}-state.json`), env: { COMPANION_GIST_API: fake.url, ...env } });

	it("reads the environment first, then the file, and is off without both", async () => {
		const file = join(dir, "cfg.json");
		expect((await loadSyncConfig({}, file)).source).toBe("none");
		await writeFile(file, JSON.stringify({ code: CODE, token: "file-token" }));
		const fromFile = await loadSyncConfig({}, file);
		expect(fromFile).toMatchObject({ source: "file", code: CODE, token: "file-token" });
		const fromEnv = await loadSyncConfig({ COMPANION_SYNC_CODE: "vmm1.aaaaaaaaaaaaaaaaaaaa.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, file);
		expect(fromEnv.source).toBe("env");
		expect(fromEnv.code).not.toBe(CODE);
		await writeFile(file, "not json");
		expect((await loadSyncConfig({}, file)).source).toBe("none");
	});

	it("creates a gist for a token, stores code and token owner-only, and starts the poller", async () => {
		const m = manager("create");
		await m.start();
		expect((await m.info()).enabled).toBe(false);
		const info = await m.setup("spike");
		expect(info.enabled).toBe(true);
		expect(info.source).toBe("file");
		expect(info.canWrite).toBe(true);
		const code = parseSyncCode(info.code!);
		expect(info.gistId).toBe(code.gistId);
		expect(started.at(-1)).toMatchObject({ code: info.code, token: "spike", api: fake.url });
		const saved = JSON.parse(await readFile(join(dir, "create.json"), "utf-8")) as { code: string; token: string };
		expect(saved).toMatchObject({ code: info.code, token: "spike" });
		if (process.platform !== "win32") expect((await stat(join(dir, "create.json"))).mode & 0o777).toBe(0o600);
		// a second manager on the same file picks the setup up
		const again = manager("create");
		await again.start();
		expect((await again.info()).code).toBe(info.code);
	});

	it("a new setup replaces the poller and drops the state of the old gist", async () => {
		const m = manager("replace");
		await writeFile(join(dir, "replace-state.json"), JSON.stringify({ lastReleaseId: "rel-1", release: null, lastServerHash: "x" }));
		const first = await m.setup("spike");
		expect(await readFile(join(dir, "replace-state.json"), "utf-8").catch(() => "gone")).toBe("gone");
		await writeFile(join(dir, "replace-state.json"), "{}");
		const second = await m.setup("spike");
		expect(second.code).not.toBe(first.code);
		expect(stopped).toContain(first.gistId!);
		expect(await readFile(join(dir, "replace-state.json"), "utf-8").catch(() => "gone")).toBe("gone");
	});

	it("joins an existing gist by code when the token can read it, and refuses otherwise", async () => {
		const m = manager("join");
		const created = await m.setup("spike");
		const other = manager("join2");
		const joined = await other.setup("spike", created.code!);
		expect(joined.code).toBe(created.code);
		await expect(other.setup("spike", "vmm1.nope.x")).rejects.toThrow("sync code");
		await expect(other.setup("spike", "vmm1.00000000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow("could not be read");
	});

	it("rejects an empty token and a setup over an environment code", async () => {
		const m = manager("env", { COMPANION_SYNC_CODE: CODE, COMPANION_GIST_TOKEN: "t" });
		await m.start();
		expect((await m.info()).source).toBe("env");
		await expect(m.setup("x")).rejects.toBeInstanceOf(SyncError);
		await expect(m.remove()).rejects.toThrow("COMPANION_SYNC_CODE");
		await expect(manager("empty").setup("  ")).rejects.toThrow("required");
	});

	it("remove stops the poller and forgets the file; the status summary follows", async () => {
		const m = manager("remove");
		const info = await m.setup("spike");
		expect(m.summary()).toEqual({ enabled: true, canWrite: true });
		const off = await m.remove();
		expect(off).toMatchObject({ enabled: false, code: null, source: "none" });
		expect(stopped).toContain(info.gistId!);
		expect(m.summary()).toEqual({ enabled: false, canWrite: false });
		expect(await readFile(join(dir, "remove.json"), "utf-8").catch(() => "gone")).toBe("gone");
	});
});
