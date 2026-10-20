// Rows of the Installed table: one per mod of the profile and per resolved dependency, each with one
// source (who decides it is there) and one install state. Sorted by a fixed rule, never by install order.
import type { Plan, ProfileMod } from "#lib/api/types.js";
import type { SortState } from "#lib/components/kit/types.js";
import { collator } from "#lib/format.js";

/** Who put the mod in the profile: the linked server (required), the server's recommendation (optional), the
 *  player, a local file, or the resolver. */
export type Source = "server" | "optional" | "own" | "local" | "dependency";
export const SOURCES: readonly Source[] = ["server", "optional", "own", "local", "dependency"];

/** One state per row, worst first: what the status column says. */
export type InstallState = "installing" | "missing" | "update" | "disabled" | "ok";
const STATE_ORDER: readonly InstallState[] = ["installing", "missing", "update", "disabled", "ok"];

export interface InstalledRow {
	id: string;
	kind: "mod" | "dep";
	name: string;
	author: string;
	version: string;
	source: Source;
	state: InstallState;
	/** Only for mod rows; dependencies are always on. */
	mod: ProfileMod | null;
	/** Dependencies: the mods that need it; empty for the loader itself (BepInEx). */
	requiredBy: string[];
	/** Version an update would bring. */
	update: string | null;
}

export interface RowsInput {
	mods: readonly ProfileMod[];
	plan: Plan | null;
	/** Dependencies the linked server requires on its own. */
	implicitMods: readonly string[];
	updates: Readonly<Record<string, string>>;
	missing: ReadonlySet<string>;
	syncing: boolean;
	/** Display name from the index, if known. */
	nameOf: (id: string) => string | undefined;
}

export const rowId = (m: { namespace: string; name: string }) => `${m.namespace}-${m.name}`;

function stateOf(id: string, i: RowsInput, mod: ProfileMod | null): InstallState {
	if (i.missing.has(id)) return i.syncing ? "installing" : "missing";
	if (mod && id in i.updates) return "update";
	if (mod && !mod.enabled) return "disabled";
	return "ok";
}

export function buildRows(i: RowsInput): InstalledRow[] {
	const own = new Set(i.mods.map(rowId));
	const mods = i.mods.map((m): InstalledRow => {
		const id = rowId(m);
		return {
			id,
			kind: "mod",
			name: m.name,
			author: m.namespace,
			version: m.version,
			source: m.managed ? "server" : m.optional ? "optional" : m.source === "local" ? "local" : "own",
			state: stateOf(id, i, m),
			mod: m,
			requiredBy: [],
			update: i.updates[id] ?? null,
		};
	});
	const deps = Object.entries(i.plan?.resolved ?? {})
		.filter(([id]) => !own.has(id))
		.map(([id, r]): InstalledRow => ({
			id,
			kind: "dep",
			name: i.nameOf(id) ?? id.slice(id.indexOf("-") + 1),
			author: id.split("-")[0],
			version: r.version,
			source: !r.requiredBy.length && i.implicitMods.includes(id) ? "server" : "dependency",
			state: stateOf(id, i, null),
			mod: null,
			requiredBy: r.requiredBy,
			update: null,
		}));
	return [...mods, ...deps];
}

const byName = (a: InstalledRow, b: InstalledRow) => collator().compare(a.name, b.name) || a.id.localeCompare(b.id);

const COMPARE: Record<string, (a: InstalledRow, b: InstalledRow) => number> = {
	mod: byName,
	author: (a, b) => collator().compare(a.author, b.author),
	source: (a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source),
	status: (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
};

/** The loader every profile needs: always the first row, whatever the sort. */
export const LOADER_ID = "denikson-BepInExPack_Valheim";
const loaderFirst = (a: InstalledRow, b: InstalledRow) => Number(b.id === LOADER_ID) - Number(a.id === LOADER_ID);

/**
 * The same order on every machine: the loader, then by source (server, optional, own, local, dependencies), then
 * by name. A column sort replaces the source key; the loader stays on top and ties fall back to the name.
 */
export function sortRows(rows: readonly InstalledRow[], sort: SortState | null): InstalledRow[] {
	const cmp = sort ? COMPARE[sort.key] : undefined;
	if (cmp) {
		const dir = sort!.dir === "asc" ? 1 : -1;
		return [...rows].sort((a, b) => loaderFirst(a, b) || dir * cmp(a, b) || byName(a, b));
	}
	return [...rows].sort((a, b) => loaderFirst(a, b) || COMPARE.source(a, b) || byName(a, b));
}

export function countSources(rows: readonly InstalledRow[]): Record<Source, number> {
	const out: Record<Source, number> = { server: 0, optional: 0, own: 0, local: 0, dependency: 0 };
	for (const r of rows) out[r.source]++;
	return out;
}
