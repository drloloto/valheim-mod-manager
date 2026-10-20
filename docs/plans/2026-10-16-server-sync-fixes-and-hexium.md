# Server sync fixes and Hexium — implementation plan

Spec: [2026-10-16-server-sync-review-and-hexium.md](../specs/2026-10-16-server-sync-review-and-hexium.md).
Branch `feat/monorepo-viteplus`. Phase A is a bug-fix commit on its own; phase B builds on it.

## Phase A: the server sync (F1–F4, F6)

1. **`dropped` in the diff** — `apps/client/src-tauri/src/server.rs`: `ServerDiff.dropped`, `diff(profile,
   resolved, manifest)` marks managed/legacy-managed entries the manifest no longer lists; `in_sync` is false
   while `dropped` is non-empty. Tests: a dropped managed mod is out of sync for a player, a player's own
   extra still is not, an admin's extra still is.
2. **Pinned and no updates for managed** — `server::adopt` writes `pinned: true`; `resolver::updates` skips
   `managed`. Tests in both modules.
3. **`last_adopted` on URL links, empty-manifest guard** — `commands.rs::adopt_server`: compute
   `<hash>:<config hash>` on the URL transport too (hash over the manifest's `configs` map); refuse a gist
   adoption without a manifest (`AppError::Invalid`). `check_link`/`check_gist` pass the profile into
   `diff`.
4. **Companion ids** — `apps/companion/src/manifest.ts`: `cleanMod` accepts hyphenated ids, optional
   `ns`/`name`, semver pre-release versions; `install.ts::splitId` prefers `ns`/`name` when present.
   `manifest.test.ts`, `install.test.ts`.
5. **Client manifest fields** — `server::ManifestMod` gains `ns`, `name` (serialised, default empty);
   `manifest_mods` fills them from the index.
6. **UI** — `types.ts` (`dropped`), `server-view.ts` counts it (test), `ServerDialog.svelte` diff list gets
   the "server removed it, adopting uninstalls it" line (`server.dropped` in `en.ts`/`de.ts`),
   `dev/mock-tauri.js` `check_server` returns one dropped entry so the screenshot shows it.
7. **Verify** — `vp run ci`; `bun run mock:audit`; `pwsh test/e2e.ps1` unchanged expectations; spec status
   → implemented.

## Phase B: Hexium

8. **Model** — `models.rs`: `Source::Hexium`; `Version { src, dl }`, `Pkg { srcs, hx_url }` with serde
   defaults so the cached index still loads; `Resolved.source`.
9. **Fetch and merge** — `thunderstore.rs`: `Store` enum with base URLs (`thunderstore.io/c/valheim`,
   `valheim.hexium.gg`), `fetch_listing_index(store, known)`, `fetch` runs both (Hexium optional via
   settings, its failure logged but not fatal), `merge_sources(ts, hx)` (union of versions, Thunderstore
   wins ties, `cmp_version` order, category normalisation table, `srcs`), cache carries both blob URLs
   (`source` becomes a small struct; an old cache simply refetches). `download_url(version)` returns `dl`
   when set. Unit tests for merge, normalisation, parse of a Hexium chunk (fixture from the scratchpad
   sample, two packages).
10. **Resolver and sync** — `resolver.rs` puts the chosen version's `src` into `Resolved`; `sync.rs`
    downloads from `download_url(&version)`; `server::manifest_mods` fills `source`; `share.rs` writes and
    reads `source` in r2x. Tests.
11. **Settings** — `settings.rs::hexium` (default true), `refresh_index` honours it, Settings page toggle
    (`settings.hexium*` keys).
12. **Companion** — `manifest.ts` (`source`), `install.ts::downloadUrl(mod)` by source with the experimental
    API fallback, `takeover.ts` `PackageApi` tries Hexium after Thunderstore; tests with a stubbed `fetch`.
13. **Browse and detail** — slim index `srcs`; `browse/criteria.ts` + `filter.ts` source token (tests);
    `PackageDetail` source badges and Hexium link; `thunderstore-links.ts` Hexium page URLs (test);
    `mock-tauri.js` packages with `srcs`, three Hexium-only.
14. **Docs and verify** (done 2026-10-17, see the spec's Verification section) — `docs/architecture.md` index section, changelog under Unreleased, `vp run ci`,
    `bun run mock:audit`, a real index refresh in the DEV app with Hexium on and off, a publish/adopt round
    trip against the test stack with one Hexium-only mod (`pwsh test/up.ps1 -SetupSync`).
