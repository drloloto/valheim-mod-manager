// Serves the prebuilt SvelteKit UI (ui/build) and sets the security headers for every response.
import type { Context, Next } from "hono";
import { normalize, sep, join } from "path";

export const UI_DIR = normalize(process.env.UI_DIR || join(import.meta.dir, "..", "ui", "build"));

/**
 * Headers for every response. The pages carry their own script/style CSP as a <meta> tag (hashes from the
 * SvelteKit build); these are the parts a meta tag cannot set, plus a strict default for API responses.
 */
export async function securityHeaders(c: Context, next: Next) {
	await next();
	const h = c.res.headers;
	h.set("X-Content-Type-Options", "nosniff");
	h.set("Referrer-Policy", "no-referrer");
	h.set("X-Frame-Options", "DENY");
	h.set("Cross-Origin-Opener-Policy", "same-origin");
	h.set("Cross-Origin-Resource-Policy", "same-origin");
	h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
	if (!h.has("Content-Security-Policy"))
		h.set(
			"Content-Security-Policy",
			c.req.path.startsWith("/api/")
				? "default-src 'none'; frame-ancestors 'none'"
				: "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
		);
}

/** Absolute file path under `root` for a URL path, or null when it would leave `root`. */
export function resolveUnder(root: string, urlPath: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(urlPath);
	} catch {
		return null;
	}
	if (decoded.includes("\0")) return null;
	const abs = normalize(join(root, decoded));
	return abs === root || abs.startsWith(root + sep) ? abs : null;
}

const isFile = async (p: string | null) => !!p && (await Bun.file(p).exists());

/**
 * GET handler for everything outside /api: the file itself, `<path>.html` for prerendered routes, otherwise
 * the SPA fallback. Hashed assets under _app/immutable are cached for a year, pages are revalidated.
 */
export async function serveUi(c: Context, root = UI_DIR): Promise<Response> {
	const path = c.req.path;
	if (path === "/api" || path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
	const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`];
	let file: string | null = null;
	for (const p of candidates) {
		const abs = resolveUnder(root, p);
		if (await isFile(abs)) {
			file = abs;
			break;
		}
	}
	if (!file) {
		// Missing assets are real 404s; unknown page paths get the app shell, which routes client-side.
		if (/\.[a-z0-9]+$/i.test(path)) return c.notFound();
		file = join(root, "200.html");
		if (!(await isFile(file))) return c.text("UI not built: run `bun run build` in ui/", 503);
	}
	const res = new Response(Bun.file(file));
	res.headers.set("Cache-Control", path.startsWith("/_app/immutable/") ? "public, max-age=31536000, immutable" : "no-cache");
	return res;
}
