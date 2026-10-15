<script lang="ts">
	// Readme, changelog or wiki of a package, rendered in place. Content is fetched lazily per tab and
	// cached in the store; the wiki tab lists its pages first.
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button, Markdown } from "#lib/components/kit/index.js";
	import { packageIdFromUrl } from "#lib/thunderstore-links.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { DocTab, Pkg, WikiIndex } from "#lib/api/types.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { pkg, tab, wiki, wide = false, onnavigate }: { pkg: Pkg; tab: DocTab; wiki: WikiIndex | null; wide?: boolean; onnavigate?: () => void } = $props();

	// Links to other Valheim packages stay in the app; everything else opens the system browser.
	function link(href: string) {
		const id = packageIdFromUrl(href);
		if (id && store.focusPackage(id)) {
			onnavigate?.();
			goto(resolve("/"));
			return;
		}
		store.openExternal(href);
	}

	const version = $derived(pkg.versions[0]?.v ?? "");
	let page = $state<string | null>(null);
	let md = $state<string | null>(null);
	let error = $state<string | null>(null);

	// The wiki opens on its first page; switching packages resets the choice.
	const activePage = $derived(page && wiki?.pages.some((p) => p.id === page) ? page : (wiki?.pages[0]?.id ?? null));

	$effect(() => {
		const key = { id: pkg.id, version, tab, page: activePage };
		md = null;
		error = null;
		const req =
			key.tab === "wiki"
				? key.page
					? store.getWikiPage(key.page)
					: Promise.resolve("")
				: key.version
					? store.getDoc(key.id, key.version, key.tab)
					: Promise.resolve("");
		req
			.then((text) => {
				if (current(key)) md = text;
			})
			.catch((e: unknown) => {
				if (current(key)) error = e instanceof Error ? e.message : String(e);
			});
		function current(k: typeof key) {
			return k.id === pkg.id && k.version === version && k.tab === tab && k.page === activePage;
		}
	});
</script>

<div class={wide ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}>
	{#if tab === "wiki" && wiki && wiki.pages.length > 1}
		<div class="flex flex-wrap gap-1 border-b px-5 py-2.5">
			{#each wiki.pages as p (p.id)}
				<Button size="sm" variant={p.id === activePage ? "secondary" : "ghost"} class="h-6 px-2 text-xs" onclick={() => (page = p.id)}>{p.title}</Button>
			{/each}
		</div>
	{/if}
	<div class={wide ? "scroll-y min-h-0 flex-1 px-6 py-5" : "px-5 py-4"}>
		{#if error}
			<p class="text-destructive-text text-sm">{t("detail.docsFailed", { e: error })}</p>
		{:else if md === null}
			<p class="text-muted-foreground text-sm">{t("common.loading")}</p>
		{:else if !md.trim()}
			<p class="text-muted-foreground text-sm">{t(tab === "changelog" ? "detail.noChangelog" : "detail.noReadme")}</p>
		{:else}
			<Markdown source={md} onlink={link} class={wide ? "md-wide" : ""} />
		{/if}
	</div>
</div>
