// Is the active profile ready to play? Derived from the core's plan: everything the resolver wants
// installed but installed.json does not have (missing or wrong version) blocks a clean start.
import type { AppState } from "#lib/api/types.js";

const modId = (m: { namespace: string; name: string }) => `${m.namespace}-${m.name}`;

export interface MissingMod {
	id: string;
	version: string;
	/** In the profile itself, as opposed to a resolved dependency. */
	explicit: boolean;
	requiredBy: string[];
}

export type ReadinessStatus =
	| "noProfile"
	/** The plan is not available yet (index still loading). */
	| "unknown"
	| "syncing"
	/** Mods are missing or the resolver reported errors. */
	| "incomplete"
	| "ready";

export interface Readiness {
	status: ReadinessStatus;
	missing: MissingMod[];
	errors: string[];
}

export function computeReadiness(state: Pick<AppState, "active" | "mods" | "plan">, syncing: boolean): Readiness {
	if (!state.active) return { status: "noProfile", missing: [], errors: [] };
	const plan = state.plan;
	if (!plan) return { status: "unknown", missing: [], errors: [] };
	const explicit = new Set(state.mods.map(modId));
	const missing = plan.toInstall.map((t) => ({
		id: t.id,
		version: t.to,
		explicit: explicit.has(t.id),
		requiredBy: plan.resolved[t.id]?.requiredBy ?? [],
	}));
	const errors = [...plan.errors];
	if (syncing) return { status: "syncing", missing, errors };
	return { status: missing.length || errors.length ? "incomplete" : "ready", missing, errors };
}
