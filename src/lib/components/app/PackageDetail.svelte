<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button, Chip, Dialog, EmptyState, ModAvatar, PanelSection, Segmented, Stat } from "#lib/components/kit/index.js";
	import type { SegmentOption } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { DocTab, Pkg, WikiIndex } from "#lib/api/types.js";
	import { formatBytes, formatDate, formatNumber, relativeTime } from "#lib/format.js";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import Maximize2 from "@lucide/svelte/icons/maximize-2";
	import { describeIssue } from "#lib/health.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import ModDocs from "./ModDocs.svelte";

	let { id }: { id: string | null } = $props();

	let pkg = $state<Pkg | null>(null);
	let error = $state<string | null>(null);
	let wiki = $state<WikiIndex | null>(null);
	type Tab = "details" | DocTab;
	let tab = $state<Tab>("details");
	let expanded = $state(false);
	let expandedTab = $state<DocTab>("readme");

	$effect(() => {
		const current = id;
		pkg = null;
		error = null;
		wiki = null;
		if (!current) return;
		store
			.getPackage(current)
			.then((p) => {
				if (id === current) pkg = p;
			})
			.catch((e: unknown) => {
				if (id === current) error = e instanceof Error ? e.message : t("detail.loadFailed");
			});
		// The wiki tab only appears when the package has one; a failed lookup just hides it.
		store
			.getWiki(current)
			.then((w) => {
				if (id === current) wiki = w;
			})
			.catch(() => {});
	});

	// A package without a wiki cannot stay on the wiki tab.
	const activeTab = $derived<Tab>(tab === "wiki" && !wiki ? "details" : tab);
	const status = $derived(id ? store.modStatus(id) : "none");
	const mod = $derived(id ? store.modsMap.get(id) : undefined);
	const update = $derived(id ? store.state.updates[id] : undefined);
	const latest = $derived(pkg?.versions[0]);
	const docTabs = $derived<SegmentOption[]>([
		{ value: "readme", label: t("detail.tabReadme") },
		{ value: "changelog", label: t("detail.tabChangelog") },
		...(wiki ? [{ value: "wiki", label: t("detail.tabWiki"), badge: wiki.pages.length > 1 ? wiki.pages.length : undefined }] : []),
	]);
	const tabs = $derived<SegmentOption[]>([{ value: "details", label: t("detail.tabDetails") }, ...docTabs]);

	function depId(dep: string) {
		const parts = dep.split("-");
		return { id: `${parts[0]}-${parts.slice(1, -1).join("-")}`, version: parts[parts.length - 1] };
	}

	function primary() {
		if (!id) return;
		if (status === "update") return store.requestUpdate([id]);
		if (mod) return store.removeMod(id);
		return store.toggleMod(id);
	}

	function filterBy(fn: () => void) {
		fn();
		goto(resolve("/"));
	}

	function expand() {
		expandedTab = activeTab === "details" ? "readme" : activeTab;
		expanded = true;
	}
</script>

