<script lang="ts">
	import { Input } from "#lib/components/kit/index.js";

	// {"x":0.0,"y":0.05,"z":0.0}: one number per axis.
	let {
		axes,
		value,
		onchange,
		disabled = false,
	}: { axes: string[]; value: Record<string, number>; onchange: (v: Record<string, number>) => void; disabled?: boolean } = $props();
</script>

<div class="flex flex-wrap gap-2">
	{#each axes as a (a)}
		<label class="flex items-center gap-1.5">
			<span class="text-subtle-foreground w-4 text-right font-mono text-[11px]">{a}</span>
			<Input
				type="number"
				step="any"
				value={Number.isFinite(value[a]) ? value[a] : ""}
				oninput={(e) => onchange({ ...value, [a]: e.currentTarget.value === "" ? NaN : Number(e.currentTarget.value) })}
				{disabled}
				class="h-7 w-24 font-mono text-[12px]"
			/>
		</label>
	{/each}
</div>
