<script lang="ts">
	// "What changed" before an update: one card per mod with the changelog slice between the installed
	// and the new version. Confirm applies the update, nothing happens before that.
	import { Button, Dialog, Markdown, ModAvatar } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { SvelteSet } from "svelte/reactivity";
	import { sliceChangelog } from "#lib/changelog.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const ids = $derived(store.updateDialog ?? []);
	const open = $derived(ids.length > 0);
	const rows = $derived(
		ids.map((id) => ({
			id,
			name: store.byId.get(id)?.name ?? id,
			icon: store.byId.get(id)?.icon,
			from: store.modsMap.get(id)?.version ?? "",
			to: store.state.updates[id] ?? "",
		})),
	);
	const expanded = new SvelteSet<string>();
	let logs = $state<Record<string, { markdown: string; versions: string[]; hasHeadings: boolean } | "loading" | "error">>({});
	let busy = $state(false);

	// Single update: open its changelog right away. Several: collapsed cards, loaded on demand.
	$effect(() => {
		expanded.clear();
		if (ids.length === 1) expanded.add(ids[0]);
		logs = {};
	});

	$effect(() => {
		for (const r of rows) {
			if (!expanded.has(r.id) || logs[r.id] || !r.to) continue;
			logs[r.id] = "loading";
			store
				.getDoc(r.id, r.to, "changelog")
				.then((md) => {
					if (store.updateDialog?.includes(r.id)) logs[r.id] = sliceChangelog(md, r.from, r.to);
				})
				.catch(() => {
					if (store.updateDialog?.includes(r.id)) logs[r.id] = "error";
				});
		}
	});

	function toggle(id: string) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	async function confirm() {
		busy = true;
		try {
			await store.confirmUpdate();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(o) => !o && store.cancelUpdate()}>
	<Dialog.Content class="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-xl">
		<Dialog.Header class="border-b px-5 py-4">
			<Dialog.Title>{rows.length === 1 ? t("modupdate.titleOne", { name: rows[0].name }) : t("modupdate.titleMany", { n: rows.length })}</Dialog.Title>
			<Dialog.Description>{t("modupdate.desc")}</Dialog.Description>
		</Dialog.Header>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#each rows as r (r.id)}
				{@const log = logs[r.id]}
				<div class="border-b last:border-b-0">
					<button type="button" class="hover:bg-hover flex w-full items-center gap-3 px-5 py-2.5 text-left" onclick={() => toggle(r.id)}>
						<ModAvatar name={r.name} icon={r.icon} size="sm" />
						<span class="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
						<span class="text-muted-foreground font-mono text-xs">{r.from} → <span class="text-primary-text">{r.to}</span></span>
						<span class="text-subtle-foreground w-4 text-center text-xs">{expanded.has(r.id) ? "▾" : "▸"}</span>
					</button>
					{#if expanded.has(r.id)}
						<div class="bg-panel border-t px-5 py-3">
							{#if !log || log === "loading"}
								<p class="text-muted-foreground text-xs">{t("common.loading")}</p>
							{:else if log === "error"}
								<p class="text-muted-foreground text-xs">{t("modupdate.changelogFailed")}</p>
							{:else if !log.markdown}
								<p class="text-muted-foreground text-xs">{log.hasHeadings ? t("modupdate.noEntries") : t("modupdate.noChangelog")}</p>
							{:else}
								{#if !log.hasHeadings}<p class="text-muted-foreground mb-2 text-xs">{t("modupdate.wholeChangelog")}</p>{/if}
								<Markdown source={log.markdown} onlink={(href) => store.openExternal(href)} class="text-xs" />
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<Dialog.Footer class="border-t px-5 py-3">
			<Button variant="outline" disabled={busy} onclick={() => store.cancelUpdate()}>{t("common.cancel")}</Button>
			<Button disabled={busy} onclick={confirm}>{rows.length === 1 ? t("modupdate.confirmOne") : t("modupdate.confirmMany", { n: rows.length })}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
