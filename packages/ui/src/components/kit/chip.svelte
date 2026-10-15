<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	let { active = false, onclick, title, children }: { active?: boolean; onclick?: () => void; title?: string; children: Snippet } = $props();
</script>

<button
	type="button"
	{title}
	{onclick}
	aria-pressed={active}
	class={cn(
		"flex h-6 items-center rounded-[4px] border px-2.5 text-xs",
		active ? "bg-primary-tint text-primary-text border-primary-line" : "border-input text-foreground-soft hover:bg-hover",
	)}
>
	{@render children()}
</button>
