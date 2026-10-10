// The server's profile as an r2modman-compatible zip: export.r2x (YAML mod list) + BepInEx/config/*.
// The client imports it with its existing .r2z code path, so every manifest entry becomes a pinned mod.
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { strToU8, zipSync } from "fflate";
import { BEPINEX_CONFIG_DIR } from "./paths";
import { CONFIG_EXTS, type Manifest } from "./manifest";

const yamlStr = (s: string) => JSON.stringify(s);

export function buildR2x(profileName: string, mods: { id: string; version: string }[]): string {
	const lines = [`profileName: ${yamlStr(profileName)}`, "mods:"];
	for (const m of mods) {
		const [major = 0, minor = 0, patch = 0] = m.version.split(".").map((x) => Number.parseInt(x, 10) || 0);
		lines.push(`  - name: ${yamlStr(m.id)}`, "    version:", `      major: ${major}`, `      minor: ${minor}`, `      patch: ${patch}`, "    enabled: true");
	}
	return lines.join("\n") + "\n";
}

async function configFiles(dir: string): Promise<Record<string, Uint8Array>> {
	const out: Record<string, Uint8Array> = {};
	async function walk(sub: string) {
		const items = await readdir(join(dir, sub), { withFileTypes: true }).catch(() => []);
		for (const it of items) {
			const rel = sub ? `${sub}/${it.name}` : it.name;
			if (it.isDirectory()) await walk(rel);
			else if (CONFIG_EXTS.includes(it.name.split(".").pop()?.toLowerCase() ?? ""))
				out[`BepInEx/config/${rel}`] = new Uint8Array(await readFile(join(dir, rel)));
		}
	}
	await walk("");
	return out;
}

export async function buildR2z(m: Manifest, configDir = BEPINEX_CONFIG_DIR): Promise<Uint8Array> {
	const files = {
		"export.r2x": strToU8(buildR2x(m.server.name || m.server.world || "server", m.mods)),
		...(await configFiles(configDir)),
	};
	return zipSync(files, { level: 6 });
}
