// The transfer assistant's review step and the lock rule, as pure functions: which items go into which
// group, what a run will do given the player's choices, and which mods of a profile are read-only.
import type { ProfileMod, TransferCase, TransferChoice, TransferDecision, TransferItem } from "#lib/api/types.js";

/** Review order: what changes first, what stays last. */
export const CASES: readonly TransferCase[] = ["version", "add", "dropped", "extra", "same"];

export function groupItems(items: readonly TransferItem[]): { case: TransferCase; items: TransferItem[] }[] {
	return CASES.map((c) => ({ case: c, items: items.filter((i) => i.case === c) })).filter((g) => g.items.length);
}

/** The decision in force: the player's pick when the item allows it, else the item's default. */
export function decisionOf(item: TransferItem, choices: ReadonlyMap<string, TransferDecision>): TransferDecision {
	const c = choices.get(item.id);
	return c && item.choices.includes(c) ? c : item.decision;
}

export interface TransferSummary {
	/** New installs. */
	install: number;
	/** Version changes. */
	change: number;
	/** Entries that leave the profile. */
	remove: number;
	/** Entries that become server-managed. */
	lock: number;
	/** Extras kept next to the server's set. */
	keep: number;
	/** Kept extras the index calls server-side: they will not work without the server. */
	serverSideKept: number;
}

export function summarize(items: readonly TransferItem[], choices: ReadonlyMap<string, TransferDecision>): TransferSummary {
	const s: TransferSummary = { install: 0, change: 0, remove: 0, lock: 0, keep: 0, serverSideKept: 0 };
	for (const i of items) {
		const d = decisionOf(i, choices);
		if (i.managed && d === "take") s.lock++;
		switch (i.case) {
			case "add":
				if (d === "take") s.install++;
				break;
			case "version":
				if (d === "take") s.change++;
				break;
			case "dropped":
				if (d === "take") s.remove++;
				else s.keep++;
				break;
			case "extra":
				if (d === "remove") s.remove++;
				else {
					s.keep++;
					if (i.side === "server") s.serverSideKept++;
				}
				break;
			case "same":
				break;
		}
	}
	return s;
}

export function toChoices(choices: ReadonlyMap<string, TransferDecision>): TransferChoice[] {
	return [...choices].map(([id, decision]) => ({ id, decision }));
}

/** Server-managed entries are read-only while the profile's Override is off. */
export function lockedIds(mods: readonly ProfileMod[], override: boolean): Set<string> {
	if (override) return new Set();
	return new Set(mods.filter((m) => m.managed).map((m) => `${m.namespace}-${m.name}`));
}
