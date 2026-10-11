# Layout that survives the smallest window

Date: 2026-10-11. Owner report before the 0.2 release: at the minimum window size (1100 × 680 logical px,
which is also what a maximized window on a 1920 px screen at 150 % scaling gets) text overlaps in every
table row, buttons leave the detail panel, scrollbars appear where none should be, and the layout jumps.
Verified in the mock preview at 1100 × 680 with the German catalog (longer strings).

## What actually breaks

| Where                 | Cause                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse table          | fixed px columns + gaps (642 px) exceed the pane (615 px); the `1fr` name column collapses to 0, the avatar paints over "Author", a horizontal scrollbar appears |
| Detail panel (275 px) | two `whitespace-nowrap` buttons in one row, a 4-column stat grid, 4 segmented tabs, dependency and version rows without `min-w-0`                                |
| Selection bar         | five actions plus hint in a 615 px pane; the last button is cut off                                                                                              |
| Settings              | inline `span.truncate` (no effect on inline boxes) spills the data folder path under "Open"                                                                      |
| Config editor toolbar | file name without `min-w-0`, a fixed `w-64` search field, control column fixed at 14 rem                                                                         |
| Status bar            | items never shrink; with a progress bar, server status and an update hint the right action is pushed out                                                         |
| Dialogs               | footer with four buttons in a 448 px dialog does not wrap; content taller than 680 px has no scroll                                                              |
| Filter header         | "FILTER" caps label + view name + Clear in 209 px → the view name is cut to "1 ak…"                                                                              |
| Layout jumps          | scrollbars that appear when content grows shift the content by their width                                                                                       |

## Rules (the generic part)

These apply to every kit component and every app page; a static test enforces the mechanical ones.

1. **A column layout never adds up to more than its container.** Tables drop columns by priority until the
   remaining ones fit (`fitColumns`, pure, tested); the flexible column keeps a minimum width. Grids with
   fixed tracks (settings rows, config rows) collapse to one column below a container width.
2. **Width-dependent decisions use container queries, not viewport queries.** Panes are resizable, so the
   relevant width is the pane's, never the window's. Every resizable pane root is a `@container`.
3. **Every flex item that carries text either truncates or wraps**: `min-w-0` + `truncate` on the text
   element (not on an inline span), `shrink-0` on icons, badges and counts next to it. Groups of buttons
   `flex-wrap` instead of overflowing.
4. **Scroll containers reserve their gutter.** The `scroll-y` utility (`overflow-y: auto; overflow-x: hidden;
scrollbar-gutter: stable`) replaces raw `overflow-y-auto`; a scrollbar that appears no longer moves
   content, and horizontal scrollbars cannot appear by accident.
5. **shadcn primitives are hardened in `style-desktop.css`, not edited.** Dialog content is capped at the
   viewport height and scrolls; dialog footers wrap; select triggers truncate their value.
6. **No fixed widths on inputs inside toolbars.** Inputs get `w-<n>` as a _preferred_ width and shrink
   (`min-w-24`); buttons keep `shrink-0`.

## Decisions

- `ColumnDef.priority` (default 0, higher survives longer) and `minWidth` on the flexible column (default
  160 px). `DataTable` measures its own width (`bind:clientWidth`) and renders `fitColumns(...)`; hidden-by-
  width columns stay in prefs, so they return when the pane grows. The viewport is `scroll-y`, never scrolls
  horizontally.
- Pane minimums move from "whatever percentage" to values that keep the content usable at 1100 px:
  browse detail 22 %, installed detail 24 %, config files 18 %. The detail panel is designed for 240 px.
- The status bar gets a `StatusItem` kit component (dot, truncating label, optional link/button) so every
  entry shrinks the same way; the right-hand action never leaves the bar.
- The selection bar wraps its actions and hides the hint below 640 px of pane width.
- The filter header hides the "FILTER" caps label below 240 px; the view name is the information.
- Mock: `list_config_files` / `get_config_file` / `save_config_file` return sample data so the config editor
  can be verified in the preview.

## Tests

- `columns.test.ts`: `fitColumns` drops by priority then from the right, never drops fixed columns, keeps
  the flexible minimum, respects user widths, returns the same array when everything fits.
- `layout.test.ts` (static): no `overflow-y-auto` / `overflow-auto` in `.svelte` files (use `scroll-y`),
  no `whitespace-nowrap` on `kit/` text spans without `truncate`, every `Resizable.Pane` child root is a
  `@container`.
- Screenshots at 1100 × 680 and 900 × 600 (de + en) over CDP, with the overlap/overflow audit script from
  `dev/`, before claiming completion.
