<script lang="ts">
	import CopyIcon from "@lucide/svelte/icons/copy";
	import DownloadIcon from "@lucide/svelte/icons/download";
	import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
	import { toast } from "svelte-sonner";
	import { Button, EmptyState, SectionLabel, Stat } from "#lib/components/kit/index.js";
	import { api, session } from "#lib/api.svelte.js";
	import { bytes, relative, thunderstoreUrl } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { Manifest } from "#lib/types.js";

	let manifest = $state<Manifest | null>(null);
	let loadError = $state<string | null>(null);

	const s = $derived(session.status);
	const base = $derived(s?.companion.publicUrl || (typeof location === "undefined" ? "" : location.origin));
	const name = $derived(s?.server.name || "Valheim Server");
	const deepLink = $derived(
		`valheim-mod-manager://import?url=${encodeURIComponent(`${base}/api/profile.r2z`)}&name=${encodeURIComponent(name)}&link=${encodeURIComponent(base)}`,
	);

	// Reload the list when the published lock changes (a primitive, so the 15 s status poll does not refetch).
	const hash = $derived(s?.manifest?.hash);
	$effect(() => {
		if (!hash) return;
		api<Manifest>("/manifest")
			.then((m) => ((manifest = m), (loadError = null)))
			.catch((e) => (loadError = (e as Error).message));
	});

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(base);
			toast.success(t("common.copied"));
		} catch {
			toast.error(t("common.copyFailed"));
		}
	}
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6">
	{#if s && session.on("modManager")}
		<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
			<div class="flex flex-col gap-1">
				<h1 class="text-lg font-semibold">{t("home.title")}</h1>
				<p class="text-muted-foreground max-w-2xl">{t("home.lead")}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button href={deepLink}><ExternalLinkIcon />{t("home.open")}</Button>
				<Button variant="outline" href="/api/profile.r2z" download><DownloadIcon />{t("home.download")}</Button>
			</div>
			<p class="text-muted-foreground text-xs leading-relaxed">
				{t("home.noManager")}
				<a
					class="text-primary-text underline underline-offset-2"
					href="https://github.com/drloloto/valheim-mod-manager/releases/latest"
					rel="noopener noreferrer">{t("home.downloadManager")}</a
				>. {t("home.linkHint")}
				<button type="button" class="bg-field hover:bg-hover inline-flex items-center gap-1 rounded px-1.5 font-mono" onclick={copyLink}
					>{base}<CopyIcon class="size-3" /></button
				>
			</p>
		</section>
	{/if}

	{#if s}
		<section class="bg-panel grid grid-cols-2 gap-5 rounded-lg border p-5 sm:grid-cols-5">
			<Stat label={t("stat.server")} value={s.container ? (s.container.state === "running" ? t("status.running") : s.container.state) : "—"} />
			<Stat label={t("stat.world")} value={s.server.world || "—"} />
			<Stat label={t("stat.lastSave")} value={relative(s.world?.lastSave)} />
			<Stat label={t("stat.online")} value={s.online == null ? "—" : String(s.online)} />
			<Stat label={t("stat.worldSize")} value={s.world ? bytes(s.world.size) : "—"} />
		</section>
	{/if}

	<section class="bg-panel flex flex-col rounded-lg border">
		<SectionLabel class="border-b px-5 py-3">
			{t("home.mods")}{manifest ? ` · ${manifest.mods.length}` : ""}
		</SectionLabel>
		{#if !s?.manifest && s}
			<EmptyState title={t("home.readsLocked")}>{t("home.readsLockedHint")}</EmptyState>
		{:else if loadError}
			<EmptyState title={t("common.loadFailed")}>{loadError}</EmptyState>
		{:else if manifest && !manifest.mods.length}
			<EmptyState title={t("home.noMods")}>{t("home.noModsHint")}</EmptyState>
		{:else if manifest}
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead class="label-caps">
						<tr class="border-b">
							<th class="px-5 py-2 font-medium">{t("home.colMod")}</th>
							<th class="px-3 py-2 font-medium">{t("home.colVersion")}</th>
							<th class="px-5 py-2 font-medium max-sm:hidden">{t("home.colWhy")}</th>
						</tr>
					</thead>
					<tbody>
						{#each manifest.mods as m (m.id)}
							<tr class="border-line-subtle hover:bg-hover border-b last:border-b-0">
								<td class="text-row px-5 py-2">
									<a href={thunderstoreUrl(m.id)} target="_blank" rel="noopener noreferrer" class="hover:text-primary-text">{m.id}</a>
								</td>
								<td class="cell-mono px-3 py-2">{m.version}</td>
								<td class="cell-muted px-5 py-2 max-sm:hidden">
									{m.explicit ? "" : m.requiredBy.length ? t("home.depOf", { mods: m.requiredBy.join(", ") }) : t("home.dependency")}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
