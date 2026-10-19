# Test pipeline on a snapshot of the real server

Date: 2026-10-16. Status: implemented, first run green (see "Result").

## Why

The companion changed a lot (monorepo, bun image, Hexium, lock fields `ns`/`name`/`source`) and the next
`install.sh update` on the real server runs on data the test stack never had: the real lock, installed.json,
the hand-placed files in `plugins/`, 81 config files, the companion's backups. The client changed too (server
sync fixes, pinned server mods, Hexium), and its migration runs on the owner's real profiles. Both must be
tested on that data before the commit, without touching the real server or the installed app's data.

## Decisions

- **Snapshot, once, read-only.** With the owner's one-time permission the compose folder of the real server
  was streamed over SSH as a tar (`tar czf -` on the server, written only locally, nothing created there):
  `test/snapshots/prod-20261016.tar.gz`, 1.16 GB. Not in it: `data/` (the game's own install, 6.5 GB, the
  test stack has its own), the compose `.env` (tunnel secrets), `config/modmanager/sync.json` and
  `companion-token` (the real sync code and admin token), the game's own world backups in `config/backups`
  and the `*_backup_*` world folders. In it: `config/` (modmanager with lock, installed.json, cache, untracked
  files; the BepInEx folder; worlds; the lists), the companion's `backups/`, `valheim.env`, the compose files
  and the deployed `companion/` checkout (old `drloloto/companion` repo at `551ea79`, with `.git`).
  `test/snapshots/` is git-ignored; `seed.ps1` refuses a snapshot that carries one of the secret files.
- **Seed replaces `test/config`, not the stack.** `test/seed.ps1` stops the containers, moves `test/config`
  to `test/config.prev`, copies the snapshot's `config/`, `backups/` and `valheim.env` in, puts the test
  stack's own `sync.json`, `sync-state.json` and `companion-token` back (so the companion keeps the test gist
  and the test token), saves the snapshot's lock and installed.json as `<name>.lock.json` /
  `<name>.installed.json` next to the archive, and starts the game container on the seeded BepInEx folder.
- **Verify compares against the snapshot, not against expectations.** `test/verify-migration.ps1` checks
  health, the game container, server name, no staged release; every lock entry (id, version, explicit flag,
  store), the lock hash and the config-hash count; every installed.json entry with its files; `reparse --json`
  inside the container (`inSync`); `profile.r2z`; the takeover view. ok/FAIL lines, exit 1 on a FAIL.
- **vp tasks, not cached.** `test:migration` is one task with three commands in order (seed, up with sync,
  verify); `stack:up`, `stack:seed`, `stack:verify`, `e2e` are the pieces. All `cache: false`: they drive
  containers and the DEV app. `SNAPSHOT=<tar.gz>` selects a snapshot.
- **The client side seeds the DEV app from the installed app.** `apps/client/dev/seed-dev-data.ps1` copies
  every profile, `settings.json`, `cache/index.json` and `active.txt` into the DEV data dir and strips the
  `server` block of each copy: a copy must never adopt from or publish to the real server. `bun run mock` runs
  it first (existing DEV profiles are kept), `bun run mock:seed` replaces them. The link to the test companion
  is made in the app, or by `dev/dev-app.ps1` for one profile (the e2e path).

## Found on the way

- The companion image did not build since the bun migration: `bunx` is a symlink in the bun image and was
  not copied; a filtered `bun install` puts the package's dependencies into `apps/companion/node_modules` as
  symlinks into the store at `/repo/node_modules/.bun`. The runtime image now keeps the `/repo` layout
  (`WORKDIR /repo/apps/companion`, store and package `node_modules` copied).
- The real server's `plugins/` holds the companion's bare-layout installs (`EpicLoot.dll`, `Jotunn.*`,
  `MapShare.dll`, `Newtonsoft.Json.dll`, …) next to package folders; the takeover scan lists them as
  unidentified by shape, reparse maps them through installed.json and reports the lock in sync.
- The deployed companion is the old `companion` repository (commit `551ea79`, `compose.companion.yaml` says
  `build: "./companion"`); `install.sh update` from the monorepo expects the checkout at
  `<compose dir>/valheim-mod-manager/apps/companion`. The migration on the real server needs a new clone next
  to the old one (or `--dir`), then `install.sh update`. Since 2026-10-19 `update` rewrites the `build:` block
  of `compose.companion.yaml` to the monorepo (context `./valheim-mod-manager`, dockerfile
  `apps/companion/Dockerfile`), keeps every other line, checks that the game service's configuration is
  unchanged, keeps the previous file as `compose.companion.yaml.before-update` and names the old `companion/`
  folder as no longer used. Without that, a later `docker compose build` would have rebuilt the old companion
  from the dead folder.
- Rehearsal of that update, 2026-10-19, in a scratch folder built like the server: the snapshot's compose
  file, the old `compose.companion.yaml` and the old `.env` block, the old checkout built and running
  (reports 0.3.0, 11 mods, game running on the test stack's data), the monorepo as `valheim-mod-manager/`
  next to the compose file. `install.sh update` from there: file rewritten, image built, companion healthy,
  game container untouched, verify ok (world, 11 configs, 11 mods); afterwards version 0.3.1, lock hash
  unchanged, `install.sh status` ok, a second `update` leaves the file alone.

## Result

First run, 2026-10-16: `vp run test:migration` green after the image fix (11 lock entries, hash unchanged,
81 config hashes, 10 installed entries with their files, reparse in sync, profile.r2z 417 kB), with the game
container started on the snapshot ("Game server connected" with the snapshot's plugins). `test/e2e.ps1 -Build`
on the same stack: PASS (the companion's button links a fresh DEV app to the test gist, the profile adopts
the 11 mods and the configs, the app shows it in sync). `seed-dev-data.ps1` copies with robocopy, because
the installed app holds `BepInEx\cache` files open while it runs; that cache and `.snapshots` are skipped.
