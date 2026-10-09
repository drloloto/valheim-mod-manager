<script lang="ts">
	import { dev } from "$app/env";
	import { cycleTri, setTri, type DateRange, type NumRange, type TriMap } from "#lib/browse/criteria.js";
	import { logBuckets, monthBuckets } from "#lib/browse/ranges.js";
	import {
		Button,
		Chip,
		Choice,
		ContextMenu,
		DataTable,
		DateRangeFilter,
		DropdownMenu,
		FilterList,
		FilterSection,
		FilterToken,
		Histogram,
		Input,
		NumRangeFilter,
		Toolbar,
		emptySelection,
		EmptyState,
		Kbd,
		ModAvatar,
		PanelSection,
		PathField,
		SectionLabel,
		Segmented,
		SelectionBar,
		SettingRow,
		SplitButton,
		Stat,
		StatusPill,
		Stepper,
		Switch,
		TriCheckbox,
		type Selection,
		type SortState,
	} from "#lib/components/kit/index.js";

	let seg = $state("all");
	let n = $state(4);
	let path = $state<string | null>("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Valheim");
	let choice = $state("true");
	let on = $state(false);
	let demoOpen = $state(true);
	let demoMap = $state<TriMap>({ Items: 1, Modpacks: -1 });
	let demoNum = $state<NumRange | null>({ op: "gte", from: 10_000, to: null });
	let demoDate = $state<DateRange | null>(null);
	const demoBuckets = logBuckets(1_000_000);
	const demoMonths = monthBuckets(Date.now(), 12);

	const demoRows = Array.from({ length: 5000 }, (_, i) => ({ id: `Mod-${i}`, name: `Mod ${i}`, dl: (i * 7919) % 100000 }));
	let demoSel = $state<Selection>(emptySelection);
	let demoSort = $state<SortState | null>(null);

	const demoSorted = $derived(demoSort ? [...demoRows].sort((a, b) => (demoSort!.dir === "desc" ? b.dl - a.dl : a.dl - b.dl)) : demoRows);
</script>

