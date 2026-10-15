# Small-window layout — implementation plan

Spec: [2026-10-11-small-window-layout-design.md](../specs/2026-10-11-small-window-layout-design.md).

## Tasks

1. **Columns that fit** — `desktop/columns.ts`: `priority`, flexible `minWidth`, `fitColumns(defs, prefs, width,
opts)`; tests first. `DataTable` measures width, renders the fitted set, viewport `scroll-y`.
2. **Utilities and primitive hardening** — `app.css`: `@utility scroll-y`. `style-desktop.css`: dialog content
   `max-h` + scroll, footer wrap, select trigger value truncation.
3. **Kit** — `Segmented` (items `min-w-0 truncate`, group `max-w-full`), `Choice` (value in a truncating span),
   `SettingRow` (one column below `@md`), `SelectionBar` (`@container`, wrap, hint hidden when narrow),
   `Toolbar` (inputs shrink), `Stat` (truncate), `FilterSection` / `FilterList` (counts `shrink-0`),
   new `StatusItem`.
4. **Pages** — `PackageDetail` (`@container`, stacked buttons, 2/4 stat columns, rows with `min-w-0`),
   `SettingsView` (`scroll-y`, block truncation), `ConfigView` (toolbar, row collapse, `scroll-y`),
   `BrowseFilters` (`@container` header), `BrowseView` / `InstalledView` (priorities, pane minimums),
   `LogView`, `ModDocs`, dialogs (`scroll-y`), `status-bar` (`StatusItem`).
5. **Mock** — config files with bool / enum / range / string settings.
6. **Static layout test** — `src/lib/components/layout.test.ts`.
7. **Docs** — AGENTS.md "Layout rules" paragraph; `dev/README` note on the audit script.
8. **Verify** — gates (`check`, `test`, `build`, `lint`), screenshots 1100 × 680 and 900 × 600, de + en,
   autofixer on every changed `.svelte`.
