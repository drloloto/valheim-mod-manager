<script lang="ts">
	import type { DateOp, DateRange, DateUnit } from "#lib/browse/criteria.js";
	import { bucketDateRange, bucketInDate, dateActive, DATE_OPS, DATE_UNITS, dateOpLabel, extendDateRange, unitLabel, type Bucket } from "#lib/browse/ranges.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import Histogram from "./histogram.svelte";
	import Segmented from "./segmented.svelte";

	let {
		value,
		onchange,
		buckets,
		counts,
		now,
	}: {
		value: DateRange | null;
		onchange: (r: DateRange | null) => void;
		buckets: Bucket[];
		counts: number[];
		now: number;
	} = $props();

	const PRESETS: { key: "preset.7d" | "preset.30d" | "preset.90d" | "preset.1y"; n: number; unit: DateUnit }[] = [
		{ key: "preset.7d", n: 7, unit: "day" },
		{ key: "preset.30d", n: 30, unit: "day" },
		{ key: "preset.90d", n: 90, unit: "day" },
		{ key: "preset.1y", n: 1, unit: "year" },
	];

	const op = $derived(value?.op ?? "within");
	const relative = $derived(op === "within" || op === "older");
	const active = $derived(dateActive(value));
	const selected = $derived(buckets.map((b) => bucketInDate(b, value, now)));

	function base(): DateRange {
		return value ?? { op: "within", n: 0, unit: "day", from: null, to: null };
	}
	function setOp(next: DateOp) {
		const r = { ...base(), op: next };
		if ((next === "within" || next === "older") && r.n <= 0) r.n = 30;
		onchange(r);
	}
	function setN(raw: string) {
		onchange({ ...base(), n: Math.max(0, Math.floor(Number(raw) || 0)) });
	}
	function setUnit(unit: string) {
		onchange({ ...base(), unit: unit as DateUnit });
	}
	function preset(p: { n: number; unit: DateUnit }) {
		onchange({ ...base(), op: relative ? op : "within", n: p.n, unit: p.unit });
	}
	function pick(i: number, extend: boolean) {
		onchange(extend ? extendDateRange(value, buckets[i]) : bucketDateRange(buckets[i]));
	}

	// Date fields: yyyy-mm-dd (local) ↔ milliseconds; "to" means the end of the day.
	const toInput = (ms: number | null) => {
		if (ms === null) return "";
		const d = new Date(ms);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	};
	const fromInput = (s: string, end: boolean) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
		if (!m) return null;
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
		return Number.isNaN(d.getTime()) ? null : d.getTime();
	};
	const fieldClass = "h-[28px] font-mono text-xs [color-scheme:dark]";
</script>

<div class="flex flex-col gap-2.5">
	<Segmented columns={4} options={DATE_OPS.map((o) => ({ value: o, label: dateOpLabel(o) }))} bind:value={() => op, (v) => setOp(v as DateOp)} />
	<Histogram {counts} labels={buckets.map((b) => b.label)} {selected} onpick={pick} />
	{#if relative}
		<div class="grid grid-cols-[72px_minmax(0,1fr)] gap-1.5">
			<Input type="number" min="0" class={fieldClass} aria-label={t("filter.amount")} value={value?.n ?? ""} oninput={(e) => setN(e.currentTarget.value)} />
			<Select.Root type="single" value={value?.unit ?? "day"} onValueChange={setUnit}>
				<Select.Trigger class="h-[28px] w-full text-xs" aria-label={t("filter.unit")}>{unitLabel(value?.unit ?? "day")}</Select.Trigger>
				<Select.Content>
					{#each DATE_UNITS as u (u)}<Select.Item value={u} label={unitLabel(u)} class="text-xs" />{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{:else}
		<div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
			<Input
				type="date"
				class={fieldClass}
				aria-label={t("filter.from")}
				value={toInput(value?.from ?? null)}
				onchange={(e) => onchange({ ...base(), from: fromInput(e.currentTarget.value, false) })}
			/>
			<span class="text-subtle-foreground text-xs">–</span>
			<Input
				type="date"
				class={fieldClass}
				aria-label={t("filter.to")}
				value={toInput(value?.to ?? null)}
				onchange={(e) => onchange({ ...base(), to: fromInput(e.currentTarget.value, true) })}
			/>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-1">
		{#each PRESETS as p (p.key)}
			<button
				type="button"
				class="border-input text-foreground-soft hover:bg-hover aria-pressed:border-primary-line aria-pressed:bg-primary-tint aria-pressed:text-primary-text h-[22px] rounded-[4px] border px-2 text-[11.5px]"
				aria-pressed={relative && value?.n === p.n && value?.unit === p.unit}
				onclick={() => preset(p)}
			>
				{t(p.key)}
			</button>
		{/each}
		<span class="flex-1"></span>
		{#if active}<Button variant="ghost" size="sm" class="h-[22px] px-1.5 text-[11.5px]" onclick={() => onchange(null)}>{t("filter.lift")}</Button>{/if}
	</div>
</div>
