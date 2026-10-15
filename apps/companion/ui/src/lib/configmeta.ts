// What a BepInEx setting *is*, derived from the metadata the companion parses out of the .cfg comments
// (type, default, acceptable values, "multiple values" hint) and from the shape of the value itself. Each
// kind has a parser (raw text → structured), a formatter (structured → the exact text the .cfg holds) and a
// zod schema that explains what is wrong. The schema is advice: the editor's raw mode saves any single line.
import { z } from "zod";
import type { ConfigSetting } from "./types";

export type Kind =
	| { kind: "bool"; on: string; off: string }
	| { kind: "number"; integer: boolean; min?: number; max?: number }
	| { kind: "enum"; options: string[] }
	| { kind: "flags"; options: string[] }
	| { kind: "color" }
	| { kind: "vector"; axes: string[] }
	| { kind: "range" }
	| { kind: "records"; fields: number }
	| { kind: "text" };

export interface Problem {
	key: ProblemKey;
	vars?: Record<string, string | number>;
}
export type ProblemKey =
	| "cfg.err.number"
	| "cfg.err.integer"
	| "cfg.err.min"
	| "cfg.err.max"
	| "cfg.err.option"
	| "cfg.err.color"
	| "cfg.err.vector"
	| "cfg.err.range"
	| "cfg.err.records"
	| "cfg.err.line";

const INT_TYPES = /^(u?int(8|16|32|64)?|byte|sbyte|short|ushort|long|ulong)$/i;
const FLOAT_TYPES = /^(single|double|decimal|float)$/i;
const RECORD_ENTRY = /^[A-Za-z0-9_ .$-]+(:[^,:]*)+$/;

export const splitList = (s: string | undefined): string[] =>
	(s ?? "")
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

function recordFields(value: string | undefined): number | null {
	if (!value || value.includes("//")) return null;
	const entries = value.split(",").map((x) => x.trim());
	if (!entries.length || !entries.every((e) => RECORD_ENTRY.test(e))) return null;
	const counts = new Set(entries.map((e) => e.split(":").length));
	return counts.size === 1 ? [...counts][0] : null;
}

function vectorAxes(value: string | undefined): string[] | null {
	if (!value?.startsWith("{")) return null;
	try {
		const o = JSON.parse(value) as Record<string, unknown>;
		const keys = Object.keys(o);
		return keys.length >= 2 && keys.every((k) => typeof o[k] === "number") ? keys : null;
	} catch {
		return null;
	}
}

/** The editor kind for a setting. Order matters: explicit metadata first, then the value's shape. */
export function kindOf(s: ConfigSetting): Kind {
	const type = (s.type ?? "").trim();
	const sample = s.value || s.defaultValue || "";
	const options = splitList(s.acceptableValues);
	const range = s.acceptableValues?.match(/^From\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)$/i);

	if (/^bool(ean)?$/i.test(type) || /^(true|false)$/i.test(sample)) return { kind: "bool", on: "true", off: "false" };
	if (/^toggle$/i.test(type) || (options.length === 2 && options.includes("On") && options.includes("Off"))) return { kind: "bool", on: "On", off: "Off" };
	if (range || INT_TYPES.test(type) || FLOAT_TYPES.test(type)) {
		const integer = INT_TYPES.test(type) || (!FLOAT_TYPES.test(type) && /^-?\d+$/.test(sample));
		return { kind: "number", integer, min: range ? Number(range[1]) : undefined, max: range ? Number(range[2]) : undefined };
	}
	if (options.length >= 2) return s.multiple ? { kind: "flags", options } : { kind: "enum", options };
	if (/^color$/i.test(type) && /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(sample)) return { kind: "color" };
	const axes = vectorAxes(sample);
	if (axes && (/^vector/i.test(type) || !type || /^string$/i.test(type))) return { kind: "vector", axes };
	if (/^range$/i.test(type) || /^-?[\d.]+\s*-\s*-?[\d.]+$/.test(sample)) return { kind: "range" };
	const fields = recordFields(s.value) ?? recordFields(s.defaultValue);
	if (fields && fields >= 2) return { kind: "records", fields };
	return { kind: "text" };
}

/** Raw text → structured value for the editor controls. Never throws; malformed text comes back as the closest shape. */
export function parse(kind: Kind, raw: string): unknown {
	const v = raw.trim();
	switch (kind.kind) {
		case "bool":
			return v.toLowerCase() === kind.on.toLowerCase();
		case "number":
			return v === "" ? NaN : Number(v);
		case "enum":
			return v;
		case "flags":
			return splitList(v).filter((x) => x !== "0");
		case "color":
			return v.toUpperCase();
		case "vector": {
			try {
				const o = JSON.parse(v) as Record<string, unknown>;
				return Object.fromEntries(kind.axes.map((a) => [a, typeof o[a] === "number" ? o[a] : NaN]));
			} catch {
				return Object.fromEntries(kind.axes.map((a) => [a, NaN]));
			}
		}
		case "range": {
			const m = v.match(/^(-?[\d.]+)\s*-\s*(-?[\d.]+)$/);
			return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
		}
		case "records":
			return v === ""
				? []
				: v.split(",").map((e) => {
						const f = e.trim().split(":");
						while (f.length < kind.fields) f.push("");
						return f;
					});
		case "text":
			return raw;
	}
}

const num = (n: number) => (Number.isFinite(n) ? String(n) : "");