<aside class="bg-panel flex h-full flex-col overflow-y-auto border-l">
	{#if !id}
		<EmptyState title={t("detail.empty")}>{t("detail.emptyHint")}</EmptyState>
	{:else if error}
		<p class="text-destructive-text p-5 text-sm">{error}</p>
	{:else if !pkg}
		<p class="text-muted-foreground p-5 text-sm">{t("common.loading")}</p>
	{:else}
		<div class="flex flex-col gap-3.5 border-b p-5">
			<div class="flex items-center gap-3.5">
				<ModAvatar name={pkg.name} icon={pkg.icon} size="lg" />
				<div class="flex min-w-0 flex-col gap-[3px]">
					<h2 class="truncate text-lg font-bold">{pkg.name}</h2>
					<p class="text-muted-foreground text-[12.5px]">
						{t("detail.by")} <button class="text-foreground-soft hover:underline" onclick={() => filterBy(() => store.filterOwner(pkg!.ns))}>{pkg.ns}</button>
					</p>
				</div>
			</div>
			<p class="text-foreground-soft selectable text-[13px] leading-normal">{pkg.desc}</p>
			{#each store.healthByMod.get(id) ?? [] as h, i (i)}
				<p class="text-primary flex items-start gap-1.5 text-xs">
					<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{describeIssue(h, (x) => store.byId.get(x)?.name ?? x, store.state.game.lastUpdated)}
				</p>
			{/each}
			<div class="flex gap-2">
				<Button class="flex-1" variant={mod && status !== "update" ? "outline" : "default"} onclick={primary}>
					{status === "update" ? t("detail.updateTo", { v: update ?? "" }) : mod ? t("detail.remove") : t("detail.add")}
				</Button>
				<Button variant="outline" onclick={() => store.openExternal(pkg!.url)}>{t("detail.thunderstore")}</Button>
			</div>
		</div>

		<div class="flex items-center gap-2 border-b px-5 py-2.5">
			<Segmented options={tabs} bind:value={() => activeTab, (v) => (tab = v as Tab)} size="sm" class="min-w-0 flex-1" columns={tabs.length} />
			<Button size="sm" variant="ghost" class="h-7 w-7 shrink-0 p-0" title={t("detail.expand")} onclick={expand}>
				<Maximize2 class="size-3.5" />
			</Button>
		</div>

		{#if activeTab !== "details"}
			<ModDocs {pkg} tab={activeTab} {wiki} />
		{:else}
			<div class="grid grid-cols-3 border-b px-5 py-3">
				<Stat label={t("detail.downloads")} value={formatNumber(pkg.dl)} />
				<Stat label={t("detail.rating")} value={`★ ${formatNumber(pkg.rating)}`} />
				<Stat label={t("detail.size")} value={latest ? formatBytes(latest.size) : "—"} />
			</div>

			{#if pkg.cats.length}
				<PanelSection title={t("detail.categories")}>
					<div class="flex flex-wrap gap-1">
						{#each pkg.cats as cat (cat)}
							<Chip onclick={() => filterBy(() => store.filterCategory(cat))}>{cat}</Chip>
						{/each}
					</div>
				</PanelSection>
			{/if}

			<PanelSection title={t("detail.dependencies")} count={latest?.deps.length ?? 0}>
				{#each latest?.deps ?? [] as dep (dep)}
					{@const d = depId(dep)}
					{@const there = store.modsMap.has(d.id) || !!store.state.plan?.resolved[d.id]}
					<div class="flex items-center justify-between text-[13px]">
						<span class="flex items-baseline gap-2 truncate">{d.id}<span class="text-subtle-foreground text-meta font-mono">{d.version}</span></span>
						<span class={there ? "text-success text-xs" : "text-primary text-xs"}>{there ? t("detail.depInProfile") : t("detail.depWillInstall")}</span>
					</div>
				{:else}
					<p class="text-muted-foreground text-[13px]">{t("detail.noDeps")}</p>
				{/each}
			</PanelSection>

			<PanelSection title={t("detail.versions")} count={pkg.versions.length}>
				{#each pkg.versions.slice(0, 12) as v, i (v.v)}
					<div class="group flex h-7 items-center gap-2.5 text-[12.5px]">
						<span class="text-foreground-soft w-[70px] font-mono text-xs">{v.v}</span>
						<span class="text-muted-foreground flex-1" title={formatDate(v.date)}>{relativeTime(v.date)}</span>
						{#if mod?.version === v.v}<span class="text-success text-meta">{t("detail.installed")}</span>
						{:else if i === 0}<span class="text-primary text-meta">{t("detail.latest")}</span>{/if}
						{#if mod?.version !== v.v}
							<Button size="sm" variant="ghost" class="invisible h-6 group-hover:visible" onclick={() => store.toggleMod(id!, v.v)}>{t("detail.pick")}</Button>
						{/if}
					</div>
				{/each}
			</PanelSection>

			{#if pkg.web}
				<div class="px-5 py-4"><Button variant="ghost" onclick={() => store.openExternal(pkg!.web)}>{t("detail.website")}</Button></div>
			{/if}
		{/if}

		<!-- Wide reading view for image-heavy modpack pages. -->
		<Dialog.Root bind:open={expanded}>
			<Dialog.Content class="flex h-[86vh] flex-col gap-0 p-0 sm:max-w-4xl">
				<Dialog.Header class="flex-row items-center gap-3 space-y-0 border-b px-5 py-3 pr-12">
					<ModAvatar name={pkg.name} icon={pkg.icon} size="sm" />
					<Dialog.Title class="min-w-0 flex-1 truncate text-base">{pkg.name}</Dialog.Title>
					<Dialog.Description class="sr-only">{pkg.desc}</Dialog.Description>
					<Segmented options={docTabs} bind:value={() => expandedTab, (v) => (expandedTab = v as DocTab)} size="sm" />
				</Dialog.Header>
				<ModDocs {pkg} tab={expandedTab} {wiki} wide />
			</Dialog.Content>
		</Dialog.Root>
	{/if}
</aside>
