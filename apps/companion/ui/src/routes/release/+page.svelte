<script lang="ts">
	import { resolve } from "$app/paths";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { toast } from "svelte-sonner";
	import { Alert, Button, Checkbox, Collapsible, ConfirmDialog, EmptyState, Input, Label, SectionLabel, Segmented, Stat } from "#lib/components/kit/index.js";
	import SyncBadge from "#lib/components/config/sync-badge.svelte";
	import ModsTable from "#lib/components/release/mods-table.svelte";
	import Steps, { type Step } from "#lib/components/release/steps.svelte";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { dateTime, relative } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";
	import type { ApplyResponse, ConfigDiff as Diff, PendingDiff, Release, ReleaseSummary } from "#lib/types.js";

	// The release as four stations: the server now → the working state → the review → the release itself.
	let data = $state<PendingDiff | null>(null);
	let active = $state(1);
	let chosen = $state(false);
	let at = $state("");
	let backup = $state(true);
	let force = $state(false);
	let busy = $state(false);
	let diffMode = $state<"unified" | "split">("unified");
	let openFiles = $state<Record<string, boolean>>({});
	let result = $state<{ at: number; r: ApplyResponse } | null>(null);
	let confirm = $state<null | { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<void> }>(null);
	let confirmOpen = $state(false);

	const s = $derived(session.status);
	const release = $derived<Release | null>(data?.release ?? null);
	const sum = $derived<ReleaseSummary | null>(data?.summary ?? null);
	const plan = $derived(release?.plan ?? null);
	const files = $derived<Diff[]>(data?.files ?? []);
	const canRelease = $derived(session.authed && session.on("publish"));
	const blockedByConflicts = $derived(!!sum && sum.conflicts > 0 && !force);
	const ready = $derived(!!sum && !sum.empty && !blockedByConflicts);
	const restartWhy = $derived(
		plan
			? [
					plan.install.length || plan.remove.length ? t("release.s3.whyMods") : "",
					(() => {
						const needing = [...plan.configsChanged, ...plan.configsNew];
						return needing.length ? t("release.s3.whyConfigs", { files: needing.join(", ") }) : "";
					})(),
				].filter(Boolean)
			: [],
	);

	const steps = $derived<Step[]>([
		{ label: t("steps.current"), state: "done", hint: s?.manifest ? t("status.mods", { n: s.manifest.mods }) : undefined },
		{
			label: t("steps.working"),
			state: release ? "done" : "current",
			hint: sum ? t("release.summary", { install: sum.install, remove: sum.remove, configs: sum.configs }) : t("release.s2.none"),
		},
		{
			label: t("steps.review"),
			state: !release ? "blocked" : sum?.empty ? "blocked" : "done",
			hint: !release || sum?.empty ? t("steps.blocked") : sum?.problems.length || sum?.conflicts ? t("release.s3.problems") : t("steps.done"),
		},
		{
			label: t("steps.release"),
			state: ready ? "todo" : "blocked",
			hint: sum?.schedule ? (sum.schedule.when === "idle" ? t("release.idle") : dateTime(sum.schedule.at)) : ready ? undefined : t("steps.blocked"),
		},
	]);

	// Reload when the server reports another working state (a primitive key, so the 15 s status poll alone does not refetch).
	const releaseKey = $derived(`${s?.release?.id ?? ""}:${s?.release?.updatedAt ?? ""}:${s?.release?.schedule?.setAt ?? ""}`);
	$effect(() => {
		void releaseKey;
		if (canRelease) load();
	});

	async function load() {
		data = await attempt(() => api<PendingDiff>("/releases/pending/diff"));
		if (!chosen) active = !data?.release ? 1 : data.summary?.empty ? 1 : 2;
	}

	function select(i: number) {
		chosen = true;
		active = i;
	}

	function ask(c: NonNullable<typeof confirm>) {
		confirm = c;
		confirmOpen = true;
	}

	async function apply(when: "now" | "idle" | "at" | "none") {
		if (!sum) return;
		const atMs = when === "at" ? new Date(at).getTime() : undefined;
		if (when === "at" && !atMs) {
			toast.error(t("release.pickTime"));
			return;
		}
		busy = true;
		const r = await attempt(() =>
			api<ApplyResponse>(`/releases/${encodeURIComponent(sum.id)}/apply`, { method: "POST", body: { when, at: atMs, backup, force } }),
		);
		busy = false;
		if (r?.applied) {
			result = { at: Date.now(), r };
			if (r.nothingToDo) toast.success(t("release.s4.nothing"));
			else toast.success(t("release.applied", { installed: r.result?.installed.length ?? 0, removed: r.result?.removed.length ?? 0 }));
			for (const e of r.result?.errors ?? []) toast.error(e);
			if (r.started && !r.started.ok) toast.error(r.started.message);
			chosen = false;
		} else if (r) toast.success(when === "none" ? t("release.cleared") : t("release.scheduled"));
		await Promise.all([load(), session.refresh()]);
	}

	async function discard() {
		if (!sum) return;
		await attempt(() => api(`/releases/${encodeURIComponent(sum.id)}`, { method: "DELETE" }));
		chosen = false;
		await Promise.all([load(), session.refresh()]);
	}

	async function revertFile(path: string) {
		await attempt(() => api(`/releases/pending/configs/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" }));
		await Promise.all([load(), session.refresh()]);
	}
	async function revertMods() {
		await attempt(() => api("/releases/pending/mods", { method: "DELETE" }));
		await Promise.all([load(), session.refresh()]);
	}

	const configHref = (path: string) => `${resolve("/configs")}#${encodeURIComponent(path)}`;
	const sourceOf = (src: "client" | "web" | "gist" | null) => (src ? t(`source.${src}`) : "");
</script>

{#if !session.authed}
	<EmptyState title={t("auth.required")}>{t("auth.requiredHint")}</EmptyState>
{:else if !session.on("publish")}
	<EmptyState title={t("release.title")} />
{:else}
	<div class="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-5">
		<div class="bg-panel rounded-lg border p-2">
			<Steps {steps} {active} onselect={select} />
		</div>

		{#if active === 0}
			<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
				<div class="flex flex-col gap-1">
					<h2 class="text-lg font-semibold">{t("release.s1.title")}</h2>
					<p class="text-muted-foreground">{t("release.s1.lead")}</p>
				</div>
				<div class="grid grid-cols-2 gap-5 sm:grid-cols-5">
					<Stat label={t("release.s1.state")} value={s?.container ? (s.container.state === "running" ? t("status.running") : s.container.state) : "—"} />
					<Stat label={t("release.s1.online")} value={s?.online == null ? "—" : String(s.online)} />
					<Stat label={t("release.s1.mods")} value={s?.manifest ? String(s.manifest.mods) : "—"} />
					<Stat label={t("release.s1.lock")} value={s?.manifest?.generatedAt ? relative(s.manifest.generatedAt) : t("release.s1.never")} />
					<Stat label={t("stat.world")} value={s?.server.world || "—"} />
				</div>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" href={resolve("/")}>{t("nav.overview")}</Button>
					<Button variant="outline" href={resolve("/configs")}>{t("nav.configs")}</Button>
					<Button onclick={() => select(1)}>{t("steps.working")} →</Button>
				</div>
			</section>
		{:else if active === 1}
			<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
				<div class="flex flex-col gap-1">
					<h2 class="text-lg font-semibold">{t("release.s2.title")}</h2>
					<p class="text-muted-foreground">{t("release.s2.lead")}</p>
				</div>
				{#if !release}
					<Alert.Root>
						<Alert.Title>{t("release.s2.none")}</Alert.Title>
						<Alert.Description>
							<p>
								{t("release.s2.howConfigs")}
								<a class="text-primary-text underline underline-offset-2" href={resolve("/configs")}>{t("release.s2.editConfigs")}</a>
							</p>
							<p>{t("release.s2.howMods")}</p>
						</Alert.Description>
					</Alert.Root>
				{:else}
					<div class="flex flex-col gap-2">
						<SectionLabel>{t("release.s2.mods")}</SectionLabel>
						<div class="flex flex-wrap items-center gap-3">
							<p class="min-w-0 flex-1">
								{#if release.modsFrom}
									{sum!.install || sum!.remove
										? t("release.s2.modsFrom", {
												source: sourceOf(release.modsFrom),
												time: relative(release.modsAt ?? release.updatedAt),
												install: sum!.install,
												remove: sum!.remove,
											})
										: t("release.s2.modsSame", { source: sourceOf(release.modsFrom), time: relative(release.modsAt ?? release.updatedAt) })}
								{:else}
									<span class="text-muted-foreground">{t("release.s2.modsUnchanged")}</span>
								{/if}
							</p>
							{#if release.modsFrom}<Button variant="ghost" size="sm" onclick={revertMods}>{t("release.s2.dropMods")}</Button>{/if}
						</div>
						<p class="text-muted-foreground text-xs">{t("release.s2.howMods")}</p>
					</div>
					<div class="flex flex-col gap-2">
						<SectionLabel>{t("release.s2.configs")}</SectionLabel>
						{#if !release.configs.length}
							<p class="text-muted-foreground">{t("release.s2.noConfigs")}</p>
						{:else}
							<ul class="divide-line-subtle divide-y rounded-md border">
								{#each release.configs as f (f)}
									{@const meta = release.configMeta[f]}
									<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
										<a href={configHref(f)} class="hover:text-primary-text min-w-0 flex-1 truncate font-mono text-xs">{f}</a>
										<SyncBadge info={plan?.effects[f]} />
										{#if meta}<span class="text-subtle-foreground font-mono text-[11px]"
												>{t("release.s2.from", { source: sourceOf(meta.source), time: relative(meta.at) })}</span
											>{/if}
										{#if plan?.conflicts.includes(f)}<span class="text-destructive-text text-[11px]">{t("release.s3.conflict")}</span>{/if}
										<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => revertFile(f)}>{t("common.revert")}</Button>
									</li>
								{/each}
							</ul>
						{/if}
						<p class="text-muted-foreground text-xs">
							{t("release.s2.howConfigs")}
							<a class="text-primary-text underline underline-offset-2" href={resolve("/configs")}>{t("release.s2.editConfigs")}</a>
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2 border-t pt-4">
						<Button disabled={sum?.empty} onclick={() => select(2)}>{t("steps.review")} →</Button>
						{#if sum?.empty}<span class="text-muted-foreground text-xs">{t("release.s4.empty")}</span>{/if}
						<span class="flex-1"></span>
						<Button
							variant="ghost"
							class="text-destructive-text"
							onclick={() =>
								ask({
									title: t("release.s2.discardTitle"),
									description: t("release.s2.discardDesc"),
									label: t("release.s2.discardAll"),
									destructive: true,
									run: discard,
								})}>{t("release.s2.discardAll")}</Button
						>
					</div>
				{/if}
			</section>
		{:else if active === 2 && release && plan && sum}
			<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
				<div class="flex flex-col gap-1">
					<h2 class="text-lg font-semibold">{t("release.s3.title")}</h2>
					<p class="text-muted-foreground">{t("release.s3.lead")}</p>
				</div>

				{#if !sum.problems.length && !sum.conflicts && !sum.untracked}
					<Alert.Root class="border-success/40">
						<Alert.Title class="text-success">{t("release.s3.ok")}</Alert.Title>
					</Alert.Root>
				{/if}
				{#if sum.problems.length}
					<Alert.Root variant="destructive">
						<Alert.Title>{t("release.s3.problems")}</Alert.Title>
						<Alert.Description>
							<ul class="list-disc pl-4">
								{#each sum.problems as p (p)}<li>{p}</li>{/each}
							</ul>
							<p class="text-muted-foreground">{t("release.s3.problemsHint")}</p>
						</Alert.Description>
					</Alert.Root>
				{/if}
				{#if sum.conflicts}
					<Alert.Root variant="destructive">
						<Alert.Title>{t("release.s3.conflicts", { n: sum.conflicts })}</Alert.Title>
						<Alert.Description>{t("release.s3.conflictHint")}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if sum.untracked}
					<Alert.Root>
						<Alert.Description>{t("release.untracked", { n: sum.untracked })}</Alert.Description>
					</Alert.Root>
				{/if}
				<Alert.Root class={plan.restartRequired ? "border-primary-line" : "border-success/40"}>
					<Alert.Title>{plan.restartRequired ? t("release.s3.restart", { why: restartWhy.join("; ") }) : t("release.s3.noRestart")}</Alert.Title>
				</Alert.Root>

				<div class="flex flex-col rounded-md border">
					<SectionLabel class="border-b px-5 py-2.5">{t("release.s3.mods")} · {plan.install.length + plan.remove.length}</SectionLabel>
					<div class="overflow-x-auto"><ModsTable {plan} /></div>
				</div>

				<div class="flex flex-col rounded-md border">
					<div class="flex items-center gap-3 border-b px-5 py-2">
						<SectionLabel>{t("release.s3.files")} · {files.length}</SectionLabel>
						<span class="flex-1"></span>
						<Segmented
							size="sm"
							options={[
								{ value: "unified", label: t("release.s3.unified") },
								{ value: "split", label: t("release.s3.split") },
							]}
							bind:value={diffMode}
						/>
					</div>
					{#if !files.length}
						<p class="text-muted-foreground px-5 py-3 text-xs">{t("release.s2.noConfigs")}</p>
					{/if}
					{#each files as f (f.path)}
						<Collapsible.Root open={openFiles[f.path] ?? true} onOpenChange={(o: boolean) => (openFiles = { ...openFiles, [f.path]: o })}>
							<Collapsible.Trigger class="hover:bg-hover border-line-subtle flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2.5 text-left">
								<ChevronDownIcon class={cn("text-subtle-foreground size-3.5 transition-transform", openFiles[f.path] === false && "-rotate-90")} />
								<span class="font-mono text-xs">{f.path}</span>
								{#if f.status === "new"}<span class="text-success font-mono text-[11px]">{t("release.s3.newFile")}</span>{/if}
								{#if f.conflict}<span class="text-destructive-text font-mono text-[11px]">{t("release.s3.conflict")}</span>{/if}
								<SyncBadge info={f.effect} />
								<span class="flex-1"></span>
								<span class="text-subtle-foreground font-mono text-[11px]">{f.changes.length} {t("release.s3.values").toLowerCase()}</span>
							</Collapsible.Trigger>
							<Collapsible.Content>
								{#if f.effect}<p class="text-muted-foreground border-line-subtle border-b px-5 py-2 text-xs"><SyncBadge info={f.effect} long /></p>{/if}
								{#if f.changes.length}
									<table class="border-line-subtle w-full border-b text-left">
										<tbody>
											{#each f.changes as c (`${c.section}::${c.key}`)}
												<tr class="border-line-subtle border-b last:border-b-0">
													<td class="px-5 py-1.5 font-mono text-xs"><span class="text-subtle-foreground">[{c.section}]</span> {c.key}</td>
													<td class="cell-mono px-3 py-1.5 whitespace-normal">
														{#if c.from !== null}<span class="text-destructive-text line-through">{c.from}</span>{/if}
														{#if c.from !== null && c.to !== null}<span class="text-subtle-foreground"> → </span>{/if}
														{#if c.to !== null}<span class="text-success">{c.to}</span>{:else}<span class="text-destructive-text"
																>{t("release.s3.removedValue")}</span
															>{/if}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{:else if !f.tooLarge}
									<p class="text-muted-foreground border-line-subtle border-b px-5 py-2 text-xs">{t("release.s3.noValues")}</p>
								{/if}
								<div class="border-line-subtle border-b">
									{#await import("#lib/components/release/config-diff.svelte") then m}
										<m.default path={f.path} before={f.before} after={f.after} mode={diffMode} />
									{/await}
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
					{/each}
				</div>

				<div class="flex flex-wrap items-center gap-2 border-t pt-4">
					<Button variant="outline" onclick={() => select(1)}>← {t("steps.working")}</Button>
					<Button disabled={!ready && !sum.conflicts} onclick={() => select(3)}>{t("steps.release")} →</Button>
				</div>
			</section>
		{:else if active === 3 && release && plan && sum}
			<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
				<div class="flex flex-col gap-1">
					<h2 class="text-lg font-semibold">{t("release.s4.title")}</h2>
					<p class="text-muted-foreground">{t("release.s4.lead")}</p>
				</div>
				<p class="text-sm">
					{t("release.summary", { install: sum.install, remove: sum.remove, configs: sum.configs })}
					<span class="text-muted-foreground"> · {t("release.staged", { time: dateTime(sum.updatedAt) })}</span>
				</p>
				<Alert.Root class={plan.restartRequired ? "border-primary-line" : "border-success/40"}>
					<Alert.Title
						>{!session.on("control") && plan.restartRequired
							? t("release.s4.noControl")
							: plan.restartRequired
								? t("release.s4.willRestart")
								: t("release.s4.staysUp")}</Alert.Title
					>
				</Alert.Root>
				{#if sum.lastError}
					<Alert.Root variant="destructive"><Alert.Title>{t("release.lastError", { error: sum.lastError })}</Alert.Title></Alert.Root>
				{/if}
				<div class="flex flex-col gap-3">
					<div class="flex items-start gap-2.5">
						<Checkbox id="rel-backup" bind:checked={backup} disabled={!session.on("backups")} />
						<div class="flex flex-col gap-0.5">
							<Label for="rel-backup">{t("release.s4.backup")}</Label>
							<span class="text-muted-foreground text-xs">{t("release.s4.backupHint")}</span>
						</div>
					</div>
					{#if sum.conflicts}
						<div class="flex items-start gap-2.5">
							<Checkbox id="rel-force" bind:checked={force} />
							<Label for="rel-force" class="text-destructive-text">{t("release.s4.force", { n: sum.conflicts })}</Label>
						</div>
					{/if}
				</div>
				{#if blockedByConflicts}
					<p class="text-destructive-text text-xs">{t("release.s4.blockedConflicts")}</p>
				{/if}
				{#if sum.schedule}
					<p class="text-primary-text text-sm">
						{t("release.s4.scheduledFor", { when: sum.schedule.when === "idle" ? t("release.idle") : dateTime(sum.schedule.at) })}
					</p>
				{/if}
				<div class="flex flex-wrap items-center gap-2 border-t pt-4">
					<Button
						disabled={busy || !ready}
						onclick={() =>
							ask({
								title: t("release.nowTitle"),
								description: plan.restartRequired ? t("release.nowDesc") : t("release.s4.staysUp"),
								label: t("release.now"),
								run: () => apply("now"),
							})}>{t("release.now")}</Button
					>
					<Button
						variant="outline"
						disabled={busy || !ready || data?.online == null}
						onclick={() => apply("idle")}
						title={data?.online == null ? t("release.s4.idleHint") : undefined}>{t("release.idle")}</Button
					>
					<Input type="datetime-local" class="w-auto" bind:value={at} aria-label={t("release.at")} />
					<Button variant="outline" disabled={busy || !ready || !at} onclick={() => apply("at")}>{t("release.at")}</Button>
					<span class="flex-1"></span>
					{#if sum.schedule}<Button variant="ghost" disabled={busy} onclick={() => apply("none")}>{t("release.clear")}</Button>{/if}
					<Button variant="outline" onclick={() => select(2)}>← {t("steps.review")}</Button>
				</div>
			</section>
		{:else if active >= 2}
			<EmptyState title={t("release.s2.none")}>{t("release.s2.howMods")}</EmptyState>
		{/if}

		{#if result}
			<section class="bg-panel flex flex-col gap-3 rounded-lg border p-5">
				<SectionLabel>{t("release.s4.result", { time: dateTime(result.at) })}</SectionLabel>
				{#if result.r.nothingToDo}
					<p>{t("release.s4.nothing")}</p>
				{:else}
					<p class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
						<span>{t("release.s4.installed", { n: result.r.result?.installed.length ?? 0 })}</span>
						<span>{t("release.s4.removed", { n: result.r.result?.removed.length ?? 0 })}</span>
						<span>{t("release.s4.configs", { n: result.r.configsWritten?.length ?? 0 })}</span>
						{#if result.r.backup}<span class="text-muted-foreground">{t("release.backup", { id: result.r.backup.id })}</span>{/if}
						<span class="text-muted-foreground"
							>{result.r.stayedUp ? t("release.s4.stayedUp") : result.r.restartRequired ? t("release.restartYourself") : t("release.s4.restarted")}</span
						>
					</p>
					{#each result.r.result?.errors ?? [] as e (e)}<p class="text-destructive-text text-xs">{e}</p>{/each}
				{/if}
				{#if result.r.log?.length}
					<Collapsible.Root>
						<Collapsible.Trigger class="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
							>{t("release.s4.log")}</Collapsible.Trigger
						>
						<Collapsible.Content>
							<pre class="bg-field mt-2 overflow-x-auto rounded-md p-3 font-mono text-[11px] leading-relaxed">{result.r.log.join("\n")}</pre>
						</Collapsible.Content>
					</Collapsible.Root>
				{/if}
			</section>
		{/if}
	</div>
{/if}

{#if confirm}
	<ConfirmDialog
		bind:open={confirmOpen}
		title={confirm.title}
		description={confirm.description}
		confirmLabel={confirm.label}
		destructive={confirm.destructive}
		onconfirm={confirm.run}
	/>
{/if}