/** Structured value → the text the .cfg line holds (what BepInEx itself writes for that type). */
export function format(kind: Kind, value: unknown): string {
	switch (kind.kind) {
		case "bool":
			return value ? kind.on : kind.off;
		case "number":
			return num(value as number);
		case "enum":
			return (value as string | undefined) ?? "";
		case "flags": {
			const list = (value as string[]).filter(Boolean);
			return list.length ? list.join(", ") : kind.options.includes("None") ? "None" : "0";
		}
		case "color":
			return ((value as string | undefined) ?? "").toUpperCase();
		case "vector": {
			const o = value as Record<string, number>;
			return JSON.stringify(Object.fromEntries(kind.axes.map((a) => [a, o[a]])));
		}
		case "range": {
			const [a, b] = value as [number, number];
			return `${num(a)} - ${num(b)}`;
		}
		case "records":
			return (value as string[][]).map((f) => f.map((x) => x.trim()).join(":")).join(",");
		case "text":
			return (value as string | undefined) ?? "";
	}
}

const finite = (key: ProblemKey) => z.number({ error: () => key }).refine((n) => Number.isFinite(n), { error: key });

/** The zod schema for a kind; its issue messages are message keys (see `check`). */
export function schemaFor(kind: Kind): z.ZodType {
	switch (kind.kind) {
		case "bool":
			return z.boolean();
		case "number": {
			let n = finite("cfg.err.number");
			if (kind.integer) n = n.refine(Number.isInteger, { error: "cfg.err.integer" });
			if (kind.min !== undefined) n = n.refine((x) => x >= kind.min!, { error: "cfg.err.min" });
			if (kind.max !== undefined) n = n.refine((x) => x <= kind.max!, { error: "cfg.err.max" });
			return n;
		}
		case "enum":
			return z.enum(kind.options as [string, ...string[]], { error: () => "cfg.err.option" });
		case "flags":
			return z.array(z.enum(kind.options as [string, ...string[]], { error: () => "cfg.err.option" }));
		case "color":
			return z.string().regex(/^[0-9A-F]{6}([0-9A-F]{2})?$/, { error: "cfg.err.color" });
		case "vector":
			return z.object(Object.fromEntries(kind.axes.map((a) => [a, finite("cfg.err.vector")])));
		case "range":
			return z.tuple([finite("cfg.err.range"), finite("cfg.err.range")]).refine(([a, b]) => a <= b, { error: "cfg.err.range" });
		case "records":
			return z.array(
				z
					.array(z.string())
					.length(kind.fields, { error: "cfg.err.records" })
					.refine((f) => f[0].trim() !== "", { error: "cfg.err.records" }),
			);
		case "text":
			return z.string();
	}
}

/** Problems with a raw value for its kind, or null. A line break is the one thing even raw mode refuses. */
export function check(kind: Kind, raw: string): Problem | null {
	if (/[\r\n\0]/.test(raw)) return { key: "cfg.err.line" };
	if (kind.kind === "text") return null;
	const r = schemaFor(kind).safeParse(parse(kind, raw));
	if (r.success) return null;
	const key = (r.error.issues[0]?.message ?? "cfg.err.number") as ProblemKey;
	const vars: Record<string, string | number> = {};
	if (kind.kind === "number") {
		vars.min = kind.min ?? "";
		vars.max = kind.max ?? "";
	}
	if (kind.kind === "enum" || kind.kind === "flags") vars.options = kind.options.slice(0, 8).join(", ") + (kind.options.length > 8 ? ", …" : "");
	if (kind.kind === "records") vars.fields = kind.fields;
	return { key, vars };
}

/** Same value as the default, comparing by kind (so "1.0" equals "1" and "A, B" equals "B,A" for flags). */
export function isDefault(s: ConfigSetting, raw: string, kind = kindOf(s)): boolean {
	if (s.defaultValue === undefined) return true;
	if (raw === s.defaultValue) return true;
	switch (kind.kind) {
		case "number":
			return Number(raw) === Number(s.defaultValue);
		case "flags":
			return [...(parse(kind, raw) as string[])].sort().join() === [...(parse(kind, s.defaultValue) as string[])].sort().join();
		case "bool":
			return parse(kind, raw) === parse(kind, s.defaultValue);
		default:
			return false;
	}
}

export interface SearchHit {
	file: string;
	setting: ConfigSetting;
	score: number;
}

/** Settings across all files matching every word of `query` in key, section, description, value or file name; best first. */
export function searchSettings(index: Record<string, ConfigSetting[]>, query: string, limit = 150): SearchHit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const hits: SearchHit[] = [];
	for (const [file, settings] of Object.entries(index)) {
		const f = file.toLowerCase();
		for (const s of settings) {
			const key = s.key.toLowerCase();
			const sec = s.section.toLowerCase();
			const desc = s.description.toLowerCase();
			const val = s.value.toLowerCase();
			let score = 0;
			for (const w of words) {
				if (key === w) score += 10;
				else if (key.startsWith(w)) score += 6;
				else if (key.includes(w)) score += 4;
				else if (sec.includes(w)) score += 3;
				else if (val.includes(w)) score += 2;
				else if (desc.includes(w)) score += 1;
				else if (f.includes(w)) score += 1;
				else {
					score = 0;
					break;
				}
			}
			if (score) hits.push({ file, setting: s, score });
		}
	}
	return hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.setting.key.localeCompare(b.setting.key)).slice(0, limit);
}

export const settingId = (file: string, s: ConfigSetting) => `${file}::${s.section}::${s.key}`;
