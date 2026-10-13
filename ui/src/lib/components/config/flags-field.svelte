<script lang="ts">
	import { Chip } from "#lib/components/kit/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	// A flags enum ("Multiple values can be set"): one chip per allowed value, any number of them on.
	let { options, value, onchange, disabled = false }: { options: string[]; value: string[]; onchange: (v: string[]) => void; disabled?: boolean } = $props();

	function toggle(o: string) {
		if (disabled) return;
		onchange(value.includes(o) ? value.filter((x) => x !== o) : options.filter((x) => x === o || value.includes(x)));
	}
</script>

<div class="flex flex-wrap items-center gap-1.5" role="group">
	{#each options as o (o)}
		<Chip active={value.includes(o)} onclick={() => toggle(o)} title={o}><span class="font-mono">{o}</span></Chip>
	{/each}
	{#if !value.length}<span class="text-subtle-foreground font-mono text-[11px]">{t("configs.noneSelected")}</span>{/if}
</div>
