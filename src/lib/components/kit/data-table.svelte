<script lang="ts" generics="T">
	import type { Snippet } from "svelte";
	import * as ContextMenu from "#lib/components/ui/context-menu/index.js";
	import {
		DEFAULT_PREFS,
		fitColumns,
		isHidden,
		isResizable,
		moveColumn,
		orderedColumns,
		resetColumns,
		resetWidths,
		setWidth,
		trackOf,
		visibleColumns,
		type ColumnDef,
		type TablePrefs,
	} from "#lib/desktop/columns.js";
	import * as sel from "#lib/desktop/selection.js";
	import { matches } from "#lib/desktop/shortcuts.js";
	import { scrollToReveal, visibleRange } from "#lib/desktop/virtual.js";
	import { cn } from "#lib/utils.js";
	import TriCheckbox from "./tri-checkbox.svelte";
	import { t } from "#lib/i18n/index.svelte.js";
	import type { SortState, TriState } from "./types";

	interface Props {
		rows: T[];
		getId: (row: T) => string;
		/** All columns; visibility, order and width come from `prefs`. */
		columns: ColumnDef[];
		cell: Snippet<[T, string]>;
		prefs?: TablePrefs;
		selection?: sel.Selection;
		sort?: SortState | null;
		rowHeight?: number;
		compactRowHeight?: number;
		/** Extra space below the last row (px) so the SelectionBar does not cover anything. */
		padBottom?: number;
		selectable?: boolean;
		menu?: Snippet<[string[]]>;
		onactivate?: (row: T) => void;
		ondelete?: (ids: string[]) => void;
		rowClass?: (row: T) => string | undefined;
		empty?: Snippet;
		class?: string;
	}

	let {
		rows,
		getId,
		columns,
		cell,
		prefs = $bindable(DEFAULT_PREFS),
		selection = $bindable(sel.emptySelection),
		sort = $bindable(null),
		rowHeight = 50,
		compactRowHeight = 36,
		padBottom = 0,
		selectable = true,
		menu,
		onactivate,
		ondelete,
		rowClass,
		empty,
		class: className,
	}: Props = $props();

	let viewport = $state<HTMLDivElement>();
	let scrollTop = $state(0);
	let height = $state(0);
	let width = $state(0);
	/** Widths while dragging; not written to prefs until release */
	let liveWidths = $state<Record<string, number>>({});
	let dragKey = $state<string | null>(null);
	let dropKey = $state<string | null>(null);
	let dropSide = $state<"before" | "after">("before");

	// Row geometry shared by header and rows: 14px checkbox track, gap-3, px-4.
	const LEAD = 14;
	const GAP = 12;
	const PADDING = 32;
	const all = $derived(orderedColumns(columns, prefs));
	// Columns the user wants, then only as many of them as the current width can hold (never a horizontal scroll).
	const visible = $derived(fitColumns(visibleColumns(columns, prefs), prefs, width, { gap: GAP, padding: PADDING, lead: selectable ? LEAD : 0 }));
	const rh = $derived(prefs.density === "compact" ? compactRowHeight : rowHeight);
	const order = $derived(rows.map(getId));
	const range = $derived(visibleRange(scrollTop, height, rh, rows.length));
	const track = (c: ColumnDef) => (liveWidths[c.key] ? `${liveWidths[c.key]}px` : trackOf(c, prefs));
	const template = $derived([selectable ? `${LEAD}px` : null, ...visible.map(track)].filter(Boolean).join(" "));
	const headerState: TriState = $derived(!selection.ids.size ? 0 : order.length && order.every((id) => selection.ids.has(id)) ? 1 : "mixed");

	// Fit the selection to the currently visible rows (filter change); prune returns the same object when nothing changed.
	$effect(() => {
		const next = sel.prune(selection, order);
		if (next !== selection) selection = next;
	});

	// Reset the scroll position when the row count changes (e.g. a filter change); otherwise the
	// viewport can point at a region that no longer exists.
	let lastRowCount: number | undefined;
	$effect(() => {
		const count = rows.length;
		if (lastRowCount !== undefined && count !== lastRowCount) {
			scrollTop = 0;
			if (viewport) viewport.scrollTop = 0;
		}
		lastRowCount = count;
	});

	function reveal() {
		const i = selection.focus ? order.indexOf(selection.focus) : -1;
		if (viewport && i >= 0) viewport.scrollTop = scrollToReveal(i, rh, viewport.scrollTop, height);
	}

	function onRowClick(e: MouseEvent, id: string) {
		selection = sel.click(selection, order, id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
		viewport?.focus({ preventScroll: true });
	}

	function onCheck(e: MouseEvent, id: string) {
		e.stopPropagation();
		selection = sel.click(selection, order, id, { shift: e.shiftKey, toggle: true });
	}

	function onKey(e: KeyboardEvent) {
		const page = Math.max(1, Math.floor(height / rh) - 1);
		const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -order.length, End: order.length };
		if (e.key in step) {
			selection = sel.move(selection, order, step[e.key], e.shiftKey);
			reveal();
		} else if (matches(e, "Mod+A")) {
			selection = sel.selectAll(selection, order);
		} else if (e.key === "Escape" && selection.ids.size) {
			selection = sel.clear(selection);
		} else if (e.key === "Enter" && selection.focus) {
			const row = rows[order.indexOf(selection.focus)];
			if (row) onactivate?.(row);
		} else if (e.key === "Delete" && ondelete && selection.ids.size) {
			ondelete([...selection.ids]);
		} else {
			return;
		}
		e.preventDefault();
	}

	function toggleSort(c: ColumnDef) {
		if (!c.sortable) return;
		const first = c.defaultDir ?? "desc";
		if (sort?.key !== c.key) sort = { key: c.key, dir: first };
		else if (sort.dir === first) sort = { key: c.key, dir: first === "desc" ? "asc" : "desc" };
		else sort = null; // third click: back to the default sort
	}

	// Column resizing: handle at the right edge, live width, committed on release.
	function startResize(e: PointerEvent, c: ColumnDef) {
		e.preventDefault();
		e.stopPropagation();
		const handle = e.currentTarget as HTMLElement;
		const startX = e.clientX;
		const startW = liveWidths[c.key] ?? parseInt(trackOf(c, prefs), 10);
		handle.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			liveWidths = { ...liveWidths, [c.key]: Math.max(c.minWidth ?? 48, startW + ev.clientX - startX) };
		};
		const up = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", up);
			const w = liveWidths[c.key];
			if (w) prefs = setWidth(prefs, c, w);
			liveWidths = {};
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
		handle.addEventListener("pointercancel", up);
	}

	// Column reordering: drag a header cell, drop left or right of the target cell.
	function onDragStart(e: DragEvent, c: ColumnDef) {
		dragKey = c.key;
		e.dataTransfer?.setData("text/plain", c.key);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
	}
	function onDragOver(e: DragEvent, c: ColumnDef) {
		if (!dragKey || dragKey === c.key) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropSide = e.clientX < r.left + r.width / 2 ? "before" : "after";
		dropKey = c.key;
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (dragKey && dropKey) prefs = moveColumn(prefs, columns, dragKey, dropKey, dropSide);
		endDrag();
	}
	function endDrag() {
		dragKey = null;
		dropKey = null;
	}
