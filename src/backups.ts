// Backups are tar.gz archives made with the container's tar: worlds_local/<world…>, the BepInEx configs
// (bepinex/* without plugins/ and patchers/, see configdir.ts) and modmanager/manifest.json. The manifest inside lets an import show which mod versions the save expects.
import { mkdir, readdir, rename, rm, stat } from "fs/promises";
import { dirname, join } from "path";
import { assertNoSymlinks, chownTreeLike } from "./fsutil";
import { CONFIG_MEMBER, configEntries, isConfigEntry } from "./configdir";
import { BACKUP_DIR, BEPINEX_CONFIG_DIR, CONFIG_DIR, RESTORE_TMP_DIR, WORLDS_DIR } from "./paths";
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
	for (const e of await configEntries()) members.push(`${CONFIG_MEMBER}/${e}`);
	if (await stat(join(CONFIG_DIR, "modmanager/manifest.json")).catch(() => null)) members.push("modmanager/manifest.json");
	const id = `${world}-${stamp()}${label ? `-${label.replace(/[^a-z0-9-]/gi, "").toLowerCase()}` : ""}.tar.gz`;
	// Written under a temporary name: a half-written archive never shows up as a backup.
	const partial = join(BACKUP_DIR, `${id}.partial`);
	const r = await tar(["-czf", partial, "-C", CONFIG_DIR, ...members]);
	if (!r.ok) {
		await rm(partial, { force: true });
		throw new Error(`tar failed: ${r.err.trim()}`);
	}
	await rename(partial, join(BACKUP_DIR, id));
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
	const hasConfigs = configTops(names).length > 0;
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

const worldOfMember = (n: string) =>
	n
		.split("/")[1]
		?.split(".")[0]
		.replace(/_backup_.*$/, "")
		.replace(/_main$/, "");

/** the config folder's top-level entries in an archive, as member names */
const configTops = (names: string[]) => [
	...new Set(
		names
			.filter((n) => n.startsWith(`${CONFIG_MEMBER}/`))
			.map((n) => n.slice(CONFIG_MEMBER.length + 1).split("/")[0])
			.filter((top) => top && isConfigEntry(top))
			.map((top) => `${CONFIG_MEMBER}/${top}`),
	),
];

/** Archive member names that could land outside the extraction directory. */
const unsafeMember = (n: string) => n.startsWith("/") || n.includes("\\") || n.split("/").some((p) => p === ".." || p.includes(":"));

/**
 * Replaces the world (and optionally the configs) from the archive. Nothing live is touched until the
 * archive is fully extracted and checked in a staging directory; then the old files are moved aside and the
 * new ones moved in by rename (same filesystem), and a failure moves the old ones back. The caller stops
 * the game and takes the safety backup (maintenance.ts).
 */
export async function restoreFiles(id: string, opts: RestoreOptions): Promise<{ restored: string[] }> {
	const file = join(BACKUP_DIR, safeId(id));
	const contents = await inspectBackup(id);
	if (!contents.worlds.includes(opts.world)) throw new Error(`world "${opts.world}" is not in this backup`);
	const names = (await tar(["-tzf", file])).out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const bad = names.find(unsafeMember);
	if (bad) throw new Error(`unsafe path in the archive: ${bad}`);
	const worldTops = [
		...new Set(
			names
				.filter((n) => n.startsWith("worlds_local/") && worldOfMember(n) === opts.world)
				.filter((n) => !n.endsWith("/") || n.split("/").length === 3)
				.map((m) => m.split("/").slice(0, 2).join("/")),
		),
	];
	const withConfigs = opts.configs && contents.hasConfigs;

	const run = `${stamp()}-${Math.random().toString(36).slice(2, 6)}`;
	const stage = join(RESTORE_TMP_DIR, `${run}-new`);
	const old = join(RESTORE_TMP_DIR, `${run}-old`);
	await mkdir(stage, { recursive: true });
	let keepOld = false;
	try {
		const r = await tar(["-xzf", file, "-C", stage, ...worldTops]);
		if (!r.ok) throw new Error(`tar failed: ${r.err.trim()}`);
		if (withConfigs) {
			const c = await tar(["-xzf", file, "-C", stage, ...configTops(names)]);
			if (!c.ok) throw new Error(`tar failed: ${c.err.trim()}`);
		}
		await assertNoSymlinks(stage);
		const staged = await readdir(join(stage, "worlds_local")).catch(() => [] as string[]);
		const stagedConfigs = withConfigs ? await configEntries(join(stage, CONFIG_MEMBER)) : [];
		if (!staged.length) throw new Error(`world "${opts.world}" could not be extracted from ${id}`);

		// Swap. Every move is recorded so a failure halfway can be undone.
		const done: { from: string; to: string }[] = [];
		const move = async (from: string, to: string) => {
			await mkdir(dirname(to), { recursive: true });
			await rename(from, to);
			done.push({ from, to });
		};
		const existing = await worldEntries(opts.world);
		const ownerRef = existing.length ? join(WORLDS_DIR, existing[0]) : WORLDS_DIR;
		try {
			for (const e of existing) await move(join(WORLDS_DIR, e), join(old, "worlds_local", e));
			for (const e of staged) await move(join(stage, "worlds_local", e), join(WORLDS_DIR, e));
			if (withConfigs) {
				// Entry by entry: plugins/ and patchers/ share the folder and stay where they are.
				for (const e of await configEntries()) await move(join(BEPINEX_CONFIG_DIR, e), join(old, "config", e));
				for (const e of stagedConfigs) await move(join(stage, CONFIG_MEMBER, e), join(BEPINEX_CONFIG_DIR, e));
			}
		} catch (e) {
			let rolledBack = true;
			for (const m of done.reverse()) await rename(m.to, m.from).catch(() => (rolledBack = false));
			if (!rolledBack) {
				keepOld = true;
				throw new Error(`restore failed and could not be fully undone; the previous files are in ${old}: ${(e as Error).message}`);
			}
			throw new Error(`restore failed, the previous files are back in place: ${(e as Error).message}`);
		}
		// The game must be able to write what was restored: give it the owner the replaced files had.
		for (const e of staged) await chownTreeLike(join(WORLDS_DIR, e), ownerRef);
		for (const e of stagedConfigs) await chownTreeLike(join(BEPINEX_CONFIG_DIR, e), BEPINEX_CONFIG_DIR);
		const restored = [`worlds_local/${opts.world}`];
		if (withConfigs) restored.push("configs");
		return { restored };
	} finally {
		await rm(stage, { recursive: true, force: true });
		// After a clean swap or rollback the old files are redundant (they are also in the safety backup).
		if (!keepOld) await rm(old, { recursive: true, force: true });
	}
}
