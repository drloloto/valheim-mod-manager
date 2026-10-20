<script lang="ts">
	// The transfer assistant: a server's mod list or another profile as the source, a profile as the target,
	// every mod sorted into its case with a decision where there is one, then one apply. Opened by a fresh
	// server link (target preselected, straight to the review), "Copy mods…" and "Compare with server…".
	import { SvelteMap } from "svelte/reactivity";
	import { Button, Checkbox, Dialog, Input, Label, ModAvatar, SectionLabel, Segmented, Select, Stat } from "#lib/components/kit/index.js";
	import type { SegmentOption } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { TransferDecision, TransferItem, TransferKind, TransferPlan } from "#lib/api/types.js";
	import { decisionOf, groupItems, summarize, toChoices } from "#lib/transfer-view.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const req = $derived(store.transfer);
	const open = $derived(req !== null);

	let step = $state<"setup" | "review">("setup");
	let kind = $state<TransferKind>("server");
	let source = $state("");
	let targetMode = $state<"existing" | "new">("existing");
	let target = $state("");
	let newName = $state("");
	let withConfigs = $state(true);
	let install = $state(true);
	let plan = $state<TransferPlan | null>(null);
	let planning = $state(false);
	let busy = $state(false);
	const choices = new SvelteMap<string, TransferDecision>();

	// Every open starts from the request: a link hands over source and target and goes straight to the review.
	$effect(() => {
		const r = req;
		if (!r) return;
		kind = r.kind;
		source = r.source;
		targetMode = r.target ? "existing" : "new";
		target = r.target ?? (kind === "server" ? r.source : (store.state.profiles.find((p) => p !== r.source) ?? ""));
		newName = "";
		plan = null;
		choices.clear();
		step = "setup";
		if (r.target) void review();
	});

	const profiles = $derived(store.state.profiles);
	/** Profiles with a server link: the active one, and those the start-up check saw. */
	const linked = $derived([...new Set([...(store.server && store.state.active ? [store.state.active] : []), ...Object.keys(store.serverChecks)])]);
	const sources = $derived(kind === "server" ? linked : profiles);
	const targets = $derived(kind === "server" ? profiles : profiles.filter((p) => p !== source));
	const canReview = $derived(!!source && (targetMode === "new" || !!target) && !planning);
	const sourceLabel = (p: string) => (kind === "server" ? t("transfer.serverOf", { name: p }) : p);
	const targetLabel = $derived(targetMode === "new" ? t("transfer.newTarget", { name: newName.trim() || plan?.sourceName || source }) : target);

	const groups = $derived(plan ? groupItems(plan.items) : []);
	const sum = $derived(plan ? summarize(plan.items, choices) : null);
	const changes = $derived(sum ? sum.install + sum.change + sum.remove + sum.lock : 0);

	function hintOf(c: TransferItem["case"]): string {
		if (c === "dropped" || c === "extra" || c === "optional") return t(`transfer.hint.${c}`);
		return t(`transfer.hint.${c}.${kind}`);
	}
	/** What a choice means for this item: "remove" for a dropped mod's take, "copy" for a profile add … */
	function label(i: TransferItem, d: TransferDecision): string {
		if (i.case === "dropped") return d === "take" ? t("transfer.d.remove") : t("transfer.d.keepMine");
		if (i.case === "optional") {
			if (i.from === null) return d === "take" ? t("transfer.d.install") : t("transfer.d.skip");
			return d === "take" ? `${t("transfer.d.take")} ${i.to}` : `${t("transfer.d.keep")} ${i.from}`;
		}
		if (i.case === "add" && kind === "profile") return d === "take" ? t("transfer.d.copy") : t("transfer.d.skip");
		if (i.case === "version" && kind === "profile") return d === "take" ? `${t("transfer.d.take")} ${i.to}` : `${t("transfer.d.keep")} ${i.from}`;
		return t(`transfer.d.${d}`);
	}
	const options = (i: TransferItem): SegmentOption[] => i.choices.map((d) => ({ value: d, label: label(i, d) }));
	function versionText(i: TransferItem): string {
		if (i.case === "version" || (i.case === "optional" && i.from && i.from !== i.to)) return `${i.from} → ${i.to}`;
		return i.to ?? i.from ?? "";
	}

	async function review() {
		planning = true;
		try {
			plan = await store.planTransfer(kind, source, targetMode === "existing" ? target : null);
			if (plan) step = "review";
		} finally {
			planning = false;
		}
	}

	async function run() {
		busy = true;
		try {
			const ok = await store.runTransfer(
				kind,
				source,
				targetMode === "existing" ? target : null,
				targetMode === "new" ? newName.trim() || null : null,
				toChoices(choices),
				kind === "server" && withConfigs,
				install,
			);
			if (ok) close();
		} finally {
			busy = false;
		}
	}

	function close() {
		store.transfer = null;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && close()}>
	<Dialog.Content class="flex max-h-[min(680px,calc(100vh-48px))] flex-col gap-0 p-0 sm:max-w-[720px]">
		<Dialog.Header class="space-y-1 border-b px-5 py-3 pr-12">
			<Dialog.Title class="text-base">{t("transfer.title")}</Dialog.Title>
			<Dialog.Description class="text-xs">
				{#if step === "review" && plan}
					{t("transfer.fromTo", { source: plan.sourceName, target: targetLabel })}
				{:else}
					{t("transfer.desc")}
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="scroll-y @container min-h-0 flex-1 px-5 py-4">
			{#if step === "setup"}
				<!-- Step 1: source and target, same rows as the settings pages. -->
				<div class="border-line-subtle grid grid-cols-1 gap-x-6 gap-y-2 border-b py-4 @lg:grid-cols-[var(--spacing-label)_minmax(0,1fr)]">
					<div class="flex min-w-0 flex-col gap-1">
						<span class="text-row font-semibold">{t("transfer.source")}</span>
						<p class="text-muted-foreground text-xs leading-snug">{t("transfer.sourceHint")}</p>
					</div>
					<div class="grid max-w-[420px] gap-2">
						<Segmented
							bind:value={
								() => kind,
								(v) => {
									kind = v as TransferKind;
									source = (v === "server" ? linked : profiles)[0] ?? "";
									target = v === "server" ? source : (profiles.find((p) => p !== source) ?? "");
								}
							}
							options={[
								{ value: "server", label: t("transfer.sourceServer") },
								{ value: "profile", label: t("transfer.sourceProfile") },
							]}
							columns={2}
						/>
						{#if kind === "server" && !linked.length}
							<p class="text-muted-foreground text-xs">{t("transfer.noServer")}</p>
						{:else}
							<Select.Root type="single" value={source} onValueChange={(v) => (source = v)}>
								<Select.Trigger class="w-full">{source ? sourceLabel(source) : "—"}</Select.Trigger>
								<Select.Content>
									{#each sources as p (p)}<Select.Item value={p} label={sourceLabel(p)} />{/each}
								</Select.Content>
							</Select.Root>
						{/if}
					</div>
				</div>
				<div class="grid grid-cols-1 gap-x-6 gap-y-2 py-4 @lg:grid-cols-[var(--spacing-label)_minmax(0,1fr)]">
					<div class="flex min-w-0 flex-col gap-1">
						<span class="text-row font-semibold">{t("transfer.target")}</span>
						<p class="text-muted-foreground text-xs leading-snug">{kind === "server" ? t("transfer.targetHintServer") : t("transfer.targetHintProfile")}</p>
					</div>
					<div class="grid max-w-[420px] gap-2">
						<Segmented
							bind:value={() => targetMode, (v) => (targetMode = v as "existing" | "new")}
							options={[
								{ value: "existing", label: t("transfer.targetExisting") },
								{ value: "new", label: t("transfer.targetNew") },
							]}
							columns={2}
						/>
						{#if targetMode === "existing"}
							<Select.Root type="single" value={target} onValueChange={(v) => (target = v)}>
								<Select.Trigger class="w-full">{target || "—"}</Select.Trigger>
								<Select.Content>
									{#each targets as p (p)}<Select.Item value={p} label={p} />{/each}
								</Select.Content>
							</Select.Root>
						{:else}
							<Label for="transfer-name" class="sr-only">{t("transfer.newName")}</Label>
							<Input id="transfer-name" bind:value={newName} placeholder={t("transfer.newName")} />
						{/if}
					</div>
				</div>
			{:else if plan && sum}
				<!-- Step 2: the review. Counts first, then every mod in its group with its choice. -->
				<div class="grid grid-cols-3 gap-3 border-b pb-4 @md:grid-cols-5">
					<Stat label={t("transfer.sumInstall")} value={String(sum.install)} />
					<Stat label={t("transfer.sumChange")} value={String(sum.change)} />
					<Stat label={t("transfer.sumRemove")} value={String(sum.remove)} />
					<Stat label={t("transfer.sumKeep")} value={String(sum.keep)} />
					{#if kind === "server"}<Stat label={t("transfer.sumLock")} value={String(sum.lock)} />{/if}
				</div>
				{#if !changes}
					<p class="text-muted-foreground py-4 text-sm">{t("transfer.nothing")}</p>
				{/if}
				{#each groups as g (g.case)}
					<SectionLabel class="pt-5">
						{t(`transfer.case.${g.case}`)}
						<span class="text-muted-foreground ml-1.5 font-mono font-normal">{g.items.length}</span>
					</SectionLabel>
					<p class="text-muted-foreground border-b pt-0.5 pb-2 text-xs">{hintOf(g.case)}</p>
					<ul class="divide-line-subtle divide-y">
						{#each g.items as i (i.id)}
							{@const p = store.byId.get(i.id)}
							<li class="flex min-h-10 items-center gap-3 py-1.5">
								<ModAvatar name={i.name} icon={p?.icon} size="sm" />
								<div class="flex min-w-0 flex-1 flex-col">
									<span class="text-row truncate font-semibold">{p?.name ?? i.name}</span>
									<span class="text-muted-foreground truncate text-xs">
										{i.ns}
										{#if i.local}· {t("transfer.local")}{/if}
										{#if i.locked}· {t("transfer.locked")}{/if}
										{#if i.case === "extra" && i.side === "server"}· <span class="text-primary-text">{t("transfer.serverSide")}</span>
										{:else if i.case === "extra" && i.side === "client"}· {t("transfer.clientSide")}{/if}
									</span>
								</div>
								<span class="text-foreground-soft shrink-0 font-mono text-xs">{versionText(i)}</span>
								{#if i.choices.length > 1}
									<Segmented
										size="sm"
										class="shrink-0"
										options={options(i)}
										bind:value={() => decisionOf(i, choices), (v) => choices.set(i.id, v as TransferDecision)}
									/>
								{:else if i.managed}
									<span class="text-muted-foreground w-[96px] shrink-0 text-right text-xs">{t("transfer.managed")}</span>
								{:else if i.case === "optional"}
									<span class="text-muted-foreground w-[96px] shrink-0 text-right text-xs">{t("source.optional")}</span>
								{:else}
									<span class="w-[96px] shrink-0"></span>
								{/if}
							</li>
						{/each}
					</ul>
				{/each}
				<div class="text-muted-foreground grid gap-1.5 pt-5 text-xs">
					{#if sum.serverSideKept}<p class="text-primary-text">{t("transfer.warnServerSide", { n: sum.serverSideKept })}</p>{/if}
					<p>{plan.targetExists ? t("transfer.backup", { name: target }) : t("transfer.backupNew")}</p>
					{#if kind === "server" && sum.lock}<p>{t("transfer.lockNote")}</p>{/if}
				</div>
				<div class="grid gap-2 pt-4 text-sm">
					{#if kind === "server"}
						<label class="flex items-center gap-2">
							<Checkbox bind:checked={withConfigs} />
							{t("server.adoptConfigs")}
						</label>
					{/if}
					<label class="flex items-center gap-2">
						<Checkbox bind:checked={install} />
						{t("import.installAll")}
					</label>
				</div>
			{:else}
				<p class="text-muted-foreground py-4 text-sm">{t("transfer.planning")}</p>
			{/if}
		</div>

		<div class="flex items-center gap-2 border-t px-5 py-3">
			{#if step === "review"}
				<Button variant="ghost" disabled={busy} onclick={() => (step = "setup")}>{t("transfer.back")}</Button>
			{/if}
			<div class="flex-1"></div>
			<Button variant="outline" disabled={busy} onclick={close}>{t("common.cancel")}</Button>
			{#if step === "setup"}
				<Button disabled={!canReview} onclick={review}>{planning ? t("transfer.planning") : t("transfer.next")}</Button>
			{:else}
				<Button disabled={busy || !plan} onclick={run}>{busy ? t("transfer.running") : t("transfer.run")}</Button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
