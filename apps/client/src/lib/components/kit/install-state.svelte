<script lang="ts">
	// Install state of a row on the Installed page: always dot + word, the same shape for every state.
	// An available update is the only clickable one, still dot + word, so the column reads as one list.
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";
	import type { InstallState } from "#lib/installed.js";

	let { state, version, onupdate }: { state: InstallState; version?: string | null; onupdate?: (e: MouseEvent) => void } = $props();

	const TONE: Record<InstallState, { text: string; dot: string }> = {
		ok: { text: "text-success", dot: "bg-success" },
		disabled: { text: "text-muted-foreground", dot: "border-muted-foreground border bg-transparent" },
		update: { text: "text-primary-text", dot: "bg-primary" },
		missing: { text: "text-destructive-text", dot: "bg-destructive" },
		installing: { text: "text-primary-text", dot: "bg-primary animate-pulse" },
	};
	const tone = $derived(TONE[state]);
	const label = $derived(state === "update" && version ? t("state.updateTo", { v: version }) : t(`state.${state}`));
</script>

{#if state === "update" && onupdate}
	<button
		type="button"
		onclick={onupdate}
		title={t("pill.updateTo", { v: version ?? "" })}
		class={cn("hover:bg-primary-tint -mx-1.5 flex h-6 max-w-full items-center gap-1.5 rounded-[4px] px-1.5 text-xs", tone.text)}
	>
		<span class={cn("size-1.5 shrink-0 rounded-full", tone.dot)}></span><span class="truncate underline-offset-2 hover:underline">{label}</span>
	</button>
{:else}
	<span class={cn("flex h-6 max-w-full items-center gap-1.5 text-xs", tone.text)}>
		<span class={cn("size-1.5 shrink-0 rounded-full", tone.dot)}></span><span class="truncate">{label}</span>
	</span>
{/if}