</script>

<div class={cn("flex min-h-0 flex-col", className)} bind:clientWidth={width}>
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<div
				class="label-caps grid h-8 shrink-0 items-center gap-3 overflow-hidden border-b px-4 tracking-[0.06em]"
				style:grid-template-columns={template}
				role="row"
			>
				{#if selectable}
					<TriCheckbox
						state={headerState}
						label={t("sel.all")}
						onclick={() => (selection = headerState === 1 ? sel.clear(selection) : sel.selectAll(selection, order))}
					/>
				{/if}
				{#each visible as c (c.key)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class={cn(
							"relative flex h-full min-w-0 items-center",
							dropKey === c.key && dropSide === "before" && "shadow-[inset_2px_0_0_var(--color-primary)]",
							dropKey === c.key && dropSide === "after" && "shadow-[inset_-2px_0_0_var(--color-primary)]",
							dragKey === c.key && "opacity-40",
						)}
						draggable="true"
						ondragstart={(e) => onDragStart(e, c)}
						ondragover={(e) => onDragOver(e, c)}
						ondragleave={() => dropKey === c.key && (dropKey = null)}
						ondrop={onDrop}
						ondragend={endDrag}
					>
						<button
							type="button"
							disabled={!c.sortable}
							onclick={() => toggleSort(c)}
							title={c.sortable ? t("browse.sortColumn") : undefined}
							class={cn(
								"min-w-0 flex-1 truncate text-left uppercase disabled:opacity-100",
								c.align === "right" && "text-right",
								sort?.key === c.key && "text-foreground-soft",
							)}
						>
							{c.label}{#if sort?.key === c.key}{sort.dir === "desc" ? " ↓" : " ↑"}{/if}
						</button>
						{#if isResizable(c)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="hover:bg-line-strong absolute top-0 -right-2 h-full w-[7px] cursor-col-resize"
								title={t("browse.resizeColumn")}
								draggable="false"
								onpointerdown={(e) => startResize(e, c)}
								ondragstart={(e) => e.preventDefault()}
							></div>
						{/if}
					</div>
				{/each}
			</div>
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-60">
			<ContextMenu.Label>{t("browse.columns")}</ContextMenu.Label>
			{#each all as c (c.key)}
				<ContextMenu.CheckboxItem
					checked={!isHidden(c, prefs)}
					disabled={c.fixed}
					onCheckedChange={() => (prefs = { ...prefs, hidden: { ...prefs.hidden, [c.key]: !isHidden(c, prefs) } })}
				>
					{c.label}
				</ContextMenu.CheckboxItem>
			{/each}
			<ContextMenu.Separator />
			<ContextMenu.Label>{t("browse.density")}</ContextMenu.Label>
			<ContextMenu.RadioGroup value={prefs.density} onValueChange={(v) => (prefs = { ...prefs, density: v === "compact" ? "compact" : "normal" })}>
				<ContextMenu.RadioItem value="normal">{t("browse.densityNormal")}</ContextMenu.RadioItem>
				<ContextMenu.RadioItem value="compact">{t("browse.densityCompact")}</ContextMenu.RadioItem>
			</ContextMenu.RadioGroup>
			<ContextMenu.Separator />
			<ContextMenu.Item onSelect={() => (prefs = resetWidths(prefs))}>{t("browse.resetWidths")}</ContextMenu.Item>
			<ContextMenu.Item onSelect={() => (prefs = resetColumns(prefs))}>{t("browse.resetColumns")}</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>

	<ContextMenu.Root>
		<ContextMenu.Trigger class="relative min-h-0 flex-1" disabled={!menu}>
			<div
				bind:this={viewport}
				bind:clientHeight={height}
				onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
				onkeydown={onKey}
				tabindex="0"
				role="grid"
				aria-multiselectable={selectable}
				aria-rowcount={rows.length}
				class="scroll-y h-full outline-none"
			>
				{#if !rows.length}
					{@render empty?.()}
				{:else}
					<div class="relative" style:height="{rows.length * rh + padBottom}px">
						{#each rows.slice(range.start, range.end) as row, i (getId(row))}
							{@const id = getId(row)}
							<!-- Keyboard handling is centralized on the viewport div (onkeydown); the row itself is not focusable. -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								role="row"
								tabindex="-1"
								aria-selected={selection.ids.has(id)}
								aria-rowindex={range.start + i + 1}
								data-selected={selection.ids.has(id) || undefined}
								data-focused={selection.focus === id || undefined}
								class={cn(
									"border-line-subtle absolute inset-x-0 grid items-center gap-3 border-b px-4 hover:brightness-110",
									"data-selected:bg-selected data-focused:bg-focused data-selected:data-focused:bg-selected",
									"data-focused:shadow-[inset_2px_0_0_var(--color-primary)] data-selected:shadow-[inset_2px_0_0_var(--color-primary)]",
									rowClass?.(row),
								)}
								style:top="{(range.start + i) * rh}px"
								style:height="{rh}px"
								style:grid-template-columns={template}
								onclick={(e) => onRowClick(e, id)}
								ondblclick={() => onactivate?.(row)}
								oncontextmenu={() => (selection = sel.forContext(selection, id))}
							>
								{#if selectable}
									<TriCheckbox state={selection.ids.has(id) ? 1 : 0} label={t("sel.one")} onclick={(e) => onCheck(e, id)} />
								{/if}
								{#each visible as c (c.key)}
									<div class={cn("min-w-0", c.align === "right" && "flex justify-end text-right")}>{@render cell(row, c.key)}</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</ContextMenu.Trigger>
		{#if menu}
			<ContextMenu.Content class="w-72">
				{#if selection.ids.size}
					{@render menu([...selection.ids])}
				{/if}
			</ContextMenu.Content>
		{/if}
	</ContextMenu.Root>
</div>
