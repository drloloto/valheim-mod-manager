<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button, EmptyState, Input, SectionLabel, Switch, Toolbar } from "#lib/components/kit/index.js";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";
	import type { ConfigSetting } from "#lib/types.js";

	let files = $state<string[]>([]);
	let filter = $state("");
	let current = $state<string | null>(null);
	let settings = $state<ConfigSetting[]>([]);
	let edits = $state<Record<string, string>>({});
	let error = $state<string | null>(null);
	let saving = $state(false);

	const editable = $derived(session.authed && session.on("configEdit"));
	const shown = $derived(files.filter((f) => f.toLowerCase().includes(filter.toLowerCase())));
	const sections = $derived(Map.groupBy(settings, (s) => s.section));
	const keyOf = (s: ConfigSetting) => `${s.section}::${s.key}`;
	const changed = $derived(settings.filter((s) => keyOf(s) in edits && edits[keyOf(s)] !== s.value));
	const enc = (f: string) => f.split("/").map(encodeURIComponent).join("/");

	onMount(async () => {
		try {
			files = (await api<{ files: string[] }>("/configs")).files;
			const fromHash = decodeURIComponent(location.hash.slice(1));
			if (fromHash && files.includes(fromHash)) open(fromHash);
		} catch (e) {
			error = (e as Error).message;
		}
	});

	async function open(file: string) {
		if (changed.length && !confirm(t("configs.discard"))) return;
		current = file;
		edits = {};
		history.replaceState(history.state, "", `#${encodeURIComponent(file)}`);
		const r = await attempt(() => api<{ settings: ConfigSetting[] }>(`/configs/${enc(file)}`));
		settings = r?.settings ?? [];
	}

	async function save() {
		if (!current) return;
		saving = true;
		const body = { changes: changed.map((s) => ({ section: s.section, key: s.key, value: edits[keyOf(s)] })) };
		const ok = await attempt(() => api(`/configs/${enc(current!)}`, { method: "PUT", body }));
		saving = false;
		if (!ok) return;
		toast.success(t("configs.saved", { n: body.changes.length }));
		const file = current;
		edits = {};
		current = null;
		await open(file);
	}

	const isBool = (s: ConfigSetting) => s.type?.toLowerCase() === "boolean" || /^(true|false)$/i.test(s.value);
	const valueOf = (s: ConfigSetting) => edits[keyOf(s)] ?? s.value;
</script>

<div class="flex h-full min-h-0">
	<aside class="bg-panel flex w-72 shrink-0 flex-col border-r max-md:hidden">
		<div class="border-b p-3"><Input type="search" placeholder={t("configs.filter")} bind:value={filter} /></div>
		<ul class="min-h-0 flex-1 overflow-y-auto p-1.5">
			{#each shown as f (f)}
				<li>
					<button
						type="button"
						onclick={() => open(f)}
						class={cn(
							"text-foreground-soft hover:bg-hover hover:text-foreground w-full truncate rounded-[5px] px-2.5 py-1.5 text-left font-mono text-xs",
							current === f && "bg-muted text-foreground",
						)}
						title={f}>{f}</button
					>
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
			<span class="truncate font-mono text-sm max-md:hidden">{current ?? t("configs.choose")}</span>
			<span class="flex-1"></span>
			{#if editable && current}
				{#if changed.length}<Button variant="ghost" size="sm" onclick={() => (edits = {})}>{t("common.reset")}</Button>{/if}
				<Button size="sm" disabled={!changed.length || saving} onclick={save}
					>{changed.length ? t("configs.save", { n: changed.length }) : t("common.save")}</Button
				>
			{:else if current}
				<span class="text-muted-foreground text-xs">{t("configs.readOnly")}</span>
			{/if}
		</Toolbar>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if error}
				<EmptyState title={t("common.loadFailed")}>{error}</EmptyState>
			{:else if !current}
				<EmptyState title={t("configs.choose")}>{t("configs.lead")}</EmptyState>
			{:else if !settings.length}
				<EmptyState title={t("configs.empty")} />
			{:else}
				{#each [...sections] as [section, rows] (section)}
					<SectionLabel class="bg-background sticky top-0 border-b px-5 py-2.5">[{section}]</SectionLabel>
					{#each rows as s (keyOf(s))}
						<div class="border-line-subtle grid gap-x-6 gap-y-2 border-b px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
							<div class="flex min-w-0 flex-col gap-1">
								<span class="text-row font-mono font-medium break-all">{s.key}</span>
								{#if s.description}<p class="text-muted-foreground text-xs leading-snug">{s.description}</p>{/if}
								{#if s.acceptableValues}<p class="text-subtle-foreground font-mono text-[11px]">{s.acceptableValues}</p>{/if}
							</div>
							<div class="flex flex-col gap-1">
								{#if editable && isBool(s)}
									<Switch checked={valueOf(s).toLowerCase() === "true"} onCheckedChange={(v) => (edits[keyOf(s)] = v ? "true" : "false")} aria-label={s.key} />
								{:else if editable}
									<Input value={valueOf(s)} oninput={(e) => (edits[keyOf(s)] = e.currentTarget.value)} class="font-mono" aria-label={s.key} />
								{:else}
									<span class="cell-mono break-all whitespace-normal">{s.value}</span>
								{/if}
								{#if s.defaultValue !== undefined && s.defaultValue !== valueOf(s)}
									<span class="text-subtle-foreground font-mono text-[11px]">{t("configs.default", { v: s.defaultValue })}</span>
								{/if}
							</div>
						</div>
					{/each}
				{/each}
			{/if}
		</div>
	</section>
</div>
