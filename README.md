# Valheim server companion

A small service next to the `valheim` container (image `ghcr.io/community-valheim-tools/valheim-server`).
It publishes the server's mod lock so the Valheim Mod Manager can match it with one click, shows the mod
configs read-only, and manages the game container, worlds, backups, player lists, logs and `valheim.env`.
It replaces `webapp`. Everything is optional; see the switches below. Where this is heading: [ROADMAP.md](ROADMAP.md).

Design: `modmanager-client/docs/superpowers/specs/2026-10-10-server-companion-design.md`.

## Onboarding in three steps

1. Add the service next to `valheim` (below) and run `docker compose up -d --build companion`.
2. Read the admin token: `docker compose logs companion` prints it on first start (it is also stored in
   `config/modmanager/companion-token`). Or set `COMPANION_TOKEN` yourself.
3. Open `http://<server>:9002`. Players click **Open in Mod Manager**; you paste the address under
   _Profile menu → Link server…_ in the Mod Manager, with the token if you want to publish.

A server that was managed by the old webapp gets its `installed.json` converted into a manifest on the first
start. A hand-installed server starts with an empty manifest and is filled by the first publish.

```yaml
services:
  valheim:
    image: ghcr.io/community-valheim-tools/valheim-server
    # … as before …

  companion:
    build: ./companion
    volumes:
      - ./config:/config
      - ./backups:/backups
      - ./valheim.env:/env/valheim.env
      - /var/run/docker.sock:/var/run/docker.sock # only needed for control, logs and players-online
    environment:
      - VALHEIM_SERVICE=valheim
      - PUBLIC_URL=http://10.10.10.123:9002 # what the deep link on the landing page points to
      # - COMPANION_TOKEN=change-me          # optional: your own token; "none" = read-only companion
    ports:
      - "9002:9002"
    restart: unless-stopped
```

## Switches

| Variable                      | Default   | Effect                                                                                                              |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `COMPANION_TOKEN`             | generated | Admin token. Unset → generated once and stored in `config/modmanager/companion-token`. `none` → no writes at all.   |
| `COMPANION_PUBLIC_READ`       | `true`    | Manifest, `.r2z`, configs and worlds readable without a token. `false` → token for everything except `/api/status`. |
| `COMPANION_MOD_MANAGER`       | `true`    | Deep link and `.r2z` export for the Mod Manager.                                                                    |
| `COMPANION_ALLOW_PUBLISH`     | `true`    | Clients may stage releases (`POST /api/releases`) and apply them; also `PUT /api/manifest` for scripts.             |
| `COMPANION_ALLOW_CONTROL`     | `true`    | Start / stop / restart via the Docker socket. Off → publish and restore do not restart.                             |
| `COMPANION_ALLOW_BACKUPS`     | `true`    | Backups: create, import, restore, delete.                                                                           |
| `COMPANION_ALLOW_ENV`         | `true`    | `valheim.env` editing.                                                                                              |
| `COMPANION_ALLOW_CONFIG_EDIT` | `true`    | In-place edits of `.cfg` values (viewing stays available).                                                          |
| `COMPANION_ALLOW_PLAYERS`     | `true`    | Admin / permitted / banned lists, online players from the log.                                                      |
| `COMPANION_ALLOW_LOGS`        | `true`    | Log tail and live follow (token required even with public reads).                                                   |
| `PUBLIC_URL`                  | –         | Address the landing page uses for the deep link; defaults to the page's own origin.                                 |
| `VALHEIM_SERVICE`             | `valheim` | Compose service name of the game container.                                                                         |

`/api/status` reports the switches so the page and the Mod Manager hide what is off.

## API

- `GET /api/status` (always public): names, container state, manifest hash, feature switches.
- `POST /api/auth/check`: validates a token (`{ ok }`).
- `GET /api/manifest`: the lock, every package with version, `explicit` and `requiredBy`, config hashes,
  order-independent `hash` (ETag), plus the switches relevant to the client.
- `GET /api/profile.r2z`: the same as an r2modman profile zip (mods + `BepInEx/config`).
- **Staged releases** (how the Mod Manager publishes, players are never kicked by surprise):
  `POST /api/releases` (token) takes the lock + config files, pulls every zip, checks it and reports a plan
  (install / remove / config changes) with problems; nothing changes live. `GET /api/releases/pending`,
  `POST /api/releases/<id>/apply` with `{ "when": "now" | "idle" | "at", "at": <epoch ms> }` (now = stop,
  backup, install, write configs, start; idle = as soon as the log shows nobody online; at = at that time;
  `"none"` clears the schedule), `DELETE /api/releases/<id>` discards. Mods whose download failed are left
  out of the applied manifest, so the client keeps showing them as missing on the server.
- `PUT /api/manifest` (token): direct apply without staging, for scripts and the backup restore.
- `GET /api/configs`, `GET /api/configs/<file>`; `PUT /api/configs/<file>` (token) edits values in place.
- `GET/PUT /api/env` (token), `POST /api/server/restart|stop|start` (token).
- `GET /api/logs?tail=N`, `GET /api/logs/stream` (SSE) — token.
- `GET /api/players` (token): lists, online players and recent sessions; `PUT /api/players/admin|permitted|banned`.
- `GET /api/worlds`; `GET/POST /api/backups`, `POST /api/backups/import` (upload, returns the mod diff
  between the backup's manifest and the running one), `GET /api/backups/<id>`, `DELETE`, `POST /api/backups/<id>/restore`
  (stop, safety backup, replace world, optionally configs and mod versions, start).

Local development: `bun install`, then
`COMPANION_TOKEN=x CONFIG_DIR=./dev/config BACKUP_DIR=./dev/backups ENV_FILE=./dev/valheim.env bun run src/server.ts`;
tests with `bun test`.
