// BepInEx .cfg files: parsed into settings with the metadata BepInEx writes as comments (type, default,
// acceptable values, "multiple values" hint, the [Synced with Server] tags of ServerSync/Jötunn), and edited
// value by value so only the changed lines are rewritten.
import { readFile } from "fs/promises";
import { join } from "path";
import { configRel } from "./configdir";
import { walkConfigs } from "./configdir";
import { writeAtomic } from "./fsutil";
import { BEPINEX_CONFIG_DIR } from "./paths";

function safePath(p: string) {
	const rel = configRel(p);
	if (!rel) throw new Error("invalid config path");
	return join(BEPINEX_CONFIG_DIR, rel);
}

export interface ConfigSetting {
	section: string;
	key: string;
	value: string;
	description: string; // accumulated "## ..." comment lines
	type?: string; // parsed from "# Setting type: X"
	defaultValue?: string; // parsed from "# Default value: X"
	acceptableValues?: string; // parsed from "# Acceptable values: ..." or "# Acceptable value range: ..."
	/** "# Multiple values can be set at the same time by separating them with ," (flags enum) */
	multiple?: boolean;
	/** the mod marks the entry "[Synced with Server]" (true) or "[Not Synced with Server]" (false) */
	synced?: boolean;
}

export interface ParsedConfig {
	file: string;
	settings: ConfigSetting[];
}

export const listConfigFiles = () => walkConfigs((name) => name.endsWith(".cfg"));

export function parseConfigText(raw: string): ConfigSetting[] {
	const lines = raw.split(/\r?\n/);
	const settings: ConfigSetting[] = [];
	let currentSection = "";
	let commentBuf: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		const sectionMatch = trimmed.match(/^\[(.+)\]$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1];
			commentBuf = [];
			continue;
		}
		if (trimmed.startsWith("#")) {
			commentBuf.push(trimmed.replace(/^#+\s?/, ""));
			continue;
		}
		if (trimmed === "") continue;
		const kvMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
		if (!kvMatch) continue;
		const key = kvMatch[1].trim();
		const value = kvMatch[2];
		const descLines: string[] = [];
		const s: ConfigSetting = { section: currentSection, key, value, description: "" };
		for (const c of commentBuf) {
			const typeMatch = c.match(/^Setting type:\s*(.*)$/i);
			const defMatch = c.match(/^Default value:\s*(.*)$/i);
			const accMatch = c.match(/^Acceptable (?:values|value range):\s*(.*)$/i);
			if (typeMatch) s.type = typeMatch[1];
			else if (defMatch) s.defaultValue = defMatch[1];
			else if (accMatch) s.acceptableValues = accMatch[1];
			else if (/^Multiple values can be set/i.test(c)) s.multiple = true;
			else descLines.push(c);
		}
		let description = descLines.join(" ").trim();
		if (/\[Not Synced with Server\]/i.test(description)) s.synced = false;
		else if (/\[Synced with Server\]/i.test(description)) s.synced = true;
		description = description
			.replace(/\s*\[(Not )?Synced with Server\]\s*/gi, " ")
			.replace(/\s{2,}/g, " ")
			.trim();
		s.description = description;
		settings.push(s);
		commentBuf = [];
	}
	return settings;
}

export async function parseConfigFile(relPath: string): Promise<ParsedConfig> {
	const raw = await readFile(safePath(relPath), "utf-8");
	return { file: relPath, settings: parseConfigText(raw) };
}

export interface ConfigChange {
	section: string;
	key: string;
	value: string;
}

/** The file text with the given values replaced in place; every other byte, comment and line ending stays. */
export function applyConfigChanges(raw: string, changes: ConfigChange[]): string {
	const lines = raw.split(/\r?\n/);
	const changeMap = new Map(changes.map((c) => [`${c.section}::${c.key}`, c.value]));
	let currentSection = "";
	const newLines = lines.map((line) => {
		const trimmed = line.trim();
		const sectionMatch = trimmed.match(/^\[(.+)\]$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1];
			return line;
		}
		if (trimmed.startsWith("#") || trimmed === "") return line;
		const kvMatch = line.match(/^([^=]+?)(\s*=\s*)(.*)$/);
		if (!kvMatch) return line;
		const mapKey = `${currentSection}::${kvMatch[1].trim()}`;
		return changeMap.has(mapKey) ? `${kvMatch[1]}${kvMatch[2]}${changeMap.get(mapKey)}` : line;
	});
	return newLines.join(raw.includes("\r\n") ? "\r\n" : "\n");
}

/** Edits the live file in place (atomic rename, owner and mode kept). The web UI stages edits in the working state instead; see releases.ts. */
export async function saveConfigChanges(relPath: string, changes: ConfigChange[]): Promise<void> {
	const abs = safePath(relPath);
	const raw = await readFile(abs, "utf-8");
	await writeAtomic(abs, applyConfigChanges(raw, changes));
}
