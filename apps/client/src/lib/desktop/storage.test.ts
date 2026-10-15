import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readJson, removeKey, writeJson } from "./storage";

// vitest runs in Node: a tiny in-memory stand-in with the Storage interface
function fakeStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k) => m.get(k) ?? null,
		key: (i) => [...m.keys()][i] ?? null,
		removeItem: (k) => void m.delete(k),
		setItem: (k, v) => void m.set(k, String(v)),
	};
}

const parse = (v: unknown) => (typeof v === "number" ? v : null);

describe("storage", () => {
	beforeEach(() => Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true }));
	afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

	it("round-trips JSON and falls back on missing key", () => {
		expect(readJson("k", 7, parse)).toBe(7);
		writeJson("k", 42);
		expect(readJson("k", 7, parse)).toBe(42);
		removeKey("k");
		expect(readJson("k", 7, parse)).toBe(7);
	});

	it("falls back on broken JSON or wrong shape", () => {
		localStorage.setItem("k", "{not json");
		expect(readJson("k", 7, parse)).toBe(7);
		localStorage.setItem("k", JSON.stringify("text"));
		expect(readJson("k", 7, parse)).toBe(7);
	});

	it("works without any storage", () => {
		Reflect.deleteProperty(globalThis, "localStorage");
		expect(readJson("k", 7, parse)).toBe(7);
		expect(() => writeJson("k", 1)).not.toThrow();
	});
});
