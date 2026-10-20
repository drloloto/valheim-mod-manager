import { describe, expect, it } from "vite-plus/test";
import type { ProfileMod, TransferItem } from "#lib/api/types.js";
import { decisionOf, groupItems, lockedIds, summarize, toChoices } from "./transfer-view";

const item = (id: string, c: TransferItem["case"], extra: Partial<TransferItem> = {}): TransferItem => ({
	id,
	ns: id.split("-")[0],
	name: id.split("-")[1],
	case: c,
	from: c === "add" ? null : "1.0.0",
	to: c === "dropped" || c === "extra" ? null : "1.1.0",
	local: false,
	locked: false,
	managed: c !== "dropped" && c !== "extra",
	side: null,
	decision: c === "extra" ? "keep" : "take",
	choices: c === "extra" ? ["keep", "remove"] : c === "dropped" ? ["take", "keep"] : ["take"],
	...extra,
});

describe("transfer review", () => {
	const items = [
		item("a-A", "same"),
		item("b-B", "version"),
		item("c-C", "add"),
		item("d-D", "dropped"),
		item("e-E", "extra", { side: "server" }),
		item("local-F", "extra", { local: true }),
		// recommended by the server, not in the target: install by default, never managed
		item("g-G", "optional", { from: null, to: "1.0.0", managed: false, choices: ["take", "keep"] }),
	];

	it("groups in review order and skips empty groups", () => {
		expect(groupItems(items).map((g) => g.case)).toEqual(["version", "add", "optional", "dropped", "extra", "same"]);
		expect(groupItems([item("a-A", "add")]).map((g) => g.case)).toEqual(["add"]);
	});

	it("takes a choice only when the item allows it", () => {
		expect(decisionOf(items[1], new Map([["b-B", "keep"]]))).toBe("take");
		expect(decisionOf(items[4], new Map([["e-E", "remove"]]))).toBe("remove");
		expect(decisionOf(items[3], new Map())).toBe("take");
	});

	it("summarizes what a run does", () => {
		expect(summarize(items, new Map())).toEqual({ install: 2, change: 1, remove: 1, lock: 3, keep: 2, serverSideKept: 1 });
		const chosen = new Map<string, "keep" | "remove">([
			["d-D", "keep"],
			["e-E", "remove"],
			["g-G", "keep"],
		]);
		// skipping the recommended mod is no change at all
		expect(summarize(items, chosen)).toEqual({ install: 1, change: 1, remove: 1, lock: 3, keep: 2, serverSideKept: 0 });
		expect(toChoices(chosen)).toEqual([
			{ id: "d-D", decision: "keep" },
			{ id: "e-E", decision: "remove" },
			{ id: "g-G", decision: "keep" },
		]);
		// a recommended mod the target has in another version: taking the server's is a version change
		const have = item("h-H", "optional", { from: "1.0.0", to: "2.0.0", managed: false, decision: "keep", choices: ["keep", "take"] });
		expect(summarize([have], new Map()).change).toBe(0);
		expect(summarize([have], new Map([["h-H", "take"]])).change).toBe(1);
	});
});

describe("locks", () => {
	const mods: ProfileMod[] = [
		{ namespace: "a", name: "A", version: "1", enabled: true, source: "thunderstore", managed: true },
		{ namespace: "b", name: "B", version: "1", enabled: true, source: "thunderstore" },
	];
	it("locks managed entries until the override", () => {
		expect([...lockedIds(mods, false)]).toEqual(["a-A"]);
		expect(lockedIds(mods, true).size).toBe(0);
	});
});
