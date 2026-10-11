<script lang="ts">
	import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
	import Columns3 from "@lucide/svelte/icons/columns-3";
	import Plus from "@lucide/svelte/icons/plus";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import {
		Button,
		ContextMenu,
		DataTable,
		DropdownMenu,
		EmptyState,
		FilterToken,
		Input,
		isHidden,
		Kbd,
		ModAvatar,
		resetColumns,
		Resizable,
		SelectionBar,
		StatusPill,
		toggleColumn,
		Toolbar,
		type Column,
	} from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { SlimPkg } from "#lib/api/types.js";
	import { DATE_KEYS, fieldLabel, LIST_KEYS, NUM_KEYS } from "#lib/browse/criteria.js";
	import { SORT_KEYS } from "#lib/browse/filter.js";
	import { buildTokens, flipToken, removeToken } from "#lib/browse/tokens.js";
	import { formatBytes, formatCompact, formatDate, formatDateTime, formatMonth, formatNumber, relativeTime } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import BrowseFilters from "./BrowseFilters.svelte";
	import PackageDetail from "./PackageDetail.svelte";

	const f = store.browse;
	const c = $derived(f.criteria);
	const prefs = store.tables.browse;
	const filtered = $derived(store.filtered);
	const tokens = $derived(buildTokens(c));
	const focus = $derived(f.selection.focus);
	const selected = $derived([...f.selection.ids]);
	const compact = $derived(prefs.value.density === "compact");

	const columns: Column[] = $derived([
		{ key: "mod", label: t("col.mod"), width: "minmax(0,1fr)", sortable: true, defaultDir: "asc", fixed: true },
		{ key: "author", label: t("col.author"), width: "116px", sortable: true, defaultDir: "asc" },
		{ key: "version", label: t("col.version"), width: "88px" },
		{ key: "dl", label: t("col.dl"), width: "84px", align: "right", sortable: true },
		{ key: "rating", label: t("col.rating"), width: "80px", align: "right", sortable: true, hidden: true },
		{ key: "upd", label: t("col.upd"), width: "104px", align: "right", sortable: true },
		{ key: "created", label: t("col.created"), width: "88px", align: "right", sortable: true, hidden: true },
		{ key: "size", label: t("col.size"), width: "76px", align: "right", sortable: true, hidden: true },
		{ key: "ndeps", label: t("col.ndeps"), width: "56px", align: "right", sortable: true, hidden: true },
		{ key: "ndependants", label: t("col.ndependants"), width: "76px", align: "right", sortable: true, hidden: true },
		{ key: "nver", label: t("col.nver"), width: "80px", align: "right", sortable: true, hidden: true },
		{ key: "cats", label: t("col.cats"), width: "180px", hidden: true },
		{ key: "status", label: t("col.profile"), width: "132px", align: "right" },
	]);
	const sortLabel = $derived(f.sort ? `${t(`sort.${f.sort.key}` as Parameters<typeof t>[0])} ${f.sort.dir === "desc" ? "↓" : "↑"}` : t("browse.relevance"));

	function setSortKey(key: string) {
		if (!key) f.sort = null;
		else f.sort = { key, dir: f.sort?.key === key ? f.sort.dir : key === "mod" || key === "author" ? "asc" : "desc" };
	}

	function stop(e: MouseEvent, fn: () => unknown) {
		e.stopPropagation();
		fn();
	}

	/** Select all visible mods of an author. */
	function selectAuthor(ns: string) {
		const ids = filtered.filter((p) => p.ns === ns).map((p) => p.id);
		f.selection = { ids: new Set(ids), anchor: ids[0] ?? null, focus: f.selection.focus ?? ids[0] ?? null };
	}

	/** Dependencies of the selection that are visible in the list and not selected yet. */
	const missingDeps = $derived.by(() => {
		const visible = new Set(filtered.map((p) => p.id));
		const out = new Set<string>();
		for (const id of f.selection.ids) for (const d of store.byId.get(id)?.deps ?? []) if (visible.has(d) && !f.selection.ids.has(d)) out.add(d);
		return [...out];
	});
	function selectDeps() {
		if (!missingDeps.length) return;
		f.selection = { ...f.selection, ids: new Set([...f.selection.ids, ...missingDeps]) };
	}

	function jumpTo(key: string) {
		f.openSection(key);
		requestAnimationFrame(() => document.getElementById(`filter-${key}`)?.scrollIntoView({ block: "nearest" }));
	}
