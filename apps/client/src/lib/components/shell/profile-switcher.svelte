<script lang="ts">
	// Profile menu (design "Server Link Modals", 2b): switch profiles, open the manager, create one. Everything
	// else (import, export, server, rename, delete) lives in the profile manager.
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { DropdownMenu } from "#lib/components/kit/index.js";
	import NameDialog from "#lib/components/app/NameDialog.svelte";
	import ProfileManager from "#lib/components/app/ProfileManager.svelte";
	import ServerDialog from "#lib/components/app/ServerDialog.svelte";
	import PublishDialog from "#lib/components/app/PublishDialog.svelte";
	import { store } from "#lib/api/store.svelte.js";
	import { initials } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let newOpen = $state(false);

	const active = $derived(store.state.active);
	const modCount = (p: string) => (p === active ? store.state.mods.length : (store.state.profileMods[p]?.length ?? 0));
	/** ↑ publishes (admin of the active profile), ↓ follows a server; nothing for a local profile. */
	function role(p: string): { icon: string; tone: string; title: string } | null {
		if (p === active && store.server)
			return store.serverAdmin
				? { icon: "↑", tone: "text-primary", title: t("pm.roleAdminName") }
				: { icon: "↓", tone: "text-info", title: t("pm.rolePlayerName") };
		if (store.serverUpdates[p]) return { icon: "↓", tone: "text-primary", title: t("profile.serverUpdate") };
		if (store.serverChecks[p]) return { icon: "↓", tone: "text-info", title: t("pm.rolePlayerName") };
		return null;
	}

	export function openNew() {
		newOpen = true;
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
	<DropdownMenu.Content align="start" class="w-[300px]">
		<DropdownMenu.Label>{t("profile.menu")}</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={active ?? ""} onValueChange={(v) => v && v !== active && store.activateProfile(v)}>
			{#each store.state.profiles as p (p)}
				{@const r = role(p)}
				<DropdownMenu.RadioItem value={p}>
					<span class="min-w-0 flex-1 truncate">{p}</span>
					{#if r}<span class="font-mono text-[10.5px] {r.tone}" title={r.title}>{r.icon}</span>{/if}
					<span class="text-muted-foreground text-meta w-6 shrink-0 text-right font-mono tabular-nums">{modCount(p)}</span>
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => (store.profileManager = true)}
			>{t("pm.manage")}<DropdownMenu.Shortcut>{t("key.ctrl")} P</DropdownMenu.Shortcut></DropdownMenu.Item
		>
		<DropdownMenu.Item onSelect={() => (newOpen = true)}>{t("profile.new")}<DropdownMenu.Shortcut>{t("key.ctrl")} N</DropdownMenu.Shortcut></DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<NameDialog
	bind:open={newOpen}
	title={t("profile.newTitle")}
	description={t("profile.newDesc")}
	submitLabel={t("profile.create")}
	onSubmit={(n) => store.newProfile(n)}
/>
<ProfileManager />
<ServerDialog />
<PublishDialog />
