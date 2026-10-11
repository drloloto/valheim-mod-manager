# Architecture

Two processes, one binary: a Rust core that owns everything touching the disk, the network and Steam, and a
SvelteKit single-page app rendered by WebView2 that owns the interaction. They talk over Tauri's IPC
(commands and events).

```
┌──────────────────────────── WebView2 (SvelteKit SPA) ────────────────────────────┐
│ routes/        pages: Browse, Installed, Config, Log, Settings                    │
│ components/    app (pages) → kit (own components) → ui (shadcn primitives)        │
│ api/store      one reactive store (Svelte 5 runes): state, index, filters, prefs  │
│ browse/        criteria → engine (bitmask per package) → filtered list, facets     │
│ desktop/       selection model, shortcuts, virtualization, column prefs, storage  │
└──────────────┬──────────────── invoke / listen ───────────────┬──────────────────┘
               ▼                                                ▲ events: index://updated,
┌──────────────────────────────── Rust core (Tauri) ────────────┴── sync://progress, sync://done, log://lines
│ commands.rs   thin facade: AppState assembly, command handlers, index + sync workers              │
│ thunderstore  fetch + compact the package index, disk cache, slim JSON for the UI                 │
│ resolver      dependency closure of a profile, diff against installed.json, update detection      │
│ sync          make a profile folder match profile.json: parallel downloads, remove, extract       │
│ install       zip layout detection (BepInExPack / BepInEx root / subfolders / bare), enable/disable│
│ profiles      profile.json, installed.json, active profile, clone/rename/delete                   │
│ share         r2modman export.r2x / .r2z, Thunderstore legacy profile codes                       │
│ config        BepInEx .cfg parsing and in-place value writes                                      │
│ game          Steam detection (registry, libraryfolders.vdf), doorstop sync, launch arguments     │
│ localmod      local .zip/.dll mods with manifest.json support                                     │
│ logs          tail BepInEx/LogOutput.log incrementally                                            │
│ migrate       import profiles of r2modman / Thunderstore Mod Manager (mods.yml + configs)         │
│ health        duplicate DLLs, deprecated mods, mods older than the last game update              │
│ publish       profile → Thunderstore modpack: manifest, readme, icon, configs, validate, upload   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data on disk

```
%APPDATA%\io.github.drloloto.valheim-mod-manager\
  settings.json              paths, concurrency, index TTL, NSFW default
  active.txt                 name of the active profile
  cache/index.json           compacted Thunderstore index with fetch timestamp
  cache/downloads/           <id>-<version>.zip, shared across profiles
  profiles/<name>/
    profile.json             explicit mods: namespace, name, version, enabled, source, deps (local only); optional server link
    installed.json           what is physically installed: version and file list per package
    BepInEx/                 plugins, patchers, config, core … (the real mod installation)
    doorstop/                winhttp.dll, doorstop_config.ini, doorstop_libs (copied into the game on Play)
    local/<id>/              source files of local mods
    .snapshots/<stamp>-<reason>/   profile.json, installed.json and config/ before a wholesale rewrite (ten kept)
```

The game folder only ever receives the doorstop files. Launch arguments
(`--doorstop-target-assembly <profile>/BepInEx/core/BepInEx.Preloader.dll`) point Unity Doorstop at the
profile, so switching profiles does not move files. Doorstop v3 and v4 argument styles are both supported.

## Core flows

**Index.** `index_worker` loads `cache/index.json` at startup and refreshes from Thunderstore when older
than the configured TTL (default 30 minutes), with a 5-minute backoff after failures. The source is the
`package-listing-index`: a redirect to a gzip blob of chunk URLs on the CDN, chunks fetched four at a time
with one retry, the same package shape as the deprecated `/api/v1/package/`, which stays as the fallback.
The blob URL carries the content hash and is saved with the cache, so a refresh that lands on the same
blob skips the download. `build()` also counts dependants per package for "Used by". `build()` keeps
the full packages in a `HashMap` for lookups and pre-serializes a slim JSON (one entry per package: latest
version, counts, dependency ids) that `get_index` hands to the UI unchanged. The UI sends `since` and gets an
empty body when nothing changed.

**Sync.** Any profile change (`set_mods`, import, repair, local mods) enqueues a sync. One worker processes
the queue; per profile, requests are merged. `run_sync` resolves the plan, downloads missing zips in
parallel (`buffer_unordered`), then removes and extracts sequentially in a blocking task. Explicit mods that
vanished from the index are never uninstalled. Disabled mods are installed and then renamed to `.old`.
Progress and completion are emitted as events; the UI toasts the summary and reloads state.

**Resolver.** Pure function over `(profile mods, index, installed.json)`: walks dependencies depth-first,
keeps the highest requested version per package, canonicalizes every `BepInExPack*` dependency to the one
Valheim pack, adds the pack when any mod is present, and diffs against what is installed.

**Play.** `launch_game` waits for a running sync, syncs the doorstop files into the game folder (hash
compared, copied only when different) and starts `steam.exe -applaunch 892970 <doorstop args>`. Vanilla
launches pass `--doorstop-enabled false`.

**Mod docs.** The detail panel's Readme / Changelog / Wiki tabs come from Thunderstore's experimental API
(`get_package_doc`, `get_package_wiki`, `get_wiki_page`). Readme and changelog are immutable per version
and cached under `cache/docs/`; the wiki is fetched per request. The UI renders with `marked`, sanitizes
with DOMPurify (`lib/markdown.ts`) and routes every link through `openExternal`. Spec:
`docs/superpowers/specs/2026-10-11-mod-docs-and-import-install.md`.

**Publish as modpack.** `publish.rs` turns a profile into a Thunderstore package: `manifest.json` with every
resolved package as a versioned dependency, the README the author edited in the dialog, a 256×256 icon (the
app icon as placeholder), an optional CHANGELOG and the profile's config files under `config/`. Thunderstore
validates manifest, readme and icon first, then the zip goes through `usermedia/initiate-upload` (presigned
parts), `finish-upload` and `submission/submit`, authenticated with the team service-account token from the
settings. Nothing is uploaded before the validators pass.

**Linked server.** A profile can carry a `server` block (companion URL, name, token). `check_server`
fetches `/api/manifest` (2 s timeout) and diffs the local resolved plan against it; the UI shows the result
in the status bar and, before a modded launch, as a dialog with "adopt server versions and start" (the
profile is rewritten to the manifest, every entry explicit and pinned, then synced and launched) or "start
anyway". `publish_profile` stages a release on the companion (`POST /api/releases`: the server pulls and
checks the local plan plus config files, nothing changes live); `apply_release` then applies it now, when
nobody is online, or at a time, and `discard_release` drops it. `valheim-mod-manager://import?url=…&name=…&link=…` (deep-link + single-instance
plugins) downloads the companion's `.r2z`, imports it like any other and stores the link. Spec:
`docs/superpowers/specs/2026-10-10-server-companion-design.md`.

