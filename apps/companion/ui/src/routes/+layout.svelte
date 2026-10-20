<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { Toaster } from "#lib/components/kit/index.js";
	import TopBar from "#lib/components/shell/top-bar.svelte";
	import StatusBar from "#lib/components/shell/status-bar.svelte";
	import { session } from "#lib/api.svelte.js";
	import { locale } from "#lib/i18n/index.svelte.js";

	let { children } = $props();

	onMount(() => {
		document.documentElement.lang = locale;
		session.refresh();
		const timer = setInterval(() => session.refresh(), 15_000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		document.title = session.status?.server.name || "Valheim Server";
	});
</script>

<div class="flex h-screen flex-col">
	<TopBar />
	<main class="min-h-0 flex-1 overflow-auto">{@render children()}</main>
	<StatusBar />
</div>

<Toaster theme="dark" position="bottom-right" offset={{ bottom: 40, right: 16 }} />
