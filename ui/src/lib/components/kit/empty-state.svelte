<script lang="ts">
	import type { Snippet } from "svelte";

	let { title, children, action }: { title: string; children?: Snippet; action?: Snippet } = $props();
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
	<p class="text-row font-semibold">{title}</p>
	{#if children}<div class="text-muted-foreground max-w-sm text-sm">{@render children()}</div>{/if}
	{@render action?.()}
</div>
