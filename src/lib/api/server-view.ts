import type { t as translate } from "#lib/i18n/index.svelte.js";
import type { ServerCheck } from "./types";

// One reading of the linked server for everything that shows it: the toolbar chip, the status bar and
// the dialogs they open. The state names are the vocabulary; en.ts/de.ts hold the words.
//
//   checking     no answer yet
//   unreachable  the companion or the gist did not answer
//   differs      the profile and the server run different mods or versions → a player adopts, an admin publishes
//   pending      a release waits on the server (staged, or scheduled) → an admin follows it, a player is told
//   inSync       nothing to do
//
// A player sees "differs" before "pending": their job is to match the server. An admin sees "pending"
// first: after a publish their profile is ahead of the server by definition, and the release is the news.

export type ServerKind = "checking" | "unreachable" | "differs" | "pending" | "inSync";
export type ServerTone = "ok" | "warn" | "err" | "muted";
export type ServerAction = "refresh" | "diff" | "publish";

export interface ServerView {
	kind: ServerKind;
	tone: ServerTone;
	pulse: boolean;
	/** short state text, without the server name */
	text: string;
	/** what a click on the state should open */
	action: ServerAction;
	/** staged | scheduled, when a release waits */
	release: "staged" | "scheduled" | null;
}

/** the app's translator; tests pass a stub that returns the key */
type T = typeof translate;

/** staged / scheduled when the server holds a release it has not applied yet, on either transport. */
export function pendingRelease(check: ServerCheck | null): "staged" | "scheduled" | null {
	if (!check?.reachable) return null;
	const g = check.gistRelease;
	if (g && (g.state === "staged" || g.state === "scheduled")) return g.state;
	if (check.release) return check.release.schedule ? "scheduled" : "staged";
	return null;
}

export function serverView(check: ServerCheck | null, admin: boolean, t: T): ServerView {
	if (!check) return { kind: "checking", tone: "muted", pulse: true, text: t("chip.checking"), action: "refresh", release: null };
	if (!check.reachable) return { kind: "unreachable", tone: "err", pulse: false, text: t("chip.unreachable"), action: "refresh", release: null };
	const release = pendingRelease(check);
	const mods = check.diff.changed.length + check.diff.onlyLocal.length + check.diff.onlyServer.length;
	// Configs are not part of this: synced mods take them at join, the rest came once with the profile.
	const differs = (): ServerView => ({
		kind: "differs",
		tone: "warn",
		pulse: false,
		text: t("chip.differs", { what: t("chip.mods", { n: mods }) }),
		action: admin ? "publish" : "diff",
		release,
	});
	const pending = (): ServerView => ({
		kind: "pending",
		tone: "warn",
		pulse: true,
		text: admin ? t(release === "scheduled" ? "chip.releaseScheduled" : "chip.releaseStaged") : t("chip.updateComing"),
		action: admin ? "publish" : "refresh",
		release,
	});
	if (admin && release) return pending();
	if (!check.inSync) return differs();
	if (release) return pending();
	return { kind: "inSync", tone: "ok", pulse: false, text: t("chip.inSync"), action: admin ? "publish" : "refresh", release };
}
