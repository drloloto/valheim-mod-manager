<script lang="ts">
	import * as Select from "#lib/components/ui/select/index.js";
	import { cn } from "#lib/utils.js";

	let {
		value = $bindable(),
		options,
		onchange,
		class: className,
	}: { value: string; options: string[]; onchange?: (v: string) => void; class?: string } = $props();
</script>

<Select.Root
	type="single"
	bind:value={
		() => value,
		(v) => {
			if (!v) return;
			value = v;
			onchange?.(v);
		}
	}
>
	<Select.Trigger class={cn("w-full font-mono text-[12.5px]", className)} title={value}><span class="min-w-0 truncate">{value}</span></Select.Trigger>
	<Select.Content>
		{#each options as o (o)}
			<Select.Item value={o} label={o} class="font-mono text-[12.5px]">{o}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
