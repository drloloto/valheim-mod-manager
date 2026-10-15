<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";

	const tabs = $derived([
		{ href: resolve("/"), label: t("nav.browse"), count: null },
		{
			href: resolve("installed"),
			label: t("nav.installed"),
			count: store.state.mods.length || null,
		},
		{ href: resolve("config"), label: t("nav.config"), count: null },
		{ href: resolve("logs"), label: t("nav.log"), count: null },
	]);
</script>

<nav class="flex gap-0.5" aria-label={t("nav.aria")}>
	{#each tabs as tab, i (tab.href)}
		<a
			href={tab.href}
			title={t("nav.shortcut", { label: tab.label, n: i + 1 })}
			aria-current={page.url.pathname === tab.href ? "page" : undefined}
			class={cn(
				"text-foreground-soft hover:text-foreground hover:bg-hover text-row flex h-[34px] items-center gap-1.5 rounded-[5px] px-3 font-medium",
				"aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
			)}
		>
			{tab.label}
			{#if tab.count}<span class="text-subtle-foreground text-meta font-mono tabular-nums">{tab.count}</span>{/if}
		</a>
	{/each}
</nav>
