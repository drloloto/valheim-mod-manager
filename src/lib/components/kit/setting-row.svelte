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

<!-- Label column and control side by side; below 32rem of container width the row stacks instead of squeezing the control. -->
<div
	class={cn(
		"border-line-subtle grid grid-cols-1 gap-x-6 gap-y-2 border-b py-4 last:border-b-0",
		aside ? "@lg:grid-cols-[var(--spacing-label)_minmax(0,1fr)_auto]" : "@lg:grid-cols-[var(--spacing-label)_minmax(0,1fr)]",
		align === "center" && "@lg:items-center",
	)}
>
	<div class="flex min-w-0 flex-col gap-1">
		<label for={forId} class="text-row font-semibold">{label}</label>
		{#if hint}<p class="text-muted-foreground text-xs leading-snug">{hint}</p>{/if}
	</div>
	<div class="min-w-0">{@render children()}</div>
	{#if aside}<div class="min-w-0">{@render aside()}</div>{/if}
</div>
