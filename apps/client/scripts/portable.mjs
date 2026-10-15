// Assembles the portable zip from a finished release build: the executable, the `portable` marker file
// and a short README go into dist/valheim-mod-manager-<version>-portable-win64(.zip).
// Used by `pnpm run tauri:build:portable` and by the release workflow.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const exe = join(root, "src-tauri", "target", "release", "valheim-mod-manager.exe");

if (!existsSync(exe)) {
	console.error(`No release build at ${exe}. Run \`pnpm run tauri:build:portable\` (or \`tauri build\`) first.`);
	process.exit(1);
}

const name = `valheim-mod-manager-${version}-portable-win64`;
const out = join(root, "dist");
const dir = join(out, name);
const zip = join(out, `${name}.zip`);

rmSync(dir, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(dir, { recursive: true });
copyFileSync(exe, join(dir, "valheim-mod-manager.exe"));
writeFileSync(join(dir, "portable"), "");
writeFileSync(
	join(dir, "README.txt"),
	[
		`Valheim Mod Manager ${version} (portable)`,
		"",
		"Keep the 'portable' file next to the executable: profiles, cache and settings then live in a 'data' folder here instead of %APPDATA%.",
		"Requires Windows 10/11 with WebView2 (preinstalled on Windows 11).",
		"Updates: portable builds do not self-update. Download the next zip and replace the executable; the 'data' folder stays.",
		"",
	].join("\r\n"),
);

if (process.platform !== "win32") {
	console.log(`Portable folder ready at ${dir}. Zipping uses PowerShell and only runs on Windows.`);
	process.exit(0);
}

execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${dir}' -DestinationPath '${zip}'`], { stdio: "inherit" });
console.log(`Portable zip: ${zip}`);
