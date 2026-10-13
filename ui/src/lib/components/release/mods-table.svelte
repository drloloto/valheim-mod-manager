<script lang="ts">
	import { t } from "#lib/i18n/index.svelte.js";
	import { thunderstoreUrl } from "#lib/format.js";
	import type { ReleasePlan } from "#lib/types.js";

	// Every mod the release installs, updates or removes, one row each.
	let { plan }: { plan: ReleasePlan } = $props();

	const rows = $derived([
		...plan.install.map((m) => ({ id: m.id, kind: m.from ? "update" : "install", from: m.from, to: m.to })),
		...plan.remove.map((id) => ({ id, kind: "remove", from: null, to: null })),
	]);
</script>

{#if !rows.length}
	<p class="text-muted-foreground px-5 py-3 text-xs">{t("release.s3.noMods")}</p>
{:else}
	<table class="w-full text-left">
		<thead class="label-caps">
			<tr class="border-b">
				<th class="px-5 py-2 font-medium">{t("home.colMod")}</th>
				<th class="px-3 py-2 font-medium">{t("release.s3.colChange")}</th>
				<th class="px-5 py-2 font-medium">{t("home.colVersion")}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.id)}
				<tr class="border-line-subtle border-b last:border-b-0">
					<td class="text-row px-5 py-1.5"
						><a href={thunderstoreUrl(r.id)} target="_blank" rel="noopener noreferrer" class="hover:text-primary-text">{r.id}</a></td
					>
					<td class="px-3 py-1.5">
						<span
							class={`font-mono text-[11px] ${r.kind === "remove" ? "text-destructive-text" : r.kind === "install" ? "text-success" : "text-primary-text"}`}
						>
							{r.kind === "remove" ? "−" : r.kind === "install" ? "+" : "↑"}
							{t(`release.s3.${r.kind}` as "release.s3.install")}
						</span>
					</td>
					<td class="cell-mono px-5 py-1.5">{r.from ? `${r.from} → ` : ""}{r.to ?? ""}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
