<script lang="ts">
	import { onMount, tick } from "svelte";
	import { resolve } from "$app/paths";
	import { goto } from "$app/navigation";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
	import SearchIcon from "@lucide/svelte/icons/search";
	import { toast } from "svelte-sonner";
	import { Badge, Button, Collapsible, EmptyState, Input, Toolbar } from "#lib/components/kit/index.js";
	import SettingControl from "#lib/components/config/setting-control.svelte";
	import SyncBadge from "#lib/components/config/sync-badge.svelte";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { check, isDefault, kindOf, searchSettings } from "#lib/configmeta.js";
	import { relative } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";
	import type { ConfigFile, ConfigSaved, ConfigSetting, ConfigsIndex } from "#lib/types.js";

	let index = $state<ConfigsIndex | null>(null);
	let filter = $state("");
	let search = $state("");
	let current = $state<string | null>(null);
	let file = $state<ConfigFile | null>(null);
	let edits = $state<Record<string, string>>({});
	let closed = $state<Record<string, boolean>>({});
	let nonDefaultOnly = $state(false);
	let error = $state<string | null>(null);
	let saving = $state(false);

	const editable = $derived(session.authed && session.on("configEdit") && session.on("publish"));
	const files = $derived(index?.files ?? []);
	const shown = $derived(files.filter((f) => f.toLowerCase().includes(filter.toLowerCase())));
	const settings = $derived(file?.settings ?? []);
	const keyOf = (s: ConfigSetting) => `${s.section}::${s.key}`;
	const valueOf = (s: ConfigSetting) => edits[keyOf(s)] ?? s.value;
	const changed = $derived(settings.filter((s) => keyOf(s) in edits && edits[keyOf(s)] !== s.value));
	const invalid = $derived(changed.filter((s) => check(kindOf(s), edits[keyOf(s)]) !== null));
	const visible = $derived(nonDefaultOnly ? settings.filter((s) => !isDefault(s, valueOf(s))) : settings);
	const sections = $derived(Map.groupBy(visible, (s) => s.section));
	const changedIn = (section: string) => changed.filter((s) => s.section === section).length;
	const hits = $derived(index?.settings && search.trim() ? searchSettings(index.settings, search) : []);
	const hitsByFile = $derived(Map.groupBy(hits, (h) => h.file));
	const enc = (f: string) => f.split("/").map(encodeURIComponent).join("/");
	const domId = (f: string, s: ConfigSetting) => `s-${btoa(unescape(encodeURIComponent(`${f}::${keyOf(s)}`))).replace(/[^a-z0-9]/gi, "")}`;

	onMount(async () => {
		await loadIndex();
		const fromHash = decodeURIComponent(location.hash.slice(1));
		if (fromHash && files.includes(fromHash)) open(fromHash);
	});

	async function loadIndex() {
		try {
			index = await api<ConfigsIndex>("/configs?settings=1");
			error = null;
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function open(name: string, focus?: ConfigSetting) {
		if (name !== current) {
			if (changed.length && !confirm(t("configs.discard"))) return;
			current = name;
			edits = {};
			history.replaceState(history.state, "", `#${encodeURIComponent(name)}`);
			file = await attempt(() => api<ConfigFile>(`/configs/${enc(name)}`));
		}
		if (focus) {
			search = "";
			closed = { ...closed, [focus.section]: false };
			await tick();
			const el = document.getElementById(domId(name, focus));
			el?.scrollIntoView({ block: "center" });
			el?.classList.add("bg-selected");
			setTimeout(() => el?.classList.remove("bg-selected"), 1600);
		}
	}

	async function stage() {
		if (!current) return;
		saving = true;
		const body = { changes: changed.map((s) => ({ section: s.section, key: s.key, value: edits[keyOf(s)] })) };
		const r = await attempt(() => api<ConfigSaved>(`/configs/${enc(current!)}`, { method: "PUT", body }));
		saving = false;
		if (!r) return;
		toast.success(t("configs.staged.toast", { n: body.changes.length }), {
			description: r.effect
				? t(`effect.${r.effect.sync}`) + (r.effect.sync !== "unknown" ? ` · ${t(r.effect.liveReload ? "effect.live" : "effect.restart")}` : "")
				: undefined,
			action: { label: t("configs.goRelease"), onClick: () => goto(resolve("/release")) },
			duration: 8000,
		});
		await reopen();
	}

	async function revertFile() {
		if (!current) return;
		const ok = await attempt(() => api(`/releases/pending/configs/${enc(current!)}`, { method: "DELETE" }));
		if (!ok) return;
		toast.success(t("configs.reverted"));
		await reopen();
	}

	async function reopen() {
		const name = current!;
		edits = {};
		current = null;
		await Promise.all([open(name), loadIndex(), session.refresh()]);
	}

	function setAll(open: boolean) {
		closed = Object.fromEntries([...sections.keys()].map((s) => [s, !open]));
	}

	const rangeOf = (s: ConfigSetting) => {
		const k = kindOf(s);
		return k.kind === "number" && k.min !== undefined && k.max !== undefined ? t("configs.range", { min: k.min, max: k.max }) : null;
	};
</script>

<div class="flex h-full min-h-0">
	<aside class="bg-panel flex w-72 shrink-0 flex-col border-r max-md:hidden">
		<div class="border-b p-3"><Input type="search" placeholder={t("configs.filter")} bind:value={filter} /></div>
		<ul class="min-h-0 flex-1 overflow-y-auto p-1.5">
			{#each shown as f (f)}
				{@const info = index?.info[f]}
				<li>
					<button
						type="button"
						onclick={() => open(f)}
						class={cn(
							"text-foreground-soft hover:bg-hover hover:text-foreground flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left font-mono text-xs",
							current === f && "bg-muted text-foreground",
						)}
						title={[f, info ? t(`effect.${info.sync}`) : ""].filter(Boolean).join(" · ")}
					>
						<span class="min-w-0 flex-1 truncate">{f}</span>
						{#if index?.staged.includes(f)}<span class="bg-primary size-1.5 shrink-0 rounded-full" title={t("configs.staged")}></span>{/if}
						{#if info && info.sync !== "unknown"}
							<span class={cn("shrink-0 text-[10px]", info.sync === "none" ? "text-subtle-foreground" : "text-primary-text")}
								>{t(`effect.short.${info.sync}`)}</span
							>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	</aside>

	<section class="flex min-w-0 flex-1 flex-col">
		<Toolbar>
			<select
				class="bg-field border-input h-control rounded-md border px-2 text-sm md:hidden"
				value={current ?? ""}
				onchange={(e) => open(e.currentTarget.value)}
				aria-label={t("configs.file")}
			>
				<option value="" disabled>{t("configs.choose")}</option>
				{#each files as f (f)}<option value={f}>{f}</option>{/each}
			</select>
			<div class="relative min-w-0 flex-1 md:max-w-sm">
				<SearchIcon class="text-subtle-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
				<Input type="search" placeholder={t("configs.search")} bind:value={search} class="pl-8" aria-label={t("configs.search")} />
			</div>
			{#if current && !search.trim()}
				<span class="truncate font-mono text-sm max-md:hidden">{current}</span>
				<SyncBadge info={file?.info} />
			{/if}
			<span class="flex-1"></span>
			{#if editable && current && !search.trim()}
				{#if file?.staged}
					<Button variant="ghost" size="sm" onclick={revertFile} title={t("configs.revertFile")}><RotateCcwIcon />{t("common.revert")}</Button>
				{/if}
				{#if changed.length}<Button variant="ghost" size="sm" onclick={() => (edits = {})}>{t("common.reset")}</Button>{/if}
				<Button size="sm" disabled={!changed.length || saving} onclick={stage}
					>{changed.length ? t("configs.stage", { n: changed.length }) : t("common.save")}</Button
				>
			{:else if current && !search.trim()}
				<span class="text-muted-foreground text-xs">{t("configs.readOnly")}</span>
			{/if}
		</Toolbar>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if error}
				<EmptyState title={t("common.loadFailed")}>{error}</EmptyState>
			{:else if search.trim()}
				{#if !hits.length}
					<EmptyState title={t("configs.noResults", { q: search.trim() })} />
				{:else}
					<p class="text-muted-foreground border-b px-5 py-2.5 text-xs">{t("configs.results", { n: hits.length, q: search.trim() })}</p>
					{#each [...hitsByFile] as [f, list] (f)}
						<div class="bg-background sticky top-0 flex items-center gap-2 border-b px-5 py-2">
							<span class="truncate font-mono text-xs">{f}</span>
							<SyncBadge info={index?.info[f]} />
						</div>
						{#each list as h (keyOf(h.setting))}
							<button
								type="button"
								onclick={() => open(f, h.setting)}
								class="border-line-subtle hover:bg-hover flex w-full flex-col gap-0.5 border-b px-5 py-2.5 text-left"
							>
								<span class="flex items-center gap-2">
									<span class="text-row font-mono font-medium">{h.setting.key}</span>
									<span class="text-subtle-foreground font-mono text-[11px]">[{h.setting.section}]</span>
									<span class="flex-1"></span>
									<span class="cell-mono max-w-[40%] truncate">{h.setting.value}</span>
								</span>
								{#if h.setting.description}<span class="text-muted-foreground line-clamp-1 text-xs">{h.setting.description}</span>{/if}
							</button>
						{/each}
					{/each}
				{/if}
			{:else if !current}
				<EmptyState title={t("configs.choose")}>{t("configs.lead")}</EmptyState>
			{:else if !settings.length}
				<EmptyState title={t("configs.empty")} />
			{:else}
				{#if file}
					<div class="border-line-subtle flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2.5">
						<SyncBadge info={file.info} long />
						{#if file.staged}
							<span class="text-primary-text text-xs" title={t("configs.stagedFile")}
								>{t("configs.staged")}{file.meta
									? ` · ${t("release.s2.from", { source: t(`source.${file.meta.source}`), time: relative(file.meta.at) })}`
									: ""}</span
							>
						{/if}
						<span class="flex-1"></span>
						<label class="text-muted-foreground flex items-center gap-1.5 text-xs">
							<input type="checkbox" bind:checked={nonDefaultOnly} class="accent-primary" />{t("configs.nonDefault")}
						</label>
						<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => setAll(false)}>{t("configs.collapseAll")}</Button>
						<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => setAll(true)}>{t("configs.expandAll")}</Button>
					</div>
					{#if editable}<p class="text-subtle-foreground border-line-subtle border-b px-5 py-2 text-xs">{t("configs.editHint")}</p>{/if}
				{/if}
				{#each [...sections] as [section, rows] (section)}
					<Collapsible.Root open={!closed[section]} onOpenChange={(o: boolean) => (closed = { ...closed, [section]: !o })}>
						<Collapsible.Trigger
							class="bg-background hover:bg-hover sticky top-0 z-10 flex w-full items-center gap-2 border-b px-5 py-2.5 text-left"
							aria-label={`[${section}]`}
						>
							<ChevronDownIcon class={cn("text-subtle-foreground size-3.5 transition-transform", closed[section] && "-rotate-90")} />
							<span class="label-caps">[{section}]</span>
							<span class="text-subtle-foreground font-mono text-[11px]">{rows.length}</span>
							{#if changedIn(section)}<Badge variant="outline" class="border-primary-line text-primary-text ml-1 font-mono text-[10px]"
									>{t("configs.changed", { n: changedIn(section) })}</Badge
								>{/if}
						</Collapsible.Trigger>
						<Collapsible.Content>
							{#each rows as s (keyOf(s))}
								{@const id = domId(current, s)}
								{@const raw = valueOf(s)}
								{@const dirty = keyOf(s) in edits && edits[keyOf(s)] !== s.value}
								{@const live = file?.live[keyOf(s)]}
								<div
									{id}
									class={cn(
										"border-line-subtle grid gap-x-6 gap-y-2 border-b px-5 py-3 transition-colors md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]",
										dirty && "border-l-primary border-l-2",
									)}
								>
									<div class="flex min-w-0 flex-col gap-1">
										<label for={id} class="text-row font-mono font-medium break-all">{s.key}</label>
										{#if s.description}<p class="text-muted-foreground text-xs leading-snug">{s.description}</p>{/if}
										<div class="text-subtle-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
											{#if s.type}<span>{s.type}</span>{/if}
											{#if rangeOf(s)}<span>{t("configs.allowed")}: {rangeOf(s)}</span>{/if}
											{#if s.synced !== undefined}<span class={s.synced ? "text-primary-text" : ""}
													>{t(s.synced ? "configs.syncedEntry" : "configs.notSyncedEntry")}</span
												>{/if}
											{#if s.defaultValue !== undefined && !isDefault(s, raw)}
												<span class="inline-flex items-center gap-1">
													{t("configs.default", { v: s.defaultValue })}
													{#if editable}
														<button type="button" class="hover:text-foreground underline underline-offset-2" onclick={() => (edits[keyOf(s)] = s.defaultValue!)}
															>{t("configs.resetDefault")}</button
														>
													{/if}
												</span>
											{/if}
											{#if live !== undefined}<span class="text-primary-text">{t("configs.onServer", { v: live })}</span>{/if}
										</div>
									</div>
									<div class="flex min-w-0 flex-col gap-1">
										{#if editable}
											<SettingControl setting={s} {raw} {id} onchange={(v) => (edits[keyOf(s)] = v)} />
										{:else}
											<span class="cell-mono break-all whitespace-normal">{s.value}</span>
										{/if}
									</div>
								</div>
							{/each}
						</Collapsible.Content>
					</Collapsible.Root>
				{/each}
				{#if invalid.length}
					<p class="text-destructive-text px-5 py-3 text-xs">{t("configs.invalid", { n: invalid.length })} · {t("configs.rawHint")}</p>
				{/if}
			{/if}
		</div>
	</section>
</div>
