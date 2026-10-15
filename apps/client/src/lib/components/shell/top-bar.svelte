<script lang="ts">
	import { page } from "$app/state";
	import Settings from "@lucide/svelte/icons/settings";
	import { resolve } from "$app/paths";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "@vmm/ui/utils.js";
	import NavTabs from "./nav-tabs.svelte";
	import PlayButton from "./play-button.svelte";
	import ProfileSwitcher from "./profile-switcher.svelte";
	import ServerChip from "./server-chip.svelte";

	let switcher = $state<ReturnType<typeof ProfileSwitcher>>();

	export function newProfile() {
		switcher?.openNew();
	}
</script>

<!-- Toolbar: profile, sections and Play on one calm surface; no boxes, just a divider. -->
<div class="bg-panel h-toolbar flex shrink-0 items-center gap-1 border-b px-2.5">
	<ProfileSwitcher bind:this={switcher} />
	<span class="bg-border mx-2 h-5 w-px shrink-0" aria-hidden="true"></span>
	<NavTabs />
	<span class="bg-border mx-2 h-5 w-px shrink-0" aria-hidden="true"></span>
	<ServerChip />
	<div class="flex-1"></div>
	<a
		href={resolve("settings")}
		title={t("nav.settingsShortcut")}
		aria-label={t("nav.settings")}
		aria-current={page.url.pathname === resolve("settings") ? "page" : undefined}
		class={cn(
			"text-foreground-soft hover:text-foreground hover:bg-hover mr-2 flex size-[34px] shrink-0 items-center justify-center rounded-[5px]",
			"aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
		)}><Settings class="size-4" /></a
	>

	<PlayButton />
</div>
