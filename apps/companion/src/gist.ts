// The mailbox: a GitHub gist with a few small files. Reads use the REST API with an ETag (a 304 is free when
// authenticated and never serves a stale CDN copy, unlike raw URLs without a commit hash); writes PATCH only
// the named file, so one writer per file never conflicts with another.
import { VERSION } from "./config";

export interface Fetched {
	text: string;
	/** gist-wide ETag of the response that carried this content */
	etag: string | null;
}

export interface Mailbox {
	/** All files, or null when nothing changed since the last call (ETag match). */
	fetch(): Promise<Record<string, Fetched> | null>;
	put(name: string, text: string): Promise<void>;
}

export const GITHUB_API = "https://api.github.com";

/** GitHub said no because a bucket is used up. Gist writes have their own: `gist_update`, 100 per hour per user,
 *  shared by everyone who writes with the same account (the companion and the admin's Mod Manager). */
export class RateLimited extends Error {
	constructor(
		readonly resource: string,
		readonly limit: string,
		/** epoch ms */
		readonly resetAt: number,
	) {
		super(`GitHub's ${resource} limit (${limit} per hour per user) is used up; it resets in ${Math.max(1, Math.ceil((resetAt - Date.now()) / 60000))} min`);
	}
}

function rateLimited(res: Response): RateLimited | null {
	if (res.status !== 403 || res.headers.get("x-ratelimit-remaining") !== "0") return null;
	const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
	return new RateLimited(
		res.headers.get("x-ratelimit-resource") ?? "api",
		res.headers.get("x-ratelimit-limit") ?? "?",
		reset > 0 ? reset : Date.now() + 3600_000,
	);
}

interface GistFile {
	content?: string;
	truncated?: boolean;
	raw_url?: string;
	size?: number;
}

export class GistMailbox implements Mailbox {
	private etag: string | null = null;
	/** after a 403 with an empty bucket: no request of that kind before this time (epoch ms) */
	private readBlocked: RateLimited | null = null;
	private writeBlocked: RateLimited | null = null;

	constructor(
		readonly gistId: string,
		readonly token: string | null = null,
		readonly apiBase: string = GITHUB_API,
	) {}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": `valheim-companion/${VERSION}`,
			...extra,
		};
		if (this.token) h.Authorization = `Bearer ${this.token}`;
		return h;
	}

	async fetch(): Promise<Record<string, Fetched> | null> {
		if (this.readBlocked && Date.now() < this.readBlocked.resetAt) throw this.readBlocked;
		this.readBlocked = null;
		const res = await fetch(`${this.apiBase}/gists/${this.gistId}`, { headers: this.headers(this.etag ? { "If-None-Match": this.etag } : {}) });
		if (res.status === 304) return null;
		const limited = rateLimited(res);
		if (limited) throw (this.readBlocked = limited);
		if (!res.ok) throw new Error(`gist ${this.gistId}: HTTP ${res.status}${res.status === 404 ? " (wrong id, or a private gist without a token)" : ""}`);
		const etag = res.headers.get("etag");
		const body = (await res.json()) as { files?: Record<string, GistFile | null> };
		const out: Record<string, Fetched> = {};
		for (const [name, f] of Object.entries(body.files ?? {})) {
			if (!f) continue;
			let text = f.content ?? "";
			// Files over 1 MB come back cut off; raw_url has the whole thing (up to 10 MB).
			if (f.truncated && f.raw_url) {
				const raw = await fetch(f.raw_url, { headers: this.headers() });
				if (!raw.ok) throw new Error(`gist ${this.gistId}/${name}: raw HTTP ${raw.status}`);
				text = await raw.text();
			}
			out[name] = { text, etag };
		}
		this.etag = etag;
		return out;
	}

	async put(name: string, text: string): Promise<void> {
		if (!this.token) throw new Error("writing to the gist needs a token (COMPANION_GIST_TOKEN)");
		// A used-up bucket is not retried every poll: that would only burn the admin's share of it.
		if (this.writeBlocked && Date.now() < this.writeBlocked.resetAt) throw this.writeBlocked;
		this.writeBlocked = null;
		const res = await fetch(`${this.apiBase}/gists/${this.gistId}`, {
			method: "PATCH",
			headers: this.headers({ "Content-Type": "application/json" }),
			body: JSON.stringify({ files: { [name]: { content: text } } }),
		});
		const limited = rateLimited(res);
		if (limited) throw (this.writeBlocked = limited);
		if (!res.ok) throw new Error(`gist ${this.gistId}: PATCH HTTP ${res.status}`);
		// Our own write changed the gist-wide ETag; the next fetch sees everything again, which is what we want.
		this.etag = null;
	}

	/** Creates a secret (unlisted) gist with the given files; returns its id. */
	static async create(token: string, files: Record<string, string>, description: string, apiBase = GITHUB_API): Promise<string> {
		const res = await fetch(`${apiBase}/gists`, {
			method: "POST",
			headers: new GistMailbox("new", token, apiBase).headers({ "Content-Type": "application/json" }),
			body: JSON.stringify({ description, public: false, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { content: v }])) }),
		});
		if (!res.ok) throw new Error(`create gist: HTTP ${res.status} ${await res.text().catch(() => "")}`);
		const body = (await res.json()) as { id?: string };
		if (!body.id) throw new Error("create gist: no id in the response");
		return body.id;
	}
}
