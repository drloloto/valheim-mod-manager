<script lang="ts">
	import { onMount } from "svelte";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import Minus from "@lucide/svelte/icons/minus";
	import Square from "@lucide/svelte/icons/square";
	import Copy from "@lucide/svelte/icons/copy";
	import X from "@lucide/svelte/icons/x";
	import { t } from "#lib/i18n/index.svelte.js";
	import { BrandMark } from "#lib/components/kit/index.js";

	const win = getCurrentWindow();
	let maximized = $state(false);

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		const sync = () => win.isMaximized().then((m) => (maximized = m));
		sync();
		win.onResized(sync).then((u) => {
			if (disposed) u();
			else unlisten = u;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	});
</script>

<!-- data-tauri-drag-region only applies to the element itself, hence it is repeated on the children. Double-click maximizes. -->
<header data-tauri-drag-region class="bg-chrome text-muted-foreground h-titlebar flex shrink-0 items-center text-xs">
	<div data-tauri-drag-region class="flex items-center gap-2 pl-3.5">
		<BrandMark class="text-primary size-4" />
		<span data-tauri-drag-region>{t("app.name")}</span>
	</div>
	<div data-tauri-drag-region class="flex-1 self-stretch"></div>
	<div class="flex self-stretch">
		<button class="win-btn" aria-label={t("win.minimize")} onclick={() => win.minimize()}><Minus class="size-3.5" /></button>
		<button class="win-btn" aria-label={maximized ? t("win.restore") : t("win.maximize")} onclick={() => win.toggleMaximize()}>
			{#if maximized}<Copy class="size-3 -scale-x-100" />{:else}<Square class="size-3" />{/if}
		</button>
		<button class="win-btn win-close" aria-label={t("win.close")} onclick={() => win.close()}><X class="size-4" /></button>
	</div>
</header>

<style>
	.win-btn {
		display: flex;
		width: 46px;
		align-items: center;
		justify-content: center;
		color: var(--muted-foreground);
	}
	.win-btn:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	/* Windows system color for "close" */
	.win-close:hover {
		background: #c42b1c;
		color: white;
	}
</style>
