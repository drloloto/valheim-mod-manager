<script lang="ts">
	import { Input } from "#lib/components/kit/index.js";

	// "5 - 1000": a lower and an upper bound.
	let { value, onchange, disabled = false }: { value: [number, number]; onchange: (v: [number, number]) => void; disabled?: boolean } = $props();
	const num = (s: string) => (s === "" ? NaN : Number(s));
</script>

<div class="flex items-center gap-2">
	<Input
		type="number"
		step="any"
		value={Number.isFinite(value[0]) ? value[0] : ""}
		oninput={(e) => onchange([num(e.currentTarget.value), value[1]])}
		{disabled}
		class="h-7 w-24 font-mono text-[12px]"
		aria-label="min"
	/>
	<span class="text-subtle-foreground">–</span>
	<Input
		type="number"
		step="any"
		value={Number.isFinite(value[1]) ? value[1] : ""}
		oninput={(e) => onchange([value[0], num(e.currentTarget.value)])}
		{disabled}
		class="h-7 w-24 font-mono text-[12px]"
		aria-label="max"
	/>
</div>
