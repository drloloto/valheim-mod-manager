import { describe, expect, it } from "bun:test";
import { formatEnvValue, parseEnv, updateEnv } from "./env";

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
	it("updates in place, keeps comments and quoting style, appends new keys", () => {
		const out = updateEnv(sample, {
			WORLD_NAME: "PetersWelte",
			SERVER_PUBLIC: "false",
		});
		expect(out).toBe('# server\nSERVER_NAME="My Server"\nWORLD_NAME="PetersWelte"\nSERVER_PASS=secret\nBEPINEX=true\nSERVER_PUBLIC=false\n');
	});
	it("leaves unchanged lines byte for byte, even when the page sends every key", () => {
		const all = Object.fromEntries(parseEnv(sample).map((e) => [e.key, e.value]));
		expect(updateEnv(sample, all)).toBe(sample);
	});
	it("keeps CRLF and trailing blank lines (the prod file) on a no-op and on an edit", () => {
		const prod = 'SERVER_NAME="PetersWelte"\r\nWORLD_NAME="PetersWelte" \r\nSERVER_PUBLIC=true\r\nBEPINEX=true\r\n\r\n';
		expect(updateEnv(prod, { SERVER_NAME: "PetersWelte", WORLD_NAME: "PetersWelte", SERVER_PUBLIC: "true" })).toBe(prod);
		expect(updateEnv(prod, { SERVER_PUBLIC: "false" })).toBe(prod.replace("SERVER_PUBLIC=true", "SERVER_PUBLIC=false"));
		expect(updateEnv(prod, { NEW: "x" })).toBe(`${prod}NEW=x\r\n`);
		expect(updateEnv("A=1", { B: "2" })).toBe("A=1\nB=2\n");
	});
	it("quotes so Docker Compose reads back the exact value", () => {
		expect(formatEnvValue("secret")).toBe("secret");
		expect(formatEnvValue("pa$$word")).toBe("'pa$$word'"); // single quotes: no $ interpolation
		expect(formatEnvValue("a #b")).toBe("'a #b'"); // bare would cut at the comment
		expect(formatEnvValue("My Server", "double")).toBe('"My Server"');
		expect(formatEnvValue("it's", "double")).toBe('"it\'s"');
		expect(() => formatEnvValue("it's $HOME")).toThrow();
		expect(() => formatEnvValue("a\nb")).toThrow();
	});
	it("switches a double-quoted line to single quotes when the value has a $", () => {
		expect(updateEnv('SERVER_PASS="old"\n', { SERVER_PASS: "n$w" })).toBe("SERVER_PASS='n$w'\n");
	});
});
