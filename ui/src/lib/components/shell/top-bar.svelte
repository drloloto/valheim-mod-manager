<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { BrandMark, Button } from "#lib/components/kit/index.js";
	import { session } from "#lib/api.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";
	import TokenDialog from "./token-dialog.svelte";

	let tokenOpen = $state(false);

	// Public tabs for everyone, admin tabs once the token is accepted; switched-off features disappear.
	const tabs = $derived(
		[
			{ href: resolve("/"), label: t("nav.overview"), show: true },
			{ href: resolve("/configs"), label: t("nav.configs"), show: true },
			{ href: resolve("/server"), label: t("nav.server"), show: session.authed },
			{ href: resolve("/players"), label: t("nav.players"), show: session.authed && session.on("players") },
			{ href: resolve("/backups"), label: t("nav.backups"), show: session.authed && session.on("backups") },
			{ href: resolve("/logs"), label: t("nav.log"), show: session.authed && session.on("logs") },
		].filter((x) => x.show),
	);
	const release = $derived(session.authed ? session.status?.release : null);
</script>

<div class="bg-panel h-toolbar flex shrink-0 items-center gap-1 border-b px-2.5">
	<a
		href={resolve("/")}
		aria-label={session.status?.server.name || "Valheim Server"}
		class="hover:bg-hover flex h-[34px] min-w-0 items-center gap-2 rounded-[5px] px-2.5"
	>
		<BrandMark class="text-primary size-4 shrink-0" />
		<span class="text-row truncate font-semibold max-sm:hidden">{session.status?.server.name || "Valheim Server"}</span>
	</a>
	<span class="bg-border mx-2 h-5 w-px shrink-0 max-sm:hidden" aria-hidden="true"></span>
	<nav class="flex min-w-0 gap-0.5 overflow-x-auto" aria-label={t("nav.aria")}>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={page.url.pathname === tab.href ? "page" : undefined}
				class={cn(
					"text-foreground-soft hover:text-foreground hover:bg-hover text-row flex h-[34px] shrink-0 items-center gap-1.5 rounded-[5px] px-3 font-medium",
					"aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
				)}
			>
				{tab.label}
			</a>
		{/each}
	</nav>
	<div class="flex-1"></div>
	{#if release}
		<a href={resolve("/server")} class="text-primary text-meta mr-2 hidden items-center gap-1.5 font-mono hover:underline sm:flex">
			<span class="bg-primary size-1.5 animate-pulse rounded-full"></span>{t("release.pendingShort")}
		</a>
	{/if}
	{#if session.authed}
		<Button variant="ghost" size="sm" onclick={() => session.signOut()}>{t("auth.signOut")}</Button>
	{:else if session.status?.companion.tokenConfigured !== false}
		<Button variant="outline" size="sm" onclick={() => (tokenOpen = true)}>{t("auth.admin")}</Button>
	{/if}
</div>

<TokenDialog bind:open={tokenOpen} />
