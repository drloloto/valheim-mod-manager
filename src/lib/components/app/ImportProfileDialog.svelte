<script lang="ts">
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { Button, Checkbox, Dialog, Input, Label } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let mode = $state<"code" | "file">("code");
	let code = $state("");
	let file = $state<string | null>(null);
	let name = $state("");
	let withConfigs = $state(true);
	let busy = $state(false);

	const ready = $derived(mode === "code" ? !!code.trim() : !!file);
	const fileName = $derived(file?.split(/[\\/]/).pop() ?? null);

	async function pickFile() {
		const sel = await openDialog({ multiple: false, filters: [{ name: t("profile.r2zFilter"), extensions: ["r2z", "zip"] }] });
		if (typeof sel === "string") file = sel;
	}

	async function submit() {
		if (!ready || busy) return;
		busy = true;
		try {
			const ok = mode === "code" ? await store.importCode(code.trim(), name.trim(), withConfigs) : await store.importFile(file!, name.trim(), withConfigs);
			if (ok) {
				open = false;
				code = "";
				file = null;
				name = "";
			}
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t("import.title")}</Dialog.Title>
			<Dialog.Description>{t("import.desc")}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<div class="flex gap-2">
				<Button size="sm" variant={mode === "code" ? "secondary" : "ghost"} onclick={() => (mode = "code")}>{t("import.code")}</Button>
				<Button size="sm" variant={mode === "file" ? "secondary" : "ghost"} onclick={() => (mode = "file")}>{t("import.file")}</Button>
			</div>
			{#if mode === "code"}
				<div class="grid gap-2">
					<Label for="import-code">{t("import.codeLabel")}</Label>
					<Input id="import-code" bind:value={code} placeholder={t("import.codePlaceholder")} />
				</div>
			{:else}
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" onclick={pickFile}>{t("import.chooseFile")}</Button>
					<span class="text-muted-foreground truncate text-sm">{fileName ?? t("import.noFile")}</span>
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="import-name">{t("import.nameLabel")}</Label>
				<Input id="import-name" bind:value={name} placeholder={t("import.namePlaceholder")} />
			</div>
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={withConfigs} />
				{t("import.withConfigs")}
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
			<Button onclick={submit} disabled={busy || !ready}>{t("import.submit")}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
