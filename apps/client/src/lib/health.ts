// Human-readable text for health issues reported by the core (see src-tauri/src/health.rs).
import type { HealthIssue } from "#lib/api/types.js";
import { formatDate } from "#lib/format.js";
import { t } from "#lib/i18n/t.js";

export function describeIssue(h: HealthIssue, nameOf: (id: string) => string, gameUpdated: number | null): string {
	const mods = h.ids.map(nameOf).join(", ");
	switch (h.kind) {
		case "duplicate":
			return t("health.duplicate", { file: h.detail, mods });
		case "deprecated":
			return t("health.deprecated", { mod: mods });
		case "stale":
			return t("health.stale", { mod: mods, when: formatDate(Number(h.detail)), game: gameUpdated ? formatDate(gameUpdated) : "?" });
	}
}

export interface HealthGroups {
	/** Mods last updated before the current game update, oldest first. */
	stale: { id: string; name: string; when: number }[];
	deprecated: { id: string; name: string }[];
	duplicates: { file: string; mods: string[] }[];
}

/** The same issues, one group per kind, so the panel explains each kind once instead of once per mod. */
export function groupIssues(issues: readonly HealthIssue[], nameOf: (id: string) => string): HealthGroups {
	const g: HealthGroups = { stale: [], deprecated: [], duplicates: [] };
	for (const h of issues) {
		if (h.kind === "stale") for (const id of h.ids) g.stale.push({ id, name: nameOf(id), when: Number(h.detail) });
		else if (h.kind === "deprecated") for (const id of h.ids) g.deprecated.push({ id, name: nameOf(id) });
		else g.duplicates.push({ file: h.detail, mods: h.ids.map(nameOf) });
	}
	g.stale.sort((a, b) => a.when - b.when || a.name.localeCompare(b.name));
	g.deprecated.sort((a, b) => a.name.localeCompare(b.name));
	return g;
}
