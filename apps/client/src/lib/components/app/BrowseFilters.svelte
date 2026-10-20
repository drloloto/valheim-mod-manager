<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Search from "@lucide/svelte/icons/search";
	import X from "@lucide/svelte/icons/x";
	import {
		Button,
		DateRangeFilter,
		DropdownMenu,
		FilterList,
		FilterSection,
		Input,
		NumRangeFilter,
		Segmented,
		type FilterItem,
	} from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import {
		activeCount,
		DATE_KEYS,
		defaultCriteria,
		DEPS_ITEMS,
		entries,
		fieldLabel,
		FLAG_ITEMS,
		itemLabel,
		NUM_KEYS,
		STATUS_ITEMS,
		STORE_ITEMS,
		type DateKey,
		type ListKey,
		type NumKey,
		type NumRange,
	} from "#lib/browse/criteria.js";
	import { facetCounts } from "#lib/browse/filter.js";
	import { countBuckets, dateActive, describeDate, describeNum, linearBuckets, logBuckets, monthBuckets, numActive, type Bucket } from "#lib/browse/ranges.js";
	import { activeView, builtinViews } from "#lib/browse/views.js";
	import { formatBytes } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import NameDialog from "./NameDialog.svelte";

	const f = store.browse;
	const c = $derived(f.criteria);
	const now = $derived(f.now);
	const count = $derived(activeCount(c));
	const builtin = $derived(builtinViews(defaultCriteria({ showNsfw: f.showNsfw })));
	const current = $derived(activeView([...builtin, ...f.views], c));
	let saveOpen = $state(false);
	/** Search over the filter pane: section titles and list entries (status, categories, authors, …). */
	let search = $state("");
	const q = $derived(search.trim().toLowerCase());

	function listItems(key: ListKey, fixed?: readonly string[]): FilterItem[] {
		const map = c.lists[key];
		const mode = key === "cats" ? c.catMode : "any";
		const counts = facetCounts(key, map, mode, store.context({ list: key }), store.filtered, store.facts);
		// a value nobody else has still says what picking it would add: nothing
		const additive = mode === "any" && Object.values(map).some((x) => x === 1);
		const values = fixed ? [...fixed] : [...new Set([...counts.keys(), ...Object.keys(map)])];
		const items = values.map((v) => {
			const n = counts.get(v);
			return { value: v, label: itemLabel(key, v), count: n?.count ?? 0, additive: n?.additive ?? (additive && !(v in map)) };
		});
		return fixed ? items : items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	}

	const showProfiles = $derived(store.otherProfiles.length > 0 || Object.keys(c.lists.profiles).length > 0);
	const lists = $derived.by(() => {
		const out: { key: ListKey; items: FilterItem[]; limit: number; searchable?: boolean }[] = [
			{ key: "status", items: listItems("status", STATUS_ITEMS), limit: 5 },
			{ key: "cats", items: listItems("cats"), limit: 9 },
			{ key: "owners", items: listItems("owners"), limit: 8, searchable: true },
		];
		if (showProfiles) out.push({ key: "profiles", items: listItems("profiles", store.otherProfiles), limit: 8 });
		out.push(
			{ key: "deps", items: listItems("deps", DEPS_ITEMS), limit: 3 },
			{ key: "flags", items: listItems("flags", FLAG_ITEMS), limit: 3 },
			{ key: "stores", items: listItems("stores", STORE_ITEMS), limit: 2 },
		);
		return out;
	});

	const titleHit = (key: ListKey | DateKey | NumKey) => !!q && fieldLabel(key).toLowerCase().includes(q);
	/** While searching: a list shows when its title or one of its entries matches; a range only by its title. */
	const shownLists = $derived(q ? lists.filter((l) => titleHit(l.key) || l.items.some((i) => i.label.toLowerCase().includes(q))) : lists);
	const shownDates = $derived(q ? DATE_KEYS.filter(titleHit) : DATE_KEYS);
	const shownNums = $derived(q ? NUM_KEYS.filter(titleHit) : NUM_KEYS);

	function listSummary(key: ListKey): string {
		const inc = entries(c.lists[key], 1).map((v) => itemLabel(key, v));
		const exc = entries(c.lists[key], -1).map((v) => itemLabel(key, v));
		return [inc.join(", "), exc.length ? `≠ ${exc.join(", ")}` : ""].filter(Boolean).join(" · ");
	}
	function dateSummary(key: DateKey): string {
		const r = c.dates[key];
		if (!dateActive(r)) return "";
		const d = describeDate(r);
		return `${d.op} ${d.value}`;
	}
	function numSummary(key: NumKey): string {
		const r = c.nums[key];
		if (!numActive(r)) return "";
		const d = describeNum(key, r);
		return `${d.op} ${d.value}`;
	}

	// Histogram buckets: months for dates, half-decades for numbers, linear for the dependency count.
	const months = $derived(monthBuckets(now));
	function maxOf(key: NumKey): number {
		let m = 0;
		for (const p of store.packages) if (p[key] > m) m = p[key];
		return m;
	}
	const numBuckets = $derived<Record<NumKey, Bucket[]>>({
		dl: logBuckets(maxOf("dl")),
		rating: logBuckets(maxOf("rating"), String),
		size: logBuckets(maxOf("size"), formatBytes),
		ndeps: linearBuckets(8),
		ndependants: logBuckets(maxOf("ndependants")),
	});
	const dateCounts = (key: DateKey) =>
		countBuckets(
			store.context({ date: key }).map((p) => p[key]),
			months,
		);
	const numCounts = (key: NumKey) =>
		countBuckets(
			store.context({ num: key }).map((p) => p[key]),
			numBuckets[key],
		);

	const gte = (from: number): NumRange => ({ op: "gte", from, to: null });
	const lte = (to: number): NumRange => ({ op: "lte", from: null, to });
	const PRESETS: Partial<Record<NumKey, { label: string; range: NumRange }[]>> = {
		dl: [
			{ label: "≥ 1k", range: gte(1_000) },
			{ label: "≥ 10k", range: gte(10_000) },
			{ label: "≥ 100k", range: gte(100_000) },
		],
		rating: [
			{ label: "≥ 10", range: gte(10) },
			{ label: "≥ 100", range: gte(100) },
		],
		size: [
			{ label: "≤ 1 MB", range: lte(1_048_576) },
			{ label: "≤ 10 MB", range: lte(10_485_760) },
		],
	};
	const UNITS: Partial<Record<NumKey, { unit: string; scale: number }>> = { size: { unit: "MB", scale: 1_048_576 } };

	// a search opens every section it shows, without touching the stored open/closed state
	const open = (key: string) => !!q || !!f.sections[key];
	const viewLabel = $derived(current ? current.name : count ? t("filter.active", { n: count }) : t("filter.view"));
	const nothing = $derived(!!q && !shownLists.length && !shownDates.length && !shownNums.length);
