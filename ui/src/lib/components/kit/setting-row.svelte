<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	let {
		label,
		hint,
		children,
		aside,
		align = "start",
		for: forId,
	}: { label: string; hint?: string; children: Snippet; aside?: Snippet; align?: "start" | "center"; for?: string } = $props();
</script>

<div
	class={cn(
		"border-line-subtle grid gap-6 border-b py-4 last:border-b-0",
		aside ? "grid-cols-[var(--spacing-label)_minmax(0,1fr)_auto]" : "grid-cols-[var(--spacing-label)_minmax(0,1fr)]",
		align === "center" && "items-center",
	)}
>
	<div class="flex flex-col gap-1">
		<label for={forId} class="text-row font-semibold">{label}</label>
		{#if hint}<p class="text-muted-foreground text-xs leading-snug">{hint}</p>{/if}
	</div>
	<div class="min-w-0">{@render children()}</div>
	{#if aside}<div>{@render aside()}</div>{/if}
</div>
