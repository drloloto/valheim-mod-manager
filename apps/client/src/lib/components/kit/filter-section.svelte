<script lang="ts">
	import type { Snippet } from "svelte";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { cn } from "@vmm/ui/utils.js";

	let {
		id,
		title,
		summary = "",
		open,
		ontoggle,
		aside,
		children,
	}: {
		id?: string;
		title: string;
		/** Summary of the active filter, right-aligned in the header */
		summary?: string;
		open: boolean;
		ontoggle: () => void;
		/** Extra control in the header (e.g. any/all), only while the section is open */
		aside?: Snippet;
		children: Snippet;
	} = $props();
</script>

<!-- One filter section: the same header for lists and ranges, collapsible content. -->
<section {id} class="border-line-subtle border-b">
	<div class="flex h-9 items-center gap-2 pr-3.5 pl-2.5">
		<button
			type="button"
			class="hover:text-foreground flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
			aria-expanded={open}
			onclick={ontoggle}
		>
			<ChevronRight class={cn("text-subtle-foreground size-3 shrink-0 transition-transform", open && "rotate-90")} />
			<span class="label-caps text-foreground-soft min-w-0 truncate">{title}</span>
			{#if summary}<span class="text-primary text-meta ml-auto min-w-0 truncate font-mono" title={summary}>{summary}</span>{/if}
		</button>
		{#if open && aside}<div class="shrink-0">{@render aside()}</div>{/if}
	</div>
	{#if open}
		<div class="px-3.5 pb-3">{@render children()}</div>
	{/if}
</section>
