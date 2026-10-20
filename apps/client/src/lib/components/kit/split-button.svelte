<script lang="ts">
	import type { Snippet } from "svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { Button } from "@vmm/ui/components/ui/button/index.js";
	import * as DropdownMenu from "@vmm/ui/components/ui/dropdown-menu/index.js";

	let {
		children,
		onclick,
		disabled = false,
		menu,
		menuLabel,
		title,
	}: { children: Snippet; onclick: () => void; disabled?: boolean; menu: Snippet; menuLabel: string; title?: string } = $props();
</script>

<div class="flex overflow-hidden rounded-md">
	<Button size="lg" class="rounded-none" {disabled} {onclick} {title}>{@render children()}</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} size="lg" aria-label={menuLabel} class="bg-primary-hover border-primary-edge rounded-none border-0 border-l px-2.5">
					<ChevronDown class="size-3.5" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-60">{@render menu()}</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
