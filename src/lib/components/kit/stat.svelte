<script lang="ts">
	let { label, value }: { label: string; value: string } = $props();
</script>

<div class="flex min-w-0 flex-col gap-[3px]">
	<span class="label-caps truncate text-[10px] tracking-[0.06em]">{label}</span>
	<span class="truncate font-mono text-sm font-medium" title={value}>{value}</span>
</div>
