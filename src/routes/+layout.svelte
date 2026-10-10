<script lang="ts">
	import "../app.css";
	import "#lib/i18n/index.svelte.js";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Toaster } from "#lib/components/kit/index.js";
	import TitleBar from "#lib/components/shell/title-bar.svelte";
	import TopBar from "#lib/components/shell/top-bar.svelte";
	import StatusBar from "#lib/components/shell/status-bar.svelte";
	import { store } from "#lib/api/store.svelte.js";
	import { installDesktopGuards } from "#lib/desktop/guards.js";
	import { bindShortcuts } from "#lib/desktop/shortcuts.js";

	let { children } = $props();
	let topBar = $state<ReturnType<typeof TopBar>>();

	function focusSearch() {
		const el = document.querySelector<HTMLInputElement>("[data-search]");
		el?.focus();
		el?.select();
	}

	onMount(() => {
		const offGuards = installDesktopGuards();
		const offKeys = bindShortcuts({
			"Mod+K": focusSearch,
			"Mod+F": focusSearch,
			"Mod+1": () => goto(resolve("/")),
			"Mod+2": () => goto(resolve("installed")),
			"Mod+3": () => goto(resolve("config")),
			"Mod+4": () => goto(resolve("logs")),
			"Mod+,": () => goto(resolve("settings")),
			"Mod+N": () => topBar?.newProfile(),
			"Mod+Enter": () => store.state.active && store.requestLaunch(true),
			F5: (e) => {
				if (e.repeat) return;
				store.refreshIndex();
			},
		});

		// refresh "now" for relative date filters every ten minutes so a long session does not drift
		const clock = setInterval(() => (store.browse.now = Date.now()), 600_000);

		let cleanup: (() => void) | undefined;
		let disposed = false;
		store.init().then((c) => {
			if (disposed) c();
			else cleanup = c;
		});
		return () => {
			disposed = true;
			cleanup?.();
			offKeys();
			offGuards();
			clearInterval(clock);
		};
	});
</script>

<div class="flex h-screen flex-col">
	<TitleBar />
	<TopBar bind:this={topBar} />
	<main class="min-h-0 flex-1">{@render children()}</main>
	<StatusBar />
</div>

<Toaster theme="dark" position="bottom-right" offset={{ bottom: 40, right: 16 }} />
