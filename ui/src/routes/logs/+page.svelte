<script lang="ts">
	import { tick } from "svelte";
	import { Button, EmptyState, Input, Toolbar } from "#lib/components/kit/index.js";
	import { api, attempt, followLog, session } from "#lib/api.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const MAX = 3000;
	let lines = $state<string[]>([]);
	let filter = $state("");
	let following = $state<AbortController | null>(null);
	let pre = $state<HTMLPreElement>();

	const shown = $derived((filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines).slice(-800));
	const can = $derived(session.authed && session.on("logs"));

	$effect(() => {
		if (can) load();
		return () => following?.abort();
	});

	async function scrollDown() {
		await tick();
		if (pre) pre.scrollTop = pre.scrollHeight;
	}

	async function load() {
		const r = await attempt(() => api<{ lines: string[] }>("/logs?tail=400"));
		if (r) lines = r.lines;
		scrollDown();
	}

	function follow() {
		if (following) {
			following.abort();
			following = null;
			return;
		}
		const ctrl = new AbortController();
		following = ctrl;
		lines = [];
		followLog((l) => {
			lines.push(l);
			if (lines.length > MAX) lines.splice(0, lines.length - MAX);
			scrollDown();
		}, ctrl.signal)
			.catch((e) => {
				if (!ctrl.signal.aborted) attempt(() => Promise.reject(e));
			})
			.finally(() => {
				if (following === ctrl) following = null;
			});
	}
</script>

{#if !can}
	<EmptyState title={t("auth.required")}>{t("auth.requiredHint")}</EmptyState>
{:else}
	<div class="flex h-full min-h-0 flex-col">
		<Toolbar>
			<Input type="search" placeholder={t("logs.filter")} bind:value={filter} class="max-w-xs" />
			<span class="flex-1"></span>
			<Button variant="outline" size="sm" disabled={!!following} onclick={load}>{t("logs.refresh")}</Button>
			<Button variant={following ? "default" : "outline"} size="sm" onclick={follow}>{following ? t("logs.stop") : t("logs.follow")}</Button>
		</Toolbar>
		<pre bind:this={pre} class="bg-chrome text-foreground-soft min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed">{shown.join(
				"\n",
			)}</pre>
	</div>
{/if}