</script>

<Resizable.PaneGroup direction="horizontal" autoSaveId="browse" class="h-full">
	<Resizable.Pane defaultSize={19} minSize={15} maxSize={30} order={1} id="browse-filter">
		<BrowseFilters />
	</Resizable.Pane>
	<Resizable.Handle />

	<Resizable.Pane minSize={35} order={2} id="browse-table">
		<div class="relative flex h-full flex-col">
			<!-- Search and tools without their own line: search field, tokens and header form one block. -->
			<Toolbar class="border-b-0 pb-0">
				<div class="relative flex-1">
					<Input data-search class="pr-16" placeholder={t("browse.search")} bind:value={f.query} />
					<span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"><Kbd>{t("key.ctrl")} K</Kbd></span>
				</div>

				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" class="gap-1.5 whitespace-nowrap"><ArrowDownUp class="size-3.5" />{sortLabel}</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-52">
						<DropdownMenu.Label>{t("browse.sortBy")}</DropdownMenu.Label>
						<DropdownMenu.RadioGroup value={f.sort?.key ?? ""} onValueChange={setSortKey}>
							<DropdownMenu.RadioItem value="">{t("browse.relevance")}</DropdownMenu.RadioItem>
							{#each SORT_KEYS as k (k)}<DropdownMenu.RadioItem value={k}>{t(`sort.${k}`)}</DropdownMenu.RadioItem>{/each}
						</DropdownMenu.RadioGroup>
						<DropdownMenu.Separator />
						<DropdownMenu.Item disabled={!f.sort} onSelect={() => f.sort && (f.sort = { ...f.sort, dir: f.sort.dir === "desc" ? "asc" : "desc" })}>
							{f.sort?.dir === "asc" ? t("browse.descending") : t("browse.ascending")}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

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

				<Button variant="ghost" size="icon" title={t("browse.refreshIndex")} disabled={store.indexRefreshing} onclick={() => store.refreshIndex()}>
					<RefreshCw class="size-4 {store.indexRefreshing ? 'animate-spin' : ''}" />
				</Button>
			</Toolbar>

			<!-- Token row: always present so the first filter does not shift the table -->
			<div class="flex min-h-[40px] flex-wrap items-center gap-1.5 border-b px-4 py-[6px]">
				{#each tokens as tok (tok.kind + tok.key + ("sign" in tok ? tok.sign : ""))}
					<FilterToken
						field={tok.field}
						op={tok.op}
						value={tok.value}
						negative={tok.negative}
						onflip={() => f.update((x) => flipToken(x, tok))}
						onremove={() => f.update((x) => removeToken(x, tok))}
					/>
				{/each}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button {...props} type="button" class="text-primary hover:text-foreground flex h-[26px] items-center gap-1 px-1.5 text-xs"
								><Plus class="size-3" />{t("browse.addFilter")}</button
							>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-52">
						{#each [...LIST_KEYS, ...DATE_KEYS, ...NUM_KEYS] as k (k)}
							<DropdownMenu.Item onSelect={() => jumpTo(k)}>{fieldLabel(k)}</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<span class="text-muted-foreground text-meta ml-auto font-mono whitespace-nowrap tabular-nums">
					{t("browse.count", { n: formatNumber(filtered.length), total: formatNumber(store.packages.length) })}
					{#if store.indexFetchedAt}· {t("status.index", { time: relativeTime(store.indexFetchedAt) })}{/if}
				</span>
			</div>

			<DataTable
				class="flex-1"
				rows={filtered}
				getId={(p: SlimPkg) => p.id}
				{columns}
				rowHeight={54}
				compactRowHeight={38}
				padBottom={selected.length ? 64 : 0}
				bind:prefs={() => prefs.value, (v) => prefs.set(v)}
				bind:selection={f.selection}
				bind:sort={f.sort}
				onactivate={(p) => store.addMods([p.id])}
			>
				{#snippet cell(p, key)}
					{#if key === "mod"}
						<div class="flex min-w-0 items-center gap-[11px]">
							{#if !compact}<ModAvatar name={p.name} icon={p.icon} size="md" />{/if}
							<div class="flex min-w-0 flex-col gap-0.5">
								<span class="text-row truncate font-semibold"
									>{p.name}{#if p.dep}<span class="text-destructive-text text-meta ml-2">{t("browse.deprecated")}</span>{/if}{#if p.pinned}<span
											class="text-primary text-meta ml-2">{t("browse.pinned")}</span
										>{/if}</span
								>
								{#if !compact}<span class="text-muted-foreground truncate text-xs">{p.desc}</span>{/if}
							</div>
						</div>
					{:else if key === "author"}
						<span class="cell-soft block">{p.ns}</span>
					{:else if key === "version"}
						<span class="cell-mono">{p.ver}</span>
					{:else if key === "dl"}
						<span class="cell-mono" title={formatNumber(p.dl)}>{formatCompact(p.dl)}</span>
					{:else if key === "rating"}
						<span class="cell-mono">{formatNumber(p.rating)}</span>
					{:else if key === "upd"}
						<span class="cell-muted" title={formatDateTime(p.upd)}>{relativeTime(p.upd, f.now)}</span>
					{:else if key === "created"}
						<span class="cell-muted" title={formatDate(p.created)}>{formatMonth(p.created)}</span>
					{:else if key === "size"}
						<span class="cell-mono">{formatBytes(p.size)}</span>
					{:else if key === "ndeps"}
						<span class="cell-mono">{p.ndeps}</span>
					{:else if key === "ndependants"}
						<span class="cell-mono">{p.ndependants ? formatCompact(p.ndependants) : "—"}</span>
					{:else if key === "nver"}
						<span class="cell-mono">{p.nver}</span>
					{:else if key === "cats"}
						<span class="cell-soft block text-xs" title={p.cats.join(", ")}>{p.cats.join(", ")}</span>
					{:else if key === "status"}
						{@const s = store.modStatus(p.id)}
						{#if s === "none"}
							<Button size="sm" variant="outline" class="h-7" onclick={(e) => stop(e, () => store.toggleMod(p.id))}>{t("browse.add")}</Button>
						{:else}
							<StatusPill status={s} version={store.state.updates[p.id]} onclick={(e) => stop(e, () => store.toggleMod(p.id))} />
						{/if}
					{/if}
				{/snippet}
				{#snippet menu(ids)}
					{@const first = store.byId.get(ids[0])}
					<ContextMenu.Label>{ids.length > 1 ? t("browse.selectedN", { n: ids.length }) : first?.name}</ContextMenu.Label>
					<ContextMenu.Item onSelect={() => store.addMods(ids)}>
						{ids.length > 1 ? t("browse.addN", { n: ids.length }) : t("browse.addToProfile")}<ContextMenu.Shortcut>Enter</ContextMenu.Shortcut>
					</ContextMenu.Item>
					<ContextMenu.Item disabled={!ids.some((id) => id in store.state.updates)} onSelect={() => store.updateMods(ids)}
						>{t("common.update")}</ContextMenu.Item
					>
					<ContextMenu.Item disabled={!ids.some((id) => store.modsMap.has(id))} onSelect={() => store.removeMods(ids)}
						>{t("browse.removeFromProfile")}</ContextMenu.Item
					>
					<ContextMenu.Item disabled={!missingDeps.length} onSelect={selectDeps}
						>{t("browse.selectDeps")}{#if missingDeps.length}<ContextMenu.Shortcut>{missingDeps.length}</ContextMenu.Shortcut>{/if}</ContextMenu.Item
					>
					{#if first}
						<ContextMenu.Separator />
						<ContextMenu.Item onSelect={() => selectAuthor(first.ns)}>{t("browse.selectAuthor", { name: first.ns })}</ContextMenu.Item>
						<ContextMenu.Item onSelect={() => f.only("owners", first.ns)}>{t("browse.onlyAuthor", { name: first.ns })}</ContextMenu.Item>
						<ContextMenu.Item onSelect={() => f.toggleExclude("owners", first.ns)}
							>{c.lists.owners[first.ns] === -1
								? t("browse.showAuthorAgain", { name: first.ns })
								: t("browse.excludeAuthor", { name: first.ns })}</ContextMenu.Item
						>
						{#if first.cats.length}
							<ContextMenu.Sub>
								<ContextMenu.SubTrigger>{t("browse.includeCategory")}</ContextMenu.SubTrigger>
								<ContextMenu.SubContent class="w-52">
									{#each first.cats as cat (cat)}<ContextMenu.Item onSelect={() => f.setTri("cats", cat, 1)}>{cat}</ContextMenu.Item>{/each}
								</ContextMenu.SubContent>
							</ContextMenu.Sub>
							<ContextMenu.Sub>
								<ContextMenu.SubTrigger>{t("browse.excludeCategory")}</ContextMenu.SubTrigger>
								<ContextMenu.SubContent class="w-52">
									{#each first.cats as cat (cat)}<ContextMenu.Item onSelect={() => f.setTri("cats", cat, -1)}>{cat}</ContextMenu.Item>{/each}
								</ContextMenu.SubContent>
							</ContextMenu.Sub>
						{/if}
						<ContextMenu.Separator />
						<ContextMenu.Item disabled={ids.length > 1} onSelect={() => store.getPackage(first.id).then((p) => store.openExternal(p.url))}
							>{t("browse.openThunderstore")}<ContextMenu.Shortcut>↗</ContextMenu.Shortcut></ContextMenu.Item
						>
						<ContextMenu.Item disabled={ids.length > 1} onSelect={() => store.copyText(first.id, t("browse.idCopied"))}>{t("browse.copyId")}</ContextMenu.Item>
					{/if}
				{/snippet}
				{#snippet empty()}
					{#if store.indexLoading && !store.packages.length}
						<EmptyState title={t("browse.indexLoading")} />
					{:else if store.indexError}
						<EmptyState title={t("browse.indexUnavailable")}>{store.indexError}</EmptyState>
					{:else}
						<EmptyState title={t("browse.noResults")}>
							{t("browse.noResultsHint")}
							{#snippet action()}<Button variant="outline" size="sm" onclick={() => f.reset()}>{t("browse.resetFilters")}</Button>{/snippet}
						</EmptyState>
					{/if}
				{/snippet}
			</DataTable>

			<SelectionBar count={selected.length} onclear={() => (f.selection = { ...f.selection, ids: new Set(), anchor: null })} hint={t("browse.hint")}>
				<Button size="sm" onclick={() => store.addMods(selected)}>{t("browse.addToProfile")}</Button>
				<Button size="sm" variant="ghost" disabled={!selected.some((id) => id in store.state.updates)} onclick={() => store.updateMods(selected)}
					>{t("common.update")}</Button
				>
				<Button size="sm" variant="ghost" disabled={!selected.some((id) => store.modsMap.has(id))} onclick={() => store.removeMods(selected)}
					>{t("common.remove")}</Button
				>
				<Button size="sm" variant="ghost" disabled={!missingDeps.length} onclick={selectDeps}
					>{t("browse.selectDeps")}{missingDeps.length ? ` (${missingDeps.length})` : ""}</Button
				>
			</SelectionBar>
		</div>
	</Resizable.Pane>

	<Resizable.Handle />
	<Resizable.Pane defaultSize={25} minSize={18} maxSize={40} order={3} id="browse-detail">
		<PackageDetail id={focus} />
	</Resizable.Pane>
</Resizable.PaneGroup>
