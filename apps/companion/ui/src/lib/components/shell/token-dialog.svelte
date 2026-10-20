<script lang="ts">
	import { Button, Checkbox, Dialog, Input, Label } from "#lib/components/kit/index.js";
	import { session } from "#lib/api.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";

	let { open = $bindable(false) }: { open: boolean } = $props();

	let token = $state("");
	let remember = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			if (await session.signIn(token.trim(), remember)) {
				open = false;
				token = "";
			} else error = t("auth.rejected");
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<form onsubmit={submit} class="flex flex-col gap-4">
			<Dialog.Header>
				<Dialog.Title>{t("auth.title")}</Dialog.Title>
				<Dialog.Description>{t("auth.desc")}</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2">
				<Label for="token">{t("auth.token")}</Label>
				<Input id="token" type="password" autocomplete="off" spellcheck={false} bind:value={token} />
				{#if error}<p class="text-destructive-text text-xs">{error}</p>{/if}
			</div>
			<Label class="flex items-center gap-2 text-sm font-normal">
				<Checkbox bind:checked={remember} />
				{t("auth.remember")}
			</Label>
			{#if session.status?.companion.tokenSource === "generated" || session.status?.companion.tokenSource === "file"}
				<p class="text-muted-foreground text-xs leading-relaxed">
					{t("auth.whereA")} <code class="bg-field rounded px-1 font-mono">docker compose logs companion</code>
					{t("auth.whereB")} <code class="bg-field rounded px-1 font-mono">config/modmanager/companion-token</code>.
				</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
				<Button type="submit" disabled={busy || !token.trim()}>{t("auth.signIn")}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
