<script lang="ts">
	import { onMount, tick } from "svelte";
	import { listen } from "@tauri-apps/api/event";
	import { Button, Chip, Input, Switch, Toolbar } from "#lib/components/kit/index.js";
	import { api } from "#lib/api/client.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { LogChunk } from "#lib/api/types.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const MAX_LINES = 5000;
	const LEVELS = ["Fatal", "Error", "Warning", "Message", "Info", "Debug"] as const;
	type Level = (typeof LEVELS)[number];

	let lines = $state.raw<string[]>([]);
	let query = $state("");
	let levels = $state<Set<Level>>(new Set(LEVELS));
	let follow = $state(true);
	let scroller = $state<HTMLDivElement>();

	function levelOf(line: string): Level | null {
		const m = /^\[(\w+)\s*:/.exec(line);
		return m && (LEVELS as readonly string[]).includes(m[1]) ? (m[1] as Level) : null;
	}

	function colorOf(line: string): string {
		switch (levelOf(line)) {
			case "Fatal":
			case "Error":
				return "text-destructive-text";
			case "Warning":
				return "text-primary";
			case "Debug":
				return "text-subtle-foreground";
			default:
				return "text-foreground-soft";
		}
	}

	const visible = $derived.by(() => {
		const q = query.toLowerCase();
		return lines.filter((l) => {
			const lv = levelOf(l);
			if (lv && !levels.has(lv)) return false;
			return !q || l.toLowerCase().includes(q);
		});
	});

	function append(chunk: LogChunk) {
		const next = chunk.reset ? chunk.lines : [...lines, ...chunk.lines];
		lines = next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
	}

	function toggleLevel(l: Level) {
		const next = new Set(levels);
		if (next.has(l)) next.delete(l);
		else next.add(l);
		levels = next;
	}

	async function start() {
		try {
			lines = await api.startLogTail();
		} catch (e) {
			lines = [];
			if (store.state.active) store.toast(e instanceof Error ? e.message : t("log.openFailed"), "err");
		}
	}

	$effect(() => {
		// follow the log of the active profile
		void store.state.active;
		start();
	});

	$effect(() => {
		void visible.length;
		if (!follow || !scroller) return;
		const el = scroller;
		tick().then(() => (el.scrollTop = el.scrollHeight));
	});

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		listen<LogChunk>("log://lines", (e) => append(e.payload)).then((u) => {
			if (disposed) u();
			else unlisten = u;
		});
		return () => {
			disposed = true;
			unlisten?.();
			api.stopLogTail().catch(() => {});
		};
	});
</script>

<div class="flex h-full flex-col">
	<Toolbar>
		<Input data-search class="w-72" placeholder={t("log.search")} bind:value={query} />
		<div class="flex gap-1">
			{#each LEVELS as l (l)}
				<Chip active={levels.has(l)} onclick={() => toggleLevel(l)}>{l}</Chip>
			{/each}
		</div>
		<div class="flex-1"></div>
		<label class="text-foreground-soft flex items-center gap-2 text-[12.5px]">{t("log.follow")} <Switch size="sm" bind:checked={follow} /></label>
		<Button size="sm" variant="outline" onclick={() => (lines = [])}>{t("common.clear")}</Button>
		<Button size="sm" variant="ghost" onclick={() => store.openFolder("profile")} disabled={!store.state.active}>{t("log.openFolder")}</Button>
	</Toolbar>
	<div bind:this={scroller} class="bg-chrome selectable scroll-y min-h-0 flex-1 px-4 py-3 font-mono text-xs leading-5">
		{#if !lines.length}
			<p class="text-muted-foreground font-sans text-[13px]">{t("log.empty")}</p>
		{/if}
		{#each visible as line, i (i)}
			<div class="whitespace-pre-wrap {colorOf(line)}">{line}</div>
		{/each}
	</div>
</div>
