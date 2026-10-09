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
