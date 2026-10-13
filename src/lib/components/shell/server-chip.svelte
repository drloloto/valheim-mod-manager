<script lang="ts">
	import Cloud from "@lucide/svelte/icons/cloud";
	import Server from "@lucide/svelte/icons/server";
	import KeyRound from "@lucide/svelte/icons/key-round";
	import Eye from "@lucide/svelte/icons/eye";
	import { serverView, type ServerTone } from "#lib/api/server-view.js";
	import { store } from "#lib/api/store.svelte.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import { cn } from "#lib/utils.js";

	// The linked server of the active profile, in the toolbar: how it is reached, what it is called, the
	// state (one reading shared with the status bar, see server-view.ts), and whether this machine may
	// publish (admin) or only follow (read only).
	const link = $derived(store.server);
	const check = $derived(store.serverStatus);
	const name = $derived(store.serverName);
	const admin = $derived(store.serverAdmin);
	const view = $derived(serverView(check, admin, t));

	const DOT: Record<ServerTone, string> = { ok: "bg-success", warn: "bg-primary", err: "bg-destructive", muted: "bg-muted-foreground" };

	const title = $derived.by(() => {
		const lines = [link?.gist ? t("chip.viaGist") : t("chip.viaHttp", { url: link?.url ?? "" }), admin ? t("chip.adminHint") : t("chip.readOnlyHint")];
		if (check?.error) lines.push(check.error);
		if (check?.reachable) {
			const nameOf = (id: string) => store.byId.get(id)?.name ?? id;
			for (const c of check.diff.changed) lines.push(t("server.changed", { id: nameOf(c.id), local: c.local, server: c.server }));
			for (const m of check.diff.onlyServer) lines.push(t("server.onlyServer", { id: nameOf(m.id), version: m.version }));
			for (const m of check.diff.onlyLocal) lines.push(t("server.onlyLocal", { id: nameOf(m.id), version: m.version }));
			if (view.release) lines.push(t("chip.releaseLine", { id: check.gistRelease?.id ?? check.release?.id ?? "", state: view.release }));
		}
		return lines.join("\n");
	});
</script>

{#if link}
	{@const Icon = link.gist ? Cloud : Server}
	<button
		type="button"
		{title}
		onclick={() => store.serverAct(view.action)}
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
