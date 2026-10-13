import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GistMailbox } from "./gist";
import { RELEASE_FILE, SERVER_FILE, syncOnce, type ServerFile, type SyncDeps, type SyncState } from "./gistsync";
import type { Manifest } from "./manifest";
import type { Release, Schedule } from "./releases";
import { deriveKey, newSecret, openJson, sealJson } from "./synccrypto";
import { startFakeGist } from "./testing/fakegist";

const manifest = (generatedAt: number): Manifest => ({
	schema: 1,
	generatedAt,
	server: { name: "S", world: "W", gameVersion: null, bepinex: null },
	mods: [{ id: "a-A", version: "1.0.0", explicit: true, requiredBy: [] }],
	configs: {},
	hash: "sha256:x",
});

const release = (id: string, manifestMods: unknown[] = []): Release => ({
	id,
	createdAt: 1,
	manifest: { ...manifest(1), mods: manifestMods as Manifest["mods"] },
	configs: ["a.cfg"],
	plan: { install: [{ id: "a-A", from: null, to: "1.0.0" }], remove: [], configsChanged: [], configsNew: ["a.cfg"] },
	problems: [],
	schedule: null,
	lastError: null,
});

describe("gist sync", () => {
	const fake = startFakeGist(0, "127.0.0.1");
	afterAll(() => fake.stop());

	let gistId: string;
	beforeAll(async () => {
		gistId = await GistMailbox.create("t", { [SERVER_FILE]: "{}", [RELEASE_FILE]: "{}" }, "test", fake.url);
	});

	function harness(opts: { canWrite?: boolean; secret?: string } = {}) {
		const secret = opts.secret ?? newSecret();
		const key = deriveKey(secret);
		const calls: string[] = [];
		let state: SyncState = { lastReleaseId: null, release: null, lastServerHash: null };
		let pending: Release | null = null;
		let current: Manifest | null = manifest(100);
		let clock = 1000;
		const deps: SyncDeps = {
			mailbox: new GistMailbox(gistId, "t", fake.url),
			key,
			canWrite: opts.canWrite ?? true,
			stage: async (body) => {
				calls.push(`stage:${JSON.stringify(body.mods)}:${body.configs?.length ?? 0}`);
				pending = release("r1", body.mods as unknown[]);
				return pending;
			},
			schedule: async (id, s: Schedule | null) => {
				calls.push(`schedule:${id}:${s?.when}`);
				pending!.schedule = s;
				return pending!;
			},
			apply: async (id) => {
				calls.push(`apply:${id}`);
				pending = null;
				current = manifest(clock + 1);
			},
			pending: async () => pending,
			snapshot: async () => ({ server: { name: "S", world: "W" }, manifest: current, configs: [{ path: "a.cfg", contentBase64: "YQ==" }], configsSkipped: [] }),
			loadState: async () => structuredClone(state),
			saveState: async (s) => {
				state = structuredClone(s);
			},
			log: (l) => calls.push(`log:${l}`),
			now: () => clock,
		};
		const admin = new GistMailbox(gistId, "t", fake.url);
		const publish = (rel: Record<string, unknown>, k = key) => admin.put(RELEASE_FILE, sealJson(k, RELEASE_FILE, rel));
		const serverFile = async () => openJson<ServerFile>(key, SERVER_FILE, fake.gists.get(gistId)![SERVER_FILE].content);
		return {
			deps,
			calls,
			publish,
			serverFile,
			state: () => state,
			tick: () => clock++,
			setPending: (p: Release | null) => (pending = p),
			setCurrent: (m: Manifest | null) => (current = m),
		};
	}

	it("publishes server.json once and stays quiet while nothing changes", async () => {
		const h = harness();
		expect(await syncOnce(h.deps)).toEqual({ handled: null, wrote: true });
		const s = await h.serverFile();
		expect(s.manifest?.mods[0].id).toBe("a-A");
		expect(s.configs[0]).toEqual({ path: "a.cfg", contentBase64: "YQ==" });
		expect(s.release).toBeNull();
		expect(await syncOnce(h.deps)).toEqual({ handled: null, wrote: false });
		expect(h.calls.filter((c) => c.startsWith("stage"))).toEqual([]);
		// the manifest is regenerated on every read (new generatedAt), the server did not change: still no write
		h.setCurrent(manifest(200));
		expect(await syncOnce(h.deps)).toEqual({ handled: null, wrote: false });
		h.setCurrent({ ...manifest(300), mods: [...manifest(300).mods, { id: "b-B", version: "1.0.0", explicit: true, requiredBy: [] }] });
		expect(await syncOnce(h.deps)).toEqual({ handled: null, wrote: true });
	});

	it("mailbox: a used-up write bucket is reported once and not retried before the reset", async () => {
		let hits = 0;
		const reset = String(Math.floor(Date.now() / 1000) + 1800);
		const srv = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => {
				hits++;
				return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-resource": "gist_update", "x-ratelimit-limit": "100", "x-ratelimit-reset": reset } });
			},
		});
		try {
			const box = new GistMailbox("a".repeat(32), "t", `http://127.0.0.1:${srv.port}`);
			await expect(box.put("x", "y")).rejects.toThrow("gist_update limit (100 per hour per user) is used up; it resets in 30 min");
			await expect(box.put("x", "y")).rejects.toThrow("gist_update");
			await expect(box.fetch()).rejects.toThrow("gist_update");
			await expect(box.fetch()).rejects.toThrow("gist_update");
			expect(hits).toBe(2);
		} finally {
			srv.stop(true);
		}
	});

	it("stages and applies a release written by the admin, exactly once", async () => {
		const h = harness();
		await h.publish({ v: 1, id: "rel-1", createdAt: 5, message: "hi", mods: [{ id: "b-B", version: "2.0.0" }], configs: [{ path: "a.cfg", contentBase64: "YQ==" }], apply: { when: "now" } });
		expect((await syncOnce(h.deps)).handled).toBe("rel-1");
		expect(h.calls.filter((c) => !c.startsWith("log"))).toEqual(['stage:[{"id":"b-B","version":"2.0.0"}]:1', "apply:r1"]);
		const s = await h.serverFile();
		expect(s.release).toMatchObject({ id: "rel-1", state: "applied", companionId: null, plan: { install: 1, remove: 0, configs: 1 } });
		expect(s.manifest?.generatedAt).toBeGreaterThan(100);
		// same file again: nothing happens
		expect(await syncOnce(h.deps)).toEqual({ handled: null, wrote: false });
		expect(h.calls.filter((c) => c.startsWith("apply")).length).toBe(1);
	});

	it("schedules, then reports applied when the companion's scheduler has run", async () => {
		const h = harness();
		await h.publish({ v: 1, id: "rel-2", createdAt: 5, mods: [], apply: { when: "at", at: 123 } });
		await syncOnce(h.deps);
		expect(h.calls).toContain("schedule:r1:at");
		expect((await h.serverFile()).release).toMatchObject({ id: "rel-2", state: "scheduled", companionId: "r1", schedule: { when: "at", at: 123 } });
		// the scheduler applied it: pending gone, manifest newer than handledAt
		h.tick();
		h.setPending(null);
		h.setCurrent(manifest(5000));
		await syncOnce(h.deps);
		expect((await h.serverFile()).release).toMatchObject({ id: "rel-2", state: "applied", companionId: null });
	});

	it("reports a scheduler failure and a discarded release", async () => {
		const h = harness();
		await h.publish({ v: 1, id: "rel-3", createdAt: 5, mods: [], apply: { when: "idle" } });
		await syncOnce(h.deps);
		const p = h.state().release!;
		expect(p.state).toBe("scheduled");
		h.setPending({ ...release("r1"), schedule: null, lastError: "cannot read the player count" });
		await syncOnce(h.deps);
		expect((await h.serverFile()).release).toMatchObject({ state: "failed", error: "cannot read the player count" });

		await h.publish({ v: 1, id: "rel-4", createdAt: 5, mods: [] });
		await syncOnce(h.deps);
		expect(h.state().release?.state).toBe("staged");
		h.setPending(null); // admin discarded it in the UI; the manifest did not move
		await syncOnce(h.deps);
		expect(h.state().release?.state).toBe("discarded");
	});

	it("rejects a release it cannot open or validate, without staging", async () => {
		const h = harness();
		await h.publish({ v: 1, id: "rel-5", createdAt: 5, mods: [] }, deriveKey(newSecret()));
		await syncOnce(h.deps);
		expect(h.calls.some((c) => c.startsWith("stage"))).toBe(false);
		expect(h.state().release).toMatchObject({ state: "rejected" });
		expect(h.state().release?.error).toContain("wrong secret");
		await h.publish({ v: 1, id: "rel-6", createdAt: 5, mods: [], apply: { when: "at" } });
		await syncOnce(h.deps);
		expect(h.state().release).toMatchObject({ id: "rel-6", state: "rejected" });
		expect(h.state().release?.error).toContain("apply.at");
		expect(h.calls.some((c) => c.startsWith("stage"))).toBe(false);
	});

	it("stays read-only without a token and still picks up releases", async () => {
		const h = harness({ canWrite: false });
		await h.publish({ v: 1, id: "rel-7", createdAt: 5, mods: [], apply: { when: "now" } });
		expect(await syncOnce(h.deps)).toEqual({ handled: "rel-7", wrote: false });
		expect(h.calls).toContain("apply:r1");
		expect(h.calls.some((c) => c.includes("no gist token"))).toBe(true);
	});

	it("mailbox: 304 on an unchanged gist, truncated files via raw_url", async () => {
		const box = new GistMailbox(gistId, "t", fake.url);
		expect(await box.fetch()).not.toBeNull();
		expect(await box.fetch()).toBeNull();
		await new GistMailbox(gistId, "t", fake.url).put("big.txt", "x".repeat(1_000_001));
		const files = (await box.fetch())!;
		expect(files["big.txt"].text.length).toBe(1_000_001);
		await expect(new GistMailbox(gistId, null, fake.url).put("x", "y")).rejects.toThrow("token");
		await expect(new GistMailbox("0".repeat(32), "t", fake.url).fetch()).rejects.toThrow("404");
	});
});
