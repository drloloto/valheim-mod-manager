// Run by safety.test.ts in its own process: paths.ts fixes CONFIG_DIR/BACKUP_DIR at import, and bun test
// shares modules between test files. Prints one JSON object with what happened in each scenario.
import { mkdir, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import { join } from "path";

const CONFIG = process.env.CONFIG_DIR!;
const BACKUPS = process.env.BACKUP_DIR!;
const { createBackup, restoreFiles } = await import("../backups");
const { withServerStopped } = await import("../maintenance");

const world = (f: string) => join(CONFIG, "worlds_local", f);
// Layout of the valheim-server image: configs directly in bepinex/, next to plugins/.
const bep = (f: string) => join(CONFIG, "bepinex", f);
const cfg = bep("a.cfg");
const read = (p: string) => readFile(p, "utf-8").catch(() => null);
const out: Record<string, unknown> = {};

await mkdir(join(CONFIG, "worlds_local"), { recursive: true });
await mkdir(bep("plugins"), { recursive: true });
await mkdir(bep("EpicLoot"), { recursive: true });
await mkdir(world("C"), { recursive: true });
await mkdir(world("C_backup_auto-20261011-091040"), { recursive: true });
await mkdir(BACKUPS, { recursive: true });
await writeFile(world("W.db"), "v1-db");
await writeFile(world("W.fwl"), "v1-fwl");
await writeFile(world("Other.db"), "other");
await writeFile(cfg, "v1-cfg");
await writeFile(bep("EpicLoot/x.json"), "v1-json");
await writeFile(bep("plugins/P.dll"), "v1-plugin");
await writeFile(world("C/_main.1.db2"), "c1");
await writeFile(world("C_backup_auto-20261011-091040/_main.0.db2"), "c0");

// 1. Restore puts the backed-up world and configs back, leaves other worlds alone, cleans its temp dirs.
const b = await createBackup("W", "test");
await writeFile(world("W.db"), "v2-db");
await writeFile(world("W.fwl"), "v2-fwl");
await writeFile(world("W.db.old"), "v2-old"); // a file only the newer state has
await writeFile(cfg, "v2-cfg");
await writeFile(bep("new.cfg"), "v2-only");
await writeFile(bep("plugins/P.dll"), "v2-plugin");
const members = (await Bun.$`tar -tzf ${join(BACKUPS, b.id)}`.text()).split(/\r?\n/).filter(Boolean);
const r = await restoreFiles(b.id, { world: "W", configs: true });
out.restore = {
	restored: r.restored,
	db: await read(world("W.db")),
	fwl: await read(world("W.fwl")),
	dbOld: await read(world("W.db.old")),
	other: await read(world("Other.db")),
	cfg: await read(cfg),
	json: await read(bep("EpicLoot/x.json")),
	newCfg: await read(bep("new.cfg")),
	plugin: await read(bep("plugins/P.dll")),
	pluginsInArchive: members.filter((m) => m.includes("plugins")),
	tmpLeft: await readdir(join(CONFIG, "modmanager", "restore-tmp")).catch(() => []),
	partialLeft: (await readdir(BACKUPS)).filter((f) => f.endsWith(".partial")),
};

// 1b. Chunked world: the folder and the game's own auto-backup folders belong to it.
const cb = await createBackup("C");
await rm(world("C"), { recursive: true });
await restoreFiles(cb.id, { world: "C", configs: false });
out.chunked = {
	members: (await Bun.$`tar -tzf ${join(BACKUPS, cb.id)}`.text())
		.split(/\r?\n/)
		.filter((m) => m.startsWith("worlds_local/"))
		.sort(),
	main: await read(world("C/_main.1.db2")),
	auto: await read(world("C_backup_auto-20261011-091040/_main.0.db2")),
};

// 2. A world that is not in the archive: nothing changes.
try {
	await restoreFiles(b.id, { world: "Nope", configs: false });
	out.missingWorld = "no error";
} catch (e) {
	out.missingWorld = { error: (e as Error).message, db: await read(world("W.db")) };
}

// 3. Restore without a reachable Docker (no socket here): refused, the change does not run.
let ran = false;
try {
	await withServerStopped({ world: "W", label: "pre-restore", control: false, requireStopped: true }, async () => {
		ran = true;
	});
	out.restoreWithoutDocker = { ran };
} catch (e) {
	out.restoreWithoutDocker = { ran, error: (e as Error).message };
}

// 4. Backup fails (backup dir replaced by a file): the change does not run.
ran = false;
await rename(BACKUPS, `${BACKUPS}-moved`);
await writeFile(BACKUPS, "not a directory");
try {
	await withServerStopped({ world: "W", label: "pre-release", control: false, requireStopped: false }, async () => {
		ran = true;
	});
	out.backupFails = { ran };
} catch (e) {
	out.backupFails = { ran, error: (e as Error).message };
}
await rm(BACKUPS, { force: true });
await rename(`${BACKUPS}-moved`, BACKUPS);

// 5. Normal apply path without control: backup is taken, change runs, admin restarts.
const before = (await readdir(BACKUPS)).length;
const rep = await withServerStopped({ world: "W", label: "pre-release", control: false, requireStopped: false }, async () => "done");
out.applyWithoutControl = {
	value: rep.value,
	backupTaken: !!rep.backup,
	newBackups: (await readdir(BACKUPS)).length - before,
	restartRequired: rep.restartRequired,
};

// 6. No world on disk yet (fresh server): proceeds without a backup.
const rep2 = await withServerStopped({ world: "Fresh", label: "pre-release", control: false, requireStopped: false }, async () => "ok");
out.freshServer = { value: rep2.value, backup: rep2.backup };

console.log(JSON.stringify(out));
