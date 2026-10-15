<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";

	let {
		field,
		op,
		value,
		negative = false,
		onflip,
		onremove,
	}: {
		field: string;
		op: string;
		value: string;
		/** Exclusion form (is not, older than, outside) */
		negative?: boolean;
		/** Clicking the operator inverts it */
		onflip: () => void;
		onremove: () => void;
	} = $props();
</script>

<!-- Active filter as a "field · operator · value" token: flat, one border, only the operator carries color. -->
<div class="bg-field border-border flex h-[26px] max-w-full items-center overflow-hidden rounded-[5px] border text-xs">
	<span class="text-muted-foreground shrink-0 pl-2">{field}</span>
	<button
		type="button"
		class={cn("hover:bg-muted mx-1 h-full shrink-0 px-1.5 font-mono text-[11px] font-medium", negative ? "text-destructive-text" : "text-primary")}
		title={t("filter.flipOp")}
		onclick={onflip}
	>
		{op}
	</button>
	<span class={cn("text-foreground min-w-0 truncate font-medium", negative && "decoration-destructive-text/60 line-through")} title={value}>{value}</span>
	<button
		type="button"
		class="text-subtle-foreground hover:text-foreground flex h-full shrink-0 items-center px-1.5"
		aria-label={t("filter.removeToken", { field })}
		onclick={onremove}
	>
		<X class="size-3" />
	</button>
</div>
