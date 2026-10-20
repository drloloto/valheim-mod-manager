// Active filters as "field · operator · value" tokens above the table.
import {
	DATE_KEYS,
	dropSign,
	entries,
	fieldLabel,
	flipSign,
	itemLabel,
	LIST_KEYS,
	NUM_KEYS,
	withDate,
	withList,
	withNum,
	type Criteria,
	type DateKey,
	type ListKey,
	type NumKey,
	type Tri,
} from "./criteria";
import { t } from "#lib/i18n/t.js";
import { dateActive, describeDate, describeNum, flipDateOp, flipNumOp, numActive } from "./ranges";

interface TokenBase {
	field: string;
	op: string;
	value: string;
	/** Exclusion form: is not, older than, outside */
	negative: boolean;
}
export type Token =
	| (TokenBase & { kind: "list"; key: ListKey; sign: Tri; values: string[] })
	| (TokenBase & { kind: "date"; key: DateKey })
	| (TokenBase & { kind: "num"; key: NumKey });

export function buildTokens(c: Criteria): Token[] {
	const out: Token[] = [];
	for (const key of LIST_KEYS) {
		for (const sign of [1, -1] as const) {
			const values = entries(c.lists[key], sign);
			if (!values.length) continue;
			out.push({
				kind: "list",
				key,
				sign,
				values,
				field: fieldLabel(key),
				op: sign === 1 ? (key === "cats" && c.catMode === "all" && values.length > 1 ? t("filter.hasAll") : t("filter.is")) : t("filter.isNot"),
				value: values.map((v) => itemLabel(key, v)).join(", "),
				negative: sign === -1,
			});
		}
	}
	for (const key of DATE_KEYS) {
		const r = c.dates[key];
		if (!dateActive(r)) continue;
		const d = describeDate(r);
		out.push({ kind: "date", key, field: fieldLabel(key), op: d.op, value: d.value, negative: r.op === "older" || r.op === "outside" });
	}
	for (const key of NUM_KEYS) {
		const r = c.nums[key];
		if (!numActive(r)) continue;
		const d = describeNum(key, r);
		out.push({ kind: "num", key, field: fieldLabel(key), op: d.op, value: d.value, negative: r.op === "outside" });
	}
	return out;
}

/** Invert the operator: is ↔ is not, within ↔ older than, between ↔ outside, ≥ ↔ ≤. */
export function flipToken(c: Criteria, t: Token): Criteria {
	if (t.kind === "list") return withList(c, t.key, flipSign(c.lists[t.key], t.sign));
	if (t.kind === "date") {
		const r = c.dates[t.key]!;
		return withDate(c, t.key, { ...r, op: flipDateOp(r.op) });
	}
	const r = c.nums[t.key]!;
	const op = flipNumOp(r.op);
	// ≥ a becomes ≤ a: the set bound moves to the other side
	const bounds =
		op === "lte" && r.op === "gte" ? { from: null, to: r.from } : op === "gte" && r.op === "lte" ? { from: r.to, to: null } : { from: r.from, to: r.to };
	return withNum(c, t.key, { op, ...bounds });
}

export function removeToken(c: Criteria, t: Token): Criteria {
	if (t.kind === "list") return withList(c, t.key, dropSign(c.lists[t.key], t.sign));
	if (t.kind === "date") return withDate(c, t.key, null);
	return withNum(c, t.key, null);
}
