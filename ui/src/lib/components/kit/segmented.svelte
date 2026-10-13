<script lang="ts">
	import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
	import { cn } from "#lib/utils.js";
	import type { SegmentOption } from "./types";

	let {
		options,
		value = $bindable(),
		columns,
		size = "default",
		class: className,
	}: { options: SegmentOption[]; value: string; columns?: number; size?: "default" | "sm"; class?: string } = $props();
</script>

<!-- Never wider than its parent: with `columns` the items share the width by content (long labels keep
     their room, extra space is spread evenly), otherwise the group shrinks; labels truncate as a last resort. -->
<ToggleGroup.Root
	type="single"
	bind:value={() => value, (v) => v && (value = v)}
	class={cn("bg-field gap-0.5 rounded-[5px] p-0.5", columns ? "grid w-full" : "inline-flex max-w-full min-w-0", className)}
	style={columns ? `grid-template-columns: repeat(${columns}, minmax(0, auto))` : undefined}
>
	{#each options as o (o.value)}
		<ToggleGroup.Item
			value={o.value}
			title={o.label}
			class={cn(
				"text-foreground-soft hover:text-foreground min-w-0 rounded-[4px] border-0 shadow-none hover:bg-transparent",
				size === "sm" ? "h-5 px-1.5 text-[11px]" : columns ? "h-7 px-1.5 text-[11.5px]" : "h-7 px-3 text-xs",
				"data-[state=on]:bg-muted data-[state=on]:text-foreground",
				o.tone === "primary" && "text-primary",
			)}
		>
			<span class="min-w-0 truncate">{o.label}</span>
			{#if o.badge != null && o.badge !== 0}<span class="ml-1 shrink-0 font-mono">{o.badge}</span>{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
