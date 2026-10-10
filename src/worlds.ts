// Worlds in /config/worlds_local. Two on-disk shapes exist: classic `<name>.db` + `<name>.fwl` (plus
// `_backup_*` copies) and the chunked format where `<name>/` is a folder of .db2/.fwl2/.chunk files.
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { WORLDS_DIR } from "./paths";
import { dirSize } from "./install";

export interface World {
	name: string;
	/** directory entries in worlds_local that belong to this world */
	entries: string[];
	size: number;
	lastSave: number | null;
}

export function worldOfEntry(entry: string, isDir: boolean): string {
	if (isDir) return entry;
	return entry
		.split(".")[0]
		.replace(/_backup_.*$/, "")
		.replace(/_main$/, "");
}

export async function listWorlds(): Promise<World[]> {
	const items = await readdir(WORLDS_DIR, { withFileTypes: true }).catch(() => []);
	const byName = new Map<string, World>();
	for (const it of items) {
		const name = worldOfEntry(it.name, it.isDirectory());
		if (!name) continue;
		const w = byName.get(name) ?? {
			name,
			entries: [],
			size: 0,
			lastSave: null,
		};
		w.entries.push(it.name);
		const path = join(WORLDS_DIR, it.name);
		w.size += await dirSize(path);
		const s = await stat(path).catch(() => null);
		if (s && (!w.lastSave || s.mtimeMs > w.lastSave)) w.lastSave = s.mtimeMs;
		byName.set(name, w);
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function worldEntries(name: string): Promise<string[]> {
	return (await listWorlds()).find((w) => w.name === name)?.entries ?? [];
}
