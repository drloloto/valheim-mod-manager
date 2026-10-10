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

## Next (in order of value for a small friends' server)

1. **Config editor with validation** — edit `.cfg` values in the browser with the type/range metadata the
   parser already extracts (bool toggles, number ranges, enums), "changed vs default" view, diff before save,
   automatic restart prompt. The client has the same editor; same metadata, same look.
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
