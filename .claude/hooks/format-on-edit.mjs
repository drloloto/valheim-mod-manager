// PostToolUse hook (see .claude/settings.json): formats and lints the source file an Edit or Write just
// touched with `vp check --fix`, so formatting never needs a separate run. Exit code 2 feeds the remaining
// lint findings back to Claude; anything else stays silent. Paths outside the workspace, generated output and
// the Claude config itself are skipped; vite.config.ts decides what vp ignores beyond that.
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

const debug = process.env.FORMAT_HOOK_DEBUG ? (text) => process.stderr.write(`[format-on-edit] ${text}\n`) : () => {};
let file;
try {
	file = JSON.parse(input).tool_input?.file_path;
} catch (error) {
	debug(`unreadable input (${error.message}): ${input.slice(0, 200)}`);
	process.exit(0);
}
if (typeof file !== "string" || !/\.(ts|js|mjs|cjs|svelte|css|json|md)$/i.test(file)) {
	debug(`not a source file: ${file}`);
	process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = relative(root, resolve(file)).replace(/\\/g, "/");
if (rel.startsWith("..") || /^(\.claude|\.design-sync|node_modules)\/|\/node_modules\/|\.svelte-kit\/|src-tauri\/(target|gen)\//.test(rel)) {
	debug(`skipped: ${rel}`);
	process.exit(0);
}

const r = spawnSync(`vp check --fix "${rel}"`, { cwd: root, shell: true, encoding: "utf8", timeout: 80_000 });
debug(`${rel} status=${r.status} ${r.error?.message ?? ""}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
if (r.status !== 0) {
	process.stderr.write(`vp check --fix ${rel} still reports issues:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(-1500)}\n`);
	process.exit(2);
}
