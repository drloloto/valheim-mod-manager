<script lang="ts">
	import Cloud from "@lucide/svelte/icons/cloud";
	import Server from "@lucide/svelte/icons/server";
	import KeyRound from "@lucide/svelte/icons/key-round";
	import Eye from "@lucide/svelte/icons/eye";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";

	// The linked server of the active profile, in the toolbar: how it is reached, what it is called,
	// whether the profile matches it, and whether this machine may publish (admin) or only follow (read only).
	const link = $derived(store.server);
	const check = $derived(store.serverStatus);
	const name = $derived(check?.name || link?.name || link?.url || "");
	const admin = $derived(store.serverAdmin);
	const modDiff = $derived(check ? check.diff.changed.length + check.diff.onlyLocal.length + check.diff.onlyServer.length : 0);
	const configDiff = $derived(check?.configsChanged.length ?? 0);
	/** A release the server still has to act on: staged or scheduled over the gist, or pending on the companion. */
	const pendingState = $derived(
		check?.gistRelease && (check.gistRelease.state === "staged" || check.gistRelease.state === "scheduled")
			? check.gistRelease.state
			: check?.release
				? "staged"
				: null,
	);

	type Tone = "ok" | "warn" | "err" | "muted";
	const DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-primary", err: "bg-destructive", muted: "bg-muted-foreground" };
	const view = $derived.by((): { tone: Tone; text: string; pulse: boolean } => {
		if (!check) return { tone: "muted", text: t("chip.checking"), pulse: true };
		if (!check.reachable) return { tone: "err", text: t("chip.unreachable"), pulse: false };
		if (pendingState) return { tone: "warn", text: t("chip.release", { state: pendingState }), pulse: true };
		if (check.inSync) return { tone: "ok", text: t("chip.inSync"), pulse: false };
		const what = [modDiff ? t("chip.mods", { n: modDiff }) : "", configDiff ? t("chip.configs", { n: configDiff }) : ""].filter(Boolean).join(" · ");
		return { tone: "warn", text: t("chip.differs", { what }), pulse: false };
	});

	const title = $derived.by(() => {
		const lines = [link?.gist ? t("chip.viaGist") : t("chip.viaHttp", { url: link?.url ?? "" }), admin ? t("chip.adminHint") : t("chip.readOnlyHint")];
		if (check?.error) lines.push(check.error);
		if (check?.reachable) {
			const nameOf = (id: string) => store.byId.get(id)?.name ?? id;
			for (const c of check.diff.changed) lines.push(t("server.changed", { id: nameOf(c.id), local: c.local, server: c.server }));
			for (const m of check.diff.onlyServer) lines.push(t("server.onlyServer", { id: nameOf(m.id), version: m.version }));
			for (const m of check.diff.onlyLocal) lines.push(t("server.onlyLocal", { id: nameOf(m.id), version: m.version }));
			if (configDiff) lines.push(t("server.configsChanged", { n: configDiff }));
		}
		return lines.join("\n");
	});

	function act() {
		if (!check?.reachable) {
			store.refreshServerStatus();
			return;
		}
		// An admin with a difference or a waiting release goes to publish; everyone else sees what differs.
		if (admin && (pendingState || !check.inSync)) store.serverDialog = "publish";
		else if (!check.inSync || pendingState) store.serverDialog = "diff";
		else if (admin) store.serverDialog = "publish";
		else store.refreshServerStatus();
	}
</script>

{#if link}
	{@const Icon = link.gist ? Cloud : Server}
	<button
		type="button"
		{title}
		onclick={act}
		class={cn("text-foreground-soft hover:text-foreground hover:bg-hover text-row flex h-[34px] max-w-[380px] min-w-0 items-center gap-2 rounded-[5px] px-3")}
	>
		<Icon class="size-3.5 shrink-0" aria-hidden="true" />
		<span class="truncate font-medium">{name}</span>
		<span class="flex min-w-0 items-center gap-1.5">
			<span class={cn("size-1.5 shrink-0 rounded-full", DOT[view.tone], view.pulse && "animate-pulse")}></span>
			<span class="text-meta truncate">{view.text}</span>
		</span>
		<span class="text-subtle-foreground text-meta flex shrink-0 items-center gap-1 font-mono">
			{#if admin}<KeyRound class="size-3" aria-hidden="true" />{t("chip.admin")}{:else}<Eye class="size-3" aria-hidden="true" />{t("chip.readOnly")}{/if}
		</span>
	</button>
{/if}
