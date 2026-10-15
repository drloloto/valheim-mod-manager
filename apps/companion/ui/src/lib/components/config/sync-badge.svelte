<script lang="ts">
	import { Badge } from "#lib/components/kit/index.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { ConfigSync } from "#lib/types.js";

	// What an edit of this file reaches, as two small badges: the sync library and whether a restart is needed.
	let { info, long = false }: { info: ConfigSync | null | undefined; long?: boolean } = $props();

	const syncClass = $derived(
		info?.sync === "serversync" || info?.sync === "jotunn"
			? "border-primary-line bg-primary-tint text-primary-text"
			: info?.sync === "none"
				? "border-input text-muted-foreground"
				: "border-input text-subtle-foreground",
	);
</script>

{#if info}
	<span class="inline-flex flex-wrap items-center gap-1">
		<Badge variant="outline" class={`font-mono text-[10.5px] ${syncClass}`} title={t(`effect.${info.sync}`)}>
			{long ? t(`effect.${info.sync}`) : t(`effect.short.${info.sync}`)}
		</Badge>
		{#if info.sync !== "unknown"}
			<Badge
				variant="outline"
				class={`font-mono text-[10.5px] ${info.liveReload ? "border-success/40 text-success" : "border-input text-muted-foreground"}`}
				title={t(info.liveReload ? "effect.live" : "effect.restart")}
			>
				{long ? t(info.liveReload ? "effect.live" : "effect.restart") : t(info.liveReload ? "effect.short.live" : "effect.short.restart")}
			</Badge>
		{/if}
	</span>
{/if}
