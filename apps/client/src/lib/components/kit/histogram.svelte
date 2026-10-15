<script lang="ts">
	import { formatNumber } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";

	let {
		counts,
		labels,
		selected,
		onpick,
	}: {
		counts: number[];
		labels: string[];
		/** Bar lies inside the active range */
		selected: boolean[];
		/** Click sets the range to the bar; Shift+click extends it */
		onpick: (index: number, extend: boolean) => void;
	} = $props();

	// Square-root scale: rare values stay visible, the most frequent one fills the height.
	const max = $derived(Math.sqrt(Math.max(1, ...counts)));
	const heights = $derived(counts.map((c) => (c ? Math.max(2, Math.round((Math.sqrt(c) / max) * 100)) : 0)));
	const any = $derived(selected.some(Boolean));
</script>

<div class="flex h-[38px] items-end gap-px" role="group" aria-label={t("filter.distribution")}>
	{#each counts as c, i (i)}
		<button
			type="button"
			class="group flex h-full min-w-0 flex-1 items-end"
			title="{labels[i]} · {formatNumber(c)}"
			aria-label="{labels[i]}: {formatNumber(c)}"
			onclick={(e) => onpick(i, e.shiftKey)}
		>
			<span
				class={cn(
					"block w-full rounded-[1px] transition-opacity group-hover:opacity-70",
					selected[i] ? "bg-primary" : any ? "bg-line-strong" : "bg-checkbox-line",
				)}
				style:height="{heights[i]}%"
			></span>
		</button>
	{/each}
</div>
