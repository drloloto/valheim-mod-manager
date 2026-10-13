import { describe, expect, it } from "bun:test";
import { deriveKey, makeSyncCode, newSecret, open, openJson, parseSyncCode, seal, sealJson } from "./synccrypto";

describe("sync code", () => {
	it("round-trips and validates its parts", () => {
		const c = { gistId: "a".repeat(32), secret: newSecret() };
		expect(parseSyncCode(makeSyncCode(c))).toEqual(c);
		expect(parseSyncCode(` ${makeSyncCode(c)}\n`)).toEqual(c);
		expect(() => parseSyncCode("vmm2.x.y")).toThrow("vmm1");
		expect(() => parseSyncCode("vmm1.ZZZ." + c.secret)).toThrow("gist id");
		expect(() => parseSyncCode(`vmm1.${c.gistId}.short`)).toThrow("secret");
	});
});

describe("seal / open", () => {
	const key = deriveKey(newSecret());
	it("round-trips text and binary", () => {
		const e = seal(key, "release.json", "hello ü");
		expect(e.alg).toBe("A256GCM");
		expect(e.comp).toBe("gzip");
		expect(() => open(key, "release.json", { ...e, comp: "br" })).toThrow("compression");
		// an uncompressed envelope (comp absent) still opens
		const big = seal(key, "server.json", "x".repeat(50_000));
		expect(big.data.length).toBeLessThan(2000);
		expect(open(key, "release.json", e).toString("utf-8")).toBe("hello ü");
		expect(openJson<{ a: number[] }>(key, "server.json", sealJson(key, "server.json", { a: [1, 2] }))).toEqual({ a: [1, 2] });
	});
	it("rejects another key, a tampered body and a foreign slot", () => {
		const e = seal(key, "release.json", "x");
		expect(() => open(deriveKey(newSecret()), "release.json", e)).toThrow("wrong secret");
		const flipped = Buffer.from(e.data, "base64");
		flipped[0] ^= 1;
		expect(() => open(key, "release.json", { ...e, data: flipped.toString("base64") })).toThrow("wrong secret");
		expect(() => open(key, "server.json", e)).toThrow("wrong secret");
		expect(() => open(key, "release.json", { v: 2 })).toThrow("not a sealed");
	});
	it("derives the documented key for the documented secret (interop vector)", () => {
		// The Mod Manager's Rust side must produce the same bytes: hkdf(sha256, ikm = base64url(secret), salt
		// "valheim-mod-manager-sync/v1", info "aes-256-gcm", 32).
		const k = deriveKey("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
		expect(k.toString("hex")).toBe("07c49509ba52d94805d55e48337efacccf1c69bb752024dd94238bdd60f9bbf3");
	});
});
