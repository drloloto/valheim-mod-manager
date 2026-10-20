<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button, EmptyState, SectionLabel } from "#lib/components/kit/index.js";
	import { api, attempt, session } from "#lib/api.svelte.js";
	import { t, type MessageKey } from "#lib/i18n/index.svelte.js";
	import type { ListName, PlayerEntry, Players } from "#lib/types.js";

	const LISTS: { name: ListName; file: string; label: MessageKey }[] = [
		{ name: "admin", file: "adminlist.txt", label: "players.admin" },
		{ name: "permitted", file: "permittedlist.txt", label: "players.permitted" },
		{ name: "banned", file: "bannedlist.txt", label: "players.banned" },
	];

	let data = $state<Players | null>(null);
	let text = $state<Record<ListName, string>>({ admin: "", permitted: "", banned: "" });
	let saving = $state(false);

	const toText = (entries: PlayerEntry[]) => entries.map((e) => (e.note ? `${e.id} # ${e.note}` : e.id)).join("\n");
	const fromText = (s: string): PlayerEntry[] =>
		s
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("//") && !l.startsWith("#"))
			.map((l) => {
				const [id, ...rest] = l.split(/\s+/);
				return { id, note: rest.join(" ").replace(/^[#/]+\s*/, "") };
			});

	const can = $derived(session.authed && session.on("players"));
	$effect(() => {
		if (can) load();
	});

	async function load() {
		const r = await attempt(() => api<Players>("/players"));
		if (!r) return;
		data = r;
		text = { admin: toText(r.lists.admin), permitted: toText(r.lists.permitted), banned: toText(r.lists.banned) };
	}

	async function save() {
		saving = true;
		let ok = true;
		for (const l of LISTS) {
			ok = !!(await attempt(() => api(`/players/${l.name}`, { method: "PUT", body: { entries: fromText(text[l.name]) } })));
			if (!ok) break;
		}
		saving = false;
		if (ok) toast.success(t("players.saved"));
		load();
	}
</script>

{#if !can}
	<EmptyState title={t("auth.required")}>{t("auth.requiredHint")}</EmptyState>
{:else}
	<div class="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6">
		<section class="bg-panel flex flex-col gap-2 rounded-lg border p-5">
			<SectionLabel>{t("players.online")}</SectionLabel>
			{#if data?.logError}
				<p class="text-muted-foreground text-sm">{t("players.unknown", { error: data.logError })}</p>
			{:else if data?.online.length}
				<ul class="flex flex-wrap gap-2">
					{#each data.online as p (p.id)}
						<li class="bg-field flex items-center gap-2 rounded-md px-2.5 py-1 text-sm">
							<span class="bg-success size-1.5 rounded-full"></span>{p.name ?? "?"}<span class="text-subtle-foreground font-mono text-xs">{p.id}</span>
						</li>
					{/each}
				</ul>
			{:else if data}
				<p class="text-muted-foreground text-sm">{t("players.nobody")}</p>
			{/if}
		</section>

		<section class="bg-panel flex flex-col gap-4 rounded-lg border p-5">
			<div class="grid gap-4 md:grid-cols-3">
				{#each LISTS as l (l.name)}
					<label class="flex flex-col gap-1.5">
						<span class="text-row font-semibold">{t(l.label)}</span>
						<span class="text-subtle-foreground font-mono text-[11px]">{l.file}{l.name === "permitted" ? ` · ${t("players.emptyAll")}` : ""}</span>
						<textarea
							bind:value={text[l.name]}
							rows="7"
							spellcheck="false"
							class="bg-field border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border px-2.5 py-2 font-mono text-xs outline-none focus-visible:ring-3"
						></textarea>
					</label>
				{/each}
			</div>
			<div class="flex flex-wrap items-center gap-3">
				<Button disabled={saving} onclick={save}>{t("players.save")}</Button>
				<p class="text-muted-foreground text-xs">{t("players.hint")}</p>
			</div>
		</section>

		{#if data?.recent.length}
			<section class="bg-panel flex flex-col rounded-lg border">
				<SectionLabel class="border-b px-5 py-3">{t("players.recent")}</SectionLabel>
				<table class="w-full text-left">
					<tbody>
						{#each data.recent as s, i (i)}
							<tr class="border-line-subtle border-b last:border-b-0">
								<td class="text-row px-5 py-2">{s.name ?? "?"}</td>
								<td class="cell-mono px-3 py-2">{s.id}</td>
								<td class="cell-muted px-3 py-2">{s.joinedAt ?? ""}</td>
								<td class="cell-muted px-5 py-2">{s.leftAt ?? t("players.stillOnline")}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}
	</div>
{/if}
