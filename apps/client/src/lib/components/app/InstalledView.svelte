<script lang="ts">
	import { onMount } from "svelte";
	import { getCurrentWebview } from "@tauri-apps/api/webview";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import Columns3 from "@lucide/svelte/icons/columns-3";
	import FilePlus from "@lucide/svelte/icons/file-plus";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import Pin from "@lucide/svelte/icons/pin";
	import Lock from "@lucide/svelte/icons/lock";
	import {
		Button,
		ContextMenu,
		DataTable,
		DropdownMenu,
		EmptyState,
		Input,
		InstallState,
		isHidden,
		ModAvatar,
		Popover,
		resetColumns,
		Resizable,
		Segmented,
		SelectionBar,
		SourceBadge,
		Switch,
		TagList,
		toggleColumn,
		Toolbar,
		emptySelection,
		type Column,
		type Selection,
		type SortState,
	} from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { normalize } from "#lib/browse/filter.js";
	import { Persisted } from "#lib/desktop/persisted.svelte.js";
	import { isRecord } from "#lib/desktop/storage.js";
	import { formatBytes, formatCompact, formatDate, formatDateTime, formatNumber, relativeTime } from "#lib/format.js";
	import { describeIssue, groupIssues } from "#lib/health.js";
	import { buildRows, countSources, sortRows, type InstalledRow } from "#lib/installed.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import PackageDetail from "./PackageDetail.svelte";

	let query = $state("");
	let show = $state("all");
	let selection = $state.raw<Selection>(emptySelection);
	let dragging = $state(false);
	let dropped = $state<string[]>([]);
	const prefs = store.tables.installed;
	const sortPref = new Persisted<SortState | null>("werkbank.installed.sort", null, (v) =>
		isRecord(v) && typeof v.key === "string" && (v.dir === "asc" || v.dir === "desc") ? { key: v.key, dir: v.dir } : null,
	);

	const plan = $derived(store.state.plan);
	const updateCount = $derived(store.updateCount);
	const missing = $derived(store.readiness.status === "incomplete" ? store.readiness.missing : []);
	const missingNames = $derived(missing.map((m) => store.byId.get(m.id)?.name ?? m.id).join(", "));
	const compact = $derived(prefs.value.density === "compact");
	const nameOf = (id: string) => store.byId.get(id)?.name ?? id;
	const healthText = (id: string) => (store.healthByMod.get(id) ?? []).map((h) => describeIssue(h, nameOf, store.state.game.lastUpdated)).join("\n");
	const health = $derived(groupIssues(store.state.health, nameOf));
	const gameUpdated = $derived(store.state.game.lastUpdated);

	const all = $derived(
		buildRows({
			mods: store.state.mods,
			plan,
			implicitMods: store.state.implicitMods,
			updates: store.state.updates,
			missing: store.missingIds,
			syncing: store.syncing,
			nameOf: (id) => store.byId.get(id)?.name,
		}),
	);
	const sources = $derived(countSources(all));
	/** Width of the table pane: below ~900px the filter segments drop their counts so the toolbar keeps one line. */
	let paneWidth = $state(0);
	const showOptions = $derived.by(() => {
		const n = (v: number) => (paneWidth >= 900 && v ? v : undefined);
		return [
			{ value: "all", label: t("installed.all") },
			...(sources.server || show === "server" ? [{ value: "server", label: t("source.server"), badge: n(sources.server) }] : []),
			{ value: "own", label: t("installed.own"), badge: n(sources.own + sources.local) },
			{ value: "dependency", label: t("installed.deps"), badge: n(sources.dependency) },
			{ value: "updates", label: t("installed.updates"), badge: updateCount || undefined, tone: "primary" as const },
		];
	});
	const rows = $derived.by((): InstalledRow[] => {
		const q = normalize(query);
		const hit = (r: InstalledRow) => !q || normalize(`${r.name} ${r.author}`).includes(q);
		const keep = (r: InstalledRow) =>
			show === "all" || (show === "updates" ? r.state === "update" : show === "own" ? r.source === "own" || r.source === "local" : r.source === show);
		return sortRows(
			all.filter((r) => hit(r) && keep(r)),
			sortPref.value,
		);
	});

	const selectedMods = $derived([...selection.ids].filter((id) => store.modsMap.has(id)));
	/** The selection without the server's locked mods: what the bar's actions apply to. */
	const selectedFree = $derived(selectedMods.filter((id) => !store.isLocked(id)));
	const lockedTitle = $derived(`${t("installed.locked")} · ${t("installed.lockedHint")}`);
	const focus = $derived(selection.focus && store.byId.has(selection.focus) ? selection.focus : null);

	const columns: Column[] = $derived([
		{ key: "on", label: t("col.active"), width: "44px", fixed: true },
		{ key: "mod", label: t("col.mod"), width: "minmax(0,1fr)", fixed: true, sortable: true, defaultDir: "asc" },
		{ key: "author", label: t("col.author"), width: "130px", priority: 1, sortable: true, defaultDir: "asc" },
		{ key: "version", label: t("col.version"), width: "100px", priority: 2 },
		{ key: "dl", label: t("col.dl"), width: "84px", align: "right", hidden: true },
		{ key: "upd", label: t("col.upd"), width: "104px", align: "right", hidden: true },
		{ key: "size", label: t("col.size"), width: "76px", align: "right", hidden: true },
		{ key: "cats", label: t("col.cats"), width: "220px", hidden: true },
		{ key: "status", label: t("col.status"), width: "132px", priority: 4, sortable: true, defaultDir: "asc" },
		{ key: "source", label: t("col.source"), width: "120px", priority: 3, sortable: true, defaultDir: "asc" },
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

	/** What the source badge explains on hover: which server mod or player mod needs a dependency. */
	function sourceTitle(r: InstalledRow): string | undefined {
		if (r.kind !== "dep") return undefined;
		if (r.source === "server") return t("installed.fromServer");
		return r.requiredBy.length ? t("installed.requiredBy", { names: r.requiredBy.map(nameOf).join(", ") }) : t("installed.base");
	}
</script>

{#if !store.state.active}
	<EmptyState title={t("installed.noProfile")}>{t("installed.noProfileHint")}</EmptyState>
{:else}
	<Resizable.PaneGroup direction="horizontal" autoSaveId="installed" class="h-full">
		<Resizable.Pane minSize={40} order={1} id="installed-table">
			<div class="@container relative flex h-full flex-col" bind:clientWidth={paneWidth}>
				<Toolbar>
					<Input data-search class="w-[220px] shrink" placeholder={t("installed.search")} bind:value={query} />
					<Segmented bind:value={show} options={showOptions} />
					<div class="flex-1"></div>
					{#if store.state.health.length}
						<!-- Hints: one explanation per kind, the affected mods as a compact list under it. Behind a button, so a
						     profile with a few stale mods does not lose table height to them. -->
						<Popover.Root>
							<Popover.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="sm"
										class="text-primary-text gap-1.5 px-2"
										title={t("health.count", { n: store.state.health.length })}
									>
										<TriangleAlert class="size-4" /><span class="text-xs font-semibold">{store.state.health.length}</span>
									</Button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content align="end" class="w-[420px] max-w-[calc(100vw-32px)] gap-0 p-0">
								<p class="text-primary-text flex items-center gap-1.5 border-b px-3 py-2 text-xs font-semibold">
									<TriangleAlert class="size-3.5" />{t("health.count", { n: store.state.health.length })}
								</p>
								<div class="scroll-y grid max-h-[320px] gap-3 px-3 py-2.5 text-xs">
									{#if health.stale.length}
										<div class="grid gap-1">
											<p class="text-foreground-soft">
												{t("health.staleIntro", { game: gameUpdated ? formatDate(gameUpdated) : "?" })}
											</p>
											<ul class="flex flex-wrap gap-1.5">
												{#each health.stale as s (s.id)}
													<li class="border-line-subtle bg-raised flex h-6 items-center gap-2 rounded-[4px] border px-2">
														<span class="text-foreground">{s.name}</span>
														<span class="text-subtle-foreground font-mono text-[11px]" title={t("health.lastUpdate")}>{formatDate(s.when)}</span>
													</li>
												{/each}
											</ul>
										</div>
									{/if}
									{#if health.deprecated.length}
										<div class="grid gap-1">
											<p class="text-foreground-soft">{t("health.deprecatedIntro")}</p>
											<ul class="flex flex-wrap gap-1.5">
												{#each health.deprecated as d (d.id)}
													<li class="border-line-subtle bg-raised text-foreground flex h-6 items-center rounded-[4px] border px-2">{d.name}</li>
												{/each}
											</ul>
										</div>
									{/if}
									{#if health.duplicates.length}
										<div class="grid gap-1">
											<p class="text-foreground-soft">{t("health.duplicateIntro")}</p>
											<ul class="grid gap-0.5">
												{#each health.duplicates as d (d.file)}
													<li>
														<span class="text-foreground font-mono text-[11.5px]">{d.file}</span>
														<span class="text-muted-foreground">← {d.mods.join(", ")}</span>
													</li>
												{/each}
											</ul>
										</div>
									{/if}
								</div>
							</Popover.Content>
						</Popover.Root>
					{/if}
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
									>{col.label}{#if dropped.includes(col.key)}<span class="text-subtle-foreground text-meta ml-auto pl-2">{t("table.noRoom")}</span
										>{/if}</DropdownMenu.CheckboxItem
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
					<Button variant="outline" size="icon" title={t("installed.local")} aria-label={t("installed.local")} onclick={pickLocal}
						><FilePlus class="size-4" /></Button
					>
					<Button disabled={!updateCount} title={t("installed.updateAll")} onclick={() => store.updateAll()}
						><span class="hidden @min-[880px]:inline">{t("installed.updateAll")}</span><span class="@min-[880px]:hidden">{t("installed.all")}</span>{updateCount
							? ` (${updateCount})`
							: ""}</Button
					>
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

				<DataTable
					class="flex-1"
					{rows}
					getId={(r: InstalledRow) => r.id}
					{columns}
					rowHeight={50}
					compactRowHeight={36}
					padBottom={selectedMods.length ? 64 : 0}
					bind:prefs={() => prefs.value, (v) => prefs.set(v)}
					bind:sort={() => sortPref.value, (v) => sortPref.set(v)}
					bind:selection
					bind:dropped
					rowClass={(r) => (r.state === "disabled" ? "opacity-60" : undefined)}
					ondelete={(ids) => store.removeMods(ids)}
				>
					{#snippet cell(r, key)}
						{@const p = store.byId.get(r.id)}
						{#if key === "on"}
							{#if r.mod}
								{@const m = r.mod}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<span onclick={stop} title={store.isLocked(r.id) ? lockedTitle : undefined}
									><Switch
										size="sm"
										checked={m.enabled}
										disabled={store.isLocked(r.id)}
										onCheckedChange={(v) => store.setEnabled(r.id, v)}
										aria-label={t("installed.enableAria", { name: m.name })}
									/></span
								>
							{/if}
						{:else if key === "mod"}
							<div class="flex min-w-0 items-center gap-[11px]">
								{#if !compact}<ModAvatar name={r.name} icon={p?.icon} />{/if}
								<div class="flex min-w-0 flex-col gap-0.5">
									<span class="text-row truncate font-semibold {r.kind === 'dep' ? 'text-foreground-soft' : ''}">{r.name}</span>
									{#if !compact}
										<span class="text-muted-foreground truncate text-xs"
											>{r.mod?.source === "local" && !p?.desc ? t("installed.localMod") : (p?.desc ?? "")}</span
										>
									{/if}
								</div>
							</div>
						{:else if key === "author"}
							<span class="cell-soft block">{r.author}</span>
						{:else if key === "version"}
							<!-- The hint triangle sits by the version: stale and deprecated are facts about this version. -->
							<span class="cell-mono inline-flex items-center gap-1"
								>{r.version}{#if store.isLocked(r.id)}<Lock class="text-muted-foreground size-3" aria-label={lockedTitle} />{:else if r.mod?.pinned}<Pin
										class="text-primary size-3"
										aria-label={t("installed.pinnedTitle")}
									/>{/if}{#if store.healthByMod.has(r.id)}<span class="text-primary-text inline-flex shrink-0" title={healthText(r.id)}
										><TriangleAlert class="size-3.5" /></span
									>{/if}</span
							>
						{:else if key === "dl"}
							<span class="cell-mono" title={p ? formatNumber(p.dl) : undefined}>{p ? formatCompact(p.dl) : "—"}</span>
						{:else if key === "upd"}
							<span class="cell-muted" title={p ? formatDateTime(p.upd) : undefined}>{p ? relativeTime(p.upd) : "—"}</span>
						{:else if key === "size"}
							<span class="cell-mono">{p ? formatBytes(p.size) : "—"}</span>
						{:else if key === "cats"}
							<TagList tags={p?.cats ?? []} lines={compact ? 1 : 2} />
						{:else if key === "status"}
							<InstallState
								state={r.state}
								version={r.update}
								onupdate={(e) => {
									stop(e);
									store.requestUpdate([r.id]);
								}}
							/>
						{:else if key === "source"}
							<SourceBadge source={r.source} title={sourceTitle(r)} />
						{/if}
					{/snippet}
					{#snippet menu(ids)}
						{@const all = ids.filter((id) => store.modsMap.has(id))}
						{@const mods = all.filter((id) => !store.isLocked(id))}
						<ContextMenu.Label>{ids.length > 1 ? t("installed.entriesSelected", { n: ids.length }) : nameOf(ids[0])}</ContextMenu.Label>
						{#if all.length && !mods.length}
							<!-- Only server-managed mods selected: the menu says why its actions are off. -->
							<ContextMenu.Label class="text-muted-foreground flex items-center gap-1.5 font-normal"
								><Lock class="size-3" />{t("installed.locked")} · {t("installed.lockedHint")}</ContextMenu.Label
							>
						{/if}
						<ContextMenu.Item disabled={!mods.length} onSelect={() => store.setEnabledMany(mods, true)}>{t("common.enable")}</ContextMenu.Item>
						<ContextMenu.Item disabled={!mods.length} onSelect={() => store.setEnabledMany(mods, false)}>{t("common.disable")}</ContextMenu.Item>
						<ContextMenu.Item disabled={!mods.some((id) => id in store.state.updates)} onSelect={() => store.requestUpdate(mods)}
							>{t("common.update")}</ContextMenu.Item
						>
						<ContextMenu.Item disabled={mods.length !== 1} onSelect={() => store.togglePin(mods[0])}
							>{store.modsMap.get(mods[0])?.pinned ? t("installed.unpin") : t("installed.pin")}</ContextMenu.Item
						>
						<ContextMenu.Separator />
						<ContextMenu.Item disabled={ids.length > 1 || !store.indexById.has(ids[0])} onSelect={() => thunderstore(ids[0])}
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

				<SelectionBar
					count={selectedMods.length}
					onclear={() => (selection = { ...selection, ids: new Set(), anchor: null })}
					hint={selectedFree.length < selectedMods.length ? `${t("installed.locked")}: ${selectedMods.length - selectedFree.length}` : t("installed.hint")}
				>
					<Button size="sm" variant="ghost" disabled={!selectedFree.length} onclick={() => store.setEnabledMany(selectedFree, true)}
						>{t("common.enable")}</Button
					>
					<Button size="sm" variant="ghost" disabled={!selectedFree.length} onclick={() => store.setEnabledMany(selectedFree, false)}
						>{t("common.disable")}</Button
					>
					<Button size="sm" variant="ghost" disabled={!selectedFree.some((id) => id in store.state.updates)} onclick={() => store.requestUpdate(selectedFree)}
						>{t("common.update")}</Button
					>
					<Button size="sm" variant="destructive" disabled={!selectedFree.length} onclick={() => store.removeMods(selectedFree)}>{t("common.remove")}</Button>
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
