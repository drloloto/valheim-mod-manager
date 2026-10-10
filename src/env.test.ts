import { describe, expect, it } from "bun:test";
import { parseEnv, updateEnv } from "./env";

const sample = '# server\nSERVER_NAME="My Server"\nWORLD_NAME="Neotopia" \nSERVER_PASS=secret\nBEPINEX=true\n';

describe("env", () => {
	it("parses quoted and bare values, skips comments", () => {
		expect(parseEnv(sample)).toEqual([
			{ key: "SERVER_NAME", value: "My Server" },
			{ key: "WORLD_NAME", value: "Neotopia" },
			{ key: "SERVER_PASS", value: "secret" },
			{ key: "BEPINEX", value: "true" },
		]);
	});
	it("updates in place, keeps comments, appends new keys", () => {
		const out = updateEnv(sample, {
			WORLD_NAME: "PetersWelte",
			SERVER_PUBLIC: "false",
		});
		expect(out).toBe('# server\nSERVER_NAME="My Server"\nWORLD_NAME="PetersWelte"\nSERVER_PASS=secret\nBEPINEX=true\nSERVER_PUBLIC="false"\n');
	});
});
