// The server's profile as an r2modman-compatible zip: export.r2x (YAML mod list) + BepInEx/config/*.
// The client imports it with its existing .r2z code path, so every manifest entry becomes a pinned mod.
import { readFile } from "fs/promises";
import { join } from "path";
import { strToU8, zipSync } from "fflate";
import { walkConfigs } from "./configdir";
import { BEPINEX_CONFIG_DIR } from "./paths";
import { isConfigFile, type Manifest } from "./manifest";

const yamlStr = (s: string) => JSON.stringify(s);

export function buildR2x(profileName: string, mods: { id: string; version: string; source?: string }[]): string {
	const lines = [`profileName: ${yamlStr(profileName)}`, "mods:"];
	for (const m of mods) {
		const [major = 0, minor = 0, patch = 0] = m.version.split(".").map((x) => Number.parseInt(x, 10) || 0);
		lines.push(`  - name: ${yamlStr(m.id)}`, "    version:", `      major: ${major}`, `      minor: ${minor}`, `      patch: ${patch}`, "    enabled: true");
		// Gale's field for a release only Hexium has; r2modman and the Mod Manager's import ignore it.
		if (m.source === "hexium") lines.push("    source: hexium");
	}
	return lines.join("\n") + "\n";
}

async function configFiles(dir: string): Promise<Record<string, Uint8Array>> {
	const out: Record<string, Uint8Array> = {};
	for (const rel of await walkConfigs(isConfigFile, dir)) out[`BepInEx/config/${rel}`] = new Uint8Array(await readFile(join(dir, rel)));
	return out;
}

export async function buildR2z(m: Manifest, configDir = BEPINEX_CONFIG_DIR): Promise<Uint8Array> {
	const files = {
		"export.r2x": strToU8(buildR2x(m.server.name || m.server.world || "server", m.mods)),
		...(await configFiles(configDir)),
	};
	return zipSync(files, { level: 6 });
}
