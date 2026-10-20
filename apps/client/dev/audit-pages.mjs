// Every page of the mock preview at the minimum window, in German: one screenshot and layout audit each,
// through dev/screenshot.mjs. Fails only when a page does not render; audit findings are printed for review.
//
//   bun run mock          # at the root, in another terminal (mock:web: browser only)
//   bun run mock:audit    # → dev/out/<page>-<locale>.png, findings on stdout
//
// Environment: LOCALE (default de), WIDTH × HEIGHT (default 1100 × 680), ROUTES (comma-separated, default all
// pages), plus PORT and EDGE as in screenshot.mjs.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const routes = (process.env.ROUTES ?? "/,/installed,/config,/logs,/settings").split(",").map((r) => r.trim());
const locale = process.env.LOCALE ?? "de";
const width = process.env.WIDTH ?? "1100";
const height = process.env.HEIGHT ?? "680";
let failed = 0;
let findings = 0;

for (const route of routes) {
	const name = route === "/" ? "index" : route.slice(1).replace(/\//g, "-");
	const out = join(here, "out", `${name}-${locale}.png`);
	const r = spawnSync(process.execPath, [join(here, "screenshot.mjs"), width, height, route, out], {
		encoding: "utf8",
		env: { ...process.env, LOCALE: locale },
	});
	const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
	const lines = text ? text.split("\n") : [];
	const broken = r.status !== 0 || /NOT READY|navigate failed/.test(text);
	if (broken) failed++;
	findings += lines.filter((l) => /^(OVERLAP|SPILL|SCROLL|EXC |ERROR )/.test(l)).length;
	console.log(`${broken ? "FAIL" : "ok  "} ${route.padEnd(12)} ${out}`);
	for (const line of lines) console.log(`     ${line}`);
}

console.log(`\n${routes.length - failed}/${routes.length} pages rendered, ${findings} audit findings (see above).`);
process.exit(failed ? 1 : 0);
