import { readFile } from "fs/promises";
import { join } from "path";
import { configRel, walkConfigs } from "./configdir";
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
	acceptableValues?: string; // parsed from "# Acceptable values: ..."
}

export interface ParsedConfig {
	file: string;
	settings: ConfigSetting[];
}

export const listConfigFiles = () => walkConfigs((name) => name.endsWith(".cfg"));

export async function parseConfigFile(relPath: string): Promise<ParsedConfig> {
	const abs = safePath(relPath);
	const raw = await readFile(abs, "utf-8");
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
		if (trimmed === "") {
			continue;
		}
		const kvMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
		if (kvMatch) {
			const key = kvMatch[1].trim();
			const value = kvMatch[2];
			const descLines: string[] = [];
			let type: string | undefined;
			let defaultValue: string | undefined;
			let acceptableValues: string | undefined;
			for (const c of commentBuf) {
				const typeMatch = c.match(/^Setting type:\s*(.*)$/i);
				const defMatch = c.match(/^Default value:\s*(.*)$/i);
				const accMatch = c.match(/^Acceptable (?:values|value range):\s*(.*)$/i);
				if (typeMatch) type = typeMatch[1];
				else if (defMatch) defaultValue = defMatch[1];
				else if (accMatch) acceptableValues = accMatch[1];
				else descLines.push(c);
			}
			settings.push({
				section: currentSection,
				key,
				value,
				description: descLines.join(" ").trim(),
				type,
				defaultValue,
				acceptableValues,
			});
			commentBuf = [];
		}
	}

	return { file: relPath, settings };
}

export async function saveConfigChanges(relPath: string, changes: { section: string; key: string; value: string }[]): Promise<void> {
	const abs = safePath(relPath);
	const raw = await readFile(abs, "utf-8");
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
		if (kvMatch) {
			const key = kvMatch[1].trim();
			const mapKey = `${currentSection}::${key}`;
			if (changeMap.has(mapKey)) {
				return `${kvMatch[1]}${kvMatch[2]}${changeMap.get(mapKey)}`;
			}
		}
		return line;
	});

	await writeAtomic(abs, newLines.join(raw.includes("\r\n") ? "\r\n" : "\n"));
}
