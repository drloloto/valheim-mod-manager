# Market analysis (Analyse.md), validated against the app on 2026-10-11

The owner's deep research (`Analyse.md`, Thunderstore API + r2modman/Gale feature gaps) was written without
the full picture of the app. This note checks every point against the code and the live API and fixes the
order of work. Verified live: `/api/docs/?format=openapi` marks `/api/v1/package/` and
`/c/{community}/api/v1/package/` as `deprecated: true`; `/c/valheim/api/v1/package-listing-index/` answers
302 to a gzip blob on `ccdn.thunderstore.io`; the cyberstorm readme endpoint returns `{ html }` only (no
`is_edited` field, contrary to the analysis); the experimental readme/changelog/wiki endpoints return
markdown and are what the app uses since commit `c0c2172`.

## Already covered (no work)

| Analysis item                                                 | State in the app                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-app readme / changelog / wiki (A, B#2)                     | Done: tabs in the detail panel, wide reading dialog, DOMPurify, links via `openExternal`, request-key check against stale responses, per-version disk cache. |
| Versions tab, dependency list, "Thunderstore ↗", website link | Done (Details tab).                                                                                                                                          |
| Version pinning in the resolver (B#4, half)                   | Explicit profile entries are pinned; dependencies float to newest. Downgrade = "Pick" in the versions list.                                                  |
| Health hint "older than the last game update" (B#5, half)     | Done, from the Steam app manifest build date.                                                                                                                |
| Typed config editor (B#6, half)                               | Done for bool (switch), enum / acceptable values (choice), text. `Acceptable value range` is parsed.                                                         |
| Category blacklist / default filters (B#8)                    | Done: tri-state exclude lists, persisted criteria, saved views; "not Deprecated, NSFW" is the shipped default.                                               |
| Auto-update opt-out (B#20)                                    | Done (Settings).                                                                                                                                             |
| Downloads / last updated in the list (B.1)                    | Done, plus filters and histograms.                                                                                                                           |
| Server sync (B#9, own server)                                 | Done via the companion: compare before Play, adopt, staged releases.                                                                                         |
| Offline play (B#19, half)                                     | Works: index from cache, Play never needs the network, server check times out after 2 s.                                                                     |

## Decided: do next

_Status, same evening: 1 to 9 are implemented (see CHANGELOG, Unreleased)._

1. **Index on `package-listing-index`, v1 as fallback** (B#1, Must, M). v1 is deprecated in Swagger today.
   Chunked gzip JSON over the CDN, `Last-Modified` conditional GET, and a retry on the CDN outages the
   Thunderstore wiki documents. Adapter in `thunderstore.rs`, same `Pkg` output, no UI change.
2. **Changelog before updating** (B#3, Must, S). The changelog endpoint is wired; the update row and
   "Update all" get a "What changed" view with the `##` sections between installed and new version.
3. **Pin per mod** (B#4, Must, S). A `pinned` flag on the profile entry that "Update all" and the server
   adopt skip, with a marker in the installed list. Rollback = Pick an older version, already there.
4. **Docs cache and CSP** (A.4, Should, S). Readme/changelog can be edited on Thunderstore after
   upload, so the per-version cache gets a 7-day TTL instead of forever. Set a real CSP in
   `tauri.conf.json` (`script-src 'self'`, `img-src https: data:`, `frame-src 'none'`) as the second layer
   behind DOMPurify. Thunderstore package links inside a readme open the package in-app instead of the
   browser.
5. **Dependants** (B#15, Should, S). Computed from the index (reverse dependency map) at build time:
   "Used by n mods" in the detail header and a filter, no extra requests.
6. **Config editor finish** (B#6, Should, S–M). Slider for numeric ranges, "Reset to default", orphaned
   entries flagged.
7. **Client/server-side hints** (B#11, Should, S). The index already carries the Server-side /
   Client-side categories; a profile with a linked server gets a hint when a server-side mod is missing on
   the server manifest and vice versa.
8. **Download retry and CDN fallback** (C, Should, S). One retry with backoff; failures already drop the
   mod from the plan instead of breaking the sync.
9. **Publish a profile as a Thunderstore modpack** (B#7, Should, M–L). Generate manifest, README,
   icon, CHANGELOG, upload with a team service-account token. Fits the "GitHub for modpacks" vision and
   the companion's staged releases; after 1–8.

## Deliberately not now

- **Valheim 1.0 heuristics from changelog text and fork detection** (B#5 rest): parsing "Compiled
  against" out of free text is unreliable; the build-date hint covers the common case. Revisit if users ask.
- **Image proxy** (A.4): privacy nice-to-have; `img-src https:` with lazy loading is enough for a desktop
  app that already talks to Thunderstore. Could come with the CSP work later.
- **Live sync link without a server, CLI, hardlinks, ecosystem schema, log analysis, extra sources,
  tray notifications, explicit offline switch, mod list export** (B#9 rest, #10, #12, #13, #14, #16,
  #17, #18, #19 rest): valid, all "Could". Mod list export (Markdown for Discord) is the only one worth
  picking up opportunistically, it is an hour of work.
- **Cyberstorm endpoints**: undocumented, no `is_edited` in practice; the experimental endpoints do the
  job. Keep an eye on the Swagger for a stable replacement.
