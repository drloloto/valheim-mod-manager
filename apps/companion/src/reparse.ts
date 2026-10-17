// What really runs on this server versus the lock. Three sources, compared per package:
//   the lock          config/modmanager/manifest.json (what the companion publishes to players)
//   installed.json    what the companion itself installed, with versions and file lists
//   plugins/ on disk  `Namespace-Name` folders the companion did not install = hand-installed; their version
//                     is resolved like takeover.ts does (Thunderstore release at copy time, else the DLL's own)
// `--write` replaces the lock with what is on disk, unless something blocks it: a package Thunderstore cannot
// resolve, a staged release, or lock entries that would be dropped (`--force` overrides the last two).
//   bun run src/reparse.ts [--write] [--force] [--json]        (reparse.sh runs this inside the container)
import { stat } from "fs/promises";
import { join } from "path";
import { loadInstalled, type Installed } from "./install";
import { configHashes, isPack, loadManifest, normalizeManifest, saveManifest, type Manifest, type ManifestMod, type ServerInfo } from "./manifest";
import { BEPINEX_DIR } from "./paths";
import { pendingRelease } from "./releases";
import { lockFrom, resolveCandidate, scanPlugins, storeApi, type PackageApi, type Resolved } from "./takeover";

export type Source = "companion" | "hand" | "image" | "lock-only";
export type Status = "ok" | "version" | "not-in-lock" | "not-on-disk" | "unresolved";

export interface Row {
	id: string;
	/** version in the lock, null when the lock does not have the package */
	lock: string | null;
	/** version on disk: installed.json for companion installs, the resolved release for hand installs */
	disk: string | null;
	source: Source;
	status: Status;
	note?: string;
}

export interface Report {
	rows: Row[];
	/** entries of plugins/ nobody can map to a package (loose files, odd folders) */
	unidentified: string[];
	/** what `--write` would store, null when nothing on disk could be identified */
	proposed: Manifest | null;
	/** why `--write` must not run as is */
	blockers: string[];
	/** lock entries the proposed lock drops (need --force) */
	dropped: string[];
	inSync: boolean;
}

export interface ReparseOpts {
	bepinexDir?: string;
	api?: PackageApi;
	configs?: Record<string, string>;
	lock: Manifest | null;
	installed: Installed;
	pendingRelease: boolean;
	force?: boolean;
}

const byId = (mods: ManifestMod[]) => new Map(mods.map((m) => [m.id, m]));

export async function reparse(server: ServerInfo, o: ReparseOpts): Promise<Report> {
	const bepinexDir = o.bepinexDir ?? BEPINEX_DIR;
	const api = o.api ?? storeApi;
	const lock = byId(o.lock?.mods ?? []);
	const scan = await scanPlugins(bepinexDir);
	const tracked = new Set(Object.values(o.installed).flatMap((e) => e.files));
	const rows: Row[] = [];
	const resolvedHand: Resolved[] = [];
	const blockers: string[] = [];

	// 1. companion installs: installed.json is authoritative for the version; the files must still be there
	for (const [id, e] of Object.entries(o.installed).sort(([a], [b]) => a.localeCompare(b))) {
		let present = false;
		for (const f of e.files) {
			if (
				await stat(join(bepinexDir, f)).then(
					() => true,
					() => false,
				)
			) {
				present = true;
				break;
			}
		}
		const l = lock.get(id)?.version ?? null;
		rows.push({
			id,
			lock: l,
			disk: present ? e.version : null,
			source: "companion",
			status: !present ? "not-on-disk" : l === null ? "not-in-lock" : l === e.version ? "ok" : "version",
			note: present ? undefined : "installed.json lists it, no file of it is on disk",
		});
	}

	// 2. hand installs: package folders without an installed.json entry
	for (const c of scan.candidates) {
		if (o.installed[c.id]) continue;
		const l = lock.get(c.id)?.version ?? null;
		try {
			const r = await resolveCandidate(c, api);
			if (!r) {
				rows.push({ id: c.id, lock: l, disk: null, source: "hand", status: "unresolved", note: "not on Thunderstore" });
				continue;
			}
			resolvedHand.push(r);
			rows.push({
				id: c.id,
				lock: l,
				disk: r.version,
				source: "hand",
				status: l === null ? "not-in-lock" : l === r.version ? "ok" : "version",
				note: r.from === "latest" ? undefined : r.from === "dll" ? "version read from the DLL" : "guessed: latest release, published after the copy",
			});
		} catch (e) {
			rows.push({ id: c.id, lock: l, disk: null, source: "hand", status: "unresolved", note: (e as Error).message });
		}
	}

	// 3. lock entries nothing on disk accounts for (dependencies pinned by the lock are re-derived below);
	//    BepInExPack is shipped by the server image, never installed, and stays as the lock pins it
	const seen = new Set(rows.map((r) => r.id));
	for (const m of o.lock?.mods ?? []) {
		if (seen.has(m.id)) continue;
		if (isPack(m.id)) {
			rows.push({ id: m.id, lock: m.version, disk: m.version, source: "image", status: "ok", note: "shipped by the server image" });
			continue;
		}
		{
			rows.push({
				id: m.id,
				lock: m.version,
				disk: null,
				source: "lock-only",
				status: "not-on-disk",
				note: m.explicit ? undefined : `dependency of ${m.requiredBy.join(", ") || "?"}`,
			});
		}
	}
	rows.sort((a, b) => a.id.localeCompare(b.id));

	// unidentified: whatever the scan could not name and installed.json does not track either
	const unidentified = scan.unidentified.filter((p) => ![...tracked].some((f) => f === p || f.startsWith(p + "/")));

	// the proposed lock: hand installs with their Thunderstore dependencies, companion installs as they are
	const fromHand = lockFrom(resolvedHand);
	const proposedMap = byId(fromHand);
	for (const [id, e] of Object.entries(o.installed)) {
		const row = rows.find((r) => r.id === id);
		if (row?.status === "not-on-disk") continue;
		const old = lock.get(id);
		const dep = proposedMap.get(id);
		proposedMap.set(id, {
			id,
			version: e.version,
			explicit: old?.explicit ?? dep?.explicit ?? true,
			requiredBy: [...new Set([...(old?.requiredBy ?? []), ...(dep?.requiredBy ?? [])])],
		});
	}
	// a dependency the lock already pins at a newer version keeps the lock's pin (the client resolved it)
	for (const m of proposedMap.values()) {
		const old = lock.get(m.id);
		if (!m.explicit && old && !old.explicit && newerThan(old.version, m.version)) m.version = old.version;
	}
	// the image's BepInExPack stays in the lock as it is (players need it in their profile)
	for (const m of lock.values()) {
		if (isPack(m.id) && !proposedMap.has(m.id)) proposedMap.set(m.id, { ...m, requiredBy: [...m.requiredBy] });
	}
	const proposedMods = [...proposedMap.values()].sort((a, b) => a.id.localeCompare(b.id));
	const proposed = proposedMods.length ? normalizeManifest({ mods: proposedMods }, server, o.configs ?? (await configHashes())) : null;

	const dropped = [...lock.keys()].filter((id) => !proposedMap.has(id));
	const unresolved = rows.filter((r) => r.status === "unresolved");
	if (unresolved.length) blockers.push(`${unresolved.length} package(s) could not be resolved: ${unresolved.map((r) => r.id).join(", ")}`);
	if (o.pendingRelease && !o.force) blockers.push("a staged release exists; apply or discard it first (or --force)");
	if (dropped.length && !o.force)
		blockers.push(`the new lock would drop ${dropped.length} entr${dropped.length === 1 ? "y" : "ies"}: ${dropped.join(", ")} (--force to accept)`);
	if (!proposed) blockers.push("nothing identifiable on disk; the lock would be empty");

	const inSync = rows.every((r) => r.status === "ok") && (!o.lock || sameSet(o.lock.mods, proposedMods));
	return { rows, unidentified, proposed, blockers, dropped, inSync };
}

