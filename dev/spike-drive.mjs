// Drives the running DEV app over CDP (start it with `pwsh dev/spike-gist.ps1 -Cdp`). No dependencies.
//
//   node dev/spike-drive.mjs [when] [out dir]
//     when     none (default: the companion only stages the release) | idle | now
//     out dir  where the screenshots go (default: the current directory)
//
// The seeded profile is already linked to the test gist, so this checks the link, opens the publish
// dialog, publishes a release and waits for the companion to report it back. Screenshots:
//   spike-1-main.png, spike-2-publish.png, spike-3-result.png
// Exit code 1 when any step fails; console errors of the page are printed at the end.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
await shot("spike-1-main.png");

// 3. Publish through the dialog's own store call, with the dialog open for the picture.
await evaluate('(vmm.serverDialog = "publish", true)');
await sleep(1200);
await shot("spike-2-publish.png");
const ok = await evaluate(`vmm.publishGist(true, ${JSON.stringify(when)}, null)`);
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
