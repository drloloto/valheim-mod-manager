<script lang="ts">
	import { onMount } from "svelte";
	import { getVersion } from "@tauri-apps/api/app";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { Button, Input, PathField, SectionLabel, Segmented, SettingRow, Stepper, Switch } from "#lib/components/kit/index.js";
	import { api } from "#lib/api/client.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { GameInfo, Settings } from "#lib/api/types.js";
	import { debounce } from "#lib/desktop/debounce.js";
	import { formatBytes, formatNumber, relativeTime } from "#lib/format.js";
	import { localeSetting, setLocaleSetting, t, type LocaleSetting } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";

	const SECTIONS = $derived([
		{ id: "game", label: t("settings.game") },
		{ id: "downloads", label: t("settings.downloads") },
		{ id: "appearance", label: t("settings.appearance") },
		{ id: "thunderstore", label: t("settings.thunderstore") },
		{ id: "updates", label: t("update.section") },
		{ id: "storage", label: t("settings.storage") },
		{ id: "about", label: t("settings.about") },
	]);

	const ctrl = $derived(t("key.ctrl"));
	let form = $state<Settings | null>(null);
	let detected = $state<GameInfo | null>(null);
	let version = $state("");
	let saving = $state(false);
	let current = $state("game");
	let scroller = $state<HTMLDivElement>();
	// Last sent/accepted state (not $state): comparing against store.settings would create an
	// autosave loop whenever the backend normalizes a value (e.g. trims a path).
	let lastSaved = "";

	$effect(() => {
		if (store.settings && !form) {
			form = { ...store.settings };
			lastSaved = JSON.stringify(store.settings);
		}
	});

	onMount(() => {
		api
			.detectGame()
			.then((d) => (detected = d))
			.catch(() => {});
		getVersion()
			.then((v) => (version = v))
			.catch(() => {});
		return () => persist.flush();
	});

	const persist = debounce(async (s: Settings) => {
		saving = true;
		await store.saveSettings(s, true);
		saving = false;
	}, 600);

	// Autosave: every form change saves after a short pause; only the last state counts.
	$effect(() => {
		if (!form) return;
		const snapshot = $state.snapshot(form) as Settings;
		const json = JSON.stringify(snapshot);
		if (json !== lastSaved) {
			lastSaved = json;
			persist(snapshot);
		}
	});

	async function pickValheim() {
		const dir = await openDialog({ directory: true });
		if (typeof dir === "string" && form) form.valheimDir = dir;
	}

	async function pickSteam() {
		const file = await openDialog({ filters: [{ name: "steam.exe", extensions: ["exe"] }] });
		if (typeof file === "string" && form) form.steamExe = file;
	}

	async function clearCache() {
		try {
			const freed = await api.clearDownloadCache();
			store.toast(t("settings.cacheCleared", { size: formatBytes(freed) }), "ok");
		} catch (e) {
			store.toast(e instanceof Error ? e.message : t("settings.cacheFailed"), "err");
		}
	}

	function jump(id: string) {
		current = id;
		document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	function onScroll() {
		if (!scroller) return;
		const top = scroller.getBoundingClientRect().top;
		for (const s of [...SECTIONS].reverse()) {
			const el = document.getElementById(`settings-${s.id}`);
			if (el && el.getBoundingClientRect().top - top <= 40) {
				current = s.id;
				return;
			}
		}
	}

	const gameCheck = $derived(
		store.state.game.found
			? { ok: true, text: form?.valheimDir ? t("settings.exeFound") : t("settings.exeFoundAuto") }
			: { ok: false, text: t("settings.exeMissing") },
	);
</script>

{#if form}
	<div class="flex h-full">
		<nav class="flex w-[212px] shrink-0 flex-col gap-0.5 border-r px-3 py-4 text-[13px]" aria-label={t("settings.sectionsAria")}>
			{#each SECTIONS as s (s.id)}
				<button
					class={cn("rounded-[5px] px-2.5 py-[7px] text-left", current === s.id ? "bg-muted font-medium" : "text-foreground-soft hover:text-foreground")}
					onclick={() => jump(s.id)}>{s.label}</button
				>
			{/each}
		</nav>

		<div bind:this={scroller} onscroll={onScroll} class="scroll-y min-w-0 flex-1">
			<div class="@container flex max-w-[860px] flex-col gap-8 px-10 py-7">
				<div class="flex items-baseline justify-between gap-4">
					<h1 class="shrink-0 text-[22px] font-bold">{t("settings.title")}</h1>
					<span
						class={cn("min-w-0 truncate font-mono text-[11.5px]", store.settingsError ? "text-destructive-text" : "text-success")}
						title={store.settingsError ?? undefined}
					>
						{#if saving}{t("settings.saving")}{:else if store.settingsError}✗ {store.settingsError}{:else}{t("settings.saved")}{/if}
					</span>
				</div>

				<section id="settings-game">
					<SectionLabel class="border-b pb-2.5">{t("settings.game")}</SectionLabel>
					<SettingRow label={t("settings.valheimDir")} hint={t("settings.valheimDirHint")} for="valheim-dir">
						<PathField
							id="valheim-dir"
							bind:value={form.valheimDir}
							placeholder={detected?.valheimDir ?? t("settings.notFound")}
							onpick={pickValheim}
							onopen={() => store.openFolder("game")}
							check={gameCheck}
						/>
					</SettingRow>
					<SettingRow label={t("settings.steamExe")} hint={t("settings.steamExeHint")} for="steam-exe">
						<PathField
							id="steam-exe"
							bind:value={form.steamExe}
							placeholder={detected?.steamExe ?? t("settings.notFound")}
							onpick={pickSteam}
							check={form.steamExe ? null : detected?.steamExe ? { ok: true, text: t("settings.autoDetected") } : { ok: false, text: t("settings.notFound") }}
						/>
					</SettingRow>
				</section>

				<section id="settings-downloads">
					<SectionLabel class="border-b pb-2.5">{t("settings.downloads")}</SectionLabel>
					<SettingRow label={t("settings.concurrency")} align="center">
						<div class="flex items-center gap-3.5">
							<Stepper bind:value={form.downloadConcurrency} min={1} max={16} label={t("settings.concurrency")} />
							<span class="text-muted-foreground min-w-0 text-xs">{t("settings.concurrencyHint")}</span>
						</div>
					</SettingRow>
					<SettingRow label={t("settings.indexTtl")} align="center">
						<Segmented
							bind:value={() => String(form!.indexTtlMinutes), (v) => (form!.indexTtlMinutes = Number(v))}
							options={[
								{ value: "15", label: t("settings.minutes", { n: 15 }) },
								{ value: "30", label: t("settings.minutes", { n: 30 }) },
								{ value: "60", label: t("settings.hours", { n: 1 }) },
								{ value: "240", label: t("settings.hours", { n: 4 }) },
							]}
						/>
					</SettingRow>
					<SettingRow label={t("settings.nsfw")} align="center">
						<div class="flex items-center gap-2.5">
							<Switch bind:checked={form.showNsfw} aria-label={t("settings.nsfw")} />
							<span class="text-muted-foreground min-w-0 text-xs">{t("settings.nsfwHint")}</span>
						</div>
					</SettingRow>
				</section>

				<section id="settings-appearance">
					<SectionLabel class="border-b pb-2.5">{t("settings.appearance")}</SectionLabel>
					<SettingRow label={t("settings.language")} hint={t("settings.languageHint")} align="center">
						<Segmented
							bind:value={() => localeSetting.value, (v) => setLocaleSetting(v as LocaleSetting)}
							options={[
								{ value: "system", label: t("settings.lang.system") },
								{ value: "de", label: t("settings.lang.de") },
								{ value: "en", label: t("settings.lang.en") },
							]}
						/>
					</SettingRow>
				</section>

				<section id="settings-thunderstore">
					<SectionLabel class="border-b pb-2.5">{t("settings.thunderstore")}</SectionLabel>
					<SettingRow label={t("settings.tsToken")} hint={t("settings.tsTokenHint")} for="ts-token">
						<div class="grid gap-1.5">
							<Input
								id="ts-token"
								type="password"
								autocomplete="off"
								placeholder="tss_…"
								value={form.thunderstoreToken ?? ""}
								oninput={(e) => (form!.thunderstoreToken = e.currentTarget.value || null)}
							/>
							<button class="text-primary-text w-max text-xs hover:underline" onclick={() => store.openExternal("https://thunderstore.io/settings/teams/")}>
								{t("settings.tsTokenWhere")}
							</button>
						</div>
					</SettingRow>
				</section>

				<section id="settings-updates">
					<SectionLabel class="border-b pb-2.5">{t("update.section")}</SectionLabel>
					<SettingRow label={t("settings.version")} align="center">
						<div class="flex flex-wrap items-center gap-3">
							<span class="font-mono text-[12.5px]">{store.state.app.version || version}</span>
							{#if store.state.app.portable}
								<span class="text-muted-foreground text-xs">{t("update.portable")}</span>
							{:else if store.updateStatus === "available" && store.update}
								<Button size="sm" onclick={() => store.installUpdate()}>{t("update.install")} ({store.update.version})</Button>
							{:else if store.updateStatus === "installing"}
								<span class="text-primary text-xs">{t("update.installing")}</span>
							{:else}
								<Button size="sm" variant="outline" disabled={store.updateStatus === "checking"} onclick={() => store.checkUpdate()}>
									{store.updateStatus === "checking" ? t("update.checking") : t("update.checkNow")}
								</Button>
								{#if store.updateStatus === "none"}<span class="text-success text-xs">{t("update.none")}</span>
								{:else if store.updateStatus === "error"}<span class="text-destructive-text text-xs">{t("update.failed", { e: store.updateError ?? "" })}</span
									>{/if}
							{/if}
						</div>
					</SettingRow>
					<SettingRow label={t("update.auto")} hint={t("update.autoHint")} align="center">
						<Switch
							checked={store.autoUpdate.value}
							onCheckedChange={(v) => store.autoUpdate.set(v)}
							aria-label={t("update.auto")}
							disabled={store.state.app.portable}
						/>
					</SettingRow>
				</section>

				<section id="settings-storage">
					<SectionLabel class="border-b pb-2.5">{t("settings.storage")}</SectionLabel>
					<SettingRow label={t("settings.cache")} hint={t("settings.cacheHint")} align="center">
						<span></span>
						{#snippet aside()}<Button size="sm" variant="outline" onclick={clearCache}>{t("common.clear")}</Button>{/snippet}
					</SettingRow>
					<SettingRow label={t("settings.index")} align="center">
						<span class="text-foreground-soft block truncate font-mono text-[12.5px]">
							{t("settings.packages", { n: formatNumber(store.packages.length) })}{#if store.indexFetchedAt}
								· {relativeTime(store.indexFetchedAt)}{/if}
						</span>
						{#snippet aside()}<Button size="sm" variant="outline" disabled={store.indexRefreshing} onclick={() => store.refreshIndex()}
								>{t("settings.refreshNow")}</Button
							>{/snippet}
					</SettingRow>
					<SettingRow label={t("settings.dataFolder")} hint={store.state.app.portable ? t("settings.portable") : t("settings.dataFolderHint")} align="center">
						<span class="text-foreground-soft selectable block truncate font-mono text-[12.5px]" title={store.state.app.dataDir}>{store.state.app.dataDir}</span
						>
						{#snippet aside()}<Button size="sm" variant="ghost" onclick={() => store.openFolder("data")}>{t("common.open")}</Button>{/snippet}
					</SettingRow>
				</section>

				<section id="settings-about" class="pb-10">
					<SectionLabel class="border-b pb-2.5">{t("settings.about")}</SectionLabel>
					<SettingRow label={t("settings.version")} align="center">
						<span class="font-mono text-[12.5px]">{t("app.name")} {version}</span>
					</SettingRow>
					<SettingRow label={t("settings.shortcuts")}>
						<dl class="text-foreground-soft grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[12.5px]">
							<dt class="font-mono">{ctrl} K / {ctrl} F</dt>
							<dd>{t("settings.sc.search")}</dd>
							<dt class="font-mono">{ctrl} 1–4, {ctrl} ,</dt>
							<dd>{t("settings.sc.tabs")}</dd>
							<dt class="font-mono">{ctrl} Enter</dt>
							<dd>{t("settings.sc.play")}</dd>
							<dt class="font-mono">{ctrl} N</dt>
							<dd>{t("settings.sc.newProfile")}</dd>
							<dt class="font-mono">F5</dt>
							<dd>{t("settings.sc.refresh")}</dd>
							<dt class="font-mono">{ctrl} A, {t("key.shiftClick")}, {t("key.del")}</dt>
							<dd>{t("settings.sc.selection")}</dd>
						</dl>
					</SettingRow>
				</section>
			</div>
		</div>
	</div>
{:else}
	<p class="text-muted-foreground p-6 text-sm">{t("common.loading")}</p>
{/if}
