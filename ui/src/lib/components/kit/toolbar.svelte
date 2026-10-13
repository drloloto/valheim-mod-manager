<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<!-- Page toolbar: one height, one spacing, one line, for every table and editor page.
     Inputs give way first (their width is a preference, not a floor); buttons never shrink. -->
<div class={cn("bg-background flex h-[58px] shrink-0 items-center gap-2.5 border-b px-4 [&_input]:min-w-24", className)}>
	{@render children()}
</div>
