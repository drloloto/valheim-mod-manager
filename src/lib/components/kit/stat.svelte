<script lang="ts">
	let { label, value }: { label: string; value: string } = $props();
</script>

<div class="flex flex-col gap-[3px]">
	<span class="label-caps text-[10px] tracking-[0.06em]">{label}</span>
	<span class="font-mono text-sm font-medium">{value}</span>
</div>
