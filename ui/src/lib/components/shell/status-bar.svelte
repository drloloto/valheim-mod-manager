<script lang="ts">
	import { session } from "#lib/api.svelte.js";
	import { relative } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const s = $derived(session.status);
	const running = $derived(s?.container?.state === "running");
</script>

<footer
	class="bg-chrome text-muted-foreground h-statusbar text-meta flex shrink-0 items-center gap-5 overflow-hidden border-t px-3.5 font-mono whitespace-nowrap"
>
	{#if session.error && !s}
		<span class="text-destructive-text flex items-center gap-1.5"><span class="bg-destructive size-1.5 rounded-full"></span>{session.error}</span>
	{:else if s?.container}
		<span class="flex items-center gap-1.5" title={s.container.status}>
			<span class={running ? "bg-success size-1.5 rounded-full" : "bg-destructive size-1.5 rounded-full"}></span>
			{running ? t("status.running") : t("status.state", { state: s.container.state })}
		</span>
	{:else if s}
		<span class="flex items-center gap-1.5"><span class="border-muted-foreground size-1.5 rounded-full border"></span>{t("status.unknown")}</span>
	{/if}
	{#if s?.server.world}
		<span>{t("status.world", { world: s.server.world })}{s.world?.lastSave ? ` · ${t("status.saved", { time: relative(s.world.lastSave) })}` : ""}</span>
	{/if}
	{#if s?.online != null}<span>{t("status.online", { n: s.online })}</span>{/if}
	{#if s?.manifest}<span class="hidden sm:inline">{t("status.mods", { n: s.manifest.mods })}</span>{/if}
	<span class="flex-1"></span>
	{#if s}<span class="hidden sm:inline">companion {s.companion.version}</span>{/if}
</footer>
