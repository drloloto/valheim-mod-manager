<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { ConfirmDialog, DropdownMenu, SplitButton } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const incomplete = $derived(store.readiness.status === "incomplete" && store.readiness.missing.length > 0);
	const names = $derived(store.readiness.missing.map((m) => store.byId.get(m.id)?.name ?? m.id).join(", "));
</script>

<SplitButton
	onclick={() => store.requestLaunch(true)}
	disabled={store.launching || !store.state.active}
	menuLabel={t("play.more")}
	title={incomplete ? t("play.incomplete") : undefined}
>
	{store.launching ? t("play.starting") : `${incomplete ? "⚠" : "▶"} ${t("play.start")}`}
	{#snippet menu()}
		<DropdownMenu.Item disabled={store.launching} onSelect={() => store.launch(false)}>{t("play.vanilla")}</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => store.openFolder("game")}>{t("play.gameFolder")}</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => goto(resolve("logs"))}>{t("play.showLog")}</DropdownMenu.Item>
	{/snippet}
</SplitButton>

<ConfirmDialog
	bind:open={store.launchConfirm}
	title={t("readiness.launchTitle")}
	description={t("readiness.launchDesc", { n: store.readiness.missing.length, names })}
	confirmLabel={t("readiness.launchAnyway")}
	destructive
	onconfirm={() => store.launch(true)}
/>
