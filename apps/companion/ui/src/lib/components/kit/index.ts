// The only UI entry point for pages, as in the client. Everything except this file and types.ts is synced
// from the client (scripts/sync-from-client.ts) and stays unchanged; the primitives below the kit line were
// added here with the shadcn-svelte CLI (components.json) and are not synced.
export type { SegmentOption } from "./types";

export { default as BrandMark } from "@vmm/ui/components/kit/brand-mark.svelte";
export { default as Chip } from "@vmm/ui/components/kit/chip.svelte";
export { default as ConfirmDialog } from "./confirm-dialog.svelte";
export { default as EmptyState } from "@vmm/ui/components/kit/empty-state.svelte";
export { default as PanelSection } from "@vmm/ui/components/kit/panel-section.svelte";
export { default as SectionLabel } from "@vmm/ui/components/kit/section-label.svelte";
export { default as Segmented } from "@vmm/ui/components/kit/segmented.svelte";
export { default as SettingRow } from "@vmm/ui/components/kit/setting-row.svelte";
export { default as Stat } from "@vmm/ui/components/kit/stat.svelte";
export { default as Toolbar } from "@vmm/ui/components/kit/toolbar.svelte";

export { Button } from "@vmm/ui/components/ui/button/index.js";
export { Input } from "@vmm/ui/components/ui/input/index.js";
export { Label } from "@vmm/ui/components/ui/label/index.js";
export { Switch } from "@vmm/ui/components/ui/switch/index.js";
export { Checkbox } from "@vmm/ui/components/ui/checkbox/index.js";
export { Separator } from "@vmm/ui/components/ui/separator/index.js";
export { Toaster } from "@vmm/ui/components/ui/sonner/index.js";
export * as Dialog from "@vmm/ui/components/ui/dialog/index.js";
export { ScrollArea } from "@vmm/ui/components/ui/scroll-area/index.js";
export { Badge } from "@vmm/ui/components/ui/badge/index.js";
export { Slider } from "@vmm/ui/components/ui/slider/index.js";
export * as Alert from "@vmm/ui/components/ui/alert/index.js";
export * as Collapsible from "@vmm/ui/components/ui/collapsible/index.js";
export * as Popover from "@vmm/ui/components/ui/popover/index.js";
export * as Select from "@vmm/ui/components/ui/select/index.js";
export * as Tabs from "@vmm/ui/components/ui/tabs/index.js";
export * as Tooltip from "@vmm/ui/components/ui/tooltip/index.js";
