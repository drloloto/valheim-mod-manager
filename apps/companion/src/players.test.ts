import { describe, expect, it } from "bun:test";
import { formatList, onlineFrom, parseList, sessionsFromLog } from "./players";

describe("player lists", () => {
	it("parses ids with notes and skips comments", () => {
		const txt = "// comment\n76561198024931988 # Basti\n\nABC123DEF456\nbad id here!\n# other\n";
		expect(parseList(txt)).toEqual([
			{ id: "76561198024931988", note: "Basti" },
			{ id: "ABC123DEF456", note: "" },
		]);
		const out = formatList(parseList(txt), "adminlist.txt");
		expect(out).toContain("76561198024931988 # Basti\n");
		expect(out).toContain("ABC123DEF456\n");
		expect(parseList(out)).toEqual(parseList(txt));
	});
});

describe("sessionsFromLog", () => {
	it("pairs connections with names and disconnects", () => {
		const lines = [
			"10/10/2026 16:08:30: Got connection SteamID 76561198000000001",
			"10/10/2026 16:08:39: Got character ZDOID from Basti : 123:1",
			"10/10/2026 16:10:00: Got connection SteamID 76561198000000002",
			"10/10/2026 16:10:05: Got character ZDOID from Peter : 124:1",
			"10/10/2026 16:20:00: Closing socket 76561198000000001",
		];
		const s = sessionsFromLog(lines);
		expect(s).toHaveLength(2);
		expect(s[0]).toEqual({ id: "76561198000000001", name: "Basti", joinedAt: "10/10/2026 16:08:30", leftAt: "10/10/2026 16:20:00" });
		expect(onlineFrom(s).map((x) => x.name)).toEqual(["Peter"]);
	});
});
