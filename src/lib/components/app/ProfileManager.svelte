<script lang="ts">
	// Profile manager (design "Server Link Modals", 2a): every profile as a card, a click opens its details in
	// the same modal with three tabs: General, Server & Sync, Share & Export. Everything that used to crowd the
	// profile menu lives here; the menu only switches profiles.
	import { save as saveDialog } from "@tauri-apps/plugin-dialog";
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import { Button, ConfirmDialog, Dialog, DropdownMenu, Input, Segmented } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { serverView } from "#lib/api/server-view.js";
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
		server: { name: string; role: Role | null; status: string; tone: string } | null;
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
				server: store.server ? { name: store.serverName, role: store.serverAdmin ? "admin" : "player", status: v.text, tone: v.tone } : null,
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
			server: check && v ? { name: check.name || t("server.fallbackName"), role: null, status: v.text, tone: v.tone } : null,
		};
	}

	const cards = $derived(store.state.profiles.filter((p) => !search.trim() || p.toLowerCase().includes(search.trim().toLowerCase())).map(card));
	const current = $derived(sel && store.state.profiles.includes(sel) ? card(sel) : null);
	const TONE: Record<string, string> = { ok: "text-success", warn: "text-primary-text", err: "text-destructive-text", muted: "text-muted-foreground" };

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

	/** Where the profiles live on disk, for the footer (the data dir of this install). */
	const folder = $derived(store.state.app.dataDir ? `${store.state.app.dataDir}\\profiles` : "");
	const canSave = $derived(
		!busy && ((tab === "general" && !!nameEdit.trim() && nameEdit.trim() !== sel) || (tab === "server" && isActive && !!address.trim())),
	);
</script>

