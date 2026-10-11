<script lang="ts">
	import { Button, Choice, ConfirmDialog, EmptyState, Input, Resizable, SectionLabel, Switch, Toolbar } from "#lib/components/kit/index.js";
	import { api, ApiError } from "#lib/api/client.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { ConfigSetting } from "#lib/api/types.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import { parseRange } from "#lib/config-range.js";

	let files = $state<string[]>([]);
	let fileFilter = $state("");
	let currentFile = $state<string | null>(null);
	let settings = $state<ConfigSetting[]>([]);
	let dirty = $state<Map<number, string>>(new Map());
	let settingFilter = $state("");
	let loading = $state(true);
	let pendingFile = $state<string | null>(null);

	async function loadFiles() {
		loading = true;
		try {
			files = await api.listConfigFiles();
		} catch (e) {
			files = [];
			if (store.state.active) store.toast(e instanceof ApiError ? e.message : t("config.loadFailed"), "err");
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// reload when the active profile changes
		void store.state.active;
		currentFile = null;
		settings = [];
		dirty = new Map();
		loadFiles();
	});

	const filteredFiles = $derived(files.filter((f) => f.toLowerCase().includes(fileFilter.toLowerCase())));

	function requestFile(f: string) {
		if (f === currentFile) return;
		if (dirty.size) pendingFile = f;
		else openFile(f);
	}

	async function openFile(f: string) {
		pendingFile = null;
		try {
			const data = await api.getConfigFile(f);
			currentFile = f;
			settings = data.settings;
			dirty = new Map();
		} catch (e) {
			store.toast(e instanceof ApiError ? e.message : t("config.readFailed"), "err");
		}
	}

	function isBool(type?: string) {
		return /^bool/i.test(type ?? "");
	}

	function enumOptions(s: ConfigSetting): string[] {
		if (!s.acceptableValues || /^From /i.test(s.acceptableValues)) return [];
		return s.acceptableValues
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean);
	}

	/** BepInEx writes comments only for entries the mod still binds; a bare key = value is a leftover. */
	function isOrphan(s: ConfigSetting) {
		return !s.type && s.defaultValue == null && !s.description;
	}

	function current(i: number) {
		return dirty.get(i) ?? settings[i].value;
	}

	function setValue(i: number, value: string) {
		const next = new Map(dirty);
		if (value === settings[i].value) next.delete(i);
		else next.set(i, value);
		dirty = next;
	}

	async function save() {
		if (!currentFile || !dirty.size) return;
		const changes = [...dirty].map(([i, value]) => ({ section: settings[i].section, key: settings[i].key, value }));
		try {
			await api.saveConfigFile(currentFile, changes);
			for (const [i, v] of dirty) settings[i] = { ...settings[i], value: v };
			dirty = new Map();
			store.toast(t("config.saved", { n: changes.length }), "ok");
		} catch (e) {
			store.toast(e instanceof ApiError ? e.message : t("config.saveFailed"), "err");
		}
	}

	const visible = $derived.by(() => {
		const q = settingFilter.toLowerCase();
		const all = settings.map((s, i) => ({ s, i }));
		return q ? all.filter(({ s }) => `${s.section} ${s.key} ${s.description}`.toLowerCase().includes(q)) : all;
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			save();
		}
	}}
/>

