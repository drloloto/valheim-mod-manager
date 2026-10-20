<script lang="ts">
	import type { NumOp, NumRange } from "#lib/browse/criteria.js";
	import { bucketInNum, bucketNumRange, extendNumRange, NUM_OPS, numActive, numOpLabel, type Bucket } from "#lib/browse/ranges.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { Input } from "@vmm/ui/components/ui/input/index.js";
	import { Button } from "@vmm/ui/components/ui/button/index.js";
	import Histogram from "./histogram.svelte";
	import Segmented from "@vmm/ui/components/kit/segmented.svelte";

	let {
		value,
		onchange,
		buckets,
		counts,
		unit = "",
		scale = 1,
		presets = [],
	}: {
		value: NumRange | null;
		onchange: (r: NumRange | null) => void;
		buckets: Bucket[];
		counts: number[];
		/** Unit shown behind the fields, e.g. "MB" */
		unit?: string;
		/** field value × scale = model value (e.g. MB → bytes) */
		scale?: number;
		presets?: { label: string; range: NumRange }[];
	} = $props();

	const op = $derived(value?.op ?? "gte");
	const active = $derived(numActive(value));
	const selected = $derived(buckets.map((b) => bucketInNum(b, value)));
	const showFrom = $derived(op !== "lte");
	const showTo = $derived(op !== "gte");

	function base(): NumRange {
		return value ?? { op: "gte", from: null, to: null };
	}
	function setOp(next: NumOp) {
		const r = { ...base(), op: next };
		// One-sided operators carry a single bound; the other side takes over the existing value
		if (next === "gte") onchange({ op: next, from: r.from ?? r.to, to: null });
		else if (next === "lte") onchange({ op: next, from: null, to: r.to ?? r.from });
		else onchange(r);
	}
	function field(ms: number | null): string {
		return ms === null ? "" : String(Math.round((ms / scale) * 100) / 100);
	}
	function parse(raw: string): number | null {
		const v = Number(raw.replace(",", "."));
		return raw.trim() === "" || !Number.isFinite(v) ? null : Math.max(0, Math.round(v * scale));
	}
	function pick(i: number, extend: boolean) {
		onchange(extend ? extendNumRange(value, buckets[i]) : bucketNumRange(buckets[i]));
	}
	const same = (a: NumRange, b: NumRange | null) => !!b && a.op === b.op && a.from === b.from && a.to === b.to;
	const fieldClass = "h-[28px] font-mono text-xs";
</script>

<div class="flex flex-col gap-2.5">
	<Segmented columns={4} options={NUM_OPS.map((o) => ({ value: o, label: numOpLabel(o) }))} bind:value={() => op, (v) => setOp(v as NumOp)} />
	<Histogram {counts} labels={buckets.map((b) => b.label)} {selected} onpick={pick} />
	<div class="grid items-center gap-1.5 {showFrom && showTo ? 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'grid-cols-1'}">
		{#if showFrom}
			<div class="relative">
				<Input
					type="text"
					inputmode="decimal"
					class={fieldClass}
					aria-label={t("filter.from")}
					placeholder={t("filter.from")}
					value={field(value?.from ?? null)}
					onchange={(e) => onchange({ ...base(), from: parse(e.currentTarget.value) })}
				/>
				{#if unit}<span class="text-subtle-foreground text-meta pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono">{unit}</span>{/if}
			</div>
		{/if}
		{#if showFrom && showTo}<span class="text-subtle-foreground text-xs">–</span>{/if}
		{#if showTo}
			<div class="relative">
				<Input
					type="text"
					inputmode="decimal"
					class={fieldClass}
					aria-label={t("filter.to")}
					placeholder={t("filter.to")}
					value={field(value?.to ?? null)}
					onchange={(e) => onchange({ ...base(), to: parse(e.currentTarget.value) })}
				/>
				{#if unit}<span class="text-subtle-foreground text-meta pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono">{unit}</span>{/if}
			</div>
		{/if}
	</div>
	{#if presets.length || active}
		<div class="flex flex-wrap items-center gap-1">
			{#each presets as p (p.label)}
				<button
					type="button"
					class="border-input text-foreground-soft hover:bg-hover aria-pressed:border-primary-line aria-pressed:bg-primary-tint aria-pressed:text-primary-text h-[22px] rounded-[4px] border px-2 text-[11.5px]"
					aria-pressed={same(p.range, value)}
					onclick={() => onchange(p.range)}
				>
					{p.label}
				</button>
			{/each}
			<span class="flex-1"></span>
			{#if active}<Button variant="ghost" size="sm" class="h-[22px] px-1.5 text-[11.5px]" onclick={() => onchange(null)}>{t("filter.lift")}</Button>{/if}
		</div>
	{/if}
</div>
