<script lang="ts">
	// Profile manager: every profile as a card, a click opens its details in the same modal with three tabs:
	// General, Server & Sync, Share & Export. Everything that used to crowd the profile menu lives here; the
	// menu only switches profiles. Built from the app's own parts (SettingRow, SectionLabel, Segmented, Stat,
	// StatusItem) so it reads like the Settings page and the toolbar, not like a page of its own.
	import { save as saveDialog } from "@tauri-apps/plugin-dialog";
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Cloud from "@lucide/svelte/icons/cloud";
	import Plus from "@lucide/svelte/icons/plus";
	import Server from "@lucide/svelte/icons/server";
	import {
		Button,
		ConfirmDialog,
		Dialog,
		DropdownMenu,
		Input,
		Kbd,
		SectionLabel,
		Segmented,
		SettingRow,
		Stat,
		StatusItem,
		Switch,
	} from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { releaseLabel, serverView, type ServerTone } from "#lib/api/server-view.js";
	import { initials } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import ImportProfileDialog from "./ImportProfileDialog.svelte";
	import MigrateDialog from "./MigrateDialog.svelte";
	import NameDialog from "./NameDialog.svelte";

	type Tab = "general" | "server" | "share";
	type Role = "player" | "admin";

	let view = $state<"list" | "detail">("list");
	let sel = $state<string | null>(null);
	let tab = $state<Tab>("general");
	let search = $state("");
	let newOpen = $state(false);
	let cloneOpen = $state(false);
	let deleteOpen = $state(false);
	let restoreOpen = $state(false);
	let importOpen = $state(false);
	let importMode = $state<"code" | "file">("code");
	let migrateOpen = $state(false);
	let busy = $state(false);
	// detail form state, reset whenever another profile or tab is opened
	let nameEdit = $state("");
	let role = $state<Role>("player");
	let address = $state("");
	let token = $state("");
	let code = $state<string | null>(null);

	const active = $derived(store.state.active);
	const isActive = $derived(sel !== null && sel === active);

	/** Closing resets the modal, so the next open always starts at the list. */
	function setOpen(v: boolean) {
		store.profileManager = v;
		if (!v) {
			view = "list";
			search = "";
		}
	}

	interface Card {
		name: string;
		active: boolean;
		mods: number;
		fromServer: number | null;
		updates: number | null;
		server: { name: string; gist: boolean; role: Role | null; status: string; tone: ServerTone } | null;
	}

	function card(name: string): Card {
		const on = name === active;
		if (on) {
			const v = store.serverViewNow;
			return {
				name,
				active: true,
				mods: store.state.mods.length,
				fromServer: store.state.mods.filter((m) => m.managed).length,
				updates: store.updateCount,
				server: store.server
					? { name: store.serverName, gist: store.server.gist, role: store.serverAdmin ? "admin" : "player", status: v.text, tone: v.tone }
					: null,
			};
		}
		const check = store.serverChecks[name];
		const v = check ? serverView(check, false, t) : null;
		return {
			name,
			active: false,
			mods: store.state.profileMods[name]?.length ?? 0,
			fromServer: null,
			updates: null,
			server: check && v ? { name: check.name || t("server.fallbackName"), gist: true, role: null, status: v.text, tone: v.tone } : null,
		};
	}

	const cards = $derived(store.state.profiles.filter((p) => !search.trim() || p.toLowerCase().includes(search.trim().toLowerCase())).map(card));
	const current = $derived(sel && store.state.profiles.includes(sel) ? card(sel) : null);
	const TEXT: Record<ServerTone, string> = { ok: "text-success", warn: "text-primary", err: "text-destructive-text", muted: "text-muted-foreground" };

	function open(name: string, to?: Tab) {
		sel = name;
		view = "detail";
		const c = card(name);
		setTab(to ?? (c.server ? "server" : "general"));
	}

	function setTab(next: Tab) {
		tab = next;
		nameEdit = sel ?? "";
		role = store.serverAdmin ? "admin" : "player";
		address = "";
		token = "";
		code = null;
	}

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		try {
			await fn();
		} finally {
			busy = false;
		}
	}

	async function rename() {
		const to = nameEdit.trim();
		if (!sel || !to || to === sel) return;
		if (await store.renameProfile(sel, to)) sel = to;
	}

	async function exportFile() {
		if (!sel) return;
		const path = await saveDialog({ defaultPath: `${sel}.r2z`, filters: [{ name: t("profile.r2zFilter"), extensions: ["r2z"] }] });
		if (path) await store.exportFile(path, sel);
	}

	async function saveServer() {
		const url = address.trim();
		if (!url) return;
		if (await store.linkServer(url, role === "admin" ? token.trim() : "")) {
			address = "";
			token = "";
		}
	}

	function startImport(mode: "code" | "file") {
		importMode = mode;
		importOpen = true;
	}

	const overrideOn = $derived(sel !== null && store.state.overrides.includes(sel));

	/** The assistant with this profile as the source (copy) or its server as the source (compare). */
	function openTransfer(kind: "server" | "profile") {
		if (!sel) return;
		store.openTransfer(kind, sel, kind === "server" ? sel : null);
		setOpen(false);
	}

	/** Where the profiles live on disk, for the footer (the data dir of this install). */
	const folder = $derived(store.state.app.dataDir ? `${store.state.app.dataDir}\\profiles` : "");
	const canSave = $derived(
		!busy && ((tab === "general" && !!nameEdit.trim() && nameEdit.trim() !== sel) || (tab === "server" && isActive && !!address.trim())),
	);
