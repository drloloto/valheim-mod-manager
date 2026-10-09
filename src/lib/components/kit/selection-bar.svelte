<script lang="ts">
	import type { Snippet } from "svelte";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/components/ui/button/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { count, onclear, hint, children }: { count: number; onclear: () => void; hint?: string; children: Snippet } = $props();
</script>

{#if count > 0}
	<div
		role="toolbar"
		aria-label={t("sel.count", { n: count })}
		class="bg-selection-bar border-primary-line absolute inset-x-4 bottom-3.5 z-10 flex h-[46px] items-center gap-1 rounded-lg border pr-1.5 pl-3.5 shadow-(--shadow-float)"
	>
		<span class="text-primary-text pr-2.5 text-[13px] font-bold whitespace-nowrap">{t("sel.count", { n: count })}</span>
		{@render children()}
		<span class="flex-1"></span>
		{#if hint}<span class="text-muted-foreground text-meta min-w-0 truncate pr-2.5 font-mono">{hint}</span>{/if}
		<Button variant="ghost" size="icon-sm" aria-label={t("sel.clear")} onclick={onclear}><X class="size-4" /></Button>
	</div>
{/if}
