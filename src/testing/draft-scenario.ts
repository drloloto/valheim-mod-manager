// Run by releases.test.ts in its own process (paths.ts fixes CONFIG_DIR at import, bun test shares modules
// between files). Walks the working state through its life: a web edit stages a copy, an identical edit
// drops it, a hand edit of the live file is a conflict, a release writes the file and clears the state.
// Prints one JSON object with what happened.
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const CONFIG = process.env.CONFIG_DIR!;
const bep = (f: string) => join(CONFIG, "bepinex", f);
const info = { name: "s", world: "W", gameVersion: null, bepinex: null };
const out: Record<string, unknown> = {};

await mkdir(bep("plugins/Mod"), { recursive: true });
await mkdir(join(CONFIG, "modmanager"), { recursive: true });
const cfgText = ["[General]", "", "## Speed", "# Setting type: Int32", "# Default value: 1", "Speed = 1", ""].join("\n");
await writeFile(bep("Mod.Alpha.cfg"), cfgText);
await writeFile(bep("Other.cfg"), "[X]\nA = 1\n");
// a plugin that merges ServerSync and re-reads its file; its GUID appears in the DLL as plain bytes
await writeFile(bep("plugins/Mod/Alpha.dll"), "MZ\0\0Mod.Alpha\0ServerSync\0ConfigSync\0ReadConfigValues\0");
await writeFile(join(CONFIG, "modmanager", "installed.json"), JSON.stringify({ "Mod-Alpha": { version: "1.0.0", files: ["plugins/Mod/Alpha.dll"] } }));

const { applyRelease, discardRelease, draftDiff, pendingRelease, refreshPlan, revertConfig, stageConfigChanges, summary } = await import("../releases");
const { workingConfig } = await import("../releases");

// 1. an edit creates the working state with a copy of the file; the live file is untouched
let r = await stageConfigChanges("Mod.Alpha.cfg", [{ section: "General", key: "Speed", value: "5" }], info);
out.stagedFiles = r.configs;
out.liveAfterEdit = await readFile(bep("Mod.Alpha.cfg"), "utf-8");
out.working = (await workingConfig("Mod.Alpha.cfg")).text;
out.plan1 = { changed: r.plan.configsChanged, restart: r.plan.restartRequired, effect: r.plan.effects["Mod.Alpha.cfg"], empty: summary(r).empty, modsFrom: r.modsFrom };

// 2. editing back to the live value drops the copy; the working state stays (empty)
r = await stageConfigChanges("Mod.Alpha.cfg", [{ section: "General", key: "Speed", value: "1" }], info);
out.afterUndo = { configs: r.configs, empty: summary(r).empty };

// 3. a second file without a matching plugin needs a restart; a hand edit of the live copy is a conflict
r = await stageConfigChanges("Other.cfg", [{ section: "X", key: "A", value: "2" }], info);
out.plan3 = { restart: r.plan.restartRequired, effect: r.plan.effects["Other.cfg"]?.sync, conflicts: r.plan.conflicts };
await writeFile(bep("Other.cfg"), "[X]\nA = 3\n");
r = await refreshPlan(r);
out.conflicts = r.plan.conflicts;
const diff = await draftDiff(r);
out.diff = diff.map((d) => ({ path: d.path, status: d.status, conflict: d.conflict, before: d.before, changes: d.changes }));
let refused: string | null = null;
try {
	await applyRelease(r.id);
} catch (e) {
	refused = (e as Error).message;
}
out.refused = refused;

// 4. revert the conflicting file, stage the first one again and release (no docker here: control is off)
r = (await revertConfig("Other.cfg"))!;
r = await stageConfigChanges("Mod.Alpha.cfg", [{ section: "General", key: "Speed", value: "7" }], info);
const report = await applyRelease(r.id, () => {}, { backup: false });
out.report = { written: report.configsWritten, stayedUp: report.stayedUp, restartRequired: report.restartRequired, backup: report.backup, nothingToDo: report.nothingToDo };
out.liveAfterRelease = await readFile(bep("Mod.Alpha.cfg"), "utf-8");
out.pendingAfterRelease = await pendingRelease();
out.manifestConfigs = Object.keys(JSON.parse(await readFile(join(CONFIG, "modmanager", "manifest.json"), "utf-8")).configs);

// 5. an empty working state releases to nothing and disappears
r = await stageConfigChanges("Other.cfg", [{ section: "X", key: "A", value: "3" }], info);
const empty = await applyRelease(r.id);
out.emptyRelease = { nothingToDo: empty.nothingToDo, pending: await pendingRelease() };
await discardRelease();

console.log(JSON.stringify(out));
