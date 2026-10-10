import { describe, expect, it } from "vitest";
import { parseDeepLink } from "./deeplink";

describe("parseDeepLink", () => {
	it("reads the companion import link", () => {
		const base = "http://10.10.10.123:9002";
		const raw = `valheim-mod-manager://import?url=${encodeURIComponent(`${base}/api/profile.r2z`)}&name=${encodeURIComponent("Peters Welte")}&link=${encodeURIComponent(base + "/")}`;
		expect(parseDeepLink(raw)).toEqual({ kind: "import", url: `${base}/api/profile.r2z`, name: "Peters Welte", link: base });
	});
	it("accepts the path form and tolerates a missing link", () => {
		expect(parseDeepLink("valheim-mod-manager:import?url=https%3A%2F%2Fx.y%2Fp.r2z")).toEqual({
			kind: "import",
			url: "https://x.y/p.r2z",
			name: "",
			link: null,
		});
	});
	it("rejects other schemes, actions and non-http urls", () => {
		expect(parseDeepLink("https://example.com/import?url=https://x.y/p.r2z")).toBeNull();
		expect(parseDeepLink("valheim-mod-manager://delete?url=https://x.y")).toBeNull();
		expect(parseDeepLink("valheim-mod-manager://import?url=file:///C:/x.r2z")).toBeNull();
		expect(parseDeepLink("not a url")).toBeNull();
	});
});
