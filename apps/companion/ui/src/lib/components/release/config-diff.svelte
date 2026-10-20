<script lang="ts">
	import { DiffModeEnum, DiffView } from "@git-diff-view/svelte";
	import { generateDiffFile } from "@git-diff-view/file";
	import "@git-diff-view/svelte/styles/diff-view-pure.css";
	import { t } from "#lib/i18n/index.svelte.js";

	// Live file vs. staged copy, rendered by @git-diff-view/svelte in the Werkbank colours (app.css).
	let { path, before, after, mode = "unified" }: { path: string; before: string | null; after: string | null; mode?: "unified" | "split" } = $props();

	const lang = $derived(
		path.toLowerCase().endsWith(".json") ? "json" : path.toLowerCase().endsWith(".cfg") || path.toLowerCase().endsWith(".ini") ? "ini" : "plaintext",
	);
	const file = $derived.by(() => {
		if (after === null) return null;
		const f = generateDiffFile(path, before ?? "", path, after, lang, lang);
		f.initTheme("dark");
		f.init();
		f.buildSplitDiffLines();
		f.buildUnifiedDiffLines();
		return f;
	});
</script>

{#if !file}
	<p class="text-muted-foreground px-4 py-3 text-xs">{t("release.s3.tooLarge")}</p>
{:else}
	<div class="overflow-x-auto text-[12px]">
		<DiffView
			diffFile={file}
			diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
			diffViewTheme="dark"
			diffViewHighlight={true}
			diffViewWrap={true}
			diffViewFontSize={12}
		/>
	</div>
{/if}
