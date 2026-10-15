<script lang="ts">
	// Sanitized markdown (see lib/markdown.ts). Links never navigate the WebView: every click on an
	// anchor is handed to `onlink`, broken images are hidden instead of showing a frame.
	import { renderMarkdown } from "#lib/markdown.js";
	import { cn } from "@vmm/ui/utils.js";

	let { source, onlink, class: className }: { source: string; onlink: (href: string) => void; class?: string } = $props();

	const html = $derived(renderMarkdown(source));
	let root = $state<HTMLDivElement | null>(null);

	function click(e: MouseEvent) {
		const a = (e.target as HTMLElement | null)?.closest("a");
		if (!a) return;
		e.preventDefault();
		const href = a.getAttribute("href") ?? "";
		if (href.startsWith("#")) {
			root?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "start" });
			return;
		}
		if (href) onlink(href);
	}

	function hideBroken(e: Event) {
		const img = e.target as HTMLElement | null;
		if (img?.tagName === "IMG") img.style.display = "none";
	}
</script>

<!-- eslint-disable svelte/no-at-html-tags -- renderMarkdown sanitizes with DOMPurify -->
<div bind:this={root} class={cn("md selectable", className)} onclick={click} onerrorcapture={hideBroken} role="presentation">
	{@html html}
</div>
