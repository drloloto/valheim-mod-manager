<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button, ConfirmDialog, EmptyState, Input, SectionLabel, SettingRow } from "#lib/components/kit/index.js";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { dateTime } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { ActionResult, ApplyResponse, EnvEntry, EnvWrite, PendingRelease } from "#lib/types.js";

	let pending = $state<PendingRelease | null>(null);
	let env = $state<EnvEntry[]>([]);
	let envEdits = $state<Record<string, string>>({});
	let at = $state("");
	let busy = $state(false);
	let confirm = $state<null | { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<void> }>(null);
	let confirmOpen = $state(false);

	const summary = $derived(pending?.summary ?? null);
	const plan = $derived(pending?.release?.plan ?? null);
	const envChanged = $derived(env.filter((e) => e.key in envEdits && envEdits[e.key] !== e.value));

	// Effects depend on primitives only: the status object is replaced every 15 s, which must not reload the
	// env form (and wipe what the admin is typing). The release reloads when the server reports another one.
	const canRelease = $derived(session.authed && session.on("publish"));
	const canEnv = $derived(session.authed && session.on("env"));
	const releaseKey = $derived(`${session.status?.release?.id ?? ""}:${session.status?.release?.schedule?.setAt ?? ""}`);
	$effect(() => {
		void releaseKey;
		if (canRelease) loadRelease();
	});
	$effect(() => {
		if (canEnv) loadEnv();
	});

	async function loadRelease() {
		pending = await attempt(() => api<PendingRelease>("/releases/pending"));
	}
	async function loadEnv() {
		const r = await attempt(() => api<{ entries: EnvEntry[] }>("/env"));
		if (r) ((env = r.entries), (envEdits = {}));
	}

	function ask(c: NonNullable<typeof confirm>) {
		confirm = c;
		confirmOpen = true;
	}

	async function apply(when: "now" | "idle" | "at" | "none") {
		if (!summary) return;
		const atMs = when === "at" ? new Date(at).getTime() : undefined;
		if (when === "at" && !atMs) {
			toast.error(t("release.pickTime"));
			return;
		}
		busy = true;
		const r = await attempt(() => api<ApplyResponse>(`/releases/${encodeURIComponent(summary.id)}/apply`, { method: "POST", body: { when, at: atMs } }));
		busy = false;
		if (!r) {
			await loadRelease();
			return;
		}
		if (r.applied && r.result) {
			toast.success(t("release.applied", { installed: r.result.installed.length, removed: r.result.removed.length }), {
				description: [r.backup ? t("release.backup", { id: r.backup.id }) : "", r.restartRequired ? t("release.restartYourself") : ""]
					.filter(Boolean)
					.join(" · "),
			});
			for (const e of r.result.errors) toast.error(e);
			if (r.started && !r.started.ok) toast.error(r.started.message);
		} else toast.success(when === "none" ? t("release.cleared") : t("release.scheduled"));
		await Promise.all([loadRelease(), session.refresh()]);
	}

	async function discard() {
		if (!summary) return;
		await attempt(() => api(`/releases/${encodeURIComponent(summary.id)}`, { method: "DELETE" }));
		await Promise.all([loadRelease(), session.refresh()]);
	}

	async function control(action: "restart" | "stop" | "start") {
		const r = await attempt(() => api<ActionResult>(`/server/${action}`, { method: "POST" }));
		if (r) (r.ok ? toast.success : toast.error)(r.message);
		session.refresh();
	}

	async function saveEnv() {
		const r = await attempt(() => api<EnvWrite>("/env", { method: "PUT", body: Object.fromEntries(envChanged.map((e) => [e.key, envEdits[e.key]])) }));
		if (!r) return;
		env = r.entries;
		envEdits = {};
		if (r.changed) toast.success(t("env.saved"), { description: t("env.applyWith", { cmd: r.applyWith }), duration: 15_000 });
	}
</script>

