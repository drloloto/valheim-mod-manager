<script lang="ts">
	import { save as saveDialog } from "@tauri-apps/plugin-dialog";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { ConfirmDialog, DropdownMenu } from "#lib/components/kit/index.js";
	import NameDialog from "#lib/components/app/NameDialog.svelte";
	import ImportProfileDialog from "#lib/components/app/ImportProfileDialog.svelte";
	import MigrateDialog from "#lib/components/app/MigrateDialog.svelte";
	import ExportCodeDialog from "#lib/components/app/ExportCodeDialog.svelte";
	import ServerDialog from "#lib/components/app/ServerDialog.svelte";
	import { store } from "#lib/api/store.svelte.js";
	import { initials } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let newOpen = $state(false);
	let renameOpen = $state(false);
	let cloneOpen = $state(false);
	let importOpen = $state(false);
	let migrateOpen = $state(false);
	let deleteOpen = $state(false);
	let exportCode = $state<string | null>(null);

	const active = $derived(store.state.active);

	export function openNew() {
		newOpen = true;
	}

	async function share() {
		exportCode = await store.exportCode();
	}

	async function exportFile() {
		if (!active) return;
		const path = await saveDialog({ defaultPath: `${active}.r2z`, filters: [{ name: t("profile.r2zFilter"), extensions: ["r2z"] }] });
		if (path) await store.exportFile(path);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<!-- Flat like the tabs next to it: avatar, name, chevron; stands out only on hover. -->
			<button
				{...props}
				class="hover:bg-hover data-[state=open]:bg-muted flex h-[34px] max-w-[260px] items-center gap-2 rounded-[5px] py-1 pr-2 pl-1.5 text-left"
				title={t("profile.menu")}
			>
				<span class="bg-primary-soft text-primary-text text-2xs flex size-[22px] shrink-0 items-center justify-center rounded-[4px] font-mono font-semibold">
					{active ? initials(active) : "–"}
				</span>
				<span class="truncate text-[13px] font-semibold">{active ?? t("profile.none")}</span>
				{#if store.updateCount}<span class="text-primary text-meta shrink-0 font-mono">↑{store.updateCount}</span>{/if}
				<ChevronDown class="text-muted-foreground size-3.5 shrink-0" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-72">
		<DropdownMenu.Label>{t("profile.menu")}</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={active ?? ""} onValueChange={(v) => v && v !== active && store.activateProfile(v)}>
			{#each store.state.profiles as p (p)}
				<DropdownMenu.RadioItem value={p}>
					{p}
					{#if store.serverUpdates[p]}<span class="text-primary text-meta ml-1 font-mono" title={t("profile.serverUpdate")}>↓</span>{/if}
					{#if p === active}<span class="text-muted-foreground text-meta ml-auto font-mono">{t("profile.summary", { mods: store.state.mods.length })}</span
						>{/if}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => (newOpen = true)}>{t("profile.new")}<DropdownMenu.Shortcut>{t("key.ctrl")} N</DropdownMenu.Shortcut></DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (importOpen = true)}>{t("profile.import")}</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (store.serverDialog = "add")}>{t("server.menuAdd")}</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (migrateOpen = true)}>{t("profile.migrate")}</DropdownMenu.Item>
		{#if active}
			<DropdownMenu.Item disabled={!store.state.mods.length} onSelect={share}>{t("profile.share")}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={exportFile}>{t("profile.export")}</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => (renameOpen = true)}>{t("profile.rename")}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => (cloneOpen = true)}>{t("profile.clone")}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => store.openFolder("profile")}>{t("profile.openFolder")}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => store.repair()}>{t("profile.repair")}</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => (store.serverDialog = "link")}
				>{store.server ? t("server.menuEdit", { name: store.server.name || store.server.url }) : t("server.menuLink")}</DropdownMenu.Item
			>
			{#if store.server}
				<DropdownMenu.Item disabled={!store.state.mods.length} onSelect={() => (store.serverDialog = "publish")}>{t("server.menuPublish")}</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Separator />
			<DropdownMenu.Item variant="destructive" onSelect={() => (deleteOpen = true)}>{t("profile.delete")}</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<NameDialog
	bind:open={newOpen}
	title={t("profile.newTitle")}
	description={t("profile.newDesc")}
	submitLabel={t("profile.create")}
	onSubmit={(n) => store.newProfile(n)}
/>
<NameDialog
	bind:open={renameOpen}
	title={t("profile.renameTitle")}
	description={t("profile.renameDesc", { name: active ?? "" })}
	submitLabel={t("profile.renameSubmit")}
	initial={active ?? ""}
	onSubmit={(n) => store.renameActive(n)}
/>
<NameDialog
	bind:open={cloneOpen}
	title={t("profile.cloneTitle")}
	description={t("profile.cloneDesc", { name: active ?? "" })}
	submitLabel={t("profile.cloneSubmit")}
	initial={t("profile.copySuffix", { name: active ?? "" })}
	onSubmit={(n) => store.cloneActive(n)}
/>
<ImportProfileDialog bind:open={importOpen} />
<MigrateDialog bind:open={migrateOpen} />
<ExportCodeDialog bind:code={exportCode} />
<ServerDialog />
<ConfirmDialog
	bind:open={deleteOpen}
	title={t("profile.deleteTitle", { name: active ?? "" })}
	description={t("profile.deleteDesc")}
	confirmLabel={t("profile.deleteConfirm")}
	destructive
	onconfirm={() => store.deleteActiveProfile()}
/>
