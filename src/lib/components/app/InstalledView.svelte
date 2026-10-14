<script lang="ts">
	import { onMount } from "svelte";
	import { getCurrentWebview } from "@tauri-apps/api/webview";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import Columns3 from "@lucide/svelte/icons/columns-3";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import Pin from "@lucide/svelte/icons/pin";
	import {
		Button,
		ContextMenu,
		DataTable,
		DropdownMenu,
		EmptyState,
		Input,
		isHidden,
		ModAvatar,
		resetColumns,
		Resizable,
		Segmented,
		SelectionBar,
		StatusPill,
		Switch,
		toggleColumn,
		Toolbar,
		emptySelection,
		type Column,
		type Selection,
	} from "#lib/components/kit/index.js";
	import { modId, store } from "#lib/api/store.svelte.js";
	import type { ProfileMod } from "#lib/api/types.js";
	import { normalize } from "#lib/browse/filter.js";
	import { formatBytes, formatCompact, formatDateTime, formatNumber, relativeTime } from "#lib/format.js";
	import { describeIssue } from "#lib/health.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import PackageDetail from "./PackageDetail.svelte";

	type Row = { kind: "mod"; id: string; m: ProfileMod } | { kind: "dep"; id: string; version: string; requiredBy: string[] };

	let query = $state("");
	let show = $state("all");
	let selection = $state.raw<Selection>(emptySelection);
	let dragging = $state(false);
	const prefs = store.tables.installed;

	const plan = $derived(store.state.plan);
	const updateCount = $derived(store.updateCount);
	const missing = $derived(store.readiness.status === "incomplete" ? store.readiness.missing : []);
	const missingNames = $derived(missing.map((m) => store.byId.get(m.id)?.name ?? m.id).join(", "));
	const compact = $derived(prefs.value.density === "compact");
	let healthOpen = $state(true);
	const nameOf = (id: string) => store.byId.get(id)?.name ?? id;
	const healthText = (id: string) => (store.healthByMod.get(id) ?? []).map((h) => describeIssue(h, nameOf, store.state.game.lastUpdated)).join("\n");

	const rows = $derived.by((): Row[] => {
		const q = normalize(query);
		const hit = (s: string) => !q || normalize(s).includes(q);
		const mods: Row[] = store.state.mods
			.map((m) => ({ kind: "mod" as const, id: modId(m), m }))
			.filter((r) => hit(r.id))
			.filter((r) => show === "all" || (show === "on" ? r.m.enabled : show === "off" ? !r.m.enabled : r.id in store.state.updates));
		if (show !== "all") return mods;
		const deps: Row[] = Object.entries(plan?.resolved ?? {})
			.filter(([id]) => !store.modsMap.has(id) && hit(id))
			.map(([id, r]) => ({ kind: "dep" as const, id, version: r.version, requiredBy: r.requiredBy }));
		return [...mods, ...deps];
	});

	const selectedMods = $derived([...selection.ids].filter((id) => store.modsMap.has(id)));
	const focus = $derived(selection.focus && store.byId.has(selection.focus) ? selection.focus : null);

	const columns: Column[] = $derived([
		{ key: "on", label: t("col.active"), width: "44px", fixed: true },
		{ key: "mod", label: t("col.mod"), width: "minmax(0,1fr)", fixed: true },
		{ key: "author", label: t("col.author"), width: "130px", priority: 1 },
		{ key: "version", label: t("col.version"), width: "100px", priority: 2 },
		{ key: "dl", label: t("col.dl"), width: "84px", align: "right", hidden: true },
		{ key: "upd", label: t("col.upd"), width: "104px", align: "right", hidden: true },
		{ key: "size", label: t("col.size"), width: "76px", align: "right", hidden: true },
		{ key: "cats", label: t("col.cats"), width: "180px", hidden: true },
		{ key: "status", label: t("col.status"), width: "150px", align: "right", priority: 3 },
	]);

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		getCurrentWebview()
			.onDragDropEvent((e) => {
				const p = e.payload;
				if (p.type === "enter" || p.type === "over") dragging = true;
				else if (p.type === "leave") dragging = false;
				else if (p.type === "drop") {
					dragging = false;
					const files = p.paths.filter((f) => /\.(zip|dll)$/i.test(f));
					if (files.length) store.addLocalMods(files);
					else store.toast(t("installed.onlyZipDll"), "err");
				}
			})
			.then((u) => {
				if (disposed) u();
				else unlisten = u;
			});
		return () => {
			disposed = true;
			unlisten?.();
		};
	});

	async function pickLocal() {
		const sel = await openDialog({ multiple: true, filters: [{ name: t("installed.modsFilter"), extensions: ["zip", "dll"] }] });
		if (sel) await store.addLocalMods(Array.isArray(sel) ? sel : [sel]);
	}

	function thunderstore(id: string) {
		store.getPackage(id).then((p) => store.openExternal(p.url));
	}

	function stop(e: Event) {
		e.stopPropagation();
	}