{#if !session.authed}
	<EmptyState title={t("auth.required")}>{t("auth.requiredHint")}</EmptyState>
{:else}
	<div class="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-6">
		{#if session.on("publish")}
			<section class="bg-panel flex flex-col gap-3 rounded-lg border p-5">
				<SectionLabel>{t("release.title")}</SectionLabel>
				{#if !summary}
					<p class="text-muted-foreground">{t("release.none")}</p>
				{:else}
					<p>
						{t("release.summary", { install: summary.install, remove: summary.remove, configs: summary.configs })}
						<span class="text-muted-foreground"> · {t("release.staged", { time: dateTime(summary.createdAt) })}</span>
					</p>
					{#if summary.schedule}
						<p class="text-primary-text text-sm">
							{summary.schedule.when === "idle" ? t("release.whenIdle") : t("release.whenAt", { time: dateTime(summary.schedule.at) })}
						</p>
					{/if}
					{#if plan}
						<ul class="text-foreground-soft flex flex-col gap-0.5 font-mono text-xs">
							{#each plan.install as m (m.id)}<li>+ {m.id} {m.from ? `${m.from} → ` : ""}{m.to}</li>{/each}
							{#each plan.remove as id (id)}<li class="text-destructive-text">− {id}</li>{/each}
							{#each [...plan.configsChanged, ...plan.configsNew] as f (f)}<li class="text-muted-foreground">~ {f}</li>{/each}
						</ul>
					{/if}
					{#if summary.untracked}
						<p class="bg-info-soft border-info-line rounded-md border px-3 py-2 text-xs">{t("release.untracked", { n: summary.untracked })}</p>
					{/if}
					{#each [...summary.problems, ...(summary.lastError ? [summary.lastError] : [])] as p (p)}
						<p class="text-destructive-text text-xs">{p}</p>
					{/each}
					<div class="flex flex-wrap items-center gap-2 pt-1">
						<Button
							disabled={busy}
							onclick={() => ask({ title: t("release.nowTitle"), description: t("release.nowDesc"), label: t("release.now"), run: () => apply("now") })}
							>{t("release.now")}</Button
						>
						<Button variant="outline" disabled={busy || pending?.online == null} onclick={() => apply("idle")}>{t("release.idle")}</Button>
						<Input type="datetime-local" class="w-auto" bind:value={at} aria-label={t("release.at")} />
						<Button variant="outline" disabled={busy || !at} onclick={() => apply("at")}>{t("release.at")}</Button>
						<span class="flex-1"></span>
						{#if summary.schedule}<Button variant="ghost" disabled={busy} onclick={() => apply("none")}>{t("release.clear")}</Button>{/if}
						<Button
							variant="ghost"
							class="text-destructive-text"
							disabled={busy}
							onclick={() =>
								ask({ title: t("release.discardTitle"), description: t("release.discardDesc"), label: t("release.discard"), destructive: true, run: discard })}
							>{t("release.discard")}</Button
						>
					</div>
				{/if}
			</section>
		{/if}

		{#if session.on("control")}
			<section class="bg-panel flex flex-col gap-3 rounded-lg border p-5">
				<SectionLabel>{t("control.title")}</SectionLabel>
				<div class="flex flex-wrap gap-2">
					<Button
						variant="outline"
						onclick={() =>
							ask({ title: t("control.restartTitle"), description: t("control.restartDesc"), label: t("control.restart"), run: () => control("restart") })}
						>{t("control.restart")}</Button
					>
					<Button
						variant="outline"
						onclick={() =>
							ask({
								title: t("control.stopTitle"),
								description: t("control.stopDesc"),
								label: t("control.stop"),
								destructive: true,
								run: () => control("stop"),
							})}>{t("control.stop")}</Button
					>
					<Button variant="outline" onclick={() => control("start")}>{t("control.start")}</Button>
				</div>
				<p class="text-muted-foreground text-xs">{t("control.hint")}</p>
			</section>
		{/if}

		{#if session.on("env")}
			<section class="bg-panel flex flex-col rounded-lg border px-5 pt-4">
				<SectionLabel>valheim.env</SectionLabel>
				<div>
					{#each env as e (e.key)}
						<SettingRow label={e.key} for={`env-${e.key}`} align="center">
							<Input
								id={`env-${e.key}`}
								type={/PASS|TOKEN|SECRET|KEY/i.test(e.key) ? "password" : "text"}
								autocomplete="off"
								value={envEdits[e.key] ?? e.value}
								oninput={(ev) => (envEdits[e.key] = ev.currentTarget.value)}
								class="font-mono"
							/>
						</SettingRow>
					{/each}
				</div>
				<div class="flex flex-wrap items-center gap-3 border-t py-4">
					<Button disabled={!envChanged.length} onclick={saveEnv}>{envChanged.length ? t("env.save", { n: envChanged.length }) : t("common.save")}</Button>
					<p class="text-muted-foreground min-w-0 flex-1 text-xs">{t("env.hint")}</p>
				</div>
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
