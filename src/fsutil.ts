// File helpers for writes that must not leave half-written or wrongly owned files behind.
import { chmod, chown, lstat, mkdir, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";

interface Owner {
	uid: number;
	gid: number;
	mode?: number;
}

/** Owner of `path`, or of the closest existing parent directory (mode only from the file itself). */
export async function ownerOf(path: string): Promise<Owner | null> {
	const own = await stat(path).catch(() => null);
	if (own) return { uid: own.uid, gid: own.gid, mode: own.isFile() ? own.mode & 0o7777 : undefined };
	let dir = dirname(path);
	for (;;) {
		const s = await stat(dir).catch(() => null);
		if (s) return { uid: s.uid, gid: s.gid };
		const up = dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

async function applyOwner(path: string, owner: Owner | null): Promise<void> {
	if (!owner) return;
	// chown fails outside the container (Windows, unprivileged dev): ownership is best effort there.
	await chown(path, owner.uid, owner.gid).catch(() => {});
	if (owner.mode !== undefined) await chmod(path, owner.mode).catch(() => {});
}

/**
 * Writes via a temp file in the same directory and renames it over the target, so a crash leaves either
 * the old or the new content. Owner and mode of the replaced file are kept. Not for single-file bind mounts
 * (valheim.env): a rename there would fail or detach the file from the host; env.ts writes that one in place.
 */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const owner = await ownerOf(path);
	const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	try {
		await writeFile(tmp, data);
		await applyOwner(tmp, owner);
		await rename(tmp, path);
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}

/** Recursively gives `path` the owner of `like` (a file or directory the game already uses). */
export async function chownTreeLike(path: string, like: string): Promise<void> {
	const s = await stat(like).catch(() => null);
	if (!s) return;
	const walk = async (p: string) => {
		await chown(p, s.uid, s.gid).catch(() => {});
		const st = await lstat(p).catch(() => null);
		if (st?.isDirectory()) for (const e of await readdir(p)) await walk(join(p, e));
	};
	await walk(path);
}

/** Throws when `dir` contains a symlink anywhere (an archive must not point outside the bind mount). */
export async function assertNoSymlinks(dir: string): Promise<void> {
	const walk = async (p: string) => {
		const st = await lstat(p);
		if (st.isSymbolicLink()) throw new Error(`archive contains a symlink: ${p}`);
		if (st.isDirectory()) for (const e of await readdir(p)) await walk(join(p, e));
	};
	await walk(dir);
}
