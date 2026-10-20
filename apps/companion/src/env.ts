// valheim.env of the game container: KEY=value lines, optionally quoted. Edits keep comments, order and
// every line that did not change. Docker Compose reads env_file only when it creates the container, so an
// edit takes effect with `docker compose up -d <service>`, not with a restart.
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { ENV_FILE, ENV_HISTORY_DIR } from "./paths";

export interface EnvEntry {
	key: string;
	value: string;
}

/** The image's default when WORLD_NAME is not set. */
export const DEFAULT_WORLD = "Dedicated";
const HISTORY_KEEP = 20;

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(v: string): string {
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
	return v;
}

export function parseEnv(text: string): EnvEntry[] {
	const out: EnvEntry[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const m = line.match(LINE);
		if (m) out.push({ key: m[1], value: unquote(m[2]) });
	}
	return out;
}

type Style = "bare" | "double" | "single";
const styleOf = (raw: string): Style => (raw.startsWith('"') ? "double" : raw.startsWith("'") ? "single" : "bare");

/**
 * Writes a value so Docker Compose reads back exactly that value. Compose expands `$VAR` in bare and
 * double-quoted values and treats ` #` as a comment; single quotes are literal. The line's previous style is
 * kept when it is safe for the new value.
 */
export function formatEnvValue(value: string, prev: Style = "bare"): string {
	if (/[\r\n\0]/.test(value)) throw new Error("values cannot contain line breaks");
	const bareSafe = /^[A-Za-z0-9_.,:/@+%=-]*$/.test(value);
	const doubleSafe = !/[$"\\`]/.test(value);
	if (prev === "bare" && bareSafe) return value;
	if (prev === "double" && doubleSafe) return `"${value}"`;
	if (!value.includes("'")) return `'${value}'`;
	if (doubleSafe) return `"${value}"`;
	throw new Error("a value with both ' and $, \" or \\ cannot be written safely; edit valheim.env by hand");
}

/**
 * Applies changes in place; everything else (unchanged lines, line endings, blank lines) stays byte for byte,
 * so a no-op edit leaves the file identical. Unknown keys are appended.
 */
export function updateEnv(text: string, changes: Record<string, string>): string {
	const pending = new Map(Object.entries(changes));
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	// Even indices are lines, odd ones the line break that followed them.
	const parts = text.split(/(\r?\n)/);
	for (let i = 0; i < parts.length; i += 2) {
		const line = parts[i];
		const m = line.match(LINE);
		if (!m || line.trim().startsWith("#") || !pending.has(m[1])) continue;
		const v = pending.get(m[1])!;
		pending.delete(m[1]);
		if (unquote(m[2]) !== v) parts[i] = `${m[1]}=${formatEnvValue(v, styleOf(m[2]))}`;
	}
	let out = parts.join("");
	if (pending.size && out && !out.endsWith("\n")) out += eol;
	for (const [k, v] of pending) out += `${k}=${formatEnvValue(v)}${eol}`;
	return out;
}

export async function readEnv(): Promise<EnvEntry[]> {
	try {
		return parseEnv(await Bun.file(ENV_FILE).text());
	} catch {
		return [];
	}
}

/** Keeps a copy of the current file before it is changed; the newest HISTORY_KEEP copies stay. */
async function keepCopy(text: string): Promise<string> {
	await mkdir(ENV_HISTORY_DIR, { recursive: true });
	const file = join(ENV_HISTORY_DIR, `valheim.env.${new Date().toISOString().replace(/[:.]/g, "-")}`);
	await writeFile(file, text);
	const old = (await readdir(ENV_HISTORY_DIR)).filter((f) => f.startsWith("valheim.env.")).sort();
	for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) await rm(join(ENV_HISTORY_DIR, f), { force: true });
	return file;
}

export interface EnvWrite {
	entries: EnvEntry[];
	changed: boolean;
	/** copy of the previous file, null when nothing changed */
	previous: string | null;
}

export async function writeEnv(changes: Record<string, string>): Promise<EnvWrite> {
	for (const [k, v] of Object.entries(changes)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`invalid key: ${k}`);
		if (typeof v !== "string") throw new Error(`value of ${k} must be a string`);
	}
	const text = await Bun.file(ENV_FILE)
		.text()
		.catch(() => "");
	const next = updateEnv(text, changes);
	if (next === text) return { entries: await readEnv(), changed: false, previous: null };
	const previous = await keepCopy(text);
	// In place, not via rename: the file is a single-file bind mount and must stay the host's file.
	await writeFile(ENV_FILE, next);
	return { entries: await readEnv(), changed: true, previous };
}

export async function envValue(key: string): Promise<string | null> {
	return (await readEnv()).find((e) => e.key === key)?.value ?? null;
}

export const activeWorld = async () => (await envValue("WORLD_NAME")) || DEFAULT_WORLD;
