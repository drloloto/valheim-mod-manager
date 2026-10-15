import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { resolveUnder, securityHeaders, serveUi } from "./web";

describe("resolveUnder", () => {
	it("keeps paths inside the root and rejects everything else", () => {
		const root = join(tmpdir(), "ui-root");
		expect(resolveUnder(root, "/a/b.js")).toBe(join(root, "a", "b.js"));
		expect(resolveUnder(root, "/../secret")).toBeNull();
		expect(resolveUnder(root, "/%2e%2e/secret")).toBeNull();
		expect(resolveUnder(root, "/a/%2e%2e/%2e%2e/secret")).toBeNull();
		expect(resolveUnder(root, "/x%00.js")).toBeNull();
		expect(resolveUnder(root, "/%E0%A4%A")).toBeNull();
	});
});

describe("serveUi", async () => {
	const root = await mkdtemp(join(tmpdir(), "companion-ui-"));
	await mkdir(join(root, "_app", "immutable"), { recursive: true });
	await writeFile(join(root, "index.html"), "home");
	await writeFile(join(root, "configs.html"), "configs");
	await writeFile(join(root, "200.html"), "shell");
	await writeFile(join(root, "_app", "immutable", "a.js"), "js");
	await writeFile(join(tmpdir(), "outside-secret.txt"), "secret");
	const app = new Hono();
	app.use("*", securityHeaders);
	app.get("/api/status", (c) => c.json({ ok: true }));
	app.on(["GET", "HEAD"], "*", (c) => serveUi(c, root));
	const get = (p: string) => app.request(p);

	it("serves prerendered pages, the SPA shell and hashed assets", async () => {
		expect(await (await get("/")).text()).toBe("home");
		expect(await (await get("/configs")).text()).toBe("configs");
		expect(await (await get("/players")).text()).toBe("shell");
		const asset = await get("/_app/immutable/a.js");
		expect(asset.headers.get("cache-control")).toContain("immutable");
		expect((await get("/configs")).headers.get("cache-control")).toBe("no-cache");
	});
	it("does not leave the build folder and 404s missing assets and API paths", async () => {
		expect((await get("/..%2foutside-secret.txt")).status).toBe(404);
		expect((await get("/missing.js")).status).toBe(404);
		const api = await get("/api/nope");
		expect(api.status).toBe(404);
		expect(await api.json()).toEqual({ error: "not found" });
	});
	it("sends the security headers", async () => {
		const page = await get("/");
		expect(page.headers.get("x-frame-options")).toBe("DENY");
		expect(page.headers.get("x-content-type-options")).toBe("nosniff");
		expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		expect((await get("/api/status")).headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
	});
});
