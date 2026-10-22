# Launcher memory: where 800 MB go, and how the index should be stored

Date: 2026-10-22. Status: decided and implemented the same day (option B); the measurements below are from before.

## Measurement (installed app v0.4.2, idle, after startup)

| process                               | working set | private bytes |
| ------------------------------------- | ----------: | ------------: |
| `valheim-mod-manager.exe` (Rust core) |      798 MB |        869 MB |
| WebView2 renderer (our page)          |      162 MB |        108 MB |
| WebView2 gpu process                  |      103 MB |        146 MB |
| WebView2 browser, network, storage    |     ~210 MB |        ~60 MB |

The Rust core is the problem, not the web view. The WebView2 processes are ordinary Chromium overhead; the
renderer holds the slim index (18 MB JSON → JS objects) plus the DOM.

### What the Rust core holds

`cache/index.json` is 132 MB (compact JSON). It is deserialised into `Index` at startup and after every refresh:

| in the index                        |     count |
| ----------------------------------- | --------: |
| Thunderstore packages               |    13,750 |
| Hexium packages                     |     2,026 |
| versions                            |   117,199 |
| dependency entries (`Version.deps`) | 3,378,721 |
| **unique** dependency strings       |    33,363 |
| dependency bytes (with duplicates)  |    103 MB |

Every dependency entry is its own `String` (24-byte header + its own heap block, ~80 bytes each on the Windows
heap) → **~270 MB per copy**, and `Index` holds **two copies**: `parts` (the per-store lists, kept only so a
refresh that finds one store unchanged can reuse it) and `by_id` (the merged lookup map; `merge()` clones
everything). Versions, categories and the other strings add ~100 MB per copy. That is the 800 MB.

Peaks are higher: `load_cache` holds the 132 MB file, the deserialised parts and the built index at once; a
refresh holds the old index, the fetched lists and the new index. The Windows heap keeps most of that
committed afterwards, which is why the owner sees 750 MB to 1.2 GB.

### Who needs which data, and how often

| consumer                                            | needs                                                                                  | when                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Browse page (frontend)                              | the slim list: 1 record per package, latest version only                               | while browsing; `get_index` once per index generation                                  |
| resolver (`plan`, `updates`), health, server checks | full records **by id** for the profile's mods + their closure (a few hundred packages) | every `build_state`, i.e. after each mutation; sync; server check                      |
| details pane (`get_package`)                        | one full record                                                                        | on click                                                                               |
| modpack publish / share / transfer                  | full records by id for one profile                                                     | rarely                                                                                 |
| refresh                                             | whole lists per store, to merge and rebuild the slim list                              | every `index_ttl_minutes` when the CDN blob URL changed (otherwise nothing is rebuilt) |

Nobody iterates all 117k versions or 3.4M dependency entries at runtime except the refresh itself. The
launcher is idle 90 % of its life (started to launch the game, then left open). Holding the full lists in
memory serves only the refresh, which is the one path that could stream.

Full records are small except for a few modpacks: median 1.3 KB, p99 120 KB, the largest 3 MB
(`BlackViking-ThePack`, 529 versions × ~150 dependencies).

## Options

### A. Keep everything in memory, but compact

- Drop `parts` (reload the per-store lists from the cache file when a refresh needs an unchanged store).
- Intern dependency strings (`Arc<str>`, 33k unique values shared by 3.4M entries) or index them (`u32` into a
  dependency table).

Result: ~60 MB resident (Arc) or ~35 MB (u32 table). Startup still parses 132 MB of JSON (~1–2 s on a
background thread) and the transient peak stays ~400 MB. Refresh peak similar. Moderate change: `Version.deps`
changes type, which touches resolver, localmod, transfer and tests.

### B. Keep only the slim list in memory, full records on disk, read by id

