// Screenshots the running DEV app over CDP (port 9229) and prints its visible text, sync codes masked.
//   node test/e2e/app.mjs <png> [wait seconds]
import { writeFileSync } from "node:fs";

const [out = "app.png", waitS = "0"] = process.argv.slice(2);
const port = Number(process.env.CDP_PORT ?? 9229);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(Number(waitS) * 1000);
let page;
for (let i = 0; i < 40 && !page; i++) {
	try {
		const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
		page = list.find((t) => t.type === "page" && /tauri\.localhost|^tauri:/.test(t.url));
	} catch {
		/* not up yet */
	}
	if (!page) await sleep(500);
}
if (!page) throw new Error(`no app page on CDP ${port}; start the DEV app with dev/dev-app.ps1 -Cdp`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
	}
};
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const i = ++id;
		pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
		ws.send(JSON.stringify({ id: i, method, params }));
	});
await send("Page.enable");
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
const text = await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
console.log(
	String(text.result.value)
		.replace(/vmm1\.[^\s]+/g, "<code>")
		.slice(0, 2500),
);
ws.close();
