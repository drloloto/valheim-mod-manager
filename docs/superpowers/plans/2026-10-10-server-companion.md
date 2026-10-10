# Server companion — implementation plan

Spec: [2026-10-10-server-companion-design.md](../specs/2026-10-10-server-companion-design.md). Two code bases:
the companion (`C:\Users\schlangeatom\valheim-server\companion`, Bun + Hono, replaces `webapp`) and this
client. The contract between them is the manifest JSON and the `.r2z` profile zip.

## Decisions taken while planning

- The companion holds **no Thunderstore index**. The lock names every package with namespace, name and
  version; the download URL follows from that. Icons on the landing page come from Thunderstore's package
  page link, not from an index.
- `PUT /api/manifest` is **synchronous**: downloads of a handful of mods take seconds, the client waits with
  a long timeout. No job queue, no SSE.
- The pre-Play comparison is **by mod list, not by hash**: BepInExPack is ignored on both sides, so a manifest
  migrated from a hand-installed server still compares correctly. The hash remains the ETag.
- Backups are `tar.gz` via the container's `tar`; the archive holds `worlds_local/<world>…`,
  `bepinex/config/` and `modmanager/manifest.json`.
- Deep link scheme `valheim-mod-manager`, registered by the installers and at runtime (`register_all`) so the
  portable build works too. `tauri-plugin-single-instance` with the `deep-link` feature forwards the URL to
  the running window.

## Tasks

1. **Companion skeleton** — `package.json`, `Dockerfile`, `paths.ts`, `auth.ts` (Bearer token for every
   non-GET), `server.ts` with `/api/status`. Reused as is: `bepinexconfig.ts`, `docker.ts` (+ stop/start/state).
2. **Manifest** — `manifest.ts`: types, `hashMods`, `diffMods`, load/save, migration from the old webapp's
   `profiles/*.json` + `installed.json`. Tests: hash ignores order and the pack; diff added/removed/changed.
3. **Install** — `install.ts`: layout detection ported from `install.rs` (pack / BepInEx root / subfolders /
   bare), never overwrite configs, `installed.json` bookkeeping, remove + prune. Tests with in-memory zips
   (`fflate`).
4. **Profile export** — `r2z.ts`: `export.r2x` YAML + `BepInEx/config/*`. Test: client-compatible YAML shape.
5. **Env, worlds, backups** — `env.ts` (parse/update `valheim.env`, test), `worlds.ts`, `backups.ts`
   (create, list, import with manifest diff, restore with safety backup).
6. **Routes + pages** — all endpoints of the spec, `public/index.html` (mods, deep-link button, config
   link), `public/configs.html`. Compose snippet + README.
7. **Client core** — `models.rs` `ServerLink`, `server.rs` (manifest types, diff, publish body, tests),
   commands `import_profile_url`, `set_server_link`, `check_server`, `adopt_server`, `publish_profile`;
   `AppState.server`.
8. **Client deep link** — Cargo + npm plugins, `tauri.conf.json` scheme, capability, `lib.rs` wiring,
   frontend listener → import.
9. **Client UI** — `ServerDialog.svelte` (link / publish / pre-play diff), profile menu entries, status-bar
   indicator, `requestLaunch` gate, i18n, mock handlers.
10. **Gates** — `npm run check && npm test && npm run build && npm run lint`, `cargo fmt/clippy/test`,
    `bun test` in the companion, mock preview screenshots.
