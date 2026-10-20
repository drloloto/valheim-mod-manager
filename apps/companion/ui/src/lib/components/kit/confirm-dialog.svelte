<script lang="ts">
	import { Button } from "@vmm/ui/components/ui/button/index.js";
	import * as Dialog from "@vmm/ui/components/ui/dialog/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		destructive = false,
		onconfirm,
	}: {
		open: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		destructive?: boolean;
		onconfirm: () => void | Promise<void>;
	} = $props();

	let busy = $state(false);

	async function confirm() {
		busy = true;
		try {
			await onconfirm();
			open = false;
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
			<Button variant={destructive ? "destructive" : "default"} disabled={busy} onclick={confirm}>{confirmLabel}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
