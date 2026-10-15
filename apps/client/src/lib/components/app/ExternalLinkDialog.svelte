<script lang="ts">
	// Before the first external link opens: where it leads, that it opens in the system browser and that the
	// app has no say over that page. Asked once, or on every link when the user ticks the box.
	import { Button, Checkbox, Dialog } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let askAgain = $state(false);
	const url = $derived(store.externalPrompt);
	const host = $derived.by(() => {
		try {
			return url ? new URL(url).host || url : "";
		} catch {
			return url ?? "";
		}
	});
</script>

<Dialog.Root open={url !== null} onOpenChange={(o) => !o && (store.externalPrompt = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t("external.title")}</Dialog.Title>
			<Dialog.Description>{t("external.desc", { host })}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3 text-[13px]">
			<p class="bg-field text-foreground-soft selectable rounded-[4px] border px-2.5 py-2 font-mono text-xs break-all">{url}</p>
			<ul class="text-muted-foreground grid list-disc gap-1 pl-5 text-xs leading-snug">
				<li>{t("external.noControl")}</li>
				<li>{t("external.downloads")}</li>
				<li>{t("external.privacy")}</li>
			</ul>
			<label class="flex items-center gap-2 text-xs">
				<Checkbox bind:checked={askAgain} />
				{t("external.askAgain")}
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (store.externalPrompt = null)}>{t("common.cancel")}</Button>
			<Button onclick={() => store.confirmExternal(askAgain)}>{t("external.open")}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
