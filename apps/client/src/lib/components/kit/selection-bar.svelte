<script lang="ts">
	import type { Snippet } from "svelte";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "@vmm/ui/components/ui/button/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { count, onclear, hint, children }: { count: number; onclear: () => void; hint?: string; children: Snippet } = $props();
</script>

<!-- Floats over the table. Actions wrap onto a second line when the pane is narrow; the hint only shows when there is room. -->
{#if count > 0}
	<div class="@container absolute inset-x-4 bottom-3.5 z-10">
		<div
			role="toolbar"
			aria-label={t("sel.count", { n: count })}
			class="bg-selection-bar border-primary-line flex min-h-[46px] flex-wrap items-center gap-1 rounded-lg border py-1 pr-1.5 pl-3.5 shadow-(--shadow-float)"
		>
			<span class="text-primary-text shrink-0 pr-2.5 text-[13px] font-bold whitespace-nowrap">{t("sel.count", { n: count })}</span>
			{@render children()}
			<span class="flex-1"></span>
			{#if hint}<span class="text-muted-foreground text-meta hidden min-w-0 truncate pr-2.5 font-mono @2xl:inline">{hint}</span>{/if}
			<Button variant="ghost" size="icon-sm" class="shrink-0" aria-label={t("sel.clear")} onclick={onclear}><X class="size-4" /></Button>
		</div>
	</div>
{/if}