- The cache becomes one record file per store: one JSON line per package (today's `Pkg` JSON), plus an
  in-memory table `id → (store, offset, len)` (16k entries, ~1 MB) and the slim JSON bytes (18 MB, which the
  frontend fetches anyway; could shrink: see below).
- `get(id)` reads one line per store with a positional read (`FileExt::seek_read`, no locking), merges the
  pair with today's `merge` logic (generalised to one package), and parses it: ~5–20 µs for a median record,
  ~10 ms for the largest modpack. A small per-generation cache (`HashMap<String, Arc<Pkg>>`, bounded) covers
  the profile's own packages so `build_state` never re-parses them.
- Refresh streams: Thunderstore comes as chunks already (`fetch_listing_index`); each chunk is parsed, appended
  to the new record file and dropped. Hexium (2k packages) stays in memory during the build. The slim list and
  the dependants count come out of that single pass. An unchanged store is re-streamed from its existing record
  file; nothing is held in memory for it.
- New generations are new files (`index-<fetchedAt>-<store>.jsonl`); old ones are deleted once no reader
  holds them. (Windows will not rename over an open file, so no rename-in-place.)

Result: ~20–40 MB resident Rust heap. Startup reads headers only (no 132 MB parse). Refresh peak ≈ one chunk

- Hexium ≈ 50–100 MB. Bigger change, confined to `thunderstore.rs` (the cache and index types), the resolver's
  lookup signature (`&HashMap<String, Pkg>` → a `PkgSource` trait implemented by the map for tests and by the
  disk index) and the commands that call `index.by_id`.

### C. A database (SQLite)

The same shape as B with less own code: `pkg(store, id PRIMARY KEY, json BLOB)`, page cache, transactional
replacement, per-package upserts. Performance for our access pattern (lookups by id) is the same as B: a
page-cached file read either way. What a database would add that B does not:

- relational queries and full-text search over packages. We do not run any: the Browse page filters the
  slim list in the web view (`src/lib/browse`, pure and tested) and nothing else queries by anything but id.
- incremental updates. Thunderstore ships whole chunks and the CDN URL is the change detector, so a refresh
  rewrites everything anyway.

Costs: a native dependency (`rusqlite` bundled: longer builds, a bigger binary, a C toolchain in CI), writing
117k versions + 3.4M dependency rows (or JSON blobs, which makes it a key-value store with extra steps), and
a second serialisation format to migrate. The repository rule is "new dependencies only when nothing in the
workspace does the job"; `std::fs` with positional reads does it.

A database would pay off only if the Browse page itself moved to server-side filtering (FTS5 queries from
Rust, the web view asking for pages of results). That would also cut the renderer's memory (it would no longer
hold 13.7k packages), but it is a rewrite of a working, tested filter engine for ~100 MB in a Chromium
process. Not justified now; noted as the one scenario where SQLite earns its place.

## Decision proposed

**B**: slim list in memory, full records on disk per store, read by id, refresh as a stream. No database.
Interning (A) is subsumed: with records on disk there is nothing left to intern.

Two side effects worth taking along:

- The slim JSON carries the latest version's dependency ids (`deps`, 293k strings, ~8 of its 18 MB). The
  frontend uses them for the dependency filter and the Browse selection helper, so they stay; but `desc`
  (1.2 MB) and the icon URLs could be trimmed later if the renderer ever matters.
- `get_index` clones the slim bytes per call; with `Arc<[u8]>` it would not. Minor.

Expected outcome: Rust core from ~800 MB to under 50 MB resident, startup without a 132 MB parse, refresh
peaks under 100 MB. Verification: `Get-Process` working set and private bytes of `valheim-mod-manager.exe`
idle, after startup and after a forced refresh; `cargo test` for the resolver and cache round trips; the
existing `listing_index_matches_v1_in_size_and_detects_unchanged` network test.

## Not in scope here, measured on the way

- Security: CSP is strict (`script-src 'self'`, no `unsafe-eval`, `frame-src 'none'`), markdown from the
  stores goes through DOMPurify, the capability set is minimal (no shell, no fs, opener restricted to URLs),
  updater signatures on. Nothing to fix.
- Svelte: the package list is `$state.raw`, listeners and the 5-minute server clock are cleaned up in
  `init()`'s teardown, the table is virtualised. No leak found in the audit's scope.
