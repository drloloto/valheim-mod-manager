# UI polish batch: Browse search and filters, Installed table, profile manager, links (2026-10-15)

Nine small requests from the owner, done in one branch (`feat/ui-polish-batch`). Each entry: what was wrong,
what was decided, where it lives. Extends `2026-10-11-small-window-layout-design.md` (column fitting) and
`2026-10-14-server-managed-mods.md` (how server mods are shown).

## Browse

1. **Field search.** Free text still searches name, author and description as one needle (spaces ignored, so
   "epic loot" finds EpicLoot). New: field terms `name:` / `title:` / `titel:`, `desc:` / `beschreibung:`,
   `author:` / `autor:`, quotes for phrases, `-word` / `-name:x` to exclude. On top, a scope menu inside the
   search field ("All fields ▾") sets where free text looks; it is remembered. The prefix syntax is for power
   use, the menu for discovery; the menu shows the syntax. `src/lib/browse/query.ts` (+ test).
2. **Counts did not follow the own section.** Facets skipped their own section (classic OR facets), so after
   picking "Not in profile" the list still said "In profile 28", and in categories' "all" mode the counts
   were plainly wrong. Now (`facetCounts` in `filter.ts`): nothing included → unchanged; "all" mode → counts
   within the current results; "any" mode with an inclusion → picked values count their rows, every other
   value shows **+N**, the rows picking it would add.
3. **Filter search.** A search field at the top of the filter pane: list sections show only matching entries
   and open while searching; range sections (dates, numbers) show only when their title matches.
4. **Column choice "not remembered".** It was stored all along, but `fitColumns` dropped columns the user
   switched on first (priority 0) when the pane was too narrow, so they seemed to vanish. User-chosen columns
   now outrank every default column, and the column menu says "no room" for a column that still does not fit.
   The column sort is remembered now as well (Browse and Installed).
5. **Categories column**: tags on up to two rows (one in compact density), the rest as "+N" with the full list
   as tooltip (`kit/tag-list.svelte`), column 220 px.
6. **Downloads**: at most three digits plus unit: 980 · 9.9K · 566K · 1.6M; a value rounding to 1000 moves up
   (999.7K → 1M). `formatCompact`.

## Installed

- **Rows** come from `src/lib/installed.ts`: one **source** per row (Server, Yours, Local file, Dependency;
  the server-required library counts as Server) and one **state** (Up to date, Disabled, Update x.y.z,
  Not installed, Installing…).
- **Order** is fixed: by source (server, yours, local, dependencies), then name; never install order.
  Mod, author, status and source are sortable, the name breaks ties.
- **Status column**: one shape for every state, dot + word (`kit/install-state.svelte`); an update is the same
  shape, clickable. The stale-game-update triangle moved next to the mod name: it is a hint about the mod,
  not its install state.
- **Source column** at the end (`kit/source-badge.svelte`); "From the server" no longer sits in front of the
  description. Dependencies explain on hover who needs them.
- **Filter segments**: All · Server · Yours · Dependencies · Updates (On/Off went away; the switch column and
  the status sort cover it). Counts are dropped below ~900 px so the toolbar stays one line at 1100 × 680.
- **Hints**: grouped by kind with one explanation each (`groupIssues` in `health.ts`), affected mods as chips
  with their last update date, instead of one long sentence per mod.

## Profiles (design "Server Link Modals", claude.ai/design)

- The profile menu (2b) only switches profiles, plus "Manage profiles… Ctrl P" and "New profile… Ctrl N".
- The profile manager modal (2a, `ProfileManager.svelte`): cards per profile (mods, server mods, updates,
  server and role), Import ▾ (file, code, server or sync code, r2modman/TMM), new profile. A card opens the
  details in the same modal: **General** (rename, repair, clone, delete; works for any profile),
  **Server & sync** (role player/admin, address or sync code, token; for the active profile only, since the
  link commands act on it), **Share & export** (profile code, .r2z, modpack; modpack needs the active profile).
- Deviation from the design: one address field (companion address _or_ sync code, as `linkServer` already
  takes it) instead of separate gist id / display name / owner fields; the client does not know a gist link's
  code, so changing a link means pasting a new address or code. Card stats show "—" where the client only
  knows the active profile (updates, server mods), and no disk size (no command for it).
- Profile operations take a name now (`renameProfile`, `cloneProfile`, `deleteProfile`, `repairProfile`,
  `exportCode(profile)`, `exportFile(path, profile)`); `checkAllServers` keeps every result in `serverChecks`.

## Shell and links

- Settings in the top bar is an icon button (gear) with tooltip and aria label.
- Every link that leaves the app goes through `store.openExternal`: anchors anywhere in the page and
  `window.open` are intercepted (`installDesktopGuards`, `externalHref` + test). The first external link shows
  a dialog: destination host, opens in the default browser, no control over that page, downloads unchecked,
  their terms apply; "Ask before every external link" keeps it on. Stored as `werkbank.externalLinksAck`.

## Verification

`npm run check` (0 errors), `npm test` (all green, new tests: query, facetCounts, fitColumns, formatCompact,
groupIssues, installed rows, externalHref), `npm run lint`, `npm run build`; screenshots at 1100 × 680 in
German of Browse, Installed, the profile manager (list and server tab), the profile menu and the link dialog.
The mock (`dev/mock-tauri.js`) now has server-managed mods, a real dependency and a server-required library.
