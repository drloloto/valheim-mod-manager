import { describe, expect, it } from "vitest";
import { parseDeepLink } from "./deeplink";

const CODE = "vmm1.5f2964a03b693a8655578dfdcbd4b6b6.4okNMk4QDw6NEzsno2auxfX_CZ3Xs-XnfjeD0LCFp-M";

describe("parseDeepLink", () => {
	it("reads the companion import link", () => {
		const base = "http://10.10.10.123:9002";
		const raw = `valheim-mod-manager://import?url=${encodeURIComponent(`${base}/api/profile.r2z`)}&name=${encodeURIComponent("Peters Welte")}&link=${encodeURIComponent(base + "/")}`;
		expect(parseDeepLink(raw)).toEqual({ kind: "import", url: `${base}/api/profile.r2z`, name: "Peters Welte", link: base, code: null });
	});
	it("accepts the path form and tolerates a missing link", () => {
		expect(parseDeepLink("valheim-mod-manager:import?url=https%3A%2F%2Fx.y%2Fp.r2z")).toEqual({
			kind: "import",
			url: "https://x.y/p.r2z",
			name: "",
			link: null,
			code: null,
		});
	});
	it("reads a gist link by its sync code; the code wins over an r2z url", () => {
		expect(parseDeepLink(`valheim-mod-manager://import?code=${CODE}&name=Peters`)).toEqual({
			kind: "import",
			url: null,
			name: "Peters",
			link: null,
			code: CODE,
		});
		const both = parseDeepLink(
			`valheim-mod-manager://import?code=${encodeURIComponent(` ${CODE} `)}&url=${encodeURIComponent("http://h:9002/api/profile.r2z")}&link=http%3A%2F%2Fh%3A9002`,
		);
		expect(both).toEqual({ kind: "import", url: null, name: "", link: null, code: CODE });
	});
	it("falls back to the r2z url when the code is malformed", () => {
		expect(parseDeepLink("valheim-mod-manager://import?code=vmm1.nope&url=https%3A%2F%2Fx.y%2Fp.r2z")?.code).toBeNull();
		expect(parseDeepLink("valheim-mod-manager://import?code=vmm1.nope")).toBeNull();
	});
	it("accepts the dev scheme", () => {
		expect(parseDeepLink(`valheim-mod-manager-dev://import?code=${CODE}`)?.code).toBe(CODE);
	});
	it("rejects other schemes, actions and non-http urls", () => {
		expect(parseDeepLink("https://example.com/import?url=https://x.y/p.r2z")).toBeNull();
		expect(parseDeepLink("valheim-mod-manager://delete?url=https://x.y")).toBeNull();
		expect(parseDeepLink("valheim-mod-manager://import?url=file:///C:/x.r2z")).toBeNull();
		expect(parseDeepLink("not a url")).toBeNull();
	});
});