<Resizable.PaneGroup direction="horizontal" autoSaveId="config" class="h-full">
	<Resizable.Pane defaultSize={22} minSize={15} maxSize={40} order={1} id="config-files">
		<div class="flex h-full flex-col">
			<div class="flex flex-col gap-2 border-b p-3">
				<Input placeholder={t("config.filterFiles")} bind:value={fileFilter} />
				<Button variant="outline" size="sm" onclick={() => store.openFolder("config")} disabled={!store.state.active}>{t("config.openFolder")}</Button>
			</div>
			<div class="flex-1 overflow-y-auto p-1.5">
				{#if !loading && !filteredFiles.length}
					<p class="text-muted-foreground p-2 text-[13px]">{t("config.noFiles")}</p>
				{/if}
				{#each filteredFiles as f (f)}
					<button
						class={cn(
							"block w-full truncate rounded-[5px] px-2.5 py-[7px] text-left font-mono text-xs",
							f === currentFile ? "bg-muted text-foreground" : "text-foreground-soft hover:bg-hover",
						)}
						title={f}
						onclick={() => requestFile(f)}
					>
						{f}
					</button>
				{/each}
			</div>
		</div>
	</Resizable.Pane>
	<Resizable.Handle />
	<Resizable.Pane minSize={40} order={2} id="config-editor">
		{#if !currentFile}
			<EmptyState title={t("config.chooseFile")}>{t("config.chooseFileHint")}</EmptyState>
		{:else}
			<div class="flex h-full flex-col">
				<Toolbar>
					<span class="truncate font-mono text-[13px] font-medium">{currentFile}</span>
					{#if dirty.size}<span class="text-primary text-meta font-mono">{t("config.changed", { n: dirty.size })}</span>{/if}
					<div class="flex-1"></div>
					<Input data-search class="w-64" placeholder={t("config.filterSettings")} bind:value={settingFilter} />
					<Button variant="outline" size="sm" onclick={() => (dirty = new Map())} disabled={!dirty.size}>{t("common.discard")}</Button>
					<Button size="sm" onclick={save} disabled={!dirty.size} title={t("config.saveTitle")}>{t("common.save")}</Button>
				</Toolbar>
				<div class="flex-1 overflow-y-auto px-6">
					{#each visible as { s, i }, n (i)}
						{@const range = parseRange(s.acceptableValues, s.type)}
						{#if n === 0 || visible[n - 1].s.section !== s.section}
							<SectionLabel class="border-b pt-5 pb-2.5">{s.section}</SectionLabel>
						{/if}
						<div class="border-line-subtle grid grid-cols-[minmax(0,1fr)_14rem] items-center gap-6 border-b py-3">
							<div class="flex min-w-0 flex-col gap-1">
								<span class="text-row flex items-center gap-2 font-semibold">
									{s.key}{#if dirty.has(i)}<span class="bg-primary size-1.5 rounded-full"></span>{/if}
								</span>
								{#if s.description}<p class="text-muted-foreground selectable text-xs leading-snug">{s.description}</p>{/if}
								{#if isOrphan(s)}<p class="text-subtle-foreground text-xs">{t("config.orphan")}</p>{/if}
								<p class="text-subtle-foreground text-meta font-mono">
									{[
										s.type,
										s.defaultValue != null && t("config.default", { v: s.defaultValue }),
										s.acceptableValues && t("config.allowed", { v: s.acceptableValues }),
									]
										.filter(Boolean)
										.join(" · ")}
								</p>
							</div>
							<div class="flex items-center gap-1.5">
								<div class="min-w-0 flex-1">
									{#if isBool(s.type)}
										<Switch checked={current(i) === "true"} onCheckedChange={(v) => setValue(i, String(v))} aria-label={s.key} />
									{:else if enumOptions(s).length}
										<Choice value={current(i)} options={enumOptions(s)} onchange={(v) => setValue(i, v)} />
									{:else if range}
										<div class="flex items-center gap-2">
											<input
												type="range"
												class="accent-primary min-w-0 flex-1"
												min={range.min}
												max={range.max}
												step={range.step}
												value={Number(current(i)) || range.min}
												oninput={(e) => setValue(i, e.currentTarget.value)}
												aria-label={s.key}
											/>
											<Input
												class="w-[5.5rem] font-mono text-[12.5px]"
												type="number"
												min={range.min}
												max={range.max}
												step={range.step}
												value={current(i)}
												oninput={(e) => setValue(i, e.currentTarget.value)}
											/>
										</div>
									{:else}
										<Input class="font-mono text-[12.5px]" spellcheck={false} value={current(i)} oninput={(e) => setValue(i, e.currentTarget.value)} />
									{/if}
								</div>
								{#if s.defaultValue != null && current(i) !== s.defaultValue}
									<Button
										size="sm"
										variant="ghost"
										class="h-7 w-7 shrink-0 p-0"
										title={t("config.reset", { v: s.defaultValue })}
										onclick={() => setValue(i, s.defaultValue!)}
									>
										<RotateCcw class="size-3.5" />
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</Resizable.Pane>
</Resizable.PaneGroup>

<ConfirmDialog
	bind:open={() => pendingFile !== null, (v) => !v && (pendingFile = null)}
	title={t("config.discardTitle")}
	description={t("config.discardDesc", { n: dirty.size, file: currentFile ?? "" })}
	confirmLabel={t("common.discard")}
	destructive
	onconfirm={() => {
		if (pendingFile) openFile(pendingFile);
	}}
/>
