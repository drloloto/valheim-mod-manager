// Drives the running DEV app over CDP (start it with `pwsh dev/spike-gist.ps1 -Cdp`). No dependencies.
//
//   node dev/spike-drive.mjs [when] [out dir]
//     when     none (default: the companion only stages the release) | idle | now
//              add: instead of publishing, "Add server…" with the sync code pasted as a URL
//                   (http://127.0.0.1:9002/vmm1.…) and check that the new profile is in sync
//     out dir  where the screenshots go (default: the current directory)
//
// The seeded profile is already linked to the test gist, so this checks the link (disabled mods must not
// show up as a difference), opens the publish dialog, publishes a release and waits for the companion to
// report it back. Screenshots: spike-1-main.png, spike-2-publish.png, spike-3-result.png (spike-4-added.png).
// Exit code 1 when any step fails; console errors of the page are printed at the end.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [when = "none", outDir = "."] = process.argv.slice(2);
const port = Number(process.env.CDP_PORT ?? 9229);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageTarget() {
	for (let i = 0; i < 60; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
			const page = list.find((t) => t.type === "page" && /tauri\.localhost|^tauri:/.test(t.url));
			if (page) return page;
		} catch {
			/* not up yet */
		}
		await sleep(500);
	}
	throw new Error(`no app page on CDP port ${port}; start the app with dev/spike-gist.ps1 -Cdp`);
}

const ws = new WebSocket((await pageTarget()).webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
		return;
	}
	if (m.method === "Runtime.exceptionThrown") errors.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
	if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
		errors.push("ERROR " + m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const i = ++id;
		pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
		ws.send(JSON.stringify({ id: i, method, params }));
	});
/** Evaluates `expr` in the page; promises are awaited, the value comes back as JSON. */
async function evaluate(expr) {
	const r = await send("Runtime.evaluate", {
		expression: `(async () => JSON.parse(JSON.stringify(await (${expr}) ?? null)))()`,
		awaitPromise: true,
		returnByValue: true,
	});
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
	return r.result.value;
}
async function shot(name) {
	const r = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(outDir, name), Buffer.from(r.data, "base64"));
	console.log("screenshot", join(outDir, name));
}
function fail(msg) {
	console.error("FAIL:", msg);
	if (errors.length) console.error(errors.join("\n"));
	process.exit(1);
}

await send("Runtime.enable");
await send("Page.enable");

// 1. The app is up, the seeded profile is active and linked through the gist.
let state = null;
for (let i = 0; i < 120 && !state?.active; i++) {
	state = await evaluate("window.vmm ? { active: vmm.state.active, server: vmm.state.server, app: vmm.state.app, mods: vmm.state.mods.length } : null").catch(
		() => null,
	);
	if (!state?.active) await sleep(500);
}
if (!state?.active) fail("the app did not expose window.vmm with an active profile (is this the dev build?)");
console.log(`app ${state.app.version}${state.app.dev ? " [DEV]" : ""} data ${state.app.dataDir}`);
console.log(`profile ${state.active}: ${state.mods} mods, link ${JSON.stringify(state.server)}`);
if (!state.app.dev) fail("not a dev build");
if (!state.server?.gist || !state.server.hasGistToken) fail("the profile is not linked through a gist with a token");

// 2. Check the gist.
await sleep(1500);
const before = await evaluate("vmm.refreshServerStatus()");
console.log(
	"check:",
	JSON.stringify({
		reachable: before?.reachable,
		name: before?.name,
		inSync: before?.inSync,
		diff: before?.diff?.length,
		configs: before?.configsChanged?.length,
		release: before?.gistRelease,
		error: before?.error,
	}),
);
if (!before?.reachable) fail(`gist not reachable: ${before?.error}`);
const disabled = await evaluate("vmm.state.mods.filter((m) => !m.enabled).map((m) => m.namespace + '-' + m.name)");
const leaked = disabled.filter((id) => before.diff.onlyLocal.some((m) => m.id === id) || before.diff.changed.some((m) => m.id === id));
console.log(`disabled locally: ${disabled.join(", ") || "none"}; in the diff: ${leaked.join(", ") || "none"}`);
if (leaked.length) fail("a disabled mod is treated as something the server should get");
await shot("spike-1-main.png");

if (when === "add") {
	// "Add server…" with the code pasted the way people do it: at the end of the companion's address.
	const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", ".env"), "utf-8");
	const code = /^COMPANION_SYNC_CODE=(\S+)/m.exec(env)?.[1];
	if (!code) fail("no COMPANION_SYNC_CODE in test/.env");
	const d = await evaluate(`vmm.discoverServer(${JSON.stringify(`http://127.0.0.1:9002/${code}`)})`);
	console.log("discovered:", JSON.stringify({ ...d, syncCode: d?.syncCode ? "vmm1.…" : null }));
	if (d?.syncCode !== code || !d.name) fail("the pasted URL was not recognised as a sync code");
	const prevActive = state.active;
	const added = await evaluate(`vmm.addServer(${JSON.stringify(d)}, true)`);
	if (!added) fail("addServer returned false");
	const after = await evaluate("({ active: vmm.state.active, server: vmm.state.server, mods: vmm.state.mods.length })");
	console.log(`new profile ${after.active}: ${after.mods} mods, link ${JSON.stringify(after.server)}`);
	if (after.active === prevActive || !after.server?.gist) fail("no new gist-linked profile became active");
	const check = await evaluate("vmm.refreshServerStatus()");
	console.log(
		"check of the new profile:",
		JSON.stringify({ reachable: check?.reachable, inSync: check?.inSync, diff: check?.diff, configs: check?.configsChanged?.length }),
	);
	await sleep(800);
	await shot("spike-4-added.png");
	if (!check?.reachable || !check.inSync) fail("the adopted profile is not in sync with the gist");
	if (errors.length) console.log("page errors:\n" + errors.join("\n"));
	ws.close();
	process.exit(0);
}

// 3. Publish through the dialog's own store call, with the dialog open for the picture. Mods and versions
//    only, like the dialog's default: configs belong to the server (spec decision 12).
await evaluate('(vmm.serverDialog = "publish", true)');
await sleep(1200);
await shot("spike-2-publish.png");
const ok = await evaluate(`vmm.publishGist(false, ${JSON.stringify(when)}, null)`);
if (!ok) fail("publishGist returned false (see the toast / errors below)");
console.log(`published (apply: ${when}); waiting for the companion`);

// 4. The companion polls the gist (60 s in the test stack) and writes the release status back.
const prev = before?.gistRelease?.id ?? null;
let result = null;
for (let i = 0; i < 18; i++) {
	await sleep(10_000);
	const c = await evaluate("vmm.refreshServerStatus()");
	const r = c?.gistRelease;
	process.stdout.write(`  ${(i + 1) * 10}s: ${r ? `${r.id} ${r.state}` : "no release yet"}\n`);
	if (r && r.id !== prev) {
		result = r;
		break;
	}
}
await sleep(500);
await shot("spike-3-result.png");
if (!result) fail("the companion did not report the release within three minutes");
console.log("companion:", JSON.stringify(result));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
ws.close();
process.exit(["staged", "scheduled", "applied"].includes(result.state) ? 0 : 1);
