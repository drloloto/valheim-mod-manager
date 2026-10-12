<script lang="ts">
	import { Button, Checkbox, Dialog, Input, Label, Select } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { ApplyWhen, ServerDiscovery } from "#lib/api/types.js";
	import { formatDateTime } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";

	// Three small dialogs over the same state: link a server, publish to it, resolve a pre-play difference.
	// The address field shows the linked server until the user edits it; closing discards the edits.
	let urlEdit = $state<string | null>(null);
	let token = $state("");
	let withConfigs = $state(true);
	let installAll = $state(true);
	let busy = $state(false);
	let atValue = $state("");
	let adoptConfigs = $state(true);
	let discovery = $state.raw<ServerDiscovery | null>(null);
	/** Gist links: when the server applies the published release. */
	let gistWhen = $state<ApplyWhen>("idle");
	const WHEN: ApplyWhen[] = ["now", "idle", "at", "none"];
	const whenLabel = (w: ApplyWhen) => t(w === "now" ? "server.whenNow" : w === "idle" ? "server.whenIdle" : w === "at" ? "server.whenAt" : "server.whenNone");

	const mode = $derived(store.serverDialog);
	const open = $derived(mode !== null);
	const check = $derived(store.serverStatus);
	/** A release staged in this session, or one already waiting on the server. */
	const staged = $derived(store.staged);
	const pending = $derived(staged?.summary ?? check?.release ?? null);
	const online = $derived(staged?.online ?? check?.online ?? null);

	async function stage() {
		busy = true;
		try {
			await store.publish(withConfigs);
		} finally {
			busy = false;
		}
	}
	const url = $derived(urlEdit ?? (mode === "add" ? "" : (store.server?.url ?? "")));
	const serverName = $derived(check?.name || store.server?.name || store.server?.url || "");

	async function discover() {
		if (!url.trim() || busy) return;
		busy = true;
		try {
			discovery = await store.discoverServer(url.trim());
		} finally {
			busy = false;
		}
	}
	/** The admin switched publishing off on the companion (COMPANION_ALLOW_PUBLISH=false). */
	const publishOff = $derived(check?.reachable === true && check.features?.publish === false);
	/** Thunderstore's "Server-side" / "Client-side" categories: a server-side mod missing on the server cannot work. */
	function side(id: string): "server" | "client" | null {
		const cats = store.byId.get(id)?.cats ?? [];
		if (cats.includes("Server-side") && !cats.includes("Client-side")) return "server";
		if (cats.includes("Client-side") && !cats.includes("Server-side")) return "client";
		return null;
	}
	const nameOf = (id: string) => store.byId.get(id)?.name ?? id;

	function close() {
		store.serverDialog = null;
		urlEdit = null;
		token = "";
		discovery = null;
	}

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		try {
			await fn();
			close();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && close()}>
	<Dialog.Content class="sm:max-w-md">
		{#if mode === "link"}
			<Dialog.Header>
				<Dialog.Title>{t("server.linkTitle")}</Dialog.Title>
				<Dialog.Description>{t("server.linkDesc")}</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-4">
				<div class="grid gap-2">
					<Label for="server-url">{t("server.url")}</Label>
					<Input id="server-url" value={url} oninput={(e) => (urlEdit = e.currentTarget.value)} placeholder="http://10.10.10.123:9002 / vmm1.…" />
				</div>
				<div class="grid gap-2">
					<Label for="server-token">{t("server.token")}</Label>
					<Input id="server-token" type="password" bind:value={token} placeholder={store.server?.hasToken ? "••••••••" : ""} autocomplete="off" />
				</div>
			</div>
			<Dialog.Footer>
				{#if store.server}
					<Button variant="ghost" disabled={busy} onclick={() => run(() => store.unlinkServer())}>{t("server.unlink")}</Button>
				{/if}
				<Button variant="outline" onclick={close}>{t("common.cancel")}</Button>
				<Button disabled={busy || !url.trim()} onclick={() => run(() => store.linkServer(url.trim(), token.trim()))}>{t("server.save")}</Button>
			</Dialog.Footer>
		{:else if mode === "publish"}
			<Dialog.Header>
				<Dialog.Title>{t("server.publishTitle", { name: serverName })}</Dialog.Title>
				<Dialog.Description>{store.server?.gist ? t("server.gistDesc") : pending ? t("server.stagedDesc") : t("server.publishDesc")}</Dialog.Description>
			</Dialog.Header>
			{#if store.server?.gist}
				<!-- Gist transport: publish and schedule in one step; the companion answers through server.json. -->
				<div class="grid gap-3 text-sm">
					{#if check?.reachable}
						{#if check.inSync}
							<p class="text-muted-foreground">{t("server.identical")}</p>
						{:else}
							<ul class="text-foreground-soft grid gap-1 text-xs">
								{#each check.diff.changed as c (c.id)}<li>{t("server.changed", { id: nameOf(c.id), local: c.local, server: c.server })}</li>{/each}
								{#each check.diff.onlyLocal as m (m.id)}<li>{t("server.willInstall", { id: nameOf(m.id), version: m.version })}</li>{/each}
								{#each check.diff.onlyServer as m (m.id)}<li>{t("server.willRemove", { id: nameOf(m.id), version: m.version })}</li>{/each}
								{#if check.configsChanged.length}<li>{t("server.configsChanged", { n: check.configsChanged.length })}</li>{/if}
							</ul>
						{/if}
					{:else if check}
						<p class="text-destructive-text">{t("server.unreachable", { error: check.error ?? "" })}</p>
					{/if}
					{#if check?.gistRelease}
						{@const r = check.gistRelease}
						<p class="text-muted-foreground text-xs">
							{t("server.gistStatus", { id: r.id, state: r.state })}
							{#if r.plan}
								· {t("server.planInstall", { n: r.plan.install })}, {t("server.planRemove", { n: r.plan.remove })}, {t("server.planConfigs", {
									n: r.plan.configs,
								})}
							{/if}
							{#if r.error}· {r.error}{/if}
						</p>
						{#if r.problems.length}
							<div class="text-destructive-text text-xs">
								<p class="font-semibold">{t("server.problems")}</p>
								{#each r.problems as p (p)}<p>{p}</p>{/each}
							</div>
						{/if}
					{:else if check?.reachable}
						<p class="text-muted-foreground text-xs">{t("server.gistNone")}</p>
					{/if}
					{#if !store.server?.hasGistToken}
						<p class="text-destructive-text">{t("server.noGistToken")}</p>
					{/if}
					<label class="flex items-center gap-2">
						<Checkbox bind:checked={withConfigs} />
						{t("server.withConfigs")}
					</label>
					<div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
						<Label for="gist-when">{t("server.gistWhen")}</Label>
						<Select.Root type="single" value={gistWhen} onValueChange={(v) => (gistWhen = v as ApplyWhen)}>
							<Select.Trigger id="gist-when" class="w-full">{whenLabel(gistWhen)}</Select.Trigger>
							<Select.Content>
								{#each WHEN as w (w)}<Select.Item value={w} label={whenLabel(w)} />{/each}
							</Select.Content>
						</Select.Root>
						{#if gistWhen === "at"}
							<span></span>
							<Input type="datetime-local" bind:value={atValue} />
						{/if}
					</div>
				</div>
				<Dialog.Footer>
					<Button variant="ghost" disabled={busy || store.serverChecking} onclick={() => store.refreshServerStatus()}>{t("server.checkNow")}</Button>
					<Button variant="outline" onclick={close}>{t("common.cancel")}</Button>
					<Button
						disabled={busy || !store.server?.hasGistToken || (gistWhen === "at" && !atValue)}
						onclick={() => run(() => store.publishGist(withConfigs, gistWhen, gistWhen === "at" ? new Date(atValue).getTime() : null))}
						>{t("server.publishGist")}</Button
					>
				</Dialog.Footer>
			{:else if pending}
				<!-- Step 2: the server pulled and checked everything; the admin decides when players get the restart. -->
				<div class="grid gap-3 text-sm">
					<ul class="text-foreground-soft grid gap-1 text-xs">
						<li>{t("server.planInstall", { n: pending.install })}</li>
						<li>{t("server.planRemove", { n: pending.remove })}</li>
						<li>{t("server.planConfigs", { n: pending.configs })}</li>
						{#if staged}
							{#each staged.release.plan.install as i (i.id)}<li class="pl-3">{nameOf(i.id)}: {i.from ? `${i.from} → ` : ""}{i.to}</li>{/each}
							{#each staged.release.plan.remove as id (id)}<li class="pl-3">− {nameOf(id)}</li>{/each}
						{/if}
					</ul>
					{#if pending.problems.length}
						<div class="text-destructive-text text-xs">
							<p class="font-semibold">{t("server.problems")}</p>
							{#each pending.problems as p (p)}<p>{p}</p>{/each}
						</div>
					{/if}
					{#if pending.lastError}<p class="text-destructive-text text-xs">{pending.lastError}</p>{/if}
					<p class="text-muted-foreground text-xs">
						{online === null ? t("server.onlineUnknown") : t("server.online", { n: online })}
						{#if pending.schedule}
							· {t("server.scheduled", {
								what: pending.schedule.when === "idle" ? t("server.scheduleIdle") : t("server.scheduleAt", { time: formatDateTime(pending.schedule.at ?? 0) }),
							})}
						{/if}
					</p>
					<div class="flex items-center gap-2">
						<Input type="datetime-local" class="max-w-[220px]" bind:value={atValue} />
						<Button
							size="sm"
							variant="outline"
							disabled={busy || !atValue}
							onclick={() => run(() => store.applyRelease(pending.id, "at", new Date(atValue).getTime()))}>{t("server.applyAt")}</Button
						>
						{#if pending.schedule}
							<Button size="sm" variant="ghost" disabled={busy} onclick={() => run(() => store.applyRelease(pending.id, "none"))}
								>{t("server.clearSchedule")}</Button
							>
						{/if}
					</div>
				</div>
				<Dialog.Footer>
					<Button variant="ghost" disabled={busy} onclick={() => run(() => store.discardRelease(pending.id))}>{t("server.discard")}</Button>
					<Button variant="outline" onclick={close}>{t("server.keepPending")}</Button>
					<Button variant="outline" disabled={busy || online === null} onclick={() => run(() => store.applyRelease(pending.id, "idle"))}
						>{t("server.applyIdle")}</Button
					>
					<Button variant="destructive" disabled={busy} onclick={() => run(() => store.applyRelease(pending.id, "now"))}>{t("server.applyNow")}</Button>
				</Dialog.Footer>
			{:else}
				<!-- Step 1: what would change, then "pull to server and check". -->
				<div class="grid gap-3 text-sm">
					{#if check?.reachable}
						{#if check.inSync}
							<p class="text-muted-foreground">{t("server.identical")}</p>
						{:else}
							<ul class="text-foreground-soft grid gap-1 text-xs">
								{#each check.diff.changed as c (c.id)}<li>{t("server.changed", { id: nameOf(c.id), local: c.local, server: c.server })}</li>{/each}
								{#each check.diff.onlyLocal as m (m.id)}<li>{t("server.willInstall", { id: nameOf(m.id), version: m.version })}</li>{/each}
								{#each check.diff.onlyServer as m (m.id)}<li>{t("server.willRemove", { id: nameOf(m.id), version: m.version })}</li>{/each}
							</ul>
						{/if}
					{:else if check}
						<p class="text-destructive-text">{t("server.unreachable", { error: check.error ?? "" })}</p>
					{/if}
					{#if publishOff}
						<p class="text-destructive-text">{t("server.publishDisabled")}</p>
					{:else if !store.server?.hasToken}
						<p class="text-destructive-text">{t("server.noToken")}</p>
					{/if}
					<label class="flex items-center gap-2">
						<Checkbox bind:checked={withConfigs} />
						{t("server.withConfigs")}
					</label>
				</div>
				<Dialog.Footer>
					<Button variant="outline" onclick={close}>{t("common.cancel")}</Button>
					<Button disabled={busy || !store.server?.hasToken || publishOff} onclick={() => stage()}>{busy ? t("server.staging") : t("server.stage")}</Button>
				</Dialog.Footer>
			{/if}
		{:else if mode === "diff" && check}
			<!-- Before Play (or from the status bar): the server moved on. Like a modpack update: take it, take it into a copy, or play as is. -->
			<Dialog.Header>
				<Dialog.Title>{t("server.diffTitle", { name: serverName })}</Dialog.Title>
				<Dialog.Description>{t("server.diffDesc")}</Dialog.Description>
			</Dialog.Header>
			<ul class="text-foreground-soft grid gap-1 text-xs">
				{#each check.diff.changed as c (c.id)}<li>{t("server.changed", { id: nameOf(c.id), local: c.local, server: c.server })}</li>{/each}
				{#each check.diff.onlyServer as m (m.id)}
					<li>
						{t("server.onlyServer", { id: nameOf(m.id), version: m.version })}
						{#if side(m.id) === "client"}<span class="text-muted-foreground">· {t("server.clientSideHint")}</span>{/if}
					</li>
				{/each}
				{#each check.diff.onlyLocal as m (m.id)}
					<li class={side(m.id) === "server" ? "text-primary" : ""}>
						{t("server.onlyLocal", { id: nameOf(m.id), version: m.version })}
						{#if side(m.id) === "server"}· {t("server.serverSideHint")}{/if}
					</li>
				{/each}
				{#each check.configsChanged as p (p)}<li>{t("server.configChanged", { path: p })}</li>{/each}
			</ul>
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={adoptConfigs} />
				{t("server.adoptConfigs")}
			</label>
			<Dialog.Footer>
				{#if store.serverAdmin}
					<Button variant="ghost" disabled={busy} onclick={() => (store.serverDialog = "publish")}>{t("server.publishInstead")}</Button>
				{/if}
				<Button variant="ghost" disabled={busy} onclick={() => run(() => store.launch(true))}>{t("server.startAnyway")}</Button>
				<Button variant="outline" disabled={busy} onclick={() => run(() => store.adoptServer(false, adoptConfigs, serverName || "Server"))}
					>{t("server.adoptIntoNew")}</Button
				>
				<Button disabled={busy} onclick={() => run(() => store.adoptServer(true, adoptConfigs))}>{t("server.adoptAndStart")}</Button>
			</Dialog.Footer>
		{:else if mode === "add"}
			<!-- "Autoconfig": paste an address, see what it is, get a ready profile. -->
			<Dialog.Header>
				<Dialog.Title>{t("server.addTitle")}</Dialog.Title>
				<Dialog.Description>{t("server.addDesc")}</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-3">
				<div class="flex gap-2">
					<Input
						value={url}
						oninput={(e) => (urlEdit = e.currentTarget.value)}
						placeholder="10.10.10.123:9002 / vmm1.…"
						onkeydown={(e) => e.key === "Enter" && discover()}
					/>
					<Button variant="outline" disabled={busy || !url.trim()} onclick={discover}>{busy ? t("server.checking") : t("server.check")}</Button>
				</div>
				{#if discovery}
					<p class="text-sm">
						<span class="font-semibold">{discovery.name || discovery.url || discovery.syncCode}</span>
						{#if discovery.world}· {discovery.world}{/if}
						· {t("server.discoveredMods", { n: discovery.mods })}
					</p>
					{#if discovery.features.modManager === false}<p class="text-destructive-text text-xs">{t("server.noModManager")}</p>{/if}
				{/if}
				<div class="grid gap-1">
					<label class="flex items-center gap-2 text-sm">
						<Checkbox bind:checked={installAll} />
						{t("import.installAll")}
					</label>
					<p class="text-muted-foreground pl-6 text-xs">{t("import.installAllHint")}</p>
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={close}>{t("common.cancel")}</Button>
				<Button disabled={busy || !discovery || discovery.features.modManager === false} onclick={() => run(() => store.addServer(discovery!, installAll))}
					>{t("server.createProfile")}</Button
				>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
