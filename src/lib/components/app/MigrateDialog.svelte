<script lang="ts">
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { Button, Checkbox, Dialog } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { ForeignProfile } from "#lib/api/types.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let profiles = $state<ForeignProfile[]>([]);
	let loading = $state(false);
	let withConfigs = $state(true);
	let installAll = $state(true);
	let busy = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		loading = true;
		store
			.listForeignProfiles()
			.then((p) => (profiles = p))
			.catch(() => {
				profiles = [];
				store.toast(t("migrate.loadFailed"), "err");
			})
			.finally(() => (loading = false));
	});

	async function importOne(path: string, name: string) {
		if (busy) return;
		busy = path;
		try {
			if (await store.importForeign(path, name, withConfigs, installAll)) open = false;
		} finally {
			busy = null;
		}
	}

	async function pickFolder() {
		const dir = await openDialog({ directory: true });
		if (typeof dir === "string") await importOne(dir, "");
	}

	const managerLabel = (m: string) => (m === "r2modman" ? t("migrate.manager.r2modman") : t("migrate.manager.tmm"));
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{t("migrate.title")}</Dialog.Title>
			<Dialog.Description>{t("migrate.desc")}</Dialog.Description>
		</Dialog.Header>
		<div class="flex max-h-80 flex-col gap-px overflow-y-auto">
			{#if loading}
				<p class="text-muted-foreground p-2 text-sm">{t("common.loading")}</p>
			{:else if !profiles.length}
				<p class="text-muted-foreground p-2 text-sm">{t("migrate.none")}</p>
			{:else}
				{#each profiles as p (p.path)}
					<div class="hover:bg-hover flex items-center gap-3 rounded-[5px] px-2 py-1.5">
						<span class="text-subtle-foreground text-meta w-[150px] shrink-0 truncate font-mono">{managerLabel(p.manager)}</span>
						<span class="min-w-0 flex-1 truncate text-sm font-medium" title={p.path}>{p.name}</span>
						<span class="text-muted-foreground text-meta font-mono tabular-nums">{t("migrate.mods", { n: p.mods })}</span>
						<Button size="sm" variant="outline" disabled={busy !== null} onclick={() => importOne(p.path, p.name)}>
							{busy === p.path ? t("common.loading") : t("migrate.import")}
						</Button>
					</div>
				{/each}
			{/if}
		</div>
		<label class="flex items-center gap-2 text-sm">
			<Checkbox bind:checked={withConfigs} />
			{t("migrate.withConfigs")}
		</label>
		<div class="grid gap-1">
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={installAll} />
				{t("import.installAll")}
			</label>
			<p class="text-muted-foreground pl-6 text-xs">{t("import.installAllHint")}</p>
		</div>
		<Dialog.Footer>
			<Button variant="ghost" disabled={busy !== null} onclick={pickFolder}>{t("migrate.pickFolder")}</Button>
			<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
