<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { DropdownMenu, SplitButton } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
</script>

<SplitButton onclick={() => store.launch(true)} disabled={store.launching || !store.state.active} menuLabel={t("play.more")}>
	{store.launching ? t("play.starting") : `▶ ${t("play.start")}`}
	{#snippet menu()}
		<DropdownMenu.Item disabled={store.launching} onSelect={() => store.launch(false)}>{t("play.vanilla")}</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => store.openFolder("game")}>{t("play.gameFolder")}</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => goto(resolve("logs"))}>{t("play.showLog")}</DropdownMenu.Item>
	{/snippet}
</SplitButton>