</script>

{#if !store.state.active}
	<EmptyState title={t("installed.noProfile")}>{t("installed.noProfileHint")}</EmptyState>
{:else}
	<Resizable.PaneGroup direction="horizontal" autoSaveId="installed" class="h-full">
		<Resizable.Pane minSize={40} order={1} id="installed-table">
			<div class="relative flex h-full flex-col">
				<Toolbar>
					<Input data-search class="max-w-sm" placeholder={t("installed.search")} bind:value={query} />
					<Segmented
						bind:value={show}
						options={[
							{ value: "all", label: t("installed.all") },
							{ value: "on", label: t("installed.on") },
							{ value: "off", label: t("installed.off") },
							{ value: "updates", label: t("installed.updates"), badge: updateCount, tone: "primary" },
						]}
					/>
					<div class="flex-1"></div>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon" title={t("browse.columnsTitle")}><Columns3 class="size-4" /></Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-56">
							<DropdownMenu.Label>{t("browse.columns")}</DropdownMenu.Label>
							{#each columns.filter((x) => !x.fixed) as col (col.key)}
								<DropdownMenu.CheckboxItem checked={!isHidden(col, prefs.value)} onCheckedChange={() => prefs.set(toggleColumn(prefs.value, col))}
									>{col.label}</DropdownMenu.CheckboxItem
								>
							{/each}
							<DropdownMenu.Separator />
							<DropdownMenu.Label>{t("browse.density")}</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								value={prefs.value.density}
								onValueChange={(v) => prefs.set({ ...prefs.value, density: v === "compact" ? "compact" : "normal" })}
							>
								<DropdownMenu.RadioItem value="normal">{t("browse.densityNormal")}</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem value="compact">{t("browse.densityCompact")}</DropdownMenu.RadioItem>
							</DropdownMenu.RadioGroup>
							<DropdownMenu.Separator />
							<DropdownMenu.Item onSelect={() => prefs.set(resetColumns(prefs.value))}>{t("browse.resetColumns")}</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<Button variant="outline" onclick={pickLocal}>{t("installed.local")}</Button>
					<Button disabled={!updateCount} onclick={() => store.updateAll()}>{t("installed.updateAll")}{updateCount ? ` (${updateCount})` : ""}</Button>
				</Toolbar>

				{#if missing.length}
					<div class="text-destructive-text bg-destructive/10 flex items-center gap-3 border-b px-4 py-2 text-[13px]">
						<TriangleAlert class="size-4 shrink-0" />
						<span class="min-w-0 flex-1">{t("readiness.missing", { n: missing.length, names: missingNames })}</span>
						<Button size="sm" variant="outline" onclick={() => store.retrySync()}>{t("readiness.installNow")}</Button>
					</div>
				{/if}

				{#if plan?.errors.length}
					<div class="text-destructive-text bg-destructive/10 border-b px-4 py-2 text-[13px]">
						{#each plan.errors as err (err)}<p>{err}</p>{/each}
					</div>
				{/if}

				{#if store.state.health.length}
					<div class="border-b px-4 py-2 text-[13px]">
						<button
							type="button"
							class="text-primary hover:text-foreground text-meta flex items-center gap-1.5 font-mono"
							onclick={() => (healthOpen = !healthOpen)}
						>
							<TriangleAlert class="size-3.5" />{t("health.count", { n: store.state.health.length })} · {healthOpen ? t("health.hide") : t("health.show")}
						</button>
						{#if healthOpen}
							<ul class="text-foreground-soft mt-1.5 flex flex-col gap-0.5 text-xs">
								{#each store.state.health as h, i (i)}<li>{describeIssue(h, nameOf, store.state.game.lastUpdated)}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}

				<DataTable
					class="flex-1"
					{rows}
					getId={(r: Row) => r.id}
					{columns}
					rowHeight={50}
					compactRowHeight={36}
					padBottom={selectedMods.length ? 64 : 0}
					bind:prefs={() => prefs.value, (v) => prefs.set(v)}
					bind:selection
					rowClass={(r) => (r.kind === "dep" || !r.m.enabled ? "opacity-60" : undefined)}
					ondelete={(ids) => store.removeMods(ids)}
				>
					{#snippet cell(r, key)}
						{@const p = store.byId.get(r.id)}
						{#if key === "on"}
							{#if r.kind === "mod"}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<span onclick={stop}
									><Switch
										size="sm"
										checked={r.m.enabled}
										onCheckedChange={(v) => store.setEnabled(r.id, v)}
										aria-label={t("installed.enableAria", { name: r.m.name })}
									/></span
								>
							{/if}
						{:else if key === "mod"}
							{@const name = r.kind === "mod" ? r.m.name : (p?.name ?? r.id)}
							<div class="flex min-w-0 items-center gap-[11px]">
								{#if !compact}<ModAvatar {name} icon={p?.icon} />{/if}
								<div class="flex min-w-0 flex-col gap-0.5">
									<span class="text-row truncate font-semibold">{name}</span>
									{#if !compact}
										{#if r.kind === "dep"}
											<span class="text-muted-foreground truncate text-xs"
												>{r.requiredBy.length
													? t("installed.requiredBy", { names: r.requiredBy.join(", ") })
													: store.state.implicitMods.includes(r.id)
														? t("installed.fromServer")
														: t("installed.base")}</span
											>
										{:else if r.m.source === "local"}
											<span class="text-muted-foreground text-xs">{t("installed.localMod")}</span>
										{:else if r.m.managed}
											<span class="text-muted-foreground truncate text-xs"
												><span class="text-primary">{t("installed.managed")}</span>{p ? ` · ${p.desc}` : ""}</span
											>
										{:else if p}
											<span class="text-muted-foreground truncate text-xs">{p.desc}</span>
										{/if}
									{/if}
								</div>
							</div>
						{:else if key === "author"}
							<span class="cell-soft block">{r.kind === "mod" ? r.m.namespace : r.id.split("-")[0]}</span>
						{:else if key === "version"}
							<span class="cell-mono inline-flex items-center gap-1"
								>{r.kind === "mod" ? r.m.version : r.version}{#if r.kind === "mod" && r.m.pinned}<Pin
										class="text-primary size-3"
										aria-label={t("installed.pinnedTitle")}
									/>{/if}</span
							>
						{:else if key === "dl"}
							<span class="cell-mono" title={p ? formatNumber(p.dl) : undefined}>{p ? formatCompact(p.dl) : "—"}</span>
						{:else if key === "upd"}
							<span class="cell-muted" title={p ? formatDateTime(p.upd) : undefined}>{p ? relativeTime(p.upd) : "—"}</span>
						{:else if key === "size"}
							<span class="cell-mono">{p ? formatBytes(p.size) : "—"}</span>
						{:else if key === "cats"}
							<span class="cell-soft block text-xs" title={p?.cats.join(", ")}>{p?.cats.join(", ") ?? ""}</span>
						{:else if key === "status"}
							{#if store.missingIds.has(r.id) && store.syncing}
								<span class="text-primary text-xs">{t("installed.installing")}</span>
							{:else if store.missingIds.has(r.id)}
								<span class="text-destructive-text text-xs">{t("installed.notInstalled")}</span>
							{:else}
								{#if store.healthByMod.has(r.id)}<span class="mr-1.5 inline-flex" title={healthText(r.id)}><TriangleAlert class="text-primary size-3.5" /></span
									>{/if}
								<StatusPill
									status={store.modStatus(r.id)}
									version={store.state.updates[r.id]}
									onclick={(e) => {
										stop(e);
										store.requestUpdate([r.id]);
									}}
								/>
							{/if}
						{/if}
					{/snippet}
					{#snippet menu(ids)}
						{@const mods = ids.filter((id) => store.modsMap.has(id))}
						<ContextMenu.Label>{ids.length > 1 ? t("installed.entriesSelected", { n: ids.length }) : ids[0]}</ContextMenu.Label>
						<ContextMenu.Item disabled={!mods.length} onSelect={() => store.setEnabledMany(mods, true)}>{t("common.enable")}</ContextMenu.Item>
						<ContextMenu.Item disabled={!mods.length} onSelect={() => store.setEnabledMany(mods, false)}>{t("common.disable")}</ContextMenu.Item>
						<ContextMenu.Item disabled={!mods.some((id) => id in store.state.updates)} onSelect={() => store.requestUpdate(mods)}
							>{t("common.update")}</ContextMenu.Item
						>
						<ContextMenu.Item disabled={mods.length !== 1} onSelect={() => store.togglePin(mods[0])}
							>{store.modsMap.get(mods[0])?.pinned ? t("installed.unpin") : t("installed.pin")}</ContextMenu.Item
						>
						<ContextMenu.Separator />
						<ContextMenu.Item disabled={ids.length > 1 || !store.byId.has(ids[0])} onSelect={() => thunderstore(ids[0])}
							>{t("browse.openThunderstore")}<ContextMenu.Shortcut>↗</ContextMenu.Shortcut></ContextMenu.Item
						>
						<ContextMenu.Separator />
						<ContextMenu.Item variant="destructive" disabled={!mods.length} onSelect={() => store.removeMods(mods)}
							>{t("common.remove")}<ContextMenu.Shortcut>{t("key.del")}</ContextMenu.Shortcut></ContextMenu.Item
						>
					{/snippet}
					{#snippet empty()}
						<EmptyState title={store.state.mods.length ? t("installed.noMatches") : t("installed.noMods")}>
							{store.state.mods.length ? t("installed.noMatchesHint") : t("installed.noModsHint")}
						</EmptyState>
					{/snippet}
				</DataTable>

				<SelectionBar count={selectedMods.length} onclear={() => (selection = { ...selection, ids: new Set(), anchor: null })} hint={t("installed.hint")}>
					<Button size="sm" variant="ghost" onclick={() => store.setEnabledMany(selectedMods, true)}>{t("common.enable")}</Button>
					<Button size="sm" variant="ghost" onclick={() => store.setEnabledMany(selectedMods, false)}>{t("common.disable")}</Button>
					<Button size="sm" variant="ghost" disabled={!selectedMods.some((id) => id in store.state.updates)} onclick={() => store.requestUpdate(selectedMods)}
						>{t("common.update")}</Button
					>
					<Button size="sm" variant="destructive" onclick={() => store.removeMods(selectedMods)}>{t("common.remove")}</Button>
				</SelectionBar>

				{#if dragging}
					<div
						class="bg-background/80 border-primary pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium"
					>
						{t("installed.dropHere")}
					</div>
				{/if}
			</div>
		</Resizable.Pane>
		<Resizable.Handle />
		<Resizable.Pane defaultSize={28} minSize={24} maxSize={40} order={2} id="installed-detail">
			<PackageDetail id={focus} />
		</Resizable.Pane>
	</Resizable.PaneGroup>
{/if}