<Dialog.Root bind:open={() => store.profileManager, setOpen}>
	<Dialog.Content
		class="bg-panel flex h-[min(688px,calc(100vh-48px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100vw-48px))]"
		showCloseButton={false}
	>
		{#if view === "list" || !current}
			<Dialog.Header class="flex-row items-center gap-2.5 space-y-0 border-b px-5 py-4">
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<Dialog.Title class="text-base font-semibold">{t("pm.title")}</Dialog.Title>
					<span class="text-subtle-foreground text-meta font-mono">{store.state.profiles.length}</span>
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
				<Button class="gap-1.5" onclick={() => (newOpen = true)}
					><Plus class="size-3.5" />{t("pm.new")}<span class="font-mono text-[10.5px] opacity-70">{t("key.ctrl")} N</span></Button
				>
				<Dialog.Close>
					{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={t("common.close")}>×</Button>{/snippet}
				</Dialog.Close>
			</Dialog.Header>

			<div class="scroll-y @container min-h-0 flex-1 p-5">
				<div class="grid grid-cols-1 gap-3.5 @xl:grid-cols-2 @4xl:grid-cols-3">
					{#each cards as p (p.name)}
						<div
							role="button"
							tabindex="0"
							class="bg-background hover:bg-hover flex min-h-[204px] cursor-pointer flex-col rounded-[6px] border text-left {p.active
								? 'border-primary-line'
								: ''}"
							onclick={() => open(p.name)}
							ondblclick={() => !p.active && store.activateProfile(p.name)}
							onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(p.name))}
							title={p.active ? undefined : t("pm.dblclick")}
						>
							<div class="flex items-center gap-2.5 px-3.5 pt-3.5">
								<span class="bg-primary-soft text-primary-text grid size-[34px] shrink-0 place-items-center rounded-[5px] text-xs font-bold"
									>{initials(p.name)}</span
								>
								<div class="min-w-0 flex-1">
									<div class="text-row truncate font-semibold">{p.name}</div>
									<div class="text-muted-foreground text-meta truncate font-mono">{t("profile.summary", { mods: p.mods })}</div>
								</div>
								{#if p.active}
									<span class="bg-primary-tint text-primary-text border-primary-line shrink-0 rounded-[4px] border px-1.5 py-0.5 font-mono text-[10.5px]"
										>{t("pm.active")}</span
									>
								{/if}
							</div>
							<div class="bg-line-subtle border-line-subtle mx-3.5 mt-3.5 grid grid-cols-3 gap-px overflow-hidden rounded-[5px] border">
								<div class="bg-background px-2.5 py-2">
									<div class="text-row font-mono">{p.mods}</div>
									<div class="text-muted-foreground text-meta">{t("pm.mods")}</div>
								</div>
								<div class="bg-background px-2.5 py-2">
									<div class="text-row font-mono">{p.fromServer ?? "—"}</div>
									<div class="text-muted-foreground text-meta">{t("pm.fromServer")}</div>
								</div>
								<div class="bg-background px-2.5 py-2">
									<div class="text-row font-mono {p.updates ? 'text-primary' : 'text-subtle-foreground'}">{p.updates ?? "—"}</div>
									<div class="text-muted-foreground text-meta">{t("pm.updates")}</div>
								</div>
							</div>
							<div
								class="mx-3.5 mt-2.5 flex items-center gap-2 rounded-[5px] border px-2.5 py-2 {p.server?.role === 'admin'
									? 'border-primary-line bg-primary-tint'
									: p.server
										? 'border-info-line bg-info-soft'
										: 'border-line-subtle'}"
							>
								<span
									class="shrink-0 font-mono text-[11px] font-semibold {p.server?.role === 'admin'
										? 'text-primary'
										: p.server
											? 'text-info'
											: 'text-muted-foreground'}">{p.server?.role === "admin" ? "↑" : p.server ? "↓" : "–"}</span
								>
								<div class="min-w-0 flex-1">
									<div class="truncate text-xs font-semibold">{p.server?.name ?? t("pm.noServer")}</div>
									<div class="text-meta truncate {p.server ? TONE[p.server.tone] : 'text-subtle-foreground'}">{p.server?.status ?? t("pm.localOnly")}</div>
								</div>
								{#if p.server?.role}
									<span class="text-meta shrink-0 font-mono {p.server.role === 'admin' ? 'text-primary' : 'text-info'}"
										>{p.server.role === "admin" ? t("pm.roleAdmin") : t("pm.rolePlayer")}</span
									>
								{/if}
							</div>
							<div class="flex-1"></div>
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div class="flex gap-1.5 px-3.5 pt-3 pb-3.5" onclick={(e) => e.stopPropagation()}>
								{#if p.active}
									<Button size="sm" variant="outline" onclick={() => store.requestLaunch(true)}>{t("pm.play")}</Button>
									{#if p.server}
										<Button
											size="sm"
											variant="secondary"
											class={p.server.role === "admin" ? "text-primary" : "text-info"}
											onclick={() => store.showServer(p.server?.role === "admin" ? "publish" : "diff")}
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
						<div class="border-line-strong flex min-h-[204px] flex-col items-center justify-center gap-2.5 rounded-[6px] border border-dashed p-5 text-center">
							<div class="text-row font-semibold">{t("pm.newCard")}</div>
							<div class="text-muted-foreground max-w-[220px] text-xs text-pretty">{t("pm.newCardHint")}</div>
							<div class="flex gap-1.5">
								<Button size="sm" variant="outline" onclick={() => (newOpen = true)}>{t("pm.empty")}</Button>
								<Button size="sm" variant="outline" onclick={() => store.showServer("add")}>{t("pm.fromServerBtn")}</Button>
							</div>
						</div>
					{/if}
				</div>
			</div>
			<div class="bg-chrome h-statusbar text-meta text-muted-foreground flex items-center gap-5 border-t px-3.5 font-mono">
				<span class="min-w-0 truncate">{folder}</span>
				<span class="flex-1"></span>
				<span class="shrink-0">{t("pm.dblclick")}</span>
			</div>
		{:else}
			<Dialog.Header class="flex-row items-center gap-3 space-y-0 border-b px-5 py-3.5">
				<Button variant="ghost" size="sm" class="gap-1.5" onclick={() => (view = "list")}><ArrowLeft class="size-3.5" />{t("pm.back")}</Button>
				<span class="bg-border h-5 w-px shrink-0" aria-hidden="true"></span>
				<span class="bg-primary-soft text-primary-text grid size-[34px] shrink-0 place-items-center rounded-[5px] text-xs font-bold"
					>{initials(current.name)}</span
				>
				<div class="min-w-0 flex-1">
					<Dialog.Title class="truncate text-base font-semibold">{current.name}</Dialog.Title>
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
				<Dialog.Close>
					{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={t("common.close")}>×</Button>{/snippet}
				</Dialog.Close>
			</Dialog.Header>
			<div class="px-5 pt-3">
				<Segmented
					bind:value={() => tab, (v) => setTab(v as Tab)}
					options={[
						{ value: "general", label: t("pm.tabGeneral") },
						{ value: "server", label: t("pm.tabServer") },
						{ value: "share", label: t("pm.tabShare") },
					]}
				/>
			</div>

			<div class="scroll-y min-h-0 flex-1 px-5 pt-1 pb-5">
				{#if tab === "general"}
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
						<div class="text-row font-semibold">{t("common.name")}</div>
						<Input class="max-w-[360px]" bind:value={nameEdit} onkeydown={(e) => e.key === "Enter" && rename()} />
					</div>
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
						<div>
							<div class="text-row font-semibold">{t("pm.mods")}</div>
							<div class="text-muted-foreground text-xs">{t("pm.modsHint")}</div>
						</div>
						<div class="flex items-center gap-5">
							{#if current.fromServer !== null}
								<span><span class="font-mono">{current.fromServer}</span> <span class="text-muted-foreground">{t("pm.fromServerLong")}</span></span>
								<span><span class="font-mono">{current.mods - current.fromServer}</span> <span class="text-muted-foreground">{t("pm.ownLong")}</span></span>
							{:else}
								<span><span class="font-mono">{current.mods}</span> <span class="text-muted-foreground">{t("pm.mods")}</span></span>
							{/if}
						</div>
					</div>
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
						<div>
							<div class="text-row font-semibold">{t("pm.maintenance")}</div>
							<div class="text-muted-foreground text-xs">{t("pm.maintenanceHint")}</div>
						</div>
						<div class="flex flex-wrap gap-2">
							<Button size="sm" variant="outline" disabled={busy} onclick={() => run(() => store.repairProfile(current.name))}>{t("profile.repair")}</Button>
							<Button size="sm" variant="outline" onclick={() => (cloneOpen = true)}>{t("profile.clone")}</Button>
						</div>
					</div>
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 py-4">
						<div>
							<div class="text-row text-destructive-text font-semibold">{t("pm.delete")}</div>
							<div class="text-muted-foreground text-xs">{t("profile.deleteDesc")}</div>
						</div>
						<div><Button size="sm" variant="destructive" onclick={() => (deleteOpen = true)}>{t("profile.delete")}</Button></div>
					</div>
				{:else if tab === "server"}
					{#if !current.active}
						<div class="text-muted-foreground flex flex-col items-start gap-3 py-6 text-[13px]">
							<p>{current.server ? t("pm.serverOther", { name: current.server.name }) : t("pm.serverOtherNone")}</p>
							<Button size="sm" onclick={() => store.activateProfile(current.name)}>{t("pm.activate")}</Button>
						</div>
					{:else}
						<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
							<div>
								<div class="text-row font-semibold">{t("pm.role")}</div>
								<div class="text-muted-foreground text-xs">{t("pm.roleHint")}</div>
							</div>
							<div class="grid max-w-[620px] grid-cols-2 gap-2.5">
								{#each ["player", "admin"] as const as r (r)}
									<button
										type="button"
										aria-pressed={role === r}
										class="rounded-[6px] border px-3.5 py-3 text-left {role === r
											? r === 'admin'
												? 'border-primary-line bg-primary-tint'
												: 'border-info-line bg-info-soft'
											: 'bg-background hover:bg-hover'}"
										onclick={() => (role = r)}
									>
										<div class="flex gap-2 font-semibold {r === 'admin' ? 'text-primary' : 'text-info'}">
											<span class="font-mono">{r === "admin" ? "↑" : "↓"}</span>{r === "admin" ? t("pm.roleAdminName") : t("pm.rolePlayerName")}
										</div>
										<div class="text-muted-foreground mt-0.5 text-xs">{r === "admin" ? t("pm.roleAdminDesc") : t("pm.rolePlayerDesc")}</div>
									</button>
								{/each}
							</div>
						</div>
						<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
							<div>
								<div class="text-row font-semibold">{t("pm.connection")}</div>
								<div class="text-muted-foreground text-xs">{t("pm.connectionHint")}</div>
							</div>
							<div class="grid max-w-[620px] gap-1.5">
								{#if store.server}
									<p class="text-foreground-soft text-xs">
										{t("pm.linkedTo", { name: store.serverName })}
										<span class="text-muted-foreground font-mono">{store.server.gist ? t("pm.viaGist") : store.server.url}</span>
									</p>
								{/if}
								<Input class="font-mono" bind:value={address} placeholder={store.server ? t("pm.addressReplace") : "http://… / vmm1.…"} autocomplete="off" />
							</div>
						</div>
						{#if role === "admin"}
							<div class="border-primary-line bg-primary-tint mt-4 rounded-[6px] border px-4 pt-1">
								<div class="flex items-center gap-2.5 pt-3 pb-1">
									<span class="label-caps text-primary-text">{t("pm.adminAccess")}</span>
									<span class="text-muted-foreground text-xs">{t("pm.adminLocal")}</span>
								</div>
								<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 py-3">
									<div>
										<div class="text-row font-semibold">{t("pm.token")}</div>
										<div class="text-muted-foreground text-xs">{t("pm.tokenHint")}</div>
									</div>
									<div class="flex max-w-[620px] items-center gap-2.5">
										<Input
											type="password"
											class="font-mono"
											bind:value={token}
											autocomplete="off"
											placeholder={store.serverAdmin ? "••••••••" : t("pm.tokenPlaceholder")}
										/>
										{#if store.serverAdmin}<span class="text-success shrink-0 text-xs">✓ {t("pm.tokenStored")}</span>{/if}
									</div>
								</div>
								{#if store.server}
									<div class="flex flex-wrap gap-2 pb-3.5">
										<Button size="sm" variant="outline" disabled={!store.serverAdmin || !store.state.mods.length} onclick={() => store.showServer("publish")}
											>{t("server.menuPublish")}</Button
										>
										{#if store.server.gist}
											<Button size="sm" variant="ghost" onclick={() => store.copyInviteLink()}>{t("server.inviteCopy")}</Button>
										{/if}
									</div>
								{/if}
							</div>
						{:else}
							<div class="border-info-line bg-info-soft text-foreground-soft mt-4 rounded-[6px] border px-3.5 py-3 text-[12.5px] leading-normal">
								{t("pm.playerInfo")}
							</div>
						{/if}
					{/if}
				{:else}
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
						<div>
							<div class="text-row font-semibold">{t("pm.code")}</div>
							<div class="text-muted-foreground text-xs">{t("pm.codeHint")}</div>
						</div>
						<div class="flex max-w-[620px] items-center gap-2">
							{#if code}
								<div class="bg-field h-control selectable flex min-w-0 flex-1 items-center rounded-[4px] border px-2.5 font-mono text-xs">
									<span class="truncate">{code}</span>
								</div>
								<Button variant="outline" onclick={() => code && store.copyText(code, t("export.inClipboard"))}>{t("common.copy")}</Button>
							{:else}
								<Button
									variant="outline"
									disabled={busy || !current.mods}
									onclick={() =>
										run(async () => {
											code = await store.exportCode(current.name);
										})}>{t("pm.codeCreate")}</Button
								>
							{/if}
						</div>
					</div>
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 border-b py-4">
						<div>
							<div class="text-row font-semibold">{t("pm.export")}</div>
							<div class="text-muted-foreground text-xs">{t("pm.exportHint")}</div>
						</div>
						<div><Button size="sm" variant="outline" onclick={exportFile}>{t("profile.export")}</Button></div>
					</div>
					<div class="grid grid-cols-[var(--spacing-label)_minmax(0,1fr)] gap-x-6 py-4">
						<div>
							<div class="text-row font-semibold">{t("pm.modpack")}</div>
							<div class="text-muted-foreground text-xs">{current.active ? t("pm.modpackHint") : t("pm.modpackActive")}</div>
						</div>
						<div>
							<Button size="sm" variant="outline" disabled={!current.active || !current.mods} onclick={() => (store.publishDialog = true)}
								>{t("profile.publishModpack")}</Button
							>
						</div>
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-2.5 border-t px-5 py-3">
				{#if tab === "server" && current.active && store.server}
					<Button variant="ghost" size="sm" class="text-destructive-text" disabled={busy} onclick={() => run(() => store.unlinkServer())}
						>{t("server.unlink")}</Button
					>
					{#if store.serverStatus}
						<span class="flex items-center gap-1.5 text-xs {store.serverStatus.reachable ? 'text-success' : 'text-destructive-text'}">
							<span class="size-1.5 rounded-full {store.serverStatus.reachable ? 'bg-success' : 'bg-destructive'}"></span>
							{store.serverStatus.reachable ? t("pm.reachable") : t("chip.unreachable")}
						</span>
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
