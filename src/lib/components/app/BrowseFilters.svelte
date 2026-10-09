<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { Button, DateRangeFilter, DropdownMenu, FilterList, FilterSection, NumRangeFilter, Segmented, type FilterItem } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import {
		activeCount,
		defaultCriteria,
		DEPS_ITEMS,
		entries,
		fieldLabel,
		FLAG_ITEMS,
		itemLabel,
		STATUS_ITEMS,
		type DateKey,
		type ListKey,
		type NumKey,
		type NumRange,
	} from "#lib/browse/criteria.js";
	import { countBy, listValues } from "#lib/browse/filter.js";
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

	function listItems(key: ListKey, fixed?: readonly string[]): FilterItem[] {
		const counts = countBy(store.context({ list: key }), (p) => listValues(key, p, store.facts));
		const values = fixed ? [...fixed] : [...new Set([...counts.keys(), ...Object.keys(c.lists[key])])];
		const items = values.map((v) => ({ value: v, label: itemLabel(key, v), count: counts.get(v) ?? 0 }));
		return fixed ? items : items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	}

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

	const open = (key: string) => !!f.sections[key];
	const showProfiles = $derived(store.otherProfiles.length > 0 || Object.keys(c.lists.profiles).length > 0);
	const viewLabel = $derived(current ? current.name : count ? t("filter.active", { n: count }) : t("filter.view"));
</script>

<div class="flex h-full flex-col">
	<!-- Header: one row, the view as a menu instead of a chip cloud, Clear on the right. -->
	<div class="border-line-subtle flex h-[58px] items-center gap-1 border-b px-2.5">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="hover:bg-hover data-[state=open]:bg-muted flex h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded-[5px] px-2 text-left"
						title={t("filter.views")}
					>
						<span class="label-caps text-foreground-soft shrink-0">{t("filter.title")}</span>
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

	<div class="min-h-0 flex-1 overflow-y-auto">
		<FilterSection
			id="filter-status"
			title={fieldLabel("status")}
			summary={listSummary("status")}
			open={open("status")}
			ontoggle={() => f.toggleSection("status")}
		>
			<FilterList
				items={listItems("status", STATUS_ITEMS)}
				map={c.lists.status}
				oncycle={(v) => f.cycle("status", v)}
				onexclude={(v) => f.toggleExclude("status", v)}
				limit={5}
			/>
		</FilterSection>

		<FilterSection id="filter-cats" title={fieldLabel("cats")} summary={listSummary("cats")} open={open("cats")} ontoggle={() => f.toggleSection("cats")}>
			{#snippet aside()}
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
			<FilterList items={listItems("cats")} map={c.lists.cats} oncycle={(v) => f.cycle("cats", v)} onexclude={(v) => f.toggleExclude("cats", v)} limit={9} />
		</FilterSection>

		<FilterSection
			id="filter-owners"
			title={fieldLabel("owners")}
			summary={listSummary("owners")}
			open={open("owners")}
			ontoggle={() => f.toggleSection("owners")}
		>
			<FilterList
				items={listItems("owners")}
				map={c.lists.owners}
				oncycle={(v) => f.cycle("owners", v)}
				onexclude={(v) => f.toggleExclude("owners", v)}
				searchable
				placeholder={t("filter.searchAuthor")}
				limit={8}
			/>
		</FilterSection>

		{#if showProfiles}
			<FilterSection
				id="filter-profiles"
				title={fieldLabel("profiles")}
				summary={listSummary("profiles")}
				open={open("profiles")}
				ontoggle={() => f.toggleSection("profiles")}
			>
				<FilterList
					items={listItems("profiles", store.otherProfiles)}
					map={c.lists.profiles}
					oncycle={(v) => f.cycle("profiles", v)}
					onexclude={(v) => f.toggleExclude("profiles", v)}
					limit={8}
				/>
			</FilterSection>
		{/if}

		<FilterSection id="filter-deps" title={fieldLabel("deps")} summary={listSummary("deps")} open={open("deps")} ontoggle={() => f.toggleSection("deps")}>
			<FilterList
				items={listItems("deps", DEPS_ITEMS)}
				map={c.lists.deps}
				oncycle={(v) => f.cycle("deps", v)}
				onexclude={(v) => f.toggleExclude("deps", v)}
				limit={3}
			/>
		</FilterSection>

		<FilterSection id="filter-flags" title={fieldLabel("flags")} summary={listSummary("flags")} open={open("flags")} ontoggle={() => f.toggleSection("flags")}>
			<FilterList
				items={listItems("flags", FLAG_ITEMS)}
				map={c.lists.flags}
				oncycle={(v) => f.cycle("flags", v)}
				onexclude={(v) => f.toggleExclude("flags", v)}
				limit={3}
			/>
		</FilterSection>

		<FilterSection id="filter-upd" title={fieldLabel("upd")} summary={dateSummary("upd")} open={open("upd")} ontoggle={() => f.toggleSection("upd")}>
			<DateRangeFilter value={c.dates.upd} onchange={(r) => f.setDate("upd", r)} buckets={months} counts={dateCounts("upd")} {now} />
		</FilterSection>

		<FilterSection
			id="filter-created"
			title={fieldLabel("created")}
			summary={dateSummary("created")}
			open={open("created")}
			ontoggle={() => f.toggleSection("created")}
		>
			<DateRangeFilter value={c.dates.created} onchange={(r) => f.setDate("created", r)} buckets={months} counts={dateCounts("created")} {now} />
		</FilterSection>

		<FilterSection id="filter-dl" title={fieldLabel("dl")} summary={numSummary("dl")} open={open("dl")} ontoggle={() => f.toggleSection("dl")}>
			<NumRangeFilter value={c.nums.dl} onchange={(r) => f.setNum("dl", r)} buckets={numBuckets.dl} counts={numCounts("dl")} presets={PRESETS.dl} />
		</FilterSection>

		<FilterSection
			id="filter-rating"
			title={fieldLabel("rating")}
			summary={numSummary("rating")}
			open={open("rating")}
			ontoggle={() => f.toggleSection("rating")}
		>
			<NumRangeFilter
				value={c.nums.rating}
				onchange={(r) => f.setNum("rating", r)}
				buckets={numBuckets.rating}
				counts={numCounts("rating")}
				presets={PRESETS.rating}
			/>
		</FilterSection>

		<FilterSection id="filter-size" title={fieldLabel("size")} summary={numSummary("size")} open={open("size")} ontoggle={() => f.toggleSection("size")}>
			<NumRangeFilter
				value={c.nums.size}
				onchange={(r) => f.setNum("size", r)}
				buckets={numBuckets.size}
				counts={numCounts("size")}
				unit="MB"
				scale={1_048_576}
				presets={PRESETS.size}
			/>
		</FilterSection>

		<FilterSection id="filter-ndeps" title={fieldLabel("ndeps")} summary={numSummary("ndeps")} open={open("ndeps")} ontoggle={() => f.toggleSection("ndeps")}>
			<NumRangeFilter value={c.nums.ndeps} onchange={(r) => f.setNum("ndeps", r)} buckets={numBuckets.ndeps} counts={numCounts("ndeps")} />
		</FilterSection>
	</div>
</div>

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
