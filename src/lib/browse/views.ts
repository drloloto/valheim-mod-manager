// Views: named filter combinations, built in or saved by the user.
import { isRecord } from "#lib/desktop/storage.js";
import { t } from "#lib/i18n/t.js";
import { parseCriteria, sameFilters, withDate, withList, withNum, type Criteria } from "./criteria";

export interface View {
	id: string;
	name: string;
	criteria: Criteria;
}

/** Built-in views build on `base` so the default exclusions (deprecated, NSFW) are kept. */
export function builtinViews(base: Criteria): View[] {
	const b = { ...base, query: "" };
	return [
		{
			id: "proven",
			name: t("view.proven"),
			criteria: withNum(withDate(b, "upd", { op: "within", n: 90, unit: "day", from: null, to: null }), "dl", { op: "gte", from: 10_000, to: null }),
		},
		{ id: "new", name: t("view.new"), criteria: withDate(b, "created", { op: "within", n: 30, unit: "day", from: null, to: null }) },
		{ id: "nodeps", name: t("view.nodeps"), criteria: withList(b, "deps", { none: 1 }) },
		{ id: "updates", name: t("view.updates"), criteria: withList(b, "status", { update: 1 }) },
		{ id: "notInProfile", name: t("view.notInProfile"), criteria: withList(b, "status", { none: 1 }) },
	];
}

export function activeView(views: readonly View[], c: Criteria): View | undefined {
	return views.find((v) => sameFilters(v.criteria, c));
}

export function addView(views: readonly View[], id: string, name: string, criteria: Criteria): View[] {
	return [...views.filter((v) => v.id !== id), { id, name: name.trim(), criteria: { ...criteria, query: "" } }];
}

export function removeView(views: readonly View[], id: string): View[] {
	return views.filter((v) => v.id !== id);
}

export function parseViews(v: unknown): View[] | null {
	if (!Array.isArray(v)) return null;
	const out: View[] = [];
	for (const x of v) {
		if (!isRecord(x) || typeof x.id !== "string" || typeof x.name !== "string") continue;
		const criteria = parseCriteria(x.criteria);
		if (criteria) out.push({ id: x.id, name: x.name, criteria });
	}
	return out;
}
