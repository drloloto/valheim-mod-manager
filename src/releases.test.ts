import { describe, expect, it } from "bun:test";
import { summary, type Release } from "./releases";

describe("release summary", () => {
	it("counts the plan and keeps problems and schedule", () => {
		const r: Release = {
			id: "r1",
			createdAt: 1,
			manifest: { schema: 1, generatedAt: 1, server: { name: "s", world: "w", gameVersion: null, bepinex: null }, mods: [], configs: {}, hash: "" },
			configs: ["A.cfg", "B.cfg"],
			plan: { install: [{ id: "a-A", from: null, to: "1.0.0" }], remove: ["b-B"], configsChanged: ["A.cfg"], configsNew: ["B.cfg"] },
			problems: ["Download failed (c-C 1.0.0): HTTP 404"],
			schedule: { when: "idle", setAt: 2 },
			lastError: null,
		};
		expect(summary(r)).toEqual({
			id: "r1",
			createdAt: 1,
			install: 1,
			remove: 1,
			configs: 2,
			untracked: 0,
			problems: r.problems,
			schedule: r.schedule,
			lastError: null,
		});
	});
	it("counts hand-installed files the first apply moves aside", () => {
		const plan = { install: [], remove: [], configsChanged: [], configsNew: [], untracked: ["plugins/A.dll", "plugins/B/b.dll"] };
		const r = { id: "r2", createdAt: 1, configs: [], plan, problems: [], schedule: null, lastError: null } as unknown as Release;
		expect(summary(r).untracked).toBe(2);
	});
});
