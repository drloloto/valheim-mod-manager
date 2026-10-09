// localStorage with JSON, defensively: missing storage, broken JSON or a foreign shape yield the default.

export type Parser<T> = (raw: unknown) => T | null;

function area(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function readJson<T>(key: string, fallback: T, parse: Parser<T>): T {
	const raw = area()?.getItem(key);
	if (raw == null) return fallback;
	try {
		return parse(JSON.parse(raw)) ?? fallback;
	} catch {
		return fallback;
	}
}

export function writeJson(key: string, value: unknown): void {
	try {
		area()?.setItem(key, JSON.stringify(value));
	} catch {
		// full or blocked: ignore silently, the app keeps working without persistence
	}
}

export function removeKey(key: string): void {
	try {
		area()?.removeItem(key);
	} catch {
		// see above
	}
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
