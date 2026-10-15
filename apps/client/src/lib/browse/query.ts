// Search text of the Browse page: free text plus field terms (`name:arrow`, `desc:"fire arrow"`, `author:azumatt`,
// `-word` excludes). Free text searches the chosen scope (everything by default). Pure, no Svelte.
import type { SlimPkg } from "#lib/api/types.js";

export const SEARCH_SCOPES = ["all", "name", "desc", "author"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];
export type SearchField = Exclude<SearchScope, "all">;

/** Field prefixes, English and German, as typed in the search field. */
const ALIASES: Record<string, SearchField> = {
	name: "name",
	title: "name",
	titel: "name",
	n: "name",
	desc: "desc",
	description: "desc",
	beschreibung: "desc",
	d: "desc",
	author: "author",
	autor: "author",
	owner: "author",
	by: "author",
	a: "author",
};

export interface SearchKey {
	name: string;
	author: string;
	desc: string;
	all: string;
}

export interface Term {
	field: SearchScope;
	text: string;
	negate: boolean;
}

export interface Query {
	terms: Term[];
}

export function normalize(s: string): string {
	return s.toLowerCase().replace(/[\s_-]/g, "");
}

/** Search keys of a package; compute once per index, not per keystroke. */
export function searchKey(p: SlimPkg): SearchKey {
	const name = normalize(p.name);
	const author = normalize(p.ns);
	const desc = normalize(p.desc);
	return { name, author, desc, all: `${name}${author}${desc}` };
}

export function parseScope(v: unknown): SearchScope | null {
	return SEARCH_SCOPES.includes(v as SearchScope) ? (v as SearchScope) : null;
}

const TOKEN = /(-?)(?:([a-zäöü]+):)?(?:"([^"]*)"?|(\S+))/giu;

/**
 * Splits the search text into terms. Positive free words stay one needle (spaces are ignored like before,
 * so "epic loot" finds "EpicLoot"); every field term and every excluded word is its own term. An unknown
 * prefix ("c:", "http:") is plain text.
 */
export function parseQuery(q: string, scope: SearchScope = "all"): Query {
	const terms: Term[] = [];
	let free = "";
	for (const m of q.matchAll(TOKEN)) {
		const [whole, minus, prefix, quoted, bare] = m;
		const field = prefix ? ALIASES[prefix.toLowerCase()] : undefined;
		// "name:" with nothing after it yet: the user is still typing the term
		if (!prefix && bare?.endsWith(":") && ALIASES[bare.slice(0, -1).toLowerCase()]) continue;
		const raw = field ? (quoted ?? bare ?? "") : prefix ? whole.slice(minus.length) : (quoted ?? bare ?? "");
		const text = normalize(raw);
		if (!text) continue;
		if (field) terms.push({ field, text, negate: !!minus });
		else if (minus) terms.push({ field: scope, text, negate: true });
		else free += text;
	}
	if (free) terms.unshift({ field: scope, text: free, negate: false });
	return { terms };
}

export function isEmptyQuery(q: Query): boolean {
	return q.terms.length === 0;
}

export function matchesQuery(key: SearchKey, q: Query): boolean {
	return q.terms.every((t) => key[t.field].includes(t.text) !== t.negate);
}

/** What an exact name match is compared with for the default sort: the name term, else the free text. */
export function nameNeedle(q: Query): string {
	const pos = q.terms.filter((t) => !t.negate);
	return (pos.find((t) => t.field === "name") ?? pos.find((t) => t.field === "all"))?.text ?? "";
}
