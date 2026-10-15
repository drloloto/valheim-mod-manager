<script lang="ts">
	import { resolve } from "$app/paths";
	import { toast } from "svelte-sonner";
	import { Button, ConfirmDialog, EmptyState, Input, SectionLabel, SettingRow } from "#lib/components/kit/index.js";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { ActionResult, EnvEntry, EnvWrite } from "#lib/types.js";

	// Container control and valheim.env. Releases have their own page (/release).
	let env = $state<EnvEntry[]>([]);
	let envEdits = $state<Record<string, string>>({});
	let confirm = $state<null | { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<void> }>(null);
	let confirmOpen = $state(false);

	const envChanged = $derived(env.filter((e) => e.key in envEdits && envEdits[e.key] !== e.value));
	const canEnv = $derived(session.authed && session.on("env"));
	const pending = $derived(session.authed ? session.status?.release : null);
	$effect(() => {
		if (canEnv) loadEnv();
	});

	async function loadEnv() {
		const r = await attempt(() => api<{ entries: EnvEntry[] }>("/env"));
		if (r) ((env = r.entries), (envEdits = {}));
	}

	function ask(c: NonNullable<typeof confirm>) {
		confirm = c;
		confirmOpen = true;
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
		{#if pending && session.on("publish")}
			<a href={resolve("/release")} class="bg-info-soft border-info-line hover:bg-hover flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
				<span class="bg-primary size-1.5 animate-pulse rounded-full"></span>
				<span class="flex-1"
					>{t("release.pendingShort")}: {t("release.summary", { install: pending.install, remove: pending.remove, configs: pending.configs })}</span
				>
				<span class="text-primary-text">{t("nav.release")} →</span>
			</a>
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
				<div class="@container">
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
