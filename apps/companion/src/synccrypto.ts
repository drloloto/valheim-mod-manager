// Encryption for the gist mailbox. A gist is "unlisted", not private: whoever knows its id can read it, so
// every file in it is sealed with a key derived from the sync code's secret. The same parameters are
// implemented by the Mod Manager (Rust: hkdf + aes-gcm), so keep them stable: docs/adr/2026-10-12-sync-through-a-gist.md.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { gunzipSync, gzipSync } from "zlib";

export const SYNC_CODE_PREFIX = "vmm1";
const KDF_SALT = Buffer.from("valheim-mod-manager-sync/v1", "utf-8");
const KDF_INFO = Buffer.from("aes-256-gcm", "utf-8");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The sealed form of a file in the gist. `data` is ciphertext || 16-byte GCM tag (what aes-gcm crates emit).
 * The plaintext is gzipped first (`comp`): configs are base64 inside JSON and the envelope is base64 again,
 * which pushed a plain server.json past the gist API's 1 MB truncation mark; gzipped it is a tenth of that.
 */
export interface Envelope {
	v: 1;
	alg: "A256GCM";
	kdf: "HKDF-SHA256";
	comp?: "gzip";
	nonce: string;
	data: string;
}

export interface SyncCode {
	gistId: string;
	/** base64url, 32 random bytes */
	secret: string;
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export function newSecret(): string {
	return b64url(randomBytes(32));
}

/** `vmm1.<gist id>.<secret>`: one string to paste into the Mod Manager. */
export function makeSyncCode(c: SyncCode): string {
	return `${SYNC_CODE_PREFIX}.${c.gistId}.${c.secret}`;
}

export function parseSyncCode(raw: string): SyncCode {
	const parts = raw.trim().split(".");
	if (parts.length !== 3 || parts[0] !== SYNC_CODE_PREFIX) throw new Error(`sync code must look like ${SYNC_CODE_PREFIX}.<gist id>.<secret>`);
	const [, gistId, secret] = parts;
	if (!/^[0-9a-f]{20,40}$/.test(gistId)) throw new Error("sync code: the gist id is not valid");
	if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("sync code: the secret is not valid");
	return { gistId, secret };
}

/** HKDF-SHA256(secret, salt "valheim-mod-manager-sync/v1", info "aes-256-gcm") → 32 bytes. */
export function deriveKey(secret: string): Buffer {
	const ikm = Buffer.from(secret, "base64url");
	if (ikm.length < 16) throw new Error("sync secret too short");
	return Buffer.from(hkdfSync("sha256", ikm, KDF_SALT, KDF_INFO, 32));
}

/** Seals `plaintext` for the gist file `name`; the name is the AAD, so a sealed file cannot be moved to another slot. */
export function seal(key: Buffer, name: string, plaintext: string | Uint8Array): Envelope {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	cipher.setAAD(Buffer.from(name, "utf-8"));
	const packed = gzipSync(typeof plaintext === "string" ? Buffer.from(plaintext, "utf-8") : plaintext);
	const body = Buffer.concat([cipher.update(packed), cipher.final(), cipher.getAuthTag()]);
	return { v: 1, alg: "A256GCM", kdf: "HKDF-SHA256", comp: "gzip", nonce: nonce.toString("base64"), data: body.toString("base64") };
}

/** Opens an envelope; throws on a wrong key, a tampered body or a foreign slot name. */
export function open(key: Buffer, name: string, env: unknown): Buffer {
	const e = env as Partial<Envelope> | null;
	if (!e || e.v !== 1 || e.alg !== "A256GCM" || typeof e.nonce !== "string" || typeof e.data !== "string") throw new Error("not a sealed sync file");
	if (e.comp !== undefined && e.comp !== "gzip") throw new Error(`sealed sync file uses unknown compression ${String(e.comp)}`);
	const nonce = Buffer.from(e.nonce, "base64");
	const body = Buffer.from(e.data, "base64");
	if (nonce.length !== NONCE_BYTES || body.length < TAG_BYTES) throw new Error("sealed sync file is malformed");
	const decipher = createDecipheriv("aes-256-gcm", key, nonce);
	decipher.setAAD(Buffer.from(name, "utf-8"));
	decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
	let plain: Buffer;
	try {
		plain = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
	} catch {
		throw new Error("cannot open the sync file: wrong secret or tampered content");
	}
	return e.comp === "gzip" ? gunzipSync(plain) : plain;
}

/** True for text that at least claims to be an envelope; a placeholder like `{}` is not one and is ignored, not rejected. */
export function isEnvelope(text: string): boolean {
	try {
		const e = JSON.parse(text) as Partial<Envelope> | null;
		return !!e && typeof e === "object" && e.alg === "A256GCM";
	} catch {
		return false;
	}
}

export const sealJson = (key: Buffer, name: string, value: unknown) => JSON.stringify(seal(key, name, JSON.stringify(value)));
export const openJson = <T = unknown>(key: Buffer, name: string, text: string): T => JSON.parse(open(key, name, JSON.parse(text)).toString("utf-8")) as T;