## Frontend

**Store.** `src/lib/api/store.svelte.ts` holds `AppState` from the core, the slim index, the browse filters
(persisted), table preferences (persisted) and derived values: `modsMap`, `profilesByMod`, `searchKeys`,
`masks`, `filtered`. Pages never call `invoke` directly; they call store methods, which call the client and
replace `state` with the response.

**Browse engine.** Criteria are plain data (`criteria.ts`): six tri-state lists (include/exclude), two date
ranges, four numeric ranges, a query and the category mode. `engine.ts` evaluates all criteria in one pass
and stores one bitmask per package (one bit per criterion, inactive criteria always set). The result list is
"all bits set"; facet counts and histograms for section X are "all bits except X set". So typing in the
search field costs one pass over ~7,000 packages, not one per open filter section.

**Tables.** `DataTable` is a virtualized CSS grid with explorer-style selection (`desktop/selection.ts`,
pure), keyboard handling on the viewport, a header context menu for columns and density, drag-to-reorder and
resize handles. Column preferences (`desktop/columns.ts`) are per table and persisted.

**Persistence.** `Persisted<T>` mirrors a reactive value to `localStorage` under `werkbank.*` keys with a
defensive parser; broken or foreign data falls back to defaults. Keys: browse criteria, saved views, section
open state, table prefs, locale.

**Design system.** `theme.css` defines the "Werkbank" tokens (dark only, warm neutral, amber accent).
`app.css` maps them to Tailwind utilities and adds the typography utilities (`label-caps`, `cell-mono`, …).
`style-desktop.css` overrides the generated shadcn classes centrally so the generated files stay pristine.
`kit/` wraps the primitives into the components pages use; a test keeps pages from reaching below the kit.

**i18n.** `t()` reads from a catalog chosen by a replaceable locale source. `index.svelte.ts` points the
source at the persisted setting (system/de/en), which makes every `t()` call inside a `$derived` or a
template reactive to language changes. Formatters in `format.ts` are cached per locale.

## Decisions worth knowing

- **SPA, no SSR.** Tauri serves static files; `+layout.ts` sets `ssr = false` and the adapter falls back to
  `index.html`.
- **One dark theme.** The design is dark only; `<html>` carries `style-vega dark` permanently.
- **Custom title bar.** `decorations: false`, drag region in the title bar, window state persisted by
  `tauri-plugin-window-state`.
- **Profiles as the installation.** No copying on switch; the cost is one doorstop sync at launch.
- **English core messages.** Error strings from Rust are English and shown verbatim; the UI is localized.
- **Portable mode.** A `portable` file next to the executable moves the data root to `<exe dir>/data`;
  `AppState.app` reports it and the updater stays off.
- **Signed updates.** `tauri-plugin-updater` checks `releases/latest/download/latest.json` once at startup
  (opt-out in Settings); packages are verified against the public key in `tauri.conf.json`.
- **Mock backend for the browser.** `dev/mock-tauri.js` fakes `window.__TAURI_INTERNALS__` so the whole UI
  runs in a normal browser with sample data (dev server only, `VITE_MOCK_TAURI=1`).
