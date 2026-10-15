<script lang="ts">
	import { cn } from "@vmm/ui/utils.js";
	import type { TriState } from "./types";

	let { state, label, onclick, class: className }: { state: TriState; label: string; onclick?: (e: MouseEvent) => void; class?: string } = $props();

	const mark = $derived(state === 1 ? "✓" : state === 0 ? "" : "−");
	const classes = $derived(
		cn(
			"flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[10px] leading-none font-bold",
			state === 1 && "bg-primary border-primary text-primary-foreground",
			state === -1 && "bg-destructive border-destructive text-white",
			state === "mixed" && "border-primary text-primary",
			state === 0 && "border-checkbox-line",
			className,
		),
	);
</script>

{#if onclick}
	<button type="button" role="checkbox" aria-checked={state === "mixed" ? "mixed" : state === 1} aria-label={label} tabindex="-1" class={classes} {onclick}
		>{mark}</button
	>
{:else}
	<span aria-hidden="true" class={classes}>{mark}</span>
{/if}
