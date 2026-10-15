<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";

	let {
		value = $bindable(),
		placeholder,
		onpick,
		onopen,
		check = null,
		id,
	}: {
		value: string | null;
		placeholder?: string;
		onpick: () => void;
		onopen?: () => void;
		check?: { ok: boolean; text: string } | null;
		id?: string;
	} = $props();
</script>

<div class="flex flex-col gap-2">
	<div class="flex gap-1.5">
		<Input {id} class="flex-1 font-mono text-[12.5px]" spellcheck={false} {placeholder} bind:value={() => value ?? "", (v) => (value = v || null)} />
		<Button variant="outline" onclick={onpick}>{t("common.choose")}</Button>
		{#if onopen}<Button variant="ghost" onclick={onopen}>{t("common.open")}</Button>{/if}
	</div>
	{#if check}
		<p class={cn("font-mono text-[11.5px]", check.ok ? "text-success" : "text-destructive-text")}>{check.ok ? "✓" : "✗"} {check.text}</p>
	{/if}
</div>
