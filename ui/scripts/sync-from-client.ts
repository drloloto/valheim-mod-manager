// Copies the client's design system into the companion UI, unchanged: tokens, the shadcn-svelte "vega" style,
// the shadcn primitives and the small kit components the companion uses. Run after a design change in the
// client: `bun run sync` (expects ../../modmanager-client next to the companion). The copies are committed so
// the Docker build does not need the client.
import { cp, mkdir, rm } from "fs/promises";
import { dirname, join, resolve } from "path";

const CLIENT = resolve(import.meta.dir, "..", "..", "..", "modmanager-client", "src", "lib");
const TARGET = resolve(import.meta.dir, "..", "src", "lib");

/** Whole folders under components/ui and single files elsewhere, relative to src/lib. */
const UI = ["button", "input", "label", "switch", "checkbox", "dialog", "separator", "sonner", "toggle", "toggle-group"];
const FILES = [
	"theme.css",
	"style-vega.css",
	"style-desktop.css",
	"utils.ts",
	"components/icon-placeholder/icon-placeholder.svelte",
	"components/kit/brand-mark.svelte",
	"components/kit/chip.svelte",
	"components/kit/confirm-dialog.svelte",
	"components/kit/empty-state.svelte",
	"components/kit/panel-section.svelte",
	"components/kit/section-label.svelte",
	"components/kit/segmented.svelte",
	"components/kit/setting-row.svelte",
	"components/kit/stat.svelte",
	"components/kit/toolbar.svelte",
];

for (const dir of UI) {
	const to = join(TARGET, "components", "ui", dir);
	await rm(to, { recursive: true, force: true });
	await cp(join(CLIENT, "components", "ui", dir), to, { recursive: true });
}
for (const f of FILES) {
	await mkdir(dirname(join(TARGET, f)), { recursive: true });
	await cp(join(CLIENT, f), join(TARGET, f));
}
await cp(resolve(CLIENT, "..", "..", "static", "favicon.svg"), resolve(import.meta.dir, "..", "static", "favicon.svg"));
console.log(`synced ${UI.length} ui folders and ${FILES.length + 1} files from ${CLIENT}`);
