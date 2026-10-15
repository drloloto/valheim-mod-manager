// The only UI entry point for pages, as in the client. Everything except this file and types.ts is synced
// from the client (scripts/sync-from-client.ts) and stays unchanged; the primitives below the kit line were
// added here with the shadcn-svelte CLI (components.json) and are not synced.
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
export { ScrollArea } from "#lib/components/ui/scroll-area/index.js";
export { Badge } from "#lib/components/ui/badge/index.js";
export { Slider } from "#lib/components/ui/slider/index.js";
export * as Alert from "#lib/components/ui/alert/index.js";
export * as Collapsible from "#lib/components/ui/collapsible/index.js";
export * as Popover from "#lib/components/ui/popover/index.js";
export * as Select from "#lib/components/ui/select/index.js";
export * as Tabs from "#lib/components/ui/tabs/index.js";
export * as Tooltip from "#lib/components/ui/tooltip/index.js";
