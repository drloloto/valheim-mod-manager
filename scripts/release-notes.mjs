// Writes the CHANGELOG.md section of the current package.json version to dist/release-notes.md, which the
// release workflow uses as the GitHub release body. Fails when the version has no section yet.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const start = changelog.indexOf(`## [${version}]`);
if (start < 0) {
	console.error(`CHANGELOG.md has no "## [${version}]" section.`);
	process.exit(1);
}
const rest = changelog.slice(changelog.indexOf("\n", start) + 1);
const end = rest.search(/^## \[/m);
const section = (end < 0 ? rest : rest.slice(0, end)).trim();

const notes = [
	section,
	"",
	"---",
	"",
	'Installers are unsigned; Windows SmartScreen will warn on first start ("More info → Run anyway"). The',
	"portable zip needs no installation. Installed versions update themselves to this release on confirmation.",
	"",
].join("\n");

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "release-notes.md"), notes);
console.log(`dist/release-notes.md (${version}, ${section.split("\n").length} lines)`);
