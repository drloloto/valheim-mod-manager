<script lang="ts">
	import { resolve } from "$app/paths";
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import { ConfirmDialog } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { relativeTime } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const progress = $derived(store.syncProgress);
	let confirmOpen = $state(false);

	async function copyCode() {
		const code = await store.exportCode();
		if (!code) return;
		try {
			await writeText(code);
			store.toast(t("status.codeCopied"), "ok");
		} catch {
			store.toast(t("common.copyFailed"), "err");
		}
	}
</script>

<footer class="bg-chrome text-muted-foreground h-statusbar text-meta flex shrink-0 items-center gap-5 border-t px-3.5 font-mono">
	{#if store.state.game.found}
		<span class="flex items-center gap-1.5"><span class="bg-success size-1.5 rounded-full"></span>{t("status.gameFound")}</span>
	{:else}
		<a href={resolve("settings")} class="text-destructive-text flex items-center gap-1.5 hover:underline">
			<span class="bg-destructive size-1.5 rounded-full"></span>
			{t("status.gameMissing")}
		</a>
	{/if}

	<span>
		{#if store.indexLoading && !store.packages.length}{t("status.indexLoading")}
		{:else if store.indexError}<span class="text-destructive-text">{store.indexError}</span>
		{:else if store.indexFetchedAt}{t("status.index", { time: relativeTime(store.indexFetchedAt) })}{/if}
	</span>

	{#if progress}
		<span class="flex min-w-0 items-center gap-2" title={progress.id}>
			<span class="truncate">{t(`status.phase.${progress.phase}`)} {progress.id}</span>

			<span class="bg-muted h-1 w-[120px] shrink-0 overflow-hidden rounded-full">
				<span class="bg-primary block h-full" style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span>
			</span>
			{progress.done}/{progress.total}
		</span>
	{:else if store.state.sync.running}
		<span class="flex items-center gap-1.5"><span class="bg-primary size-1.5 animate-pulse rounded-full"></span>{t("status.syncing")}</span>
	{/if}

	{#if store.updateStatus === "available" && store.update}
		<button class="text-primary hover:underline" onclick={() => (confirmOpen = true)}>{t("update.statusBar", { v: store.update.version })}</button>
	{/if}

	<span class="flex-1"></span>
	{#if store.state.active && store.state.mods.length}
		<button class="hover:text-foreground" onclick={copyCode}>{t("status.copyCode")}</button>
	{/if}
</footer>

<ConfirmDialog
	bind:open={confirmOpen}
	title={t("update.confirmTitle", { v: store.update?.version ?? "" })}
	description={t("update.confirmDesc")}
	confirmLabel={t("update.install")}
	onconfirm={() => store.installUpdate()}
/>
