<script lang="ts">
	// Publish the active profile as a Thunderstore modpack. Everything the package needs is on one
	// page: team, name, version, description, categories, icon, README (generated, editable),
	// changelog, configs. Nothing leaves the machine before "Publish".
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { Button, Checkbox, Chip, Dialog, Input, Label } from "#lib/components/kit/index.js";
	import { store } from "#lib/api/store.svelte.js";
	import type { ModpackPreview, PublishCategory, PublishMeta, PublishResult } from "#lib/api/types.js";
	import { t } from "#lib/i18n/index.svelte.js";

	const open = $derived(store.publishDialog);
	let team = $state("");
	let name = $state("");
	let version = $state("1.0.0");
	let description = $state("");
	let websiteUrl = $state("");
	let readme = $state("");
	let readmeTouched = $state(false);
	let changelog = $state("");
	let categories = $state<string[]>([]);
	let nsfw = $state(false);
	let iconPath = $state<string | null>(null);
	let includeConfigs = $state(true);
	let available = $state<PublishCategory[]>([]);
	let preview = $state<ModpackPreview | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let result = $state<PublishResult | null>(null);

	const changelogPlaceholder = "## 1.0.0\n- ";
	const suggestedName = $derived((store.state.active ?? "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""));

	// Opening resets the form to the active profile; the README is regenerated until the author edits it.
	$effect(() => {
		if (!open) return;
		name = suggestedName;
		categories = ["modpacks"];
		result = null;
		error = null;
		readmeTouched = false;
		store
			.publishCategories()
			.then((c) => (available = c))
			.catch(() => (available = []));
	});

	$effect(() => {
		if (!open) return;
		const n = name;
		const d = description;
		store
			.modpackPreview(n, d)
			.then((p) => {
				preview = p;
				if (!readmeTouched) readme = p.readme;
			})
			.catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
	});

	function toggleCategory(slug: string) {
		categories = categories.includes(slug) ? categories.filter((c) => c !== slug) : [...categories, slug];
	}

	async function pickIcon() {
		const sel = await openDialog({ multiple: false, filters: [{ name: "PNG", extensions: ["png"] }] });
		if (typeof sel === "string") iconPath = sel;
	}

	async function publish() {
		if (busy) return;
		busy = true;
		error = null;
		const meta: PublishMeta = {
			team: team.trim(),
			name: name.trim(),
			version: version.trim(),
			description: description.trim(),
			websiteUrl: websiteUrl.trim(),
			readme,
			changelog,
			categories,
			nsfw,
			iconPath,
			includeConfigs,
		};
		try {
			result = await store.publishModpack(meta);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(o) => !o && !busy && (store.publishDialog = false)}>
	<Dialog.Content class="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-2xl">
		<Dialog.Header class="border-b px-5 py-4">
			<Dialog.Title>{t("publish.title", { name: store.state.active ?? "" })}</Dialog.Title>
			<Dialog.Description>{t("publish.desc")}</Dialog.Description>
		</Dialog.Header>
		{#if result}
			<div class="grid gap-3 px-5 py-5">
				<p class="text-sm">{t("publish.done", { name: result.fullName })}</p>
				<p class="text-muted-foreground text-xs">{t("publish.doneHint")}</p>
			</div>
			<Dialog.Footer class="border-t px-5 py-3">
				<Button variant="outline" onclick={() => (store.publishDialog = false)}>{t("common.done")}</Button>
				<Button onclick={() => store.openExternal(result!.url)}>{t("publish.openPage")}</Button>
			</Dialog.Footer>
		{:else}
			<div class="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
				{#if preview && !preview.hasToken}
					<p class="bg-primary-tint text-primary-text rounded-[5px] px-3 py-2 text-xs">{t("publish.noToken")}</p>
				{/if}
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-1.5">
						<Label for="pub-team">{t("publish.team")}</Label>
						<Input id="pub-team" bind:value={team} placeholder="MyTeam" />
					</div>
					<div class="grid gap-1.5">
						<Label for="pub-name">{t("publish.name")}</Label>
						<Input id="pub-name" bind:value={name} placeholder="My_Modpack" />
					</div>
					<div class="grid gap-1.5">
						<Label for="pub-version">{t("publish.version")}</Label>
						<Input id="pub-version" bind:value={version} placeholder="1.0.0" class="font-mono" />
					</div>
					<div class="grid gap-1.5">
						<Label for="pub-web">{t("publish.website")}</Label>
						<Input id="pub-web" bind:value={websiteUrl} placeholder="https://" />
					</div>
				</div>
				<div class="grid gap-1.5">
					<Label for="pub-desc">{t("publish.description")}</Label>
					<Input id="pub-desc" bind:value={description} maxlength={256} placeholder={t("publish.descriptionPlaceholder")} />
				</div>
				<div class="grid gap-1.5">
					<Label>{t("publish.categories")}</Label>
					<div class="flex flex-wrap gap-1">
						{#each available as c (c.slug)}
							<Chip active={categories.includes(c.slug)} onclick={() => toggleCategory(c.slug)}>{c.name}</Chip>
						{:else}
							<span class="text-muted-foreground text-xs">{t("common.loading")}</span>
						{/each}
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-1.5">
						<Label>{t("publish.icon")}</Label>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" onclick={pickIcon}>{t("publish.pickIcon")}</Button>
							<span class="text-muted-foreground truncate text-xs" title={iconPath ?? ""}
								>{iconPath ? iconPath.split(/[\\/]/).pop() : t("publish.defaultIcon")}</span
							>
						</div>
					</div>
					<div class="grid gap-2 pt-5">
						<label class="flex items-center gap-2 text-sm">
							<Checkbox bind:checked={includeConfigs} />
							{t("publish.includeConfigs", { n: preview?.configs ?? 0 })}
						</label>
						<label class="flex items-center gap-2 text-sm">
							<Checkbox bind:checked={nsfw} />
							{t("publish.nsfw")}
						</label>
					</div>
				</div>
				<div class="grid gap-1.5">
					<Label for="pub-readme">{t("publish.readme")}</Label>
					<textarea
						id="pub-readme"
						class="bg-field border-input selectable min-h-40 rounded-[5px] border px-3 py-2 font-mono text-xs leading-relaxed"
						bind:value={readme}
						oninput={() => (readmeTouched = true)}
						spellcheck={false}></textarea>
					<p class="text-muted-foreground text-xs">{t("publish.readmeHint", { n: preview?.dependencies.length ?? 0 })}</p>
				</div>
				<div class="grid gap-1.5">
					<Label for="pub-changelog">{t("publish.changelog")}</Label>
					<textarea
						id="pub-changelog"
						class="bg-field border-input selectable min-h-20 rounded-[5px] border px-3 py-2 font-mono text-xs leading-relaxed"
						bind:value={changelog}
						placeholder={changelogPlaceholder}
						spellcheck={false}></textarea>
				</div>
				{#if error}<p class="text-destructive-text text-sm">{error}</p>{/if}
			</div>
			<Dialog.Footer class="border-t px-5 py-3">
				<Button variant="outline" disabled={busy} onclick={() => (store.publishDialog = false)}>{t("common.cancel")}</Button>
				<Button disabled={busy || !team.trim() || !name.trim() || !description.trim() || !preview?.hasToken} onclick={publish}>
					{busy ? t("publish.publishing") : t("publish.submit")}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
