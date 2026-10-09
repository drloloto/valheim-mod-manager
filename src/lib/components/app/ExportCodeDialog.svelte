<script lang="ts">
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import { Button, Dialog } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { code = $bindable(null) }: { code: string | null } = $props();
	let copied = $state(false);

	async function copy() {
		if (!code) return;
		try {
			await writeText(code);
			copied = true;
		} catch {
			store.toast(t("common.copyFailed"), "err");
		}
	}

	$effect(() => {
		copied = false;
		if (code) copy();
	});
</script>

<Dialog.Root open={code !== null} onOpenChange={(o) => !o && (code = null)}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>{t("export.title")}</Dialog.Title>
			<Dialog.Description>
				{t("export.desc")}
				{copied ? t("export.inClipboard") : ""}
			</Dialog.Description>
		</Dialog.Header>
		<div class="bg-muted rounded-md p-4 text-center font-mono text-lg tracking-wider select-all">{code}</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={copy}>{t("common.copy")}</Button>
			<Button onclick={() => (code = null)}>{t("common.done")}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
