<script lang="ts">
	import type { Tri, TriMap } from "#lib/browse/criteria.js";
	import { formatNumber } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";
	import { Input } from "@vmm/ui/components/ui/input/index.js";
	import TriCheckbox from "./tri-checkbox.svelte";
	import type { FilterItem } from "./types";

	let {
		items,
		map,
		oncycle,
		onexclude,
		searchable = false,
		placeholder = "",
		limit = 8,
		filter = "",
	}: {
		/** already sorted (e.g. by frequency) */
		items: FilterItem[];
		map: TriMap;
		/** Click: off → included → excluded → off */
		oncycle: (value: string) => void;
		/** Right-click: exclude directly, or lift the exclusion */
		onexclude: (value: string) => void;
		searchable?: boolean;
		placeholder?: string;
		limit?: number;
		/** Search from outside (the filter pane's search): narrows like the own search field and shows every hit. */
		filter?: string;
	} = $props();

	let query = $state("");
	let expanded = $state(false);

	// Picked entries always come first and stay visible through search and truncation.
	const matching = $derived.by(() => {
		const q = (query.trim() || filter.trim()).toLowerCase();
		const picked = items.filter((i) => i.value in map);
		const rest = items.filter((i) => !(i.value in map) && (!q || i.label.toLowerCase().includes(q)));
		return { picked, rest };
	});
	const shown = $derived.by(() => {
		const { picked, rest } = matching;
		const room = expanded || query || filter.trim() ? 60 : Math.max(0, limit - picked.length);
		return [...picked, ...rest.slice(0, room)];
	});
	const more = $derived(matching.picked.length + matching.rest.length - shown.length);
</script>

<div class="flex flex-col gap-px">
	{#if searchable}
		<Input class="mb-1.5 h-[28px] text-[12.5px]" {placeholder} bind:value={query} />
	{/if}
	{#each shown as it (it.value)}
		{@const tri = (map[it.value] ?? 0) as Tri | 0}
		<button
			type="button"
			class={cn(
				"hover:bg-hover -mx-1.5 flex h-[26px] items-center gap-2 rounded-[4px] px-1.5 text-[13px]",
				tri === 1 ? "text-foreground" : tri === -1 ? "text-muted-foreground decoration-destructive-text/70 line-through" : "text-foreground-soft",
			)}
			title={tri === 0 ? t("filter.hintOff") : tri === 1 ? t("filter.hintInc") : t("filter.hintExc")}
			onclick={() => oncycle(it.value)}
			oncontextmenu={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onexclude(it.value);
			}}
		>
			<TriCheckbox state={tri} label={it.label} />
			<span class="min-w-0 flex-1 truncate text-left">{it.label}</span>
			<span
				class="text-subtle-foreground text-meta shrink-0 font-mono tabular-nums"
				title={it.additive ? t("filter.additive", { n: formatNumber(it.count) }) : undefined}>{it.additive ? "+" : ""}{formatNumber(it.count)}</span
			>
		</button>
	{:else}
		<p class="text-muted-foreground px-0 py-1 text-xs">{t("filter.noEntries")}</p>
	{/each}
	{#if more > 0 || expanded}
		<button type="button" class="text-primary hover:text-foreground mt-0.5 self-start text-xs" onclick={() => (expanded = !expanded)}>
			{expanded ? t("filter.less") : t("filter.more", { n: more })}
		</button>
	{/if}
</div>
