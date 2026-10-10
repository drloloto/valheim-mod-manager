// Valheim's player lists next to worlds_local: adminlist.txt, permittedlist.txt, bannedlist.txt.
// One id per line (Steam64 or PlayFab id), `//` comments; we keep a trailing `# name` note per line.
import { join } from "path";
import { CONFIG_DIR } from "./paths";

export type ListName = "admin" | "permitted" | "banned";
export const LIST_FILES: Record<ListName, string> = { admin: "adminlist.txt", permitted: "permittedlist.txt", banned: "bannedlist.txt" };

export interface PlayerEntry {
	id: string;
	note: string;
}

const ID_RE = /^[A-Za-z0-9_-]{5,64}$/;

export function parseList(text: string): PlayerEntry[] {
	const out: PlayerEntry[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("//") || line.startsWith("#")) continue;
		const [id, ...rest] = line.split(/\s+/);
		if (!ID_RE.test(id)) continue;
		out.push({ id, note: rest.join(" ").replace(/^[#/]+\s*/, "") });
	}
	return out;
}

export function formatList(entries: PlayerEntry[], header: string): string {
	const lines = [`// ${header}`, "// One id per line. Text after the id is a note and is ignored by the game."];
	for (const e of entries) {
		if (!ID_RE.test(e.id)) continue;
		lines.push(e.note ? `${e.id} # ${e.note.replace(/[\r\n]+/g, " ")}` : e.id);
	}
	return lines.join("\n") + "\n";
}

export async function readList(name: ListName): Promise<PlayerEntry[]> {
	const f = Bun.file(join(CONFIG_DIR, LIST_FILES[name]));
	return (await f.exists()) ? parseList(await f.text()) : [];
}

export async function writeList(name: ListName, entries: PlayerEntry[]): Promise<PlayerEntry[]> {
	const seen = new Set<string>();
	const clean = entries
		.filter((e) => e && typeof e.id === "string" && ID_RE.test(e.id) && !seen.has(e.id) && seen.add(e.id))
		.map((e) => ({ id: e.id, note: String(e.note ?? "").trim() }));
	await Bun.write(join(CONFIG_DIR, LIST_FILES[name]), formatList(clean, `${LIST_FILES[name]} managed by the companion`));
	return clean;
}

export async function readAllLists(): Promise<Record<ListName, PlayerEntry[]>> {
	return { admin: await readList("admin"), permitted: await readList("permitted"), banned: await readList("banned") };
}

// ---- Online players from the server log (best effort, the dedicated server has no query API) ----

export interface Session {
	id: string;
	name: string | null;
	joinedAt: string | null;
	leftAt: string | null;
}

const TS = /^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}): /;

/**
 * Walks log lines in order: "Got connection SteamID <id>" opens a session, the next
 * "Got character ZDOID from <name> :" names it, "Closing socket <id>" closes it.
 */
export function sessionsFromLog(lines: string[]): Session[] {
	const sessions: Session[] = [];
	const open = new Map<string, Session>();
	let lastJoined: Session | null = null;
	for (const raw of lines) {
		const line = raw.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+/, ""); // docker --timestamps prefix
		const ts = line.match(TS)?.[1] ?? null;
		let m = line.match(/Got connection SteamID (\S+)/);
		if (m) {
			const s: Session = { id: m[1], name: null, joinedAt: ts, leftAt: null };
			open.set(m[1], s);
			sessions.push(s);
			lastJoined = s;
			continue;
		}
		m = line.match(/Got character ZDOID from (.+?) :/);
		if (m && lastJoined && !lastJoined.name) {
			lastJoined.name = m[1];
			continue;
		}
		m = line.match(/Closing socket (\S+)/);
		if (m) {
			const s = open.get(m[1]);
			if (s) {
				s.leftAt = ts;
				open.delete(m[1]);
			}
		}
	}
	return sessions;
}

export const onlineFrom = (sessions: Session[]) => sessions.filter((s) => !s.leftAt);
