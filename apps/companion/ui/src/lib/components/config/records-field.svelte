<script lang="ts">
	import PlusIcon from "@lucide/svelte/icons/plus";
	import XIcon from "@lucide/svelte/icons/x";
	import { Button, Input } from "#lib/components/kit/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	// A value like "BjornMeat:1,Honey:1" or "Eye:1-1:1:unrestricted:multiplyByLevel,…": one row per entry,
	// one cell per colon-separated field, so the admin never counts commas and colons by hand.
	let { fields, value, onchange, disabled = false }: { fields: number; value: string[][]; onchange: (v: string[][]) => void; disabled?: boolean } = $props();

	const labels = $derived(
		fields === 2
			? [t("configs.item"), t("configs.amount")]
			: Array.from({ length: fields }, (_, i) => (i === 0 ? t("configs.item") : t("configs.field", { n: i + 1 }))),
	);

	function set(row: number, col: number, v: string) {
		onchange(value.map((r, i) => (i === row ? r.map((c, j) => (j === col ? v : c)) : r)));
	}
	const remove = (row: number) => onchange(value.filter((_, i) => i !== row));
	const add = () => onchange([...value, Array.from({ length: fields }, () => "")]);
</script>

<div class="border-line-subtle bg-field/40 flex flex-col gap-1 rounded-md border p-1.5">
	{#if value.length}
		<div
			class="grid items-center gap-1"
			style={`grid-template-columns: ${fields === 2 ? "minmax(0,2fr) minmax(0,1fr)" : `repeat(${fields}, minmax(0,1fr))`} 1.5rem`}
		>
			{#each labels as l, i (i)}<span class="label-caps truncate px-1">{l}</span>{/each}
			<span></span>
			{#each value as row, r (r)}
				{#each row as cell, c (c)}
					<Input
						value={cell}
						oninput={(e) => set(r, c, e.currentTarget.value)}
						{disabled}
						class="h-7 font-mono text-[12px]"
						aria-label={`${labels[c]} ${r + 1}`}
					/>
				{/each}
				<Button
					variant="ghost"
					size="icon-sm"
					class="size-6"
					{disabled}
					onclick={() => remove(r)}
					title={t("configs.removeRow")}
					aria-label={t("configs.removeRow")}><XIcon class="size-3.5" /></Button
				>
			{/each}
		</div>
	{/if}
	<div>
		<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" {disabled} onclick={add}><PlusIcon class="size-3.5" />{t("configs.addRow")}</Button>
	</div>
</div>
