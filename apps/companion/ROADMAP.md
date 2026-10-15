# Companion roadmap — what a technical Valheim admin expects

The companion sits next to the game container the way Coolify sits next to its apps: one page that knows
the server, can act on it, and never gets in the way when you do things by hand. Everything stays optional
(`COMPANION_*` switches), the game container is never modified, only its bind mount and its lifecycle.

## Done (0.2)

- Mod lock (manifest) + one-click profile for the Mod Manager, `.r2z` download, read-only config viewer.
- Staged releases: the client publishes, the server pulls and checks (nothing live changes), the admin
  applies now, when nobody is online, or at a time. Backup before every apply. Players are never kicked by
  surprise.
- Start / stop / restart, `valheim.env` editing, world list, backups (create, import with mod-version diff,
  restore with safety copy).
- Player lists (admin / permitted / banned) with notes, online players and recent sessions parsed from the
  server log, log tail and live follow.
- Token onboarding: generated on first start and printed to `docker compose logs companion`.

## Done (0.4)

- Gist sync: lock and server state through one sealed gist, no open port.
- Working state and the guided release (server now → working state → review with diff → release), restart
  only when a changed file needs one, backup optional per release, conflicts with in-game write-backs caught.
- Config editor: search across all files, collapsible sections, typed controls (switch, range slider,
  enum select, flags chips, colour, vector, range, row tables for `Name:n` lists), zod advice with a raw
  escape hatch, default and "on the server" per value. Per-mod sync detection from the plugin DLLs
  (ServerSync / Jötunn / client-side, live reload).

## Next (in order of value for a small friends' server)

- The admin UI moves into the Mod Manager and both apps into one repository; this web UI shrinks to the
  landing page (button, sync code, sync setup). Design, slices and open decisions:
  `../modmanager-client/docs/superpowers/specs/2026-10-14-admin-ui-in-client-and-monorepo-design.md`.
  Decided 2026-10-14: the gist stays the players' transport; HTTP stays the admin surface on the LAN.
  Changed 2026-10-15: the companion shrinks to an install agent (apply, lifecycle, backups, logs, self-update),
  shipped as a GHCR image instead of `install.sh`, with device pairing and TLS instead of one raw token; the
  monorepo moves to the Vite+ toolchain. Plan:
  `../modmanager-client/docs/superpowers/specs/2026-10-15-monorepo-viteplus-companion-agent-design.md`.

2. **Mod updates on the server** — "N updates available" per installed mod (Thunderstore package endpoint
   per mod, no full index), one-click update into the manifest, change log link. Clients see the new lock
   before Play and adopt it.
3. **Scheduled backups and restarts** — cron-like settings (`COMPANION_BACKUP_CRON`, retention count),
   "restart at 05:00 when nobody is online", backup before every publish.
4. **Health and metrics** — CPU / RAM of the game container (`docker stats` API), save interval, world
   size over time, crash detection with automatic restart and a counter, uptime.
5. **Console / commands** — Valheim's dedicated server has no RCON. What exists: in-game console for admins
   (adminlist) and the launch flags. The companion can offer a flag editor (`-crossplay`, `-public`,
   `-saveinterval`, `-backups`, world modifiers like `-modifier combat hard`, `-preset`) that writes
   `valheim.env` / `SERVER_ARGS`, and a "send to all players" message via a small BepInEx helper mod later.
6. **Notifications** — Discord / webhook on player join/leave, server up/down, backup done, publish done.
7. **Player profile** — click a player: first seen, last seen, total time, actions (admin, ban, kick via
   restart-less `kick` is not possible without a helper mod).
8. **Multiple worlds** — switch the active world (`WORLD_NAME`), one backup set per world, world seed
   display and map preview (world file header carries the seed).
9. **Companion update check** — version against GitHub releases, one-line upgrade hint.
10. **Audit log** — who did what through the companion (token = identity today; named tokens later).

## Explicitly not planned

- A mod browser on the server page. Browsing, searching and composing profiles stays in the Mod Manager;
  the server only receives locks.
- A shell into the container. Too much power behind a single token; every action stays a typed endpoint.
