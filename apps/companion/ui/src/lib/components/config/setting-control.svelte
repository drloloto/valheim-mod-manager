<script lang="ts">
	import CodeIcon from "@lucide/svelte/icons/code";
	import PencilIcon from "@lucide/svelte/icons/pencil";
	import { Button, Input, Select, Slider, Switch } from "#lib/components/kit/index.js";
	import { check, format, kindOf, parse } from "#lib/configmeta.js";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { ConfigSetting } from "#lib/types.js";
	import ColorField from "./color-field.svelte";
	import FlagsField from "./flags-field.svelte";
	import RangeField from "./range-field.svelte";
	import RecordsField from "./records-field.svelte";
	import VectorField from "./vector-field.svelte";

	// The control for one setting, chosen by its kind (configmeta.ts). `raw` is always the exact .cfg text;
	// every control parses it and formats it back. "Edit as text" bypasses the structured control and its
	// checks for the odd value the parser does not understand.
	let {
		setting,
		raw,
		onchange,
		disabled = false,
		id,
	}: { setting: ConfigSetting; raw: string; onchange: (raw: string) => void; disabled?: boolean; id: string } = $props();

	let textMode = $state(false);
	const kind = $derived(kindOf(setting));
	const value = $derived(parse(kind, raw));
	const problem = $derived(check(kind, raw));
	const canToggle = $derived(kind.kind !== "text");
	const step = $derived(
		kind.kind === "number" ? (kind.integer ? 1 : kind.max !== undefined && kind.min !== undefined ? Math.max((kind.max - kind.min) / 200, 0.001) : 0.1) : 1,
	);
	const set = (v: unknown) => onchange(format(kind, v));
</script>

<div class="flex flex-col gap-1.5">
	<div class="flex items-start gap-1.5">
		<div class="min-w-0 flex-1">
			{#if textMode || kind.kind === "text"}
				<Input {id} value={raw} oninput={(e) => onchange(e.currentTarget.value)} {disabled} class="font-mono" aria-label={setting.key} />
			{:else if kind.kind === "bool"}
				<div class="h-control flex items-center">
					<Switch {id} checked={value as boolean} onCheckedChange={set} {disabled} aria-label={setting.key} />
				</div>
			{:else if kind.kind === "number"}
				<div class="flex items-center gap-3">
					<Input
						{id}
						type="number"
						step={kind.integer ? 1 : "any"}
						min={kind.min}
						max={kind.max}
						value={raw}
						oninput={(e) => onchange(e.currentTarget.value)}
						{disabled}
						class="w-32 font-mono"
						aria-label={setting.key}
					/>
					{#if kind.min !== undefined && kind.max !== undefined}
						<Slider
							type="single"
							value={Number.isFinite(value as number) ? (value as number) : kind.min}
							onValueChange={(v: number) => set(kind.integer ? Math.round(v) : Math.round(v / step) * step)}
							min={kind.min}
							max={kind.max}
							{step}
							{disabled}
							class="min-w-24 flex-1"
							aria-label={setting.key}
						/>
					{/if}
				</div>
			{:else if kind.kind === "enum"}
				<Select.Root type="single" value={raw} onValueChange={(v: string) => v && onchange(v)} {disabled}>
					<Select.Trigger {id} class="w-full font-mono text-[12.5px]" aria-label={setting.key}><span class="min-w-0 truncate">{raw}</span></Select.Trigger>
					<Select.Content class="max-h-72">
						{#each kind.options as o (o)}
							<Select.Item value={o} label={o} class="font-mono text-[12.5px]">{o}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{:else if kind.kind === "flags"}
				<FlagsField options={kind.options} value={value as string[]} onchange={set} {disabled} />
			{:else if kind.kind === "color"}
				<ColorField value={value as string} onchange={set} {disabled} />
			{:else if kind.kind === "vector"}
				<VectorField axes={kind.axes} value={value as Record<string, number>} onchange={set} {disabled} />
			{:else if kind.kind === "range"}
				<RangeField value={value as [number, number]} onchange={set} {disabled} />
			{:else if kind.kind === "records"}
				<RecordsField fields={kind.fields} value={value as string[][]} onchange={set} {disabled} />
			{/if}
		</div>
		{#if canToggle && !disabled}
			<Button
				variant="ghost"
				size="icon-sm"
				class="text-subtle-foreground hover:text-foreground size-7 shrink-0"
				onclick={() => (textMode = !textMode)}
				title={t(textMode ? "configs.rawOff" : "configs.raw")}
				aria-label={t(textMode ? "configs.rawOff" : "configs.raw")}
				aria-pressed={textMode}
			>
				{#if textMode}<PencilIcon class="size-3.5" />{:else}<CodeIcon class="size-3.5" />{/if}
			</Button>
		{/if}
	</div>
	{#if problem}
		<p class={textMode && problem.key !== "cfg.err.line" ? "text-muted-foreground text-xs" : "text-destructive-text text-xs"}>
			{t(problem.key, problem.vars)}{#if textMode && problem.key !== "cfg.err.line"}
				· {t("configs.rawHint")}{/if}
		</p>
	{/if}
</div>
