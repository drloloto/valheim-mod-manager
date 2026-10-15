// Reads are open on the LAN (unless COMPANION_PUBLIC_READ=false); every write needs
// `Authorization: Bearer <token>`. Feature guards turn whole route groups off.
import type { Context, Next } from "hono";
import { FEATURES, getToken, type Feature } from "./config";

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export function isAuthed(c: Context): boolean {
	const token = getToken();
	if (!token) return false;
	// Header only: a token in a URL ends up in logs and history. The page reads the log stream with fetch.
	const header = c.req.header("authorization") ?? "";
	const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	return !!given && timingSafeEqual(given, token);
}

const isRead = (c: Context) => ["GET", "HEAD", "OPTIONS"].includes(c.req.method);

/** Always-public paths: the landing page needs them to explain itself. */
const OPEN = new Set(["/api/health", "/api/status", "/api/auth/check"]);

export async function requireToken(c: Context, next: Next) {
	if (OPEN.has(c.req.path)) return next();
	if (isRead(c) && FEATURES.publicRead) return next();
	if (!getToken()) return c.json({ error: "No admin token configured (COMPANION_TOKEN=none); this action is disabled." }, 503);
	if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
	return next();
}

export const requireFeature = (f: Feature) => async (c: Context, next: Next) => {
	if (!FEATURES[f]) return c.json({ error: `feature "${f}" is disabled on this companion` }, 403);
	return next();
};
