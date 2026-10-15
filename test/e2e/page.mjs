// The companion landing page in headless Edge over CDP: what a player sees (the button's link) and, with the
// admin token, the real sync setup through the page's own form. Tokens come in through the environment
// (ADMIN_TOKEN, GIST_TOKEN) and are never printed. Prints one JSON line {enabled, href, gistId} on stdout;
// screenshots and progress go to stderr / OUT_DIR. No dependencies.
//
//   COMPANION_URL   default http://127.0.0.1:9002
//   ADMIN_TOKEN     sign in on the page (optional)
//   GIST_TOKEN      with ADMIN_TOKEN: set the sync up through the form when it is off
//   OUT_DIR         where screenshots go (default .)
//   EDGE            path to msedge.exe
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = (process.env.COMPANION_URL ?? "http://127.0.0.1:9002").replace(/\/+$/, "");
const outDir = process.env.OUT_DIR ?? ".";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const gistToken = process.env.GIST_TOKEN ?? "";
mkdirSync(outDir, { recursive: true });

const port = 9333 + Math.floor(Math.random() * 500);
const edgePath = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const profile = mkdtempSync(join(tmpdir(), "edge-cdp-"));
const edge = spawn(edgePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1200,900", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
	for (let i = 0; i < 50; i++) {
		try {
			return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
		} catch {
			await sleep(200);
		}
	}
	throw new Error("edge did not start");
}
const page = (await targets()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
		return;
	}
	if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
	if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERROR " + m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const i = ++id;
		pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
		ws.send(JSON.stringify({ id: i, method, params }));
	});
async function evaluate(expr) {
	const r = await send("Runtime.evaluate", { expression: `(async () => JSON.parse(JSON.stringify(await (${expr}) ?? null)))()`, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
	return r.result.value;
}
async function waitFor(expr, label, ms = 30000) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		const v = await evaluate(expr);
		if (v) return v;
		await sleep(300);
	}
	throw new Error(`timeout waiting for ${label}`);
}
async function shot(name) {
	const r = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(outDir, name), Buffer.from(r.data, "base64"));
	console.error("screenshot", join(outDir, name));
}
async function open(url) {
	await send("Page.navigate", { url });
	await sleep(1500);
}
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;

try {
	await send("Runtime.enable");
	await send("Page.enable");
	await open(base + "/");
	await waitFor(`${q("[data-testid=open-in-mod-manager]")} !== null`, "landing page");
	await shot("page-1-public.png");

	if (adminToken) {
		// the page's own sign-in keeps the token in sessionStorage; set it the same way and reload
		await evaluate(`(sessionStorage.setItem("companion.token", ${JSON.stringify(adminToken)}), true)`);
		await open(base + "/");
		await waitFor(`${q("[data-testid=sync-setup]")} !== null`, "admin sync card");
		await shot("page-2-admin.png");
		const on = await evaluate(`${q("[data-testid=sync-code]")} !== null`);
		if (!on && gistToken) {
			await evaluate(`(() => { const i = ${q("#gist-token")}; i.focus(); i.value = ${JSON.stringify(gistToken)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
			await sleep(300);
			await evaluate(`(() => { const b = ${q("[data-testid=sync-setup] form button[type=submit]")}; if (b.disabled) throw new Error("submit disabled"); b.click(); return true; })()`);
			await waitFor(`${q("[data-testid=sync-code]")} !== null`, "sync code on the page", 60000);
			console.error("sync set up through the page");
		}
		await sleep(500);
		await shot("page-3-enabled.png");
		const card = await evaluate(`${q("[data-testid=sync-setup]")}.innerText`);
		console.error("admin card:\n" + card.replace(/vmm1\.[^\s]+/g, "<code>"));
	}
	const href = await evaluate(`${q("[data-testid=open-in-mod-manager]")}.getAttribute("href")`);
	const enabled = await evaluate(`${q("[data-testid=sync-code]")} !== null`);
	const gistId = /code=vmm1\.([0-9a-f]+)\./.exec(href)?.[1] ?? null;
	if (logs.length) console.error("page console:\n" + logs.join("\n"));
	console.log(JSON.stringify({ enabled, href, gistId }));
} finally {
	ws.close();
	edge.kill();
}
