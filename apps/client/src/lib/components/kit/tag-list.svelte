<script lang="ts">
	// Small tags (categories) on at most `lines` rows; whatever does not fit becomes "+N" with the full list
	// as tooltip. A hidden copy measures where the rows break, so the visible copy never clips a tag.
	import { cn } from "@vmm/ui/utils.js";

	let { tags, lines = 2, class: className }: { tags: readonly string[]; lines?: number; class?: string } = $props();

	const ROW = 18;
	const GAP = 3;
	let measure = $state<HTMLDivElement>();
	let width = $state(0);
	let fit = $state(Infinity);

	$effect(() => {
		void width;
		void tags;
		if (!measure) return;
		const limit = lines * ROW + (lines - 1) * GAP;
		const kids = [...measure.children] as HTMLElement[];
		const n = kids.findIndex((k) => k.offsetTop + k.offsetHeight > limit);
		// leave room for the "+N" tag on the last row
		fit = n < 0 ? Infinity : Math.max(1, n - 1);
	});

	const shown = $derived(tags.slice(0, fit));
	const rest = $derived(tags.length - shown.length);
	const tagClass = "border-line-subtle text-foreground-soft bg-raised h-[18px] max-w-full truncate rounded-[3px] border px-1.5 text-[11px] leading-[16px]";
</script>

<div class={cn("relative min-w-0", className)} bind:clientWidth={width} title={tags.join(", ")}>
	<div bind:this={measure} class="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-wrap gap-[3px]" aria-hidden="true">
		{#each tags as tag (tag)}<span class={tagClass}>{tag}</span>{/each}
	</div>
	<div class="flex flex-wrap gap-[3px] overflow-hidden" style:max-height="{lines * ROW + (lines - 1) * GAP}px">
		{#each shown as tag (tag)}<span class={tagClass}>{tag}</span>{/each}
		{#if rest > 0}<span class={cn(tagClass, "text-muted-foreground bg-transparent font-mono")}>+{rest}</span>{/if}
	</div>
</div>
