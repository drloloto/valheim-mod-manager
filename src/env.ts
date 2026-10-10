// valheim.env of the game container: KEY=value lines, optionally quoted. Edits keep comments and order.
import { ENV_FILE } from "./paths";

export interface EnvEntry {
	key: string;
	value: string;
}

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

/** Applies changes in place; unknown keys are appended. Values are always written double-quoted. */
export function updateEnv(text: string, changes: Record<string, string>): string {
	const pending = new Map(Object.entries(changes));
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/).map((line) => {
		const m = line.match(LINE);
		if (!m || line.trim().startsWith("#") || !pending.has(m[1])) return line;
		const v = pending.get(m[1])!;
		pending.delete(m[1]);
		return `${m[1]}=${JSON.stringify(v)}`;
	});
	while (lines.length && lines[lines.length - 1] === "") lines.pop();
	for (const [k, v] of pending) lines.push(`${k}=${JSON.stringify(v)}`);
	return lines.join(eol) + eol;
}

export async function readEnv(): Promise<EnvEntry[]> {
	try {
		return parseEnv(await Bun.file(ENV_FILE).text());
	} catch {
		return [];
	}
}

export async function writeEnv(changes: Record<string, string>): Promise<EnvEntry[]> {
	for (const k of Object.keys(changes)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`invalid key: ${k}`);
	const text = await Bun.file(ENV_FILE)
		.text()
		.catch(() => "");
	await Bun.write(ENV_FILE, updateEnv(text, changes));
	return readEnv();
}

export async function envValue(key: string): Promise<string | null> {
	return (await readEnv()).find((e) => e.key === key)?.value ?? null;
}
