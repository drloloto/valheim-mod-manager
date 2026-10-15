<script lang="ts">
	import { initials } from "#lib/format.js";
	import { cn } from "@vmm/ui/utils.js";

	let { name, icon, size = "sm" }: { name: string; icon?: string; size?: "sm" | "md" | "lg" } = $props();
	let failed = $state(false);
	const box = $derived(
		size === "lg" ? "size-14 rounded-lg text-[13px]" : size === "md" ? "size-8 rounded-[5px] text-[10px]" : "size-[30px] rounded-[5px] text-[10px]",
	);
</script>

{#if icon && !failed}
	<img src={icon} alt="" loading="lazy" draggable="false" class={cn("shrink-0 object-cover", box)} onerror={() => (failed = true)} />
{:else}
	<span class={cn("avatar-stripes text-muted-foreground flex shrink-0 items-center justify-center font-mono font-medium", box)}>
		{initials(name)}
	</span>
{/if}

<style>
	.avatar-stripes {
		background: repeating-linear-gradient(135deg, var(--muted) 0 4px, var(--line-subtle) 4px 8px);
	}
</style>
