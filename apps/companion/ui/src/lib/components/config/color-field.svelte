<script lang="ts">
	import { Input } from "#lib/components/kit/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	// BepInEx colours are RRGGBBAA hex: a native colour picker for the RGB part, alpha as 0–255, the hex as text.
	let { value, onchange, disabled = false }: { value: string; onchange: (v: string) => void; disabled?: boolean } = $props();

	const valid = $derived(/^[0-9A-F]{6}([0-9A-F]{2})?$/i.test(value));
	const rgb = $derived(valid ? `#${value.slice(0, 6)}` : "#000000");
	const alpha = $derived(valid && value.length === 8 ? parseInt(value.slice(6, 8), 16) : 255);
	const hex2 = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();
</script>

<div class="flex flex-wrap items-center gap-2">
	<input
		type="color"
		value={rgb}
		{disabled}
		oninput={(e) => onchange(`${e.currentTarget.value.slice(1).toUpperCase()}${hex2(alpha)}`)}
		class="border-input bg-field h-7 w-9 cursor-pointer rounded-md border p-0.5"
		aria-label="RGB"
	/>
	<Input
		{value}
		oninput={(e) => onchange(e.currentTarget.value.toUpperCase())}
		{disabled}
		class="h-7 w-28 font-mono text-[12px] uppercase"
		maxlength={8}
		aria-label="hex"
	/>
	<label class="flex items-center gap-1.5">
		<span class="text-subtle-foreground font-mono text-[11px]">{t("configs.alpha")}</span>
		<Input
			type="number"
			min={0}
			max={255}
			value={alpha}
			oninput={(e) => onchange(`${(valid ? value : "000000").slice(0, 6)}${hex2(Number(e.currentTarget.value))}`)}
			{disabled}
			class="h-7 w-20 font-mono text-[12px]"
		/>
	</label>
</div>
