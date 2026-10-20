<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<kbd class="border-line-strong text-muted-foreground text-2xs rounded-[3px] border px-1.5 py-0.5 font-mono">{@render children()}</kbd>