function newerThan(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
}

const sameSet = (a: ManifestMod[], b: ManifestMod[]) => a.length === b.length && a.every((m) => b.some((n) => n.id === m.id && n.version === m.version));

export function renderTable(r: Report): string {
	const w = Math.max(7, ...r.rows.map((x) => x.id.length));
	const line = (id: string, lock: string, disk: string, src: string, st: string, note = "") =>
		`${id.padEnd(w)}  ${lock.padEnd(10)}  ${disk.padEnd(10)}  ${src.padEnd(9)}  ${st}${note ? `  (${note})` : ""}`;
	const out = [line("package", "lock", "on disk", "source", "status")];
	for (const x of r.rows) out.push(line(x.id, x.lock ?? "-", x.disk ?? "-", x.source, x.status, x.note));
	if (r.unidentified.length) out.push("", `unidentified in plugins/ (no Namespace-Name folder, not tracked): ${r.unidentified.join(", ")}`);
	return out.join("\n");
}

if (import.meta.main) {
	const args = new Set(process.argv.slice(2));
	const write = args.has("--write");
	const force = args.has("--force");
	const json = args.has("--json");
	const { activeWorld, envValue } = await import("./env");
	const server: ServerInfo = { name: (await envValue("SERVER_NAME")) || "Valheim", world: await activeWorld(), gameVersion: null, bepinex: null };
	const report = await reparse(server, { lock: await loadManifest(), installed: await loadInstalled(), pendingRelease: !!(await pendingRelease()), force });
	if (json) console.log(JSON.stringify({ ...report, proposed: report.proposed?.mods ?? null }, null, 2));
	else {
		console.log(renderTable(report));
		console.log("");
		if (report.inSync) console.log("lock matches what is on disk");
		else {
			const n = report.rows.filter((r) => r.status !== "ok").length;
			console.log(
				`${n} difference${n === 1 ? "" : "s"}; the lock would have ${report.proposed?.mods.length ?? 0} mods${report.dropped.length ? `, dropping ${report.dropped.join(", ")}` : ""}`,
			);
		}
	}
	if (!write) process.exit(report.inSync ? 0 : 1);
	if (report.blockers.length) {
		console.error(`not written:\n  - ${report.blockers.join("\n  - ")}`);
		process.exit(2);
	}
	await saveManifest(report.proposed!);
	console.log(`lock written: ${report.proposed!.mods.length} mods, hash ${report.proposed!.hash}`);
}
