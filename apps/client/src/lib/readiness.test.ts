import { describe, expect, it } from "vitest";
import type { Plan, ProfileMod } from "#lib/api/types.js";
import { computeReadiness } from "./readiness";

const mod = (ns: string, name: string, version = "1.0.0"): ProfileMod => ({ namespace: ns, name, version, enabled: true, source: "thunderstore" });
const plan = (p: Partial<Plan> = {}): Plan => ({ resolved: {}, toInstall: [], toRemove: [], errors: [], ...p });

describe("computeReadiness", () => {
	it("has nothing to say without a profile or a plan", () => {
		expect(computeReadiness({ active: null, mods: [], plan: null }, false).status).toBe("noProfile");
		expect(computeReadiness({ active: "p", mods: [], plan: null }, false).status).toBe("unknown");
	});

	it("is ready when the plan has nothing to install and no errors", () => {
		const r = computeReadiness({ active: "p", mods: [mod("a", "A")], plan: plan() }, false);
		expect(r).toEqual({ status: "ready", missing: [], errors: [] });
	});

	it("lists a missing dependency with what requires it", () => {
		const p = plan({
			resolved: { "a-A": { version: "1.0.0", requiredBy: [] }, "lib-Jotunn": { version: "2.30.2", requiredBy: ["a-A"] } },
			toInstall: [{ id: "lib-Jotunn", to: "2.30.2" }],
		});
		const r = computeReadiness({ active: "p", mods: [mod("a", "A")], plan: p }, false);
		expect(r.status).toBe("incomplete");
		expect(r.missing).toEqual([{ id: "lib-Jotunn", version: "2.30.2", explicit: false, requiredBy: ["a-A"] }]);
	});

	it("marks explicit mods and wrong versions as missing too", () => {
		const p = plan({ resolved: { "a-A": { version: "2.0.0", requiredBy: [] } }, toInstall: [{ id: "a-A", from: "1.0.0", to: "2.0.0" }] });
		const r = computeReadiness({ active: "p", mods: [mod("a", "A", "2.0.0")], plan: p }, false);
		expect(r.missing[0]).toMatchObject({ id: "a-A", explicit: true, version: "2.0.0" });
	});

	it("reports syncing while the installation runs, errors otherwise", () => {
		const p = plan({ toInstall: [{ id: "a-A", to: "1.0.0" }], errors: ["Package not found: x-Gone (required by a-A)"] });
		expect(computeReadiness({ active: "p", mods: [], plan: p }, true).status).toBe("syncing");
		const r = computeReadiness({ active: "p", mods: [], plan: p }, false);
		expect(r.status).toBe("incomplete");
		expect(r.errors).toEqual(["Package not found: x-Gone (required by a-A)"]);
		expect(computeReadiness({ active: "p", mods: [], plan: plan({ errors: ["x"] }) }, false).status).toBe("incomplete");
	});
});
