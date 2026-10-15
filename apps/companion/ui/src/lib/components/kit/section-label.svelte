<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	let { children, aside, class: className }: { children: Snippet; aside?: Snippet; class?: string } = $props();
</script>

<div class={cn("flex items-center gap-2", className)}>
	<span class="label-caps flex-1 truncate">{@render children()}</span>
	{@render aside?.()}
</div>
