// The only UI entry point for app pages (see boundaries.test.ts).
export type { Column, Density, FilterItem, ModStatus, SegmentOption, SortState, TablePrefs, TriState } from "./types";

export { default as SectionLabel } from "@vmm/ui/components/kit/section-label.svelte";
export { default as Kbd } from "./kbd.svelte";
export { default as TriCheckbox } from "./tri-checkbox.svelte";
export { default as Segmented } from "@vmm/ui/components/kit/segmented.svelte";
export { default as Chip } from "@vmm/ui/components/kit/chip.svelte";
export { default as StatusPill } from "./status-pill.svelte";
export { default as StatusItem } from "./status-item.svelte";
export { default as ModAvatar } from "./mod-avatar.svelte";
export { default as Stat } from "@vmm/ui/components/kit/stat.svelte";
export { default as SettingRow } from "@vmm/ui/components/kit/setting-row.svelte";
export { default as Stepper } from "./stepper.svelte";
export { default as PathField } from "./path-field.svelte";
export { default as EmptyState } from "@vmm/ui/components/kit/empty-state.svelte";
export { default as PanelSection } from "@vmm/ui/components/kit/panel-section.svelte";
export { default as SplitButton } from "./split-button.svelte";
export { default as ConfirmDialog } from "./confirm-dialog.svelte";
export { default as Choice } from "./choice.svelte";
export { default as DataTable } from "./data-table.svelte";
export { default as SelectionBar } from "./selection-bar.svelte";
export { default as Toolbar } from "@vmm/ui/components/kit/toolbar.svelte";
export { default as BrandMark } from "@vmm/ui/components/kit/brand-mark.svelte";
export { default as Markdown } from "./markdown.svelte";
export { default as FilterSection } from "./filter-section.svelte";
export { default as FilterList } from "./filter-list.svelte";
export { default as Histogram } from "./histogram.svelte";
export { default as DateRangeFilter } from "./date-range-filter.svelte";
export { default as NumRangeFilter } from "./num-range-filter.svelte";
export { default as FilterToken } from "./filter-token.svelte";
export { default as TagList } from "./tag-list.svelte";
export { default as InstallState } from "./install-state.svelte";
export { default as SourceBadge } from "./source-badge.svelte";

// Re-exports of the shadcn primitives so app code knows a single import path.
export { Button } from "@vmm/ui/components/ui/button/index.js";
export { Input } from "@vmm/ui/components/ui/input/index.js";
export { Label } from "@vmm/ui/components/ui/label/index.js";
export { Switch } from "@vmm/ui/components/ui/switch/index.js";
export { Checkbox } from "@vmm/ui/components/ui/checkbox/index.js";
export { Separator } from "@vmm/ui/components/ui/separator/index.js";
export { ScrollArea } from "@vmm/ui/components/ui/scroll-area/index.js";
export { Toaster } from "@vmm/ui/components/ui/sonner/index.js";
export * as Dialog from "@vmm/ui/components/ui/dialog/index.js";
export * as DropdownMenu from "@vmm/ui/components/ui/dropdown-menu/index.js";
export * as ContextMenu from "@vmm/ui/components/ui/context-menu/index.js";
export * as Tooltip from "@vmm/ui/components/ui/tooltip/index.js";
export * as Resizable from "@vmm/ui/components/ui/resizable/index.js";

export { emptySelection, type Selection } from "#lib/desktop/selection.js";
export { DEFAULT_PREFS, isHidden, resetColumns, resetWidths, toggleColumn } from "#lib/desktop/columns.js";
export * as Select from "@vmm/ui/components/ui/select/index.js";
