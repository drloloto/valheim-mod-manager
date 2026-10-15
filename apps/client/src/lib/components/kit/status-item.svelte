<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	let {
		tone = "muted",
		pulse = false,
		href,
		onclick,
		title,
		class: className,
		children,
	}: {
		/** Color of the leading dot; "hollow" is an outlined dot, "none" draws no dot. */
		tone?: "ok" | "warn" | "err" | "muted" | "hollow" | "none";
		pulse?: boolean;
		/** Renders a link … */
		href?: string;
		/** … or a button; neither renders a plain span. */
		onclick?: () => void;
		title?: string;
		class?: string;
		children: Snippet;
	} = $props();

	const DOT = {
		ok: "bg-success",
		warn: "bg-primary",
		err: "bg-destructive",
		muted: "bg-muted-foreground",
		hollow: "border-muted-foreground border",
		none: "",
	} as const;
	const classes = $derived(cn("flex min-w-0 items-center gap-1.5", (href || onclick) && "hover:underline", className));
</script>

<!-- One entry of the status bar: dot plus a label that truncates instead of pushing its neighbours out. -->
{#snippet inner()}
	{#if tone !== "none"}<span class={cn("size-1.5 shrink-0 rounded-full", DOT[tone], pulse && "animate-pulse")}></span>{/if}
	<span class="truncate">{@render children()}</span>
{/snippet}

{#if href}
	<a {href} {title} class={classes}>{@render inner()}</a>
{:else if onclick}
	<button type="button" {onclick} {title} class={classes}>{@render inner()}</button>
{:else}
	<span {title} class={classes}>{@render inner()}</span>
{/if}
