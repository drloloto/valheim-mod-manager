// Backups are tar.gz archives made with the container's tar: worlds_local/<world…>, bepinex/config and
// modmanager/manifest.json. The manifest inside lets an import show which mod versions the save expects.
import { readdir, rm, stat } from "fs/promises";
import { join } from "path";
import { BACKUP_DIR, CONFIG_DIR } from "./paths";
import { diffMods, loadManifest, normalizeManifest, type Manifest, type ModDiff } from "./manifest";
import { worldEntries } from "./worlds";

export interface Backup {
	id: string;
	world: string | null;
	size: number;
	createdAt: number;
	imported: boolean;
}

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\- ]*\.tar\.gz$/;

export function safeId(id: string): string {
	if (!ID_RE.test(id) || id.includes("..")) throw new Error("invalid backup id");
	return id;
}

export function stamp(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function tar(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
	const proc = Bun.spawn(["tar", ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return { ok: code === 0, out, err };
}

export async function listBackups(): Promise<Backup[]> {
	const files = (await readdir(BACKUP_DIR).catch(() => [])).filter((f) => f.endsWith(".tar.gz"));
	const out: Backup[] = [];
	for (const f of files) {
		const s = await stat(join(BACKUP_DIR, f)).catch(() => null);
		if (!s) continue;
		const imported = f.startsWith("import-");
		const world = imported ? null : f.replace(/-\d{8}-\d{6}(-[a-z-]+)?\.tar\.gz$/, "") || null;
		out.push({ id: f, world, size: s.size, createdAt: s.mtimeMs, imported });
	}
	return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Creates `<world>-<stamp>[-<label>].tar.gz`. */
export async function createBackup(world: string, label?: string): Promise<Backup> {
	const entries = await worldEntries(world);
	if (!entries.length) throw new Error(`world "${world}" not found`);
	const members = entries.map((e) => `worlds_local/${e}`);
	for (const extra of ["bepinex/config", "modmanager/manifest.json"]) if (await stat(join(CONFIG_DIR, extra)).catch(() => null)) members.push(extra);
	const id = `${world}-${stamp()}${label ? `-${label.replace(/[^a-z0-9-]/gi, "").toLowerCase()}` : ""}.tar.gz`;
	const r = await tar(["-czf", join(BACKUP_DIR, id), "-C", CONFIG_DIR, ...members]);
	if (!r.ok) throw new Error(`tar failed: ${r.err.trim()}`);
	const s = await stat(join(BACKUP_DIR, id));
	return { id, world, size: s.size, createdAt: s.mtimeMs, imported: false };
}

export async function deleteBackup(id: string): Promise<void> {
	await rm(join(BACKUP_DIR, safeId(id)), { force: true });
}

export interface BackupContents {
	id: string;
	worlds: string[];
	hasConfigs: boolean;
	manifest: Manifest | null;
	/** running manifest → backup manifest; null when the backup has none */
	diff: ModDiff | null;
}

export async function inspectBackup(id: string): Promise<BackupContents> {
	const file = join(BACKUP_DIR, safeId(id));
	const list = await tar(["-tzf", file]);
	if (!list.ok) throw new Error(`not a tar.gz archive: ${list.err.trim()}`);
	const names = list.out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const worlds = [
		...new Set(
			names
				.filter((n) => n.startsWith("worlds_local/"))
				.map((n) =>
					n
						.split("/")[1]
						?.split(".")[0]
						.replace(/_backup_.*$/, "")
						.replace(/_main$/, ""),
				)
				.filter(Boolean),
		),
	];
	const hasConfigs = names.some((n) => n.startsWith("bepinex/config/"));
	let manifest: Manifest | null = null;
	if (names.includes("modmanager/manifest.json")) {
		const m = await tar(["-xzOf", file, "modmanager/manifest.json"]);
		try {
			const raw = JSON.parse(m.out);
			manifest = normalizeManifest(raw, raw.server, raw.configs ?? {});
		} catch {
			manifest = null;
		}
	}
	const current = await loadManifest();
	return {
		id,
		worlds,
		hasConfigs,
		manifest,
		diff: manifest ? diffMods(current?.mods ?? [], manifest.mods) : null,
	};
}

/** Stores an uploaded archive as `import-<stamp>.tar.gz` and describes it. Nothing is applied. */
export async function importBackup(bytes: ArrayBuffer): Promise<BackupContents> {
	const id = `import-${stamp()}.tar.gz`;
	await Bun.write(join(BACKUP_DIR, id), bytes);
	try {
		return await inspectBackup(id);
	} catch (e) {
		await rm(join(BACKUP_DIR, id), { force: true });
		throw e;
	}
}

export interface RestoreOptions {
	world: string;
	configs: boolean;
}

/** Replaces the world (and optionally the configs) from the archive. The caller stops/starts the game container. */
export async function restoreFiles(id: string, opts: RestoreOptions): Promise<{ safety: Backup | null; restored: string[] }> {
	const file = join(BACKUP_DIR, safeId(id));
	const contents = await inspectBackup(id);
	if (!contents.worlds.includes(opts.world)) throw new Error(`world "${opts.world}" is not in this backup`);
	const existing = await worldEntries(opts.world);
	const safety = existing.length ? await createBackup(opts.world, "pre-restore") : null;
	for (const e of existing)
		await rm(join(CONFIG_DIR, "worlds_local", e), {
			recursive: true,
			force: true,
		});
	const members = (await tar(["-tzf", file])).out
		.split("\n")
		.map((l) => l.trim())
		.filter(
			(n) =>
				n.startsWith("worlds_local/") &&
				n
					.split("/")[1]
					?.split(".")[0]
					.replace(/_backup_.*$/, "")
					.replace(/_main$/, "") === opts.world,
		)
		.filter((n) => !n.endsWith("/") || n.split("/").length === 3);
	const restored: string[] = [];
	const r = await tar(["-xzf", file, "-C", CONFIG_DIR, ...new Set(members.map((m) => m.split("/").slice(0, 2).join("/")))]);
	if (!r.ok) throw new Error(`tar failed: ${r.err.trim()}`);
	restored.push(`worlds_local/${opts.world}`);
	if (opts.configs && contents.hasConfigs) {
		const c = await tar(["-xzf", file, "-C", CONFIG_DIR, "bepinex/config"]);
		if (!c.ok) throw new Error(`tar failed: ${c.err.trim()}`);
		restored.push("bepinex/config");
	}
	// The game runs as root inside its container; restored files must be writable for it.
	try {
		Bun.spawnSync(["chown", "-R", "0:0", join(CONFIG_DIR, "worlds_local")]);
	} catch {
		/* no chown outside the container (local development) */
	}
	return { safety, restored };
}
