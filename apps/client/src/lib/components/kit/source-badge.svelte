<script lang="ts">
	// Who put a mod into the profile. Server and dependency rows are managed for the player and say so in
	// colour; their own mods stay neutral.
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";
	import type { Source } from "#lib/installed.js";

	let { source, title }: { source: Source; title?: string } = $props();

	const STYLE: Record<Source, string> = {
		server: "border-info-line bg-info-soft text-info",
		own: "border-line-subtle text-foreground-soft",
		local: "border-line-subtle text-foreground-soft border-dashed",
		dependency: "border-transparent text-muted-foreground",
	};
	const ICON: Record<Source, string> = { server: "↓", own: "", local: "", dependency: "↳" };
</script>

<span
	class={cn("inline-flex h-[22px] max-w-full items-center gap-1 rounded-[4px] border px-1.5 text-[11.5px] whitespace-nowrap", STYLE[source])}
	title={title ?? t(`source.${source}Hint`)}
>
	{#if ICON[source]}<span class="shrink-0 font-mono">{ICON[source]}</span>{/if}<span class="truncate">{t(`source.${source}`)}</span>
</span>
