// One status per package from the active profile's point of view, for lists and the detail panel.

export type ModStatus = "update" | "inProfile" | "disabled" | "dependency" | "none";

export interface StatusInput {
	mods: ReadonlyMap<string, { enabled: boolean }>;
	updates: Readonly<Record<string, string>>;
	resolved: Readonly<Record<string, unknown>> | undefined;
}

export function modStatus(id: string, s: StatusInput): ModStatus {
	const m = s.mods.get(id);
	if (m) {
		if (id in s.updates) return "update";
		return m.enabled ? "inProfile" : "disabled";
	}
	if (s.resolved && id in s.resolved) return "dependency";
	return "none";
}