</script>

{#snippet avatar(name: string)}
	<span class="bg-primary-soft text-primary-text text-2xs flex size-[22px] shrink-0 items-center justify-center rounded-[4px] font-mono font-semibold"
		>{initials(name)}</span
	>
{/snippet}

<Dialog.Root bind:open={() => store.profileManager, setOpen}>
	<Dialog.Content class="flex h-[min(680px,calc(100vh-48px))] flex-col gap-0 p-0 sm:max-w-[min(1040px,calc(100vw-48px))]">
		{#if view === "list" || !current}
			<Dialog.Header class="flex-row items-center gap-3 space-y-0 border-b px-5 py-3 pr-12">
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<Dialog.Title class="text-base">{t("pm.title")}</Dialog.Title>
					<span class="text-muted-foreground text-meta font-mono">{store.state.profiles.length}</span>
					<Dialog.Description class="sr-only">{t("pm.desc")}</Dialog.Description>
				</div>
				<Input class="w-[200px] min-w-0" placeholder={t("pm.search")} bind:value={search} />
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="gap-1.5">{t("pm.import")}<ChevronDown class="text-muted-foreground size-3.5" /></Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-64">
						<DropdownMenu.Item onSelect={() => startImport("file")}>{t("pm.importFile")}</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => startImport("code")}>{t("pm.importCode")}</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => store.showServer("add")}>{t("pm.importServer")}</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={() => (migrateOpen = true)}>{t("profile.migrate")}</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Button class="gap-2" onclick={() => (newOpen = true)}><Plus class="size-3.5" />{t("pm.new")}<Kbd>{t("key.ctrl")} N</Kbd></Button>
			</Dialog.Header>

			<div class="scroll-y @container min-h-0 flex-1 px-5 py-4">
				<div class="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
					{#each cards as p (p.name)}
						<div
							role="button"
							tabindex="0"
							class="bg-background hover:bg-hover flex cursor-pointer flex-col gap-3 rounded-md border p-3 text-left {p.active ? 'border-primary-line' : ''}"
							onclick={() => open(p.name)}
							ondblclick={() => !p.active && store.activateProfile(p.name)}
							onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(p.name))}
							title={p.active ? undefined : t("pm.dblclick")}
						>
							<div class="flex items-center gap-2">
								{@render avatar(p.name)}
								<span class="text-row min-w-0 flex-1 truncate font-semibold">{p.name}</span>
								{#if p.active}
									<span
										class="bg-primary-tint text-primary-text border-primary-line text-2xs flex h-5 shrink-0 items-center rounded-[4px] border px-1.5 font-mono"
										>{t("pm.active")}</span
									>
								{/if}
							</div>
							<div class="grid grid-cols-3 gap-3">
								<Stat label={t("pm.mods")} value={String(p.mods)} />
								<Stat label={t("pm.fromServer")} value={p.fromServer === null ? "—" : String(p.fromServer)} />
								<Stat label={t("pm.updates")} value={p.updates === null ? "—" : String(p.updates)} />
							</div>
							<div class="border-line-subtle flex min-w-0 items-center gap-2 border-t pt-3 text-xs">
								{#if p.server}
									{@const Icon = p.server.gist ? Cloud : Server}
									<Icon class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
									<span class="truncate font-medium">{p.server.name}</span>
									<StatusItem tone={p.server.tone} class="text-meta {TEXT[p.server.tone]}">{p.server.status}</StatusItem>
									{#if p.server.role}
										<span class="text-subtle-foreground text-meta ml-auto shrink-0 font-mono"
											>{p.server.role === "admin" ? t("chip.admin") : t("chip.readOnly")}</span
										>
									{/if}
								{:else}
									<span class="text-muted-foreground truncate">{t("pm.noServer")}</span>
									<span class="text-subtle-foreground text-meta ml-auto shrink-0 font-mono">{t("pm.localOnly")}</span>
								{/if}
							</div>
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div class="mt-auto flex gap-1.5" onclick={(e) => e.stopPropagation()}>
								{#if p.active}
									<Button size="sm" onclick={() => store.requestLaunch(true)}>{t("pm.play")}</Button>
									{#if p.server}
										<Button size="sm" variant="outline" onclick={() => store.showServer(p.server?.role === "admin" ? "publish" : "diff")}
											>{p.server.role === "admin" ? t("pm.publish") : t("pm.sync")}</Button
										>
									{/if}
								{:else}
									<Button size="sm" variant="outline" onclick={() => store.activateProfile(p.name)}>{t("pm.activate")}</Button>
								{/if}
								<div class="flex-1"></div>
								<Button size="sm" variant="ghost" onclick={() => open(p.name, "general")}>{t("pm.edit")}</Button>
							</div>
						</div>
					{/each}
					{#if !search.trim()}
						<div class="border-line-strong flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center">
							<div class="text-row font-semibold">{t("pm.newCard")}</div>
							<div class="text-muted-foreground max-w-[220px] text-xs text-pretty">{t("pm.newCardHint")}</div>
							<div class="mt-1 flex gap-1.5">
								<Button size="sm" variant="outline" onclick={() => (newOpen = true)}>{t("pm.empty")}</Button>
								<Button size="sm" variant="outline" onclick={() => store.showServer("add")}>{t("pm.fromServerBtn")}</Button>
							</div>
						</div>
					{/if}
				</div>
			</div>
			<div class="text-meta text-muted-foreground flex items-center gap-4 border-t px-5 py-2.5 font-mono">
				<span class="selectable min-w-0 truncate" title={folder}>{folder}</span>
				<span class="flex-1"></span>
				<span class="shrink-0">{t("pm.dblclick")}</span>
			</div>
		{:else}
			<Dialog.Header class="flex-row items-center gap-3 space-y-0 border-b px-5 py-3 pr-12">
				<Button variant="ghost" size="sm" class="gap-1.5" onclick={() => (view = "list")}><ArrowLeft class="size-3.5" />{t("pm.back")}</Button>
				<span class="bg-border h-5 w-px shrink-0" aria-hidden="true"></span>
				{@render avatar(current.name)}
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<Dialog.Title class="truncate text-base">{current.name}</Dialog.Title>
					<Dialog.Description class="text-muted-foreground text-meta truncate font-mono"
						>{t("profile.summary", { mods: current.mods })}{current.active ? ` · ${t("pm.activeLong")}` : ""}</Dialog.Description
					>
				</div>
				{#if current.active}
					<Button size="sm" variant="outline" onclick={() => store.openFolder("profile")}>{t("profile.openFolder")}</Button>
					<Button size="sm" onclick={() => store.requestLaunch(true)}>{t("pm.play")}</Button>
				{:else}
					<Button size="sm" onclick={() => store.activateProfile(current.name)}>{t("pm.activate")}</Button>
				{/if}
			</Dialog.Header>
			<div class="border-b px-5 py-3">
				<Segmented
					bind:value={() => tab, (v) => setTab(v as Tab)}
					options={[
						{ value: "general", label: t("pm.tabGeneral") },
						{ value: "server", label: t("pm.tabServer") },
						{ value: "share", label: t("pm.tabShare") },
					]}
				/>
			</div>

			<div class="scroll-y @container min-h-0 flex-1 px-5 pb-4">
				{#if tab === "general"}
					<SettingRow label={t("common.name")} align="center" for="pm-name">
						<Input id="pm-name" class="max-w-[360px]" bind:value={nameEdit} onkeydown={(e) => e.key === "Enter" && rename()} />
					</SettingRow>
					<SettingRow label={t("pm.mods")} hint={t("pm.modsHint")} align="center">
						<span class="text-foreground-soft flex items-center gap-4 font-mono text-[12.5px]">
							{#if current.fromServer !== null}
								<span>{current.fromServer} <span class="text-muted-foreground font-sans">{t("pm.fromServerLong")}</span></span>
								<span>{current.mods - current.fromServer} <span class="text-muted-foreground font-sans">{t("pm.ownLong")}</span></span>
							{:else}
								<span>{current.mods} <span class="text-muted-foreground font-sans">{t("pm.mods")}</span></span>
							{/if}
						</span>
					</SettingRow>
					<SettingRow label={t("pm.maintenance")} hint={t("pm.maintenanceHint")} align="center">
						<div class="flex flex-wrap gap-2">
							<Button size="sm" variant="outline" disabled={busy} onclick={() => run(() => store.repairProfile(current.name))}>{t("profile.repair")}</Button>
							<Button size="sm" variant="outline" onclick={() => (cloneOpen = true)}>{t("profile.clone")}</Button>
							<Button size="sm" variant="outline" onclick={() => openTransfer("profile")}>{t("pm.copyMods")}</Button>
							{#if current.server}
								<Button size="sm" variant="outline" onclick={() => openTransfer("server")}>{t("pm.compareServer")}</Button>
							{/if}
							<Button size="sm" variant="outline" onclick={() => (restoreOpen = true)}>{t("pm.restore")}</Button>
						</div>
					</SettingRow>
					{#if current.server || current.fromServer}
						<!-- The lock on the server's mods, and the one switch that lifts it. -->
						<SettingRow label={t("pm.override")} hint={t("pm.overrideHint")} align="center">
							<div class="flex flex-col gap-2">
								<Switch
									checked={overrideOn}
									disabled={busy}
									onCheckedChange={(v) => run(() => store.setOverride(current.name, v))}
									aria-label={t("pm.override")}
								/>
								{#if overrideOn}<p class="text-destructive-text max-w-[520px] text-xs">{t("pm.overrideWarn")}</p>{/if}
							</div>
						</SettingRow>
					{/if}
					<SettingRow label={t("pm.delete")} hint={t("profile.deleteDesc")} align="center">
						<Button size="sm" variant="destructive" onclick={() => (deleteOpen = true)}>{t("profile.delete")}</Button>
					</SettingRow>
				{:else if tab === "server"}
					{#if !current.active}
						<div class="flex flex-col items-start gap-3 py-5">
							<p class="text-muted-foreground max-w-[520px] text-xs">
								{current.server ? t("pm.serverOther", { name: current.server.name }) : t("pm.serverOtherNone")}
							</p>
							<Button size="sm" onclick={() => store.activateProfile(current.name)}>{t("pm.activate")}</Button>
						</div>
					{:else}
						<SettingRow label={t("pm.role")} hint={t("pm.roleHint")} align="center">
							<div class="flex flex-wrap items-center gap-3">
								<Segmented
									bind:value={() => role, (v) => (role = v as Role)}
									options={[
										{ value: "player", label: t("pm.rolePlayerName") },
										{ value: "admin", label: t("pm.roleAdminName") },
									]}
								/>
								<span class="text-muted-foreground min-w-0 text-xs">{role === "admin" ? t("pm.roleAdminDesc") : t("pm.rolePlayerDesc")}</span>
							</div>
						</SettingRow>
						<SettingRow label={t("pm.connection")} hint={t("pm.connectionHint")} for="pm-address">
							<div class="grid max-w-[560px] gap-1.5">
								<Input
									id="pm-address"
									class="font-mono"
									bind:value={address}
									placeholder={store.server ? t("pm.addressReplace") : "http://… / vmm1.…"}
									autocomplete="off"
								/>
								{#if store.server}
									<p class="text-muted-foreground text-xs">
										{t("pm.linkedTo", { name: store.serverName })}
										<span class="font-mono">{store.server.gist ? t("pm.viaGist") : store.server.url}</span>
									</p>
								{/if}
							</div>
						</SettingRow>
						{#if store.server}
							<SettingRow label={t("pm.currentRelease")} hint={t("pm.currentReleaseHint")} align="center">
								<span class="text-foreground-soft text-xs"
									>{store.serverStatus?.reachable ? releaseLabel(store.serverStatus.current, t) : t("chip.unreachable")}</span
								>
							</SettingRow>
						{/if}
						{#if role === "admin"}
							<SectionLabel class="border-b pt-6 pb-2.5">
								{t("pm.adminAccess")}
								{#snippet aside()}<span class="text-muted-foreground text-xs tracking-normal normal-case">{t("pm.adminLocal")}</span>{/snippet}
							</SectionLabel>
							<SettingRow label={t("pm.token")} hint={t("pm.tokenHint")} align="center" for="pm-token">
								<div class="flex max-w-[560px] items-center gap-3">
									<Input
										id="pm-token"
										type="password"
										class="font-mono"
										bind:value={token}
										autocomplete="off"
										placeholder={store.serverAdmin ? "••••••••" : t("pm.tokenPlaceholder")}
									/>
									{#if store.serverAdmin}<StatusItem tone="ok" class="text-success shrink-0 text-xs">{t("pm.tokenStored")}</StatusItem>{/if}
								</div>
							</SettingRow>
							{#if store.server}
								<SettingRow label={t("pm.publishRow")} hint={t("pm.publishRowHint")} align="center">
									<div class="flex flex-wrap gap-2">
										<Button size="sm" variant="outline" disabled={!store.serverAdmin || !store.state.mods.length} onclick={() => store.showServer("publish")}
											>{t("server.menuPublish")}</Button
										>
										{#if store.server.gist}
											<Button size="sm" variant="ghost" onclick={() => store.copyInviteLink()}>{t("server.inviteCopy")}</Button>
										{/if}
									</div>
								</SettingRow>
							{/if}
						{:else}
							<p class="text-muted-foreground max-w-[560px] py-4 text-xs">{t("pm.playerInfo")}</p>
						{/if}
					{/if}
				{:else}
					<SettingRow label={t("pm.code")} hint={t("pm.codeHint")} align="center">
						<div class="flex max-w-[560px] items-center gap-2">
							{#if code}
								<div class="bg-field border-input h-control selectable flex min-w-0 flex-1 items-center rounded-md border px-3 font-mono text-xs">
									<span class="truncate">{code}</span>
								</div>
								<Button variant="outline" onclick={() => code && store.copyText(code, t("export.inClipboard"))}>{t("common.copy")}</Button>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={busy || !current.mods}
									onclick={() =>
										run(async () => {
											code = await store.exportCode(current.name);
										})}>{t("pm.codeCreate")}</Button
								>
							{/if}
						</div>
					</SettingRow>
					<SettingRow label={t("pm.export")} hint={t("pm.exportHint")} align="center">
						<Button size="sm" variant="outline" onclick={exportFile}>{t("profile.export")}</Button>
					</SettingRow>
					<SettingRow label={t("pm.modpack")} hint={current.active ? t("pm.modpackHint") : t("pm.modpackActive")} align="center">
						<Button size="sm" variant="outline" disabled={!current.active || !current.mods} onclick={() => (store.publishDialog = true)}
							>{t("profile.publishModpack")}</Button
						>
					</SettingRow>
				{/if}
			</div>

			<div class="flex items-center gap-2 border-t px-5 py-3">
				{#if tab === "server" && current.active && store.server}
					<Button variant="ghost" size="sm" class="text-destructive-text" disabled={busy} onclick={() => run(() => store.unlinkServer())}
						>{t("server.unlink")}</Button
					>
					{#if store.serverStatus}
						<StatusItem
							tone={store.serverStatus.reachable ? "ok" : "err"}
							class="text-xs {store.serverStatus.reachable ? 'text-success' : 'text-destructive-text'}"
							>{store.serverStatus.reachable ? t("pm.reachable") : t("chip.unreachable")}</StatusItem
						>
					{/if}
				{/if}
				<div class="flex-1"></div>
				<Button variant="outline" onclick={() => (view = "list")}>{t("pm.back")}</Button>
				{#if tab !== "share"}
					<Button disabled={!canSave} onclick={() => run(() => (tab === "general" ? rename() : saveServer()))}
						>{tab === "server" ? t("pm.saveCheck") : t("common.save")}</Button
					>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<NameDialog
	bind:open={newOpen}
	title={t("profile.newTitle")}
	description={t("profile.newDesc")}
	submitLabel={t("profile.create")}
	onSubmit={(n) => store.newProfile(n)}
/>
<NameDialog
	bind:open={cloneOpen}
	title={t("profile.cloneTitle")}
	description={t("profile.cloneDesc", { name: sel ?? "" })}
	submitLabel={t("profile.cloneSubmit")}
	initial={t("profile.copySuffix", { name: sel ?? "" })}
	onSubmit={(n) => (sel ? store.cloneProfile(sel, n) : Promise.resolve(false))}
/>
<ImportProfileDialog bind:open={importOpen} bind:mode={importMode} />
<MigrateDialog bind:open={migrateOpen} />
<ConfirmDialog
	bind:open={restoreOpen}
	title={t("pm.restoreTitle", { name: sel ?? "" })}
	description={t("pm.restoreDesc")}
	confirmLabel={t("pm.restore")}
	onconfirm={async () => {
		if (sel) await store.restoreSnapshot(sel);
	}}
/>
<ConfirmDialog
	bind:open={deleteOpen}
	title={t("profile.deleteTitle", { name: sel ?? "" })}
	description={t("profile.deleteDesc")}
	confirmLabel={t("profile.deleteConfirm")}
	destructive
	onconfirm={async () => {
		if (sel && (await store.deleteProfile(sel))) {
			view = "list";
			sel = null;
		}
	}}
/>
