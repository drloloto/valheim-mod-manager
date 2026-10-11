<script lang="ts">
	import { resolve } from "$app/paths";
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import { ConfirmDialog, StatusItem } from "#lib/components/kit/index.js";
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

<!-- Every entry truncates when the bar fills up; the action on the right always stays visible. -->
<footer class="bg-chrome text-muted-foreground h-statusbar text-meta flex shrink-0 items-center gap-5 border-t px-3.5 font-mono">
	<div class="flex min-w-0 flex-1 items-center gap-5">
		{#if store.state.game.found}
			<StatusItem tone="ok">{t("status.gameFound")}</StatusItem>
		{:else}
			<StatusItem tone="err" href={resolve("settings")} class="text-destructive-text">{t("status.gameMissing")}</StatusItem>
		{/if}

		{#if store.indexLoading && !store.packages.length}
			<StatusItem tone="none">{t("status.indexLoading")}</StatusItem>
		{:else if store.indexError}
			<StatusItem tone="none" class="text-destructive-text" title={store.indexError}>{store.indexError}</StatusItem>
		{:else if store.indexFetchedAt}
			<StatusItem tone="none">{t("status.index", { time: relativeTime(store.indexFetchedAt) })}</StatusItem>
		{/if}

		{#if progress}
			<span class="flex min-w-0 items-center gap-2" title={progress.id}>
				<span class="truncate">{t(`status.phase.${progress.phase}`)} {progress.id}</span>
				<span class="bg-muted h-1 w-[120px] shrink-0 overflow-hidden rounded-full">
					<span class="bg-primary block h-full" style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span>
				</span>
				<span class="shrink-0">{progress.done}/{progress.total}</span>
			</span>
		{:else if store.state.sync.running}
			<StatusItem tone="warn" pulse>{t("status.syncing")}</StatusItem>
		{/if}

		{#if store.server}
			{@const name = store.serverStatus?.name || store.server.name || store.server.url}
			{#if store.serverChecking && !store.serverStatus}
				<StatusItem tone="muted" pulse>{t("status.serverChecking", { name })}</StatusItem>
			{:else if store.serverStatus?.reachable && store.serverStatus.release}
				<StatusItem tone="warn" pulse class="text-primary" onclick={() => (store.serverDialog = "publish")}>{t("status.serverPending", { name })}</StatusItem>
			{:else if store.serverStatus?.reachable && store.serverStatus.inSync}
				<StatusItem tone="ok">{t("status.serverInSync", { name })}</StatusItem>
			{:else if store.serverStatus?.reachable}
				<StatusItem tone="warn" class="text-primary" onclick={() => (store.serverDialog = "diff")}>{t("status.serverDiffers", { name })}</StatusItem>
			{:else}
				<StatusItem tone="hollow" title={store.serverStatus?.error} onclick={() => store.refreshServerStatus()}
					>{t("status.serverUnreachable", { name })}</StatusItem
				>
			{/if}
		{/if}

		{#if store.readiness.status === "incomplete" && store.readiness.missing.length}
			<StatusItem tone="err" href={resolve("installed")} class="text-destructive-text">{t("status.missing", { n: store.readiness.missing.length })}</StatusItem>
		{/if}

		{#if store.updateStatus === "available" && store.update}
			<StatusItem tone="none" class="text-primary" onclick={() => (confirmOpen = true)}>{t("update.statusBar", { v: store.update.version })}</StatusItem>
		{/if}
	</div>

	{#if store.state.active && store.state.mods.length}
		<button class="hover:text-foreground shrink-0" onclick={copyCode}>{t("status.copyCode")}</button>
	{/if}
</footer>

<ConfirmDialog
	bind:open={confirmOpen}
	title={t("update.confirmTitle", { v: store.update?.version ?? "" })}
	description={t("update.confirmDesc")}
	confirmLabel={t("update.install")}
	onconfirm={() => store.installUpdate()}
/>
