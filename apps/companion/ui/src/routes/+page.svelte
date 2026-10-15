<script lang="ts">
	import CopyIcon from "@lucide/svelte/icons/copy";
	import DownloadIcon from "@lucide/svelte/icons/download";
	import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
	import { toast } from "svelte-sonner";
	import { Button, ConfirmDialog, EmptyState, Input, Label, SectionLabel, Stat } from "#lib/components/kit/index.js";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { bytes, relative, thunderstoreUrl } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { Manifest, SyncInfo, TakeoverInfo } from "#lib/types.js";

	let manifest = $state<Manifest | null>(null);
	let loadError = $state<string | null>(null);
	let sync = $state<SyncInfo | null>(null);
	let gistToken = $state("");
	let syncBusy = $state(false);
	let removeOpen = $state(false);

	const s = $derived(session.status);
	const base = $derived(s?.companion.publicUrl || (typeof location === "undefined" ? "" : location.origin));
	const name = $derived(s?.server.name || "Valheim Server");
	const scheme = $derived(s?.companion.scheme || "valheim-mod-manager");
	const code = $derived(sync?.enabled ? sync.code : null);
	// With a sync code the client links through the gist and never needs this address; the r2z url and the
	// address stay in the link for Mod Managers that do not know the code yet.
	const deepLink = $derived(
		`${scheme}://import?${code ? `code=${encodeURIComponent(code)}&` : ""}url=${encodeURIComponent(`${base}/api/profile.r2z`)}&name=${encodeURIComponent(name)}&link=${encodeURIComponent(base)}`,
	);

	// The invite: the server's identity only (sync code + name), never this companion's address. The code lets a
	// Mod Manager read the lock and the configs; writing needs the admin's gist token, which no invite carries.
	const inviteLink = $derived.by(() => {
		if (!code) return null;
		const q = `code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
		const base = s?.companion.inviteUrl;
		return base ? `${base}#${q}` : `${scheme}://import?${q}`;
	});

	// Reload the list when the published lock changes (a primitive, so the 15 s status poll does not refetch).
	const hash = $derived(s?.manifest?.hash);
	$effect(() => {
		if (!hash) return;
		api<Manifest>("/manifest")
			.then((m) => ((manifest = m), (loadError = null)))
			.catch((e) => (loadError = (e as Error).message));
	});

	// The sync details when the status says the sync is on, or the admin is signed in (the setup card).
	const syncOn = $derived(s?.sync?.enabled ?? false);
	const ready = $derived(!!s);
	$effect(() => {
		if (!ready) return;
		void syncOn;
		void session.authed;
		api<SyncInfo>("/sync")
			.then((i) => (sync = i))
			.catch(() => (sync = null));
	});

	// An empty lock on a server with mods in plugins/: say what lies there and let the admin take it over.
	let takeoverInfo = $state<TakeoverInfo | null>(null);
	let takeoverBusy = $state(false);
	const lockEmpty = $derived(!!manifest && !manifest.mods.length);
	$effect(() => {
		if (!lockEmpty) {
			takeoverInfo = null;
			return;
		}
		api<TakeoverInfo>("/takeover")
			.then((i) => (takeoverInfo = i))
			.catch(() => (takeoverInfo = null));
	});

	async function runTakeover() {
		takeoverBusy = true;
		const r = await attempt(() => api<TakeoverInfo>("/takeover", { method: "POST" }));
		takeoverBusy = false;
		if (!r) return;
		takeoverInfo = r;
		if (r.lock) toast.success(t("takeover.done", { n: r.lock }));
		session.refresh();
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t("common.copied"));
		} catch {
			toast.error(t("common.copyFailed"));
		}
	}

	async function setupSync(e: SubmitEvent) {
		e.preventDefault();
		syncBusy = true;
		const r = await attempt(() => api<SyncInfo>("/sync", { method: "POST", body: { token: gistToken.trim() } }));
		syncBusy = false;
		if (!r) return;
		sync = r;
		gistToken = "";
		toast.success(t("sync.created"));
		session.refresh();
	}

	async function removeSync() {
		const r = await attempt(() => api<SyncInfo>("/sync", { method: "DELETE" }));
		if (!r) return;
		sync = r;
		toast.success(t("sync.removed"));
		session.refresh();
	}
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6">
	{#if s && session.on("modManager")}
		<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
			<div class="flex flex-col gap-1">
				<h1 class="text-lg font-semibold">{t("home.title")}</h1>
				<p class="text-muted-foreground max-w-2xl">{t("home.lead")}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button href={deepLink} data-testid="open-in-mod-manager"><ExternalLinkIcon />{t("home.open")}</Button>
				<Button variant="outline" href="/api/profile.r2z" download><DownloadIcon />{t("home.download")}</Button>
			</div>
			<p class="text-muted-foreground text-xs leading-relaxed">
				{t("home.noManager")}
				<a
					class="text-primary-text underline underline-offset-2"
					href="https://github.com/drloloto/valheim-mod-manager/releases/latest"
					rel="noopener noreferrer">{t("home.downloadManager")}</a
				>.
				{#if code}
					{t("home.codeHint")}
					<button
						type="button"
						class="bg-field hover:bg-hover inline-flex max-w-full items-center gap-1 rounded px-1.5 font-mono break-all"
						data-testid="sync-code"
						onclick={() => copy(code)}>{code}<CopyIcon class="size-3 shrink-0" /></button
					>
				{:else}
					{t("home.linkHint")}
					<button type="button" class="bg-field hover:bg-hover inline-flex items-center gap-1 rounded px-1.5 font-mono" onclick={() => copy(base)}
						>{base}<CopyIcon class="size-3" /></button
					>
				{/if}
			</p>
			{#if inviteLink}
				<div class="bg-field flex flex-col gap-2 rounded-md p-3 text-sm" data-testid="invite">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="font-semibold">{t("home.inviteTitle")}</span>
						<Button variant="outline" size="sm" onclick={() => copy(inviteLink)}><CopyIcon />{t("home.inviteCopy")}</Button>
					</div>
					<code class="font-mono text-xs break-all">{inviteLink}</code>
					<p class="text-muted-foreground text-xs leading-relaxed">{t("home.inviteHint")}</p>
				</div>
			{/if}
		</section>
	{/if}

	{#if s && session.authed && session.on("publish")}
		<section class="bg-panel flex flex-col gap-3 rounded-lg border p-5" data-testid="sync-setup">
			<div class="flex flex-col gap-1">
				<h2 class="font-semibold">{t("sync.title")}</h2>
				<p class="text-muted-foreground max-w-2xl text-sm leading-relaxed">{t("sync.lead")}</p>
			</div>
			{#if sync?.enabled}
				<p class="text-sm">
					{t("sync.enabled", { gist: sync.gistId ?? "?", source: sync.source === "env" ? t("sync.sourceEnv") : t("sync.sourcePage") })}
				</p>
				{#if !sync.canWrite}<p class="text-destructive-text text-sm">{t("sync.readOnly")}</p>{/if}
				{#if sync.release}<p class="text-muted-foreground text-xs">{t("sync.release", { id: sync.release.id, state: sync.release.state })}</p>{/if}
				{#if sync.lastError}<p class="text-destructive-text text-xs">{t("sync.lastError", { error: sync.lastError })}</p>{/if}
				{#if sync.source === "file"}
					<div><Button variant="outline" onclick={() => (removeOpen = true)}>{t("sync.remove")}</Button></div>
				{/if}
			{:else}
				<form onsubmit={setupSync} class="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div class="flex flex-1 flex-col gap-2">
						<Label for="gist-token">{t("sync.token")}</Label>
						<Input id="gist-token" type="password" autocomplete="off" spellcheck={false} bind:value={gistToken} />
					</div>
					<Button type="submit" disabled={syncBusy || !gistToken.trim()}>{t("sync.create")}</Button>
				</form>
			{/if}
		</section>
	{/if}

	{#if s}
		<section class="bg-panel grid grid-cols-2 gap-5 rounded-lg border p-5 sm:grid-cols-5">
			<Stat label={t("stat.server")} value={s.container ? (s.container.state === "running" ? t("status.running") : s.container.state) : "—"} />
			<Stat label={t("stat.world")} value={s.server.world || "—"} />
			<Stat label={t("stat.lastSave")} value={relative(s.world?.lastSave)} />
			<Stat label={t("stat.online")} value={s.online == null ? "—" : String(s.online)} />
			<Stat label={t("stat.worldSize")} value={s.world ? bytes(s.world.size) : "—"} />
		</section>
	{/if}

	<section class="bg-panel flex flex-col rounded-lg border">
		<SectionLabel class="border-b px-5 py-3">
			{t("home.mods")}{manifest ? ` · ${manifest.mods.length}` : ""}
		</SectionLabel>
		{#if !s?.manifest && s}
			<EmptyState title={t("home.readsLocked")}>{t("home.readsLockedHint")}</EmptyState>
		{:else if loadError}
			<EmptyState title={t("common.loadFailed")}>{loadError}</EmptyState>
		{:else if manifest && !manifest.mods.length}
			<EmptyState title={t("home.noMods")}>
				{t("home.noModsHint")}
				{#if takeoverInfo}
					<span class="block pt-2" data-testid="takeover">
						{#if takeoverInfo.scan.candidates.length}
							{t("takeover.found", { n: takeoverInfo.scan.candidates.length, ids: takeoverInfo.scan.candidates.map((c) => c.id).join(", ") })}
						{:else}
							{t("takeover.none")}
						{/if}
						{#if takeoverInfo.last?.unresolved.length}
							{t("takeover.unresolved", { names: takeoverInfo.last.unresolved.join("; ") })}
						{/if}
						{#if takeoverInfo.scan.unidentified.length}
							{t("takeover.unidentified", { names: takeoverInfo.scan.unidentified.join(", ") })}
						{/if}
					</span>
					{#if session.authed && session.on("publish") && takeoverInfo.scan.candidates.length}
						<span class="block pt-3"><Button variant="outline" disabled={takeoverBusy} onclick={runTakeover}>{t("takeover.run")}</Button></span>
					{/if}
				{/if}
			</EmptyState>
		{:else if manifest}
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead class="label-caps">
						<tr class="border-b">
							<th class="px-5 py-2 font-medium">{t("home.colMod")}</th>
							<th class="px-3 py-2 font-medium">{t("home.colVersion")}</th>
							<th class="px-5 py-2 font-medium max-sm:hidden">{t("home.colWhy")}</th>
						</tr>
					</thead>
					<tbody>
						{#each manifest.mods as m (m.id)}
							<tr class="border-line-subtle hover:bg-hover border-b last:border-b-0">
								<td class="text-row px-5 py-2">
									<a href={thunderstoreUrl(m.id)} target="_blank" rel="noopener noreferrer" class="hover:text-primary-text">{m.id}</a>
								</td>
								<td class="cell-mono px-3 py-2">{m.version}</td>
								<td class="cell-muted px-5 py-2 max-sm:hidden">
									{m.explicit ? "" : m.requiredBy.length ? t("home.depOf", { mods: m.requiredBy.join(", ") }) : t("home.dependency")}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<ConfirmDialog
	bind:open={removeOpen}
	title={t("sync.remove")}
	description={t("sync.removeConfirm")}
	confirmLabel={t("sync.remove")}
	destructive
	onconfirm={removeSync}
/>