{#if dev}
	<div class="h-full overflow-y-auto p-8">
		<div class="flex max-w-4xl flex-col gap-8">
			<SectionLabel>Buttons</SectionLabel>
			<div class="flex flex-wrap items-center gap-2">
				<Button>Add to profile</Button>
				<Button variant="outline">Choose…</Button>
				<Button variant="ghost">Open ↗</Button>
				<Button variant="destructive">Delete</Button>
				<Button size="sm" variant="outline">+ Add</Button>
				<SplitButton onclick={() => {}} menuLabel="More launch options">
					▶ Play
					{#snippet menu()}<DropdownMenu.Item>Launch without mods</DropdownMenu.Item>{/snippet}
				</SplitButton>
			</div>

			<SectionLabel>Selection</SectionLabel>
			<div class="flex items-center gap-4">
				<TriCheckbox state={0} label="off" />
				<TriCheckbox state={1} label="on" />
				<TriCheckbox state={-1} label="excluded" />
				<TriCheckbox state="mixed" label="mixed" />
				<Segmented
					bind:value={seg}
					options={[
						{ value: "all", label: "All" },
						{ value: "p", label: "In profile" },
						{ value: "u", label: "Updates", badge: 3, tone: "primary" },
					]}
				/>
				<Chip active>Proven & current</Chip>
				<Chip>New this month</Chip>
				<Kbd>Ctrl K</Kbd>
				<Switch bind:checked={on} />
			</div>

			<SectionLabel>Status & avatars</SectionLabel>
			<div class="flex items-center gap-6">
				<StatusPill status="update" version="0.14.13" onclick={() => {}} />
				<StatusPill status="inProfile" />
				<StatusPill status="disabled" />
				<StatusPill status="dependency" />
				<StatusPill status="none" />
				<ModAvatar name="EpicLoot" />
				<ModAvatar name="EpicLoot" size="lg" />
				<Stat label="Downloads" value="2,3 Mio" />
			</div>

			<SectionLabel>Settings</SectionLabel>
			<div>
				<SettingRow label="Valheim folder" hint="Leave empty to detect via Steam">
					<PathField bind:value={path} onpick={() => {}} onopen={() => {}} check={{ ok: true, text: "valheim.exe found" }} />
				</SettingRow>
				<SettingRow label="Parallel downloads" align="center">
					<div class="flex items-center gap-3.5">
						<Stepper bind:value={n} min={1} max={16} label="Parallel downloads" /><span class="text-muted-foreground text-xs">1–16 · recommended 4</span>
					</div>
				</SettingRow>
				<SettingRow label="Enum" align="center"><Choice bind:value={choice} options={["true", "false"]} class="w-56" /></SettingRow>
			</div>

			<PanelSection title="Dependencies" count={2}><p>Jotunn</p></PanelSection>
			<div class="h-48 rounded-md border"><EmptyState title="No mods yet">Add some under Browse.</EmptyState></div>

			<SectionLabel>Filters (list, range, token)</SectionLabel>
			<div class="grid max-w-3xl grid-cols-2 gap-6">
				<div class="rounded-md border">
					<FilterSection title="Category" summary="Items · ≠ Modpacks" open={demoOpen} ontoggle={() => (demoOpen = !demoOpen)}>
						<FilterList
							items={[
								{ value: "Items", label: "Items", count: 812 },
								{ value: "Tweaks", label: "Tweaks", count: 640 },
								{ value: "Modpacks", label: "Modpacks", count: 399 },
								{ value: "Building", label: "Building", count: 250 },
							]}
							map={demoMap}
							oncycle={(v) => (demoMap = cycleTri(demoMap, v))}
							onexclude={(v) => (demoMap = setTri(demoMap, v, demoMap[v] === -1 ? 0 : -1))}
							limit={3}
						/>
					</FilterSection>
					<FilterSection title="Downloads" summary="≥ 10k" open={true} ontoggle={() => {}}>
						<NumRangeFilter
							value={demoNum}
							onchange={(r) => (demoNum = r)}
							buckets={demoBuckets}
							counts={[120, 900, 1400, 2000, 1100, 600, 300, 90, 20, 5]}
							presets={[{ label: "≥ 10k", range: { op: "gte", from: 10_000, to: null } }]}
						/>
					</FilterSection>
					<FilterSection title="Updated" summary="" open={true} ontoggle={() => {}}>
						<DateRangeFilter
							value={demoDate}
							onchange={(r) => (demoDate = r)}
							buckets={demoMonths}
							counts={demoMonths.map((_, i) => (i * 37) % 50)}
							now={Date.now()}
						/>
					</FilterSection>
				</div>
				<div class="flex flex-col gap-3">
					<Toolbar class="rounded-md border"><Input class="max-w-xs" placeholder="Search" /><Button variant="outline">Sort</Button></Toolbar>
					<div class="flex flex-wrap gap-1.5">
						<FilterToken field="Category" op="is" value="Items, Tweaks" onflip={() => {}} onremove={() => {}} />
						<FilterToken field="Author" op="is not" value="Azumatt" negative onflip={() => {}} onremove={() => {}} />
						<FilterToken field="Updated" op="within" value="30 days" onflip={() => {}} onremove={() => {}} />
					</div>
					<Histogram
						counts={[3, 9, 27, 12, 4, 1]}
						labels={["a", "b", "c", "d", "e", "f"]}
						selected={[false, false, true, true, false, false]}
						onpick={() => {}}
					/>
				</div>
			</div>

			<SectionLabel>DataTable (5,000 rows)</SectionLabel>
			<div class="relative h-96 rounded-md border">
				<DataTable
					rows={demoSorted}
					getId={(r) => r.id}
					columns={[
						{ key: "name", label: "Mod", width: "minmax(0,1fr)" },
						{ key: "dl", label: "Downl.", width: "90px", align: "right", sortable: true },
					]}
					bind:selection={demoSel}
					bind:sort={demoSort}
					class="h-full"
				>
					{#snippet cell(r, key)}
						{#if key === "name"}<span class="text-row font-semibold">{r.name}</span>{:else}<span class="font-mono text-xs">{r.dl}</span>{/if}
					{/snippet}
					{#snippet menu(ids)}
						<ContextMenu.Label>{ids.length} selected</ContextMenu.Label>
						<ContextMenu.Item>Add to profile <ContextMenu.Shortcut>Enter</ContextMenu.Shortcut></ContextMenu.Item>
					{/snippet}
				</DataTable>

				<SelectionBar count={demoSel.ids.size} onclear={() => (demoSel = { ...demoSel, ids: new Set(), anchor: null })} hint="Shift+click range · Ctrl+A all"
					><Button size="sm">Add to profile</Button></SelectionBar
				>
			</div>
		</div>
	</div>
{/if}
