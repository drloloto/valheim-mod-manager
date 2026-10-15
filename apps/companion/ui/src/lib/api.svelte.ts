// The page's only connection to the companion: same origin, JSON, the admin token as a Bearer header.
// The token lives in sessionStorage (gone when the tab closes) unless the admin ticks "remember on this
// device"; it never goes into a URL.
import { toast } from "svelte-sonner";
import type { Status } from "./types";

const KEY = "companion.token";

function readStored(): { token: string; remember: boolean } {
	try {
		const remembered = localStorage.getItem(KEY);
		if (remembered) return { token: remembered, remember: true };
		return { token: sessionStorage.getItem(KEY) ?? "", remember: false };
	} catch {
		return { token: "", remember: false };
	}
}

class Session {
	token = $state("");
	remember = $state(false);
	status = $state<Status | null>(null);
	error = $state<string | null>(null);

	readonly authed = $derived(!!this.status?.companion.authed);
	readonly features = $derived(this.status?.companion.features);

	constructor() {
		if (typeof window !== "undefined") Object.assign(this, readStored());
	}

	/** A feature counts as on until the status says otherwise. */
	on(f: keyof NonNullable<Status["companion"]["features"]>): boolean {
		return this.features?.[f] !== false;
	}

	async refresh(): Promise<void> {
		try {
			this.status = await api<Status>("/status");
			this.error = null;
		} catch (e) {
			this.error = (e as Error).message;
		}
	}

	/** Checks a token with the server and keeps it only when it is accepted. */
	async signIn(token: string, remember: boolean): Promise<boolean> {
		const res = await fetch("/api/auth/check", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
		const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
		if (!body.ok) return false;
		this.token = token;
		this.remember = remember;
		try {
			localStorage.removeItem(KEY);
			sessionStorage.removeItem(KEY);
			(remember ? localStorage : sessionStorage).setItem(KEY, token);
		} catch {
			/* storage blocked: the token lasts for this page view */
		}
		await this.refresh();
		return true;
	}

	signOut() {
		this.token = "";
		try {
			localStorage.removeItem(KEY);
			sessionStorage.removeItem(KEY);
		} catch {
			/* nothing stored */
		}
		this.refresh();
	}
}

export const session = new Session();

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** JSON request against /api. Objects are sent as JSON, Blobs as they are. Throws ApiError with the server's message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
	const headers: Record<string, string> = {};
	let body: BodyInit | undefined;
	if (init.body instanceof Blob) body = init.body;
	else if (init.body !== undefined) {
		body = JSON.stringify(init.body);
		headers["Content-Type"] = "application/json";
	}
	if (session.token) headers.Authorization = `Bearer ${session.token}`;
	const res = await fetch(`/api${path}`, { method: init.method ?? "GET", headers, body, signal: init.signal });
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
	return data;
}

/** Runs an action and reports its error as a toast; returns null on failure. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
	try {
		return await fn();
	} catch (e) {
		toast.error((e as Error).message);
		return null;
	}
}

/**
 * Follows the server log over Server-Sent Events read with fetch, so the token stays in the Authorization
 * header instead of the URL. Calls `onLine` per line until the signal aborts or the stream ends.
 */
export async function followLog(onLine: (line: string) => void, signal: AbortSignal): Promise<void> {
	const res = await fetch("/api/logs/stream", { headers: { Authorization: `Bearer ${session.token}` }, signal });
	if (!res.ok || !res.body) throw new ApiError(`HTTP ${res.status}`, res.status);
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let carry = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		carry += value;
		const events = carry.split("\n\n");
		carry = events.pop() ?? "";
		for (const ev of events) if (ev.startsWith("data: ")) onLine(ev.slice(6));
	}
}
