<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	let { title, count, children, class: className }: { title: string; count?: number | string; children: Snippet; class?: string } = $props();
</script>

<section class={cn("flex flex-col gap-2 border-b px-5 py-4 last:border-b-0", className)}>
	<h3 class="label-caps">
		{title}{#if count != null}
			· {count}{/if}
	</h3>
	{@render children()}
</section>
