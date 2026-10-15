<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import { cn } from "#lib/utils.js";

	// The four stations of a release as a horizontal rail. A step is clickable when it is reachable; the
	// current one is highlighted, done ones carry a check, blocked ones stay dim with the reason as a hint.
	export interface Step {
		label: string;
		hint?: string;
		state: "done" | "current" | "todo" | "blocked";
	}

	let { steps, active, onselect }: { steps: Step[]; active: number; onselect: (i: number) => void } = $props();
</script>

<ol class="flex items-stretch gap-0 overflow-x-auto" aria-label="steps">
	{#each steps as s, i (i)}
		<li class="flex min-w-0 flex-1 items-center">
			<button
				type="button"
				disabled={s.state === "blocked"}
				aria-current={i === active ? "step" : undefined}
				onclick={() => onselect(i)}
				class={cn(
					"flex min-w-0 flex-1 items-center gap-2.5 rounded-[5px] px-3 py-2 text-left disabled:cursor-not-allowed",
					i === active ? "bg-muted" : "hover:bg-hover",
					s.state === "blocked" && "opacity-50",
				)}
				title={s.hint}
			>
				<span
					class={cn(
						"flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium",
						s.state === "done" && "border-success/50 bg-success/15 text-success",
						s.state === "current" && "border-primary bg-primary text-primary-foreground",
						(s.state === "todo" || s.state === "blocked") && "border-line-strong text-muted-foreground",
					)}
				>
					{#if s.state === "done"}<CheckIcon class="size-3.5" />{:else}{i + 1}{/if}
				</span>
				<span class="flex min-w-0 flex-col">
					<span class={cn("text-row truncate font-semibold", i !== active && s.state !== "current" && "text-foreground-soft")}>{s.label}</span>
					{#if s.hint}<span class="text-subtle-foreground truncate text-[11px]">{s.hint}</span>{/if}
				</span>
			</button>
			{#if i < steps.length - 1}<span class="bg-border mx-1 h-px w-4 shrink-0 sm:w-6" aria-hidden="true"></span>{/if}
		</li>
	{/each}
</ol>
