<script lang="ts">
	import UploadIcon from "@lucide/svelte/icons/upload";
	import { toast } from "svelte-sonner";
	import { Button, Checkbox, ConfirmDialog, Dialog, EmptyState, Label, SectionLabel } from "#lib/components/kit/index.js";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { bytes, dateTime } from "#lib/format.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { Backup, BackupContents, RestoreResponse } from "#lib/types.js";

	let backups = $state<Backup[]>([]);
	let busy = $state(false);
	let fileInput = $state<HTMLInputElement>();

	// Restore dialog: what is in the archive decides which options are offered.
	let target = $state<BackupContents | null>(null);
	let restoreOpen = $state(false);
	let withConfigs = $state(false);
	let withMods = $state(false);
	let deleteId = $state<string | null>(null);
	let deleteOpen = $state(false);

	const can = $derived(session.authed && session.on("backups"));
	$effect(() => {
		if (can) load();
	});

	async function load() {
		backups = (await attempt(() => api<{ backups: Backup[] }>("/backups")))?.backups ?? backups;
	}

	async function create() {
		busy = true;
		const b = await attempt(() => api<Backup>("/backups", { method: "POST", body: {} }));
		busy = false;
		if (b) toast.success(t("backups.created", { id: b.id, size: bytes(b.size) }));
		load();
	}

	async function importFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return;
		busy = true;
		const r = await attempt(() => api<BackupContents>("/backups/import", { method: "POST", body: f }));
		busy = false;
		if (fileInput) fileInput.value = "";
		await load();
		if (r) openRestore(r);
	}

	async function inspect(id: string) {
		const r = await attempt(() => api<BackupContents>(`/backups/${encodeURIComponent(id)}`));
		if (r) openRestore(r);
	}

	function openRestore(c: BackupContents) {
		target = c;
		withConfigs = false;
		withMods = false;
		restoreOpen = true;
	}

	async function restore() {
		if (!target) return;
		busy = true;
		const id = target.id;
		const r = await attempt(() =>
			api<RestoreResponse>(`/backups/${encodeURIComponent(id)}/restore`, {
				method: "POST",
				body: { world: target!.worlds[0], configs: withConfigs, mods: withMods },
			}),
		);
		busy = false;
		if (!r) return;
		restoreOpen = false;
		toast.success(t("backups.restored", { what: r.restored.join(", ") }), { description: r.safety ? t("backups.safety", { id: r.safety.id }) : undefined });
		if (r.started && !r.started.ok) toast.error(r.started.message);
		load();
		session.refresh();
	}

	async function remove() {
		if (!deleteId) return;
		await attempt(() => api(`/backups/${encodeURIComponent(deleteId!)}`, { method: "DELETE" }));
		load();
	}

	const diffEmpty = $derived(!!target?.diff && !target.diff.added.length && !target.diff.removed.length && !target.diff.changed.length);
</script>

{#if !can}
	<EmptyState title={t("auth.required")}>{t("auth.requiredHint")}</EmptyState>
{:else}
	<div class="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6">
		<section class="bg-panel flex flex-col rounded-lg border">
			<div class="flex flex-wrap items-center gap-2 border-b px-5 py-3">
				<SectionLabel class="flex-1">{t("backups.title")} · {backups.length}</SectionLabel>
				<input bind:this={fileInput} type="file" accept=".tar.gz,.tgz" class="hidden" onchange={importFile} />
				<Button variant="outline" size="sm" disabled={busy} onclick={() => fileInput?.click()}><UploadIcon />{t("backups.import")}</Button>
				<Button size="sm" disabled={busy} onclick={create}>{t("backups.create")}</Button>
			</div>
			{#if !backups.length}
				<EmptyState title={t("backups.none")}>{t("backups.noneHint")}</EmptyState>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left">
						<thead class="label-caps">
							<tr class="border-b">
								<th class="px-5 py-2 font-medium">{t("backups.file")}</th>
								<th class="px-3 py-2 font-medium">{t("backups.world")}</th>
								<th class="px-3 py-2 font-medium">{t("backups.size")}</th>
								<th class="px-3 py-2 font-medium">{t("backups.date")}</th>
								<th class="px-5 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each backups as b (b.id)}
								<tr class="border-line-subtle hover:bg-hover border-b last:border-b-0">
									<td class="cell-mono px-5 py-2">{b.id}</td>
									<td class="cell-soft px-3 py-2">{b.world ?? t("backups.imported")}</td>
									<td class="cell-muted px-3 py-2">{bytes(b.size)}</td>
									<td class="cell-muted px-3 py-2">{dateTime(b.createdAt)}</td>
									<td class="px-5 py-1.5 text-right whitespace-nowrap">
										<Button variant="outline" size="sm" onclick={() => inspect(b.id)}>{t("backups.restore")}</Button>
										<Button variant="ghost" size="sm" class="text-destructive-text" onclick={() => ((deleteId = b.id), (deleteOpen = true))}
											>{t("common.delete")}</Button
										>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
		<p class="text-muted-foreground text-xs">{t("backups.hint")}</p>
	</div>
{/if}

<Dialog.Root bind:open={restoreOpen}>
	<Dialog.Content class="sm:max-w-lg">
		{#if target}
			<Dialog.Header>
				<Dialog.Title>{t("backups.restoreTitle", { world: target.worlds[0] ?? "?" })}</Dialog.Title>
				<Dialog.Description>{t("backups.restoreDesc")}</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3 text-sm">
				<p class="text-muted-foreground font-mono text-xs break-all">{target.id}</p>
				{#if !target.worlds.length}
					<p class="text-destructive-text">{t("backups.noWorld")}</p>
				{/if}
				{#if target.diff}
					<div class="flex flex-col gap-1">
						<span class="label-caps">{t("backups.modDiff")}</span>
						{#if diffEmpty}
							<p class="text-muted-foreground text-xs">{t("backups.identical")}</p>
						{:else}
							<ul class="text-foreground-soft flex max-h-40 flex-col gap-0.5 overflow-y-auto font-mono text-xs">
								{#each target.diff.added as m (m.id)}<li>+ {m.id} {m.version}</li>{/each}
								{#each target.diff.removed as m (m.id)}<li class="text-destructive-text">− {m.id}</li>{/each}
								{#each target.diff.changed as m (m.id)}<li>~ {m.id} {m.from} → {m.to}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}
				<Label class="flex items-center gap-2 font-normal">
					<Checkbox bind:checked={withConfigs} disabled={!target.hasConfigs} />{t("backups.withConfigs")}
				</Label>
				<Label class="flex items-center gap-2 font-normal">
					<Checkbox bind:checked={withMods} disabled={!target.diff || diffEmpty || !session.on("publish")} />{t("backups.withMods")}
				</Label>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (restoreOpen = false)}>{t("common.cancel")}</Button>
				<Button variant="destructive" disabled={busy || !target.worlds.length} onclick={restore}>{t("backups.restoreNow")}</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={deleteOpen}
	title={t("backups.deleteTitle")}
	description={deleteId ?? ""}
	confirmLabel={t("common.delete")}
	destructive
	onconfirm={remove}
/>
