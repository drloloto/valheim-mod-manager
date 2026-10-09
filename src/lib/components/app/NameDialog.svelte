<script lang="ts">
	import { Button, Dialog, Input, Label } from "#lib/components/kit/index.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let {
		open = $bindable(false),
		title,
		description,
		submitLabel,
		initial = "",
		onSubmit,
	}: {
		open?: boolean;
		title: string;
		description: string;
		submitLabel: string;
		initial?: string;
		onSubmit: (name: string) => Promise<boolean>;
	} = $props();

	let name = $state("");
	let busy = $state(false);

	$effect(() => {
		if (open) name = initial;
	});

	async function submit() {
		if (!name.trim() || busy) return;
		busy = true;
		try {
			if (await onSubmit(name.trim())) open = false;
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
		<div class="grid gap-2">
			<Label for="name-dialog-input">{t("common.name")}</Label>
			<Input id="name-dialog-input" bind:value={name} onkeydown={(e) => e.key === "Enter" && submit()} />
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
			<Button onclick={submit} disabled={busy || !name.trim()}>{submitLabel}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