</script>

<div class="@container flex h-full flex-col">
	<!-- Header: one row, the view as a menu instead of a chip cloud, Clear on the right. The caps label gives way first. -->
	<div class="border-line-subtle flex h-[58px] items-center gap-1 border-b px-2.5">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="hover:bg-hover data-[state=open]:bg-muted flex h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded-[5px] px-2 text-left"
						title={t("filter.views")}
					>
						<span class="label-caps text-foreground-soft hidden shrink-0 @min-[240px]:inline">{t("filter.title")}</span>
						<span class="text-primary text-meta min-w-0 flex-1 truncate font-mono">{viewLabel}</span>
						<ChevronDown class="text-muted-foreground size-3.5 shrink-0" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-64">
				<DropdownMenu.Label>{t("filter.views")}</DropdownMenu.Label>
				<DropdownMenu.RadioGroup value={current?.id ?? ""} onValueChange={(id) => id && f.applyView([...builtin, ...f.views].find((v) => v.id === id)!)}>
					{#each builtin as v (v.id)}<DropdownMenu.RadioItem value={v.id}>{v.name}</DropdownMenu.RadioItem>{/each}
					{#if f.views.length}
						<DropdownMenu.Separator />
						<DropdownMenu.Label>{t("filter.ownViews")}</DropdownMenu.Label>
						{#each f.views as v (v.id)}<DropdownMenu.RadioItem value={v.id}>{v.name}</DropdownMenu.RadioItem>{/each}
					{/if}
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => (saveOpen = true)}>{t("filter.saveView")}</DropdownMenu.Item>
				{#each f.views as v (v.id)}
					<DropdownMenu.Item variant="destructive" onSelect={() => f.deleteView(v.id)}>{t("filter.deleteView", { name: v.name })}</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button variant="ghost" size="sm" disabled={!count && !c.query} onclick={() => f.reset()}>{t("common.clear")}</Button>
	</div>

	<div class="border-line-subtle relative border-b px-2.5 py-2">
		<Search class="text-subtle-foreground pointer-events-none absolute top-1/2 left-[19px] size-3.5 -translate-y-1/2" />
		<Input
			class="h-[28px] pr-7 pl-7 text-[12.5px]"
			placeholder={t("filter.search")}
			bind:value={search}
			onkeydown={(e) => e.key === "Escape" && (search = "")}
		/>
		{#if search}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground absolute top-1/2 right-[16px] -translate-y-1/2"
				title={t("common.clear")}
				onclick={() => (search = "")}><X class="size-3.5" /></button
			>
		{/if}
	</div>

	<div class="scroll-y min-h-0 flex-1">
		{#each shownLists as l (l.key)}
			<FilterSection
				id="filter-{l.key}"
				title={fieldLabel(l.key)}
				summary={listSummary(l.key)}
				open={open(l.key)}
				ontoggle={() => f.toggleSection(l.key)}
				aside={l.key === "cats" ? catMode : undefined}
			>
				<FilterList
					items={l.items}
					map={c.lists[l.key]}
					oncycle={(v) => f.cycle(l.key, v)}
					onexclude={(v) => f.toggleExclude(l.key, v)}
					searchable={l.searchable && !q}
					placeholder={t("filter.searchAuthor")}
					limit={l.limit}
					filter={titleHit(l.key) ? "" : q}
				/>
			</FilterSection>
		{/each}

		{#each shownDates as key (key)}
			<FilterSection id="filter-{key}" title={fieldLabel(key)} summary={dateSummary(key)} open={open(key)} ontoggle={() => f.toggleSection(key)}>
				<DateRangeFilter value={c.dates[key]} onchange={(r) => f.setDate(key, r)} buckets={months} counts={dateCounts(key)} {now} />
			</FilterSection>
		{/each}

		{#each shownNums as key (key)}
			<FilterSection id="filter-{key}" title={fieldLabel(key)} summary={numSummary(key)} open={open(key)} ontoggle={() => f.toggleSection(key)}>
				<NumRangeFilter
					value={c.nums[key]}
					onchange={(r) => f.setNum(key, r)}
					buckets={numBuckets[key]}
					counts={numCounts(key)}
					presets={PRESETS[key]}
					unit={UNITS[key]?.unit}
					scale={UNITS[key]?.scale}
				/>
			</FilterSection>
		{/each}

		{#if nothing}
			<p class="text-muted-foreground px-3.5 py-3 text-xs">{t("filter.searchNone", { q: search.trim() })}</p>
		{/if}
	</div>
</div>

{#snippet catMode()}
	<Segmented
		size="sm"
		class="p-px"
		options={[
			{ value: "any", label: t("filter.anyOf") },
			{ value: "all", label: t("filter.allOf") },
		]}
		bind:value={() => c.catMode, (v) => f.setCatMode(v as "any" | "all")}
	/>
{/snippet}

<NameDialog
	bind:open={saveOpen}
	title={t("filter.saveViewTitle")}
	description={t("filter.saveViewDesc")}
	submitLabel={t("common.save")}
	onSubmit={async (name) => {
		f.saveView(name);
		return true;
	}}
/>
