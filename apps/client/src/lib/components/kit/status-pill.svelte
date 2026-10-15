<script lang="ts">
	import { t } from "#lib/i18n/index.svelte.js";
	import type { ModStatus } from "./types";

	let { status, version, onclick }: { status: ModStatus; version?: string; onclick?: (e: MouseEvent) => void } = $props();
</script>

{#if status === "update"}
	<button
		type="button"
		{onclick}
		disabled={!onclick}
		title={onclick ? t("pill.updateTo", { v: version ?? "" }) : undefined}
		class="bg-primary text-primary-foreground hover:bg-primary-hover rounded-[4px] px-2 py-1 font-mono text-[11.5px] font-medium"
	>
		↑ {version}
	</button>
{:else if status === "inProfile"}
	<span class="text-success flex items-center gap-1.5 text-xs"><span class="bg-success size-1.5 rounded-full"></span>{t("pill.inProfile")}</span>
{:else if status === "disabled"}
	<span class="text-muted-foreground flex items-center gap-1.5 text-xs"
		><span class="border-muted-foreground size-1.5 rounded-full border"></span>{t("pill.disabled")}</span
	>
{:else if status === "dependency"}
	<span class="text-foreground-soft text-xs">{t("pill.dependency")}</span>
{:else}
	<span class="text-subtle-foreground text-xs">—</span>
{/if}
