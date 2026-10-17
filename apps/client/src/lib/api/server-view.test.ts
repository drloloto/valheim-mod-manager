import { describe, expect, it } from "vite-plus/test";
import { releaseLabel, serverView } from "./server-view";
import type { ServerCheck } from "./types";

const t = (key: string, p?: Record<string, string | number>) => (p ? `${key}:${Object.values(p).join(",")}` : key);

const base: ServerCheck = {
	reachable: true,
	name: "S",
	world: "W",
	inSync: true,
	diff: { onlyServer: [], onlyLocal: [], dropped: [], changed: [] },
	serverMods: 1,
	serverConfigs: 0,
	hash: "h",
	generatedAt: 0,
	features: {},
	release: null,
	online: null,
	configsChanged: [],
	gistRelease: null,
	current: null,
};
const differs: ServerCheck = {
	...base,
	inSync: false,
	diff: { onlyServer: [{ id: "a-A", version: "1", explicit: true, requiredBy: [] }], onlyLocal: [], dropped: [], changed: [] },
	configsChanged: ["x.cfg", "y.cfg"],
};
const droppedOne: ServerCheck = {
	...base,
	inSync: false,
	diff: {
		onlyServer: [],
		onlyLocal: [{ id: "me-Mine", version: "1", explicit: true, requiredBy: [] }],
		dropped: [{ id: "a-A", version: "1", explicit: true, requiredBy: [] }],
		changed: [],
	},
};
const staged: ServerCheck = {
	...base,
	gistRelease: { id: "r", companionId: "c", state: "staged", handledAt: 0, problems: [], error: null, schedule: null, plan: null },
};

describe("serverView: one reading for chip, status bar and dialogs", () => {
	it("checking and unreachable look the same for everyone and re-check on click", () => {
		expect(serverView(null, false, t)).toMatchObject({ kind: "checking", pulse: true, action: "refresh" });
		expect(serverView({ ...base, reachable: false, error: "x" }, true, t)).toMatchObject({ kind: "unreachable", tone: "err", action: "refresh" });
	});

	it("a player who differs from the server is sent to adopt, counts first", () => {
		const v = serverView(differs, false, t);
		expect(v).toMatchObject({ kind: "differs", action: "diff", release: null });
		expect(v.text).toBe("chip.differs:chip.mods:1");
	});

	it("an admin who differs is sent to publish", () => {
		expect(serverView(differs, true, t)).toMatchObject({ kind: "differs", action: "publish" });
	});

	it("a mod the server dropped counts for players and admins; a player's own extra only for admins", () => {
		expect(serverView(droppedOne, false, t)).toMatchObject({ kind: "differs", text: "chip.differs:chip.mods:1" });
		expect(serverView(droppedOne, true, t)).toMatchObject({ kind: "differs", text: "chip.differs:chip.mods:2" });
	});

	it("a waiting release: the admin follows it, the player is only told and still sees a difference first", () => {
		expect(serverView(staged, true, t)).toMatchObject({ kind: "pending", text: "chip.releaseStaged", action: "publish", release: "staged" });
		expect(serverView(staged, false, t)).toMatchObject({ kind: "pending", text: "chip.updateComing", action: "refresh" });
		// An empty profile linked to a server with a staged release: the player must adopt, the release is secondary.
		expect(serverView({ ...differs, gistRelease: staged.gistRelease }, false, t)).toMatchObject({ kind: "differs", action: "diff", release: "staged" });
		// The admin after a publish: their profile is ahead by definition, the release is the news.
		expect(serverView({ ...differs, gistRelease: staged.gistRelease }, true, t)).toMatchObject({ kind: "pending", release: "staged" });
	});

	it("an HTTP companion's pending release counts too, scheduled when it has a schedule", () => {
		const release: ServerCheck["release"] = {
			id: "r1",
			createdAt: 1,
			install: 0,
			remove: 0,
			configs: 0,
			problems: [],
			schedule: { when: "idle", setAt: 1 },
			lastError: null,
		};
		expect(serverView({ ...base, release }, true, t)).toMatchObject({ kind: "pending", release: "scheduled", text: "chip.releaseScheduled" });
	});

	it("in sync: nothing to do, an admin may still open publish", () => {
		expect(serverView(base, false, t)).toMatchObject({ kind: "inSync", tone: "ok", action: "refresh" });
		expect(serverView(base, true, t)).toMatchObject({ kind: "inSync", action: "publish" });
	});
});

describe("releaseLabel", () => {
	it("names the release or says none is recorded", () => {
		expect(releaseLabel(null, t)).toBe("server.currentNone");
		expect(releaseLabel({ id: "r1", name: "Hardcore", appliedAt: 1000, source: "client" }, t, 1000 + 3_600_000)).toMatch(/^server.currentLine:Hardcore,r1,/);
		expect(releaseLabel({ id: "r2", name: null, appliedAt: 0, source: "web" }, t, 60_000)).toMatch(/^server.currentLine:server.releaseWeb,r2,/);
	});
});
