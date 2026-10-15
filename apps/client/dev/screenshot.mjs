// Screenshot + layout audit of the mock preview in headless Edge over CDP. No dependencies.
//
//   VITE_MOCK_TAURI=1 pnpm dev                          # in another terminal
//   node dev/screenshot.mjs 1100 680 /installed out.png  # viewport, route, output
//
// Environment:
//   PRESET  JS evaluated on the loaded page before a second navigation, e.g. a locale:
//           PRESET='localStorage.setItem("werkbank.locale", JSON.stringify("de"))'
//   ACTION  JS evaluated on the ready page before the audit, e.g. select the first row:
//           ACTION='document.querySelector("[role=grid] [role=row]").click()'
//   AUDIT   "0" skips dev/layout-audit.js (prints overflow, stray scrollbars and overlapping text)
//   EDGE    path to msedge.exe (default: the x86 program files install)
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [w, h, route = "/", out = "screenshot.png"] = process.argv.slice(2);
const width = Number(w) || 1100;
const height = Number(h) || 680;
const port = 9333 + Math.floor(Math.random() * 500);
const edgePath = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const profile = mkdtempSync(join(tmpdir(), "edge-cdp-"));
const edge = spawn(
	edgePath,
	["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "--no-first-run", "about:blank"],
	{ stdio: "ignore" },
);

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
	new Promise((res) => {
		const i = ++id;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method, params }));
	});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const url = `http://localhost:1420${route}`;
async function waitReady() {
	for (let i = 0; i < 60; i++) {
		await sleep(500);
		if (
			await evaluate(
				`(() => { const m = document.querySelector("main"); const t = m ? m.innerText.trim() : ""; return t.length > 20 && !/^(Loading|Lädt)/.test(t); })()`,
			)
		)
			return true;
	}
	return false;
}
const nav = await send("Page.navigate", { url });
if (nav.error) console.log("navigate failed:", nav.error.message);
let ready = await waitReady();
if (process.env.PRESET) {
	await evaluate(process.env.PRESET);
	await send("Page.navigate", { url });
	ready = await waitReady();
}
await sleep(1200);
if (process.env.ACTION) {
	await evaluate(process.env.ACTION);
	await sleep(1500);
}
if (process.env.AUDIT !== "0") {
	const audit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "layout-audit.js"), "utf8");
	console.log(await evaluate(audit));
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
if (!ready) console.log("NOT READY (main stayed empty)");
if (logs.length) console.log(logs.slice(0, 10).join("\n"));
await send("Browser.close");
ws.close();
edge.kill();
