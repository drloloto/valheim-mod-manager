<script lang="ts">
	let { value = $bindable(), min, max, label }: { value: number; min: number; max: number; label: string } = $props();

	function set(v: number) {
		value = Math.max(min, Math.min(max, v));
	}
</script>

<div
	role="spinbutton"
	tabindex="0"
	aria-label={label}
	aria-valuenow={value}
	aria-valuemin={min}
	aria-valuemax={max}
	class="border-line-strong flex w-max overflow-hidden rounded-[5px] border font-mono text-[13px] focus-visible:outline-2"
	onkeydown={(e) => {
		if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + 1);
		else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - 1);
		else return;
		e.preventDefault();
	}}
>
	<button
		type="button"
		tabindex="-1"
		class="text-foreground-soft hover:bg-muted size-8 disabled:opacity-40"
		disabled={value <= min}
		onclick={() => set(value - 1)}>−</button
	>
	<span class="border-input bg-field flex h-8 w-11 items-center justify-center border-x">{value}</span>
	<button
		type="button"
		tabindex="-1"
		class="text-foreground-soft hover:bg-muted size-8 disabled:opacity-40"
		disabled={value >= max}
		onclick={() => set(value + 1)}>+</button
	>
</div>
