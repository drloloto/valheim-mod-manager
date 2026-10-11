// The only UI entry point for pages, as in the client. Everything except this file and types.ts is synced
// from the client (scripts/sync-from-client.ts) and stays unchanged.
export type { SegmentOption } from "./types";

export { default as BrandMark } from "./brand-mark.svelte";
export { default as Chip } from "./chip.svelte";
export { default as ConfirmDialog } from "./confirm-dialog.svelte";
export { default as EmptyState } from "./empty-state.svelte";
export { default as PanelSection } from "./panel-section.svelte";
export { default as SectionLabel } from "./section-label.svelte";
export { default as Segmented } from "./segmented.svelte";
export { default as SettingRow } from "./setting-row.svelte";
export { default as Stat } from "./stat.svelte";
export { default as Toolbar } from "./toolbar.svelte";

export { Button } from "#lib/components/ui/button/index.js";
export { Input } from "#lib/components/ui/input/index.js";
export { Label } from "#lib/components/ui/label/index.js";
export { Switch } from "#lib/components/ui/switch/index.js";
export { Checkbox } from "#lib/components/ui/checkbox/index.js";
export { Separator } from "#lib/components/ui/separator/index.js";
export { Toaster } from "#lib/components/ui/sonner/index.js";
export * as Dialog from "#lib/components/ui/dialog/index.js";
