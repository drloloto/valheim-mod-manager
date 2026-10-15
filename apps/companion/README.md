# Valheim server companion

A small service next to the `valheim` container (image `ghcr.io/community-valheim-tools/valheim-server`).
It publishes the server's mod lock so the Valheim Mod Manager can match it with one click, is where the mod
configs are edited (the server's `BepInEx/config` is the single source of truth; clients take it over), and
manages the game container, worlds, backups, player lists, logs and `valheim.env`. Every change — a lock
from the Mod Manager, a config edit in the browser — goes into one **working state** and reaches the server
in one guided release: server now → working state → review (diff) → release.
It replaces `webapp`. Everything is optional; see the switches below. Where this is heading: [ROADMAP.md](ROADMAP.md).

Design: `modmanager-client/docs/superpowers/specs/2026-10-10-server-companion-design.md`.

## Install

Copy this `companion` folder next to the server's `docker-compose.yaml`, then in that folder:

```bash
bash companion/install.sh            # check only: shows what would happen, changes nothing
bash companion/install.sh install    # add it; the game keeps running, players stay connected
```

The script needs nothing but Docker. It checks Docker and Compose, finds the game service and its `/config`
and env file, picks the LAN address (loopback/private only, never a public one) and a free port, builds the
image, and shows the planned changes. It never edits your compose file: the companion goes into
`compose.companion.yaml`, and four marked lines in `.env` load it through `COMPOSE_FILE` (an existing
`docker-compose.override.yaml` stays loaded). After the start it confirms that the game container was not
touched and that the companion reads the same world the game runs. A failure in any step after the first write
restores `.env` and removes the companion, so the server is as before. It prints the URL and the admin token
at the end.

| Command                               | What it does                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash companion/install.sh update`    | after copying a new version: rebuild and restart only the companion                                                                                                                                                                                           |
| `bash companion/install.sh status`    | re-run the checks against the running companion                                                                                                                                                                                                               |
| `bash companion/install.sh uninstall` | remove container, file and `.env` lines; `config/modmanager`, `backups/` stay                                                                                                                                                                                 |
| `bash companion/reparse.sh [--write]` | compare what runs (companion installs, hand-installed folders, loose files) with the lock; `--write` replaces the lock with what is on disk unless a package cannot be resolved, a release is staged or entries would be dropped (`--force` for the last two) |

Options: `--bind <ip>`, `--port <n>`, `--service <game service>`, `--dir <compose dir>`, `--yes`.

Then open the URL. Players click **Open in Mod Manager**; you paste the address under _Profile menu → Link
server…_ in the Mod Manager, with the token if you want to publish. A hand-installed server starts with an empty
mod lock; the first publish fills it and moves the hand-installed files to `config/modmanager/untracked/`. A
server managed by the old webapp gets its `installed.json` converted on the first start (remove the old
`modmanager` service first; the script refuses while it exists).

### Manual setup

The same by hand: add this block to the compose file the server already runs from and run
`docker compose up -d --build companion`. The token is printed by `docker compose logs companion` and stored in
`config/modmanager/companion-token`.

```yaml
services:
  valheim:
    image: ghcr.io/community-valheim-tools/valheim-server
    # … unchanged …

  companion:
    build: ./companion
    volumes:
      - ./config:/config
      - ./backups:/backups
      - ./valheim.env:/env/valheim.env
      - /var/run/docker.sock:/var/run/docker.sock # control, logs, players online, safe restores
    environment:
      - VALHEIM_SERVICE=valheim
      # - PUBLIC_URL=http://192.168.1.10:9002 # what the deep link on the landing page points to
      # - COMPANION_TOKEN=change-me          # optional: your own token; "none" = read-only companion
    ports:
      - "127.0.0.1:9002:9002" # or "<LAN-IP>:9002:9002"; never on a public interface or a tunnel
    restart: unless-stopped
```

Add only this block to the compose file the server already runs from (same project: the companion finds the
game container by its compose labels). `docker compose up -d --build companion` starts it without recreating
`valheim`; players stay connected.

### Sync through a gist (no open port)

Instead of reaching the companion over HTTP, the Mod Manager and the companion exchange two sealed files in
one secret GitHub gist: `release.json` (admin → server: lock + configs + when to apply) and `server.json`
(server → everyone: what runs now + release status). Players and the admin only need the **sync code**
`vmm1.<gist id>.<secret>`; the secret seals the files (HKDF-SHA256 → AES-256-GCM, gzip), so the gist holds
nothing readable. The companion polls the gist, hands a new release to the staging pipeline above and reports
back. Nothing is published on any port for this.

**Setup:** sign in on the landing page and fill in _Sync without an open port_ with a GitHub token. Use a
GitHub account created for the server (never a personal one) and a classic token with only the `gist` scope;
fine-grained tokens cannot write gists. The companion creates the gist, keeps code and token in
`config/modmanager/sync.json` (owner-only), starts the poller and shows the code. From then on the page's
**Open in Mod Manager** button carries the code: the Mod Manager links the new profile through the gist and
adopts mods and configs before the game starts; players need neither an address nor an account. The admin
enters the same gist token under _Link server…_ in the Mod Manager to publish. _Turn sync off_ stops the
poller and forgets the file; the gist stays on GitHub. API: `GET/POST/DELETE /api/sync`.

| Variable                    | Effect                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPANION_SYNC_CODE`       | sync code from the environment instead of the page (the page can then not change it)                                                          |
| `COMPANION_GIST_TOKEN`      | the token for it; without a token releases are still read, `server.json` is not written                                                       |
| `COMPANION_GIST_POLL`       | seconds between polls (default 60, minimum 10); a 304 costs no rate limit with a token                                                        |
| `COMPANION_GIST_API`        | API base, default `https://api.github.com` (tests use `src/testing/fakegist.ts`)                                                              |
| `COMPANION_DEEPLINK_SCHEME` | URL scheme of the button, default `valheim-mod-manager`; `valheim-mod-manager-dev` opens the client's DEV build                               |
| `COMPANION_INVITE_URL`      | https page that forwards an invite to the app (the client repo's `web/join.html` on GitHub Pages); without it the invite is the raw deep link |

**Inviting players:** the page shows an _Invite link for players_ once the sync is on. It carries only the
sync code and the server name, never this companion's address, so it can be sent to friends outside the LAN;
the companion itself stays unreachable for them. The code lets the Mod Manager read the lock and the configs;
writing needs the admin's gist token, which no invite carries. Custom-scheme links are not clickable in most
chats, so publish `web/join.html` from the client repository (GitHub Pages) and set `COMPANION_INVITE_URL` to
its address: the invite becomes an https link whose fragment (`#code=…`) never reaches any server. The admin
can also copy the same invite from the Mod Manager's publish dialog.

CLI for trying it without the client: `bun run src/gistsync.ts create|publish|read|code …` (see the file
header). File formats, the client side and the test log: `docs/adr/2026-10-12-sync-through-a-gist.md`.

### What the companion does to an existing server

- **Never touched:** `./data` (`/opt/valheim`), the `valheim` service definition, the image's own backups in
  `config/backups`.
- **First start:** creates `config/modmanager/` (token, manifest, download cache), `./backups`, and the
  BepInEx folders if missing. Nothing existing is changed.
- **Every change to game files** (release, `PUT /api/manifest`, restore) runs the same sequence: stop
  the game and confirm with Docker that it is down → back up the active world + the BepInEx configs (`config/bepinex` without `plugins/`/`patchers/`) + manifest →
  change → start again (only if it was running). A failed stop or backup aborts with nothing changed. A
  restore additionally refuses when it cannot confirm the server is stopped. A release that only changes
  configs of mods that re-read their file (see below) skips the stop/start; the backup can be unticked per
  release.
- **Config edits never touch the live file directly.** The editor copies the file into the working state
  (`config/modmanager/releases/<id>/config/`) and changes that copy; the release writes it back with an
  atomic rename, owner and mode kept, only the changed lines different. If the live file changed meanwhile
  (ServerSync and Jötunn write configs back in-game), the review step shows a conflict and the release
  refuses until the admin reverts the staged copy or ticks "overwrite".
- **What an edit reaches** is read from the plugin DLLs once (`config/modmanager/plugin-scan.json`, cached by
  hash): ServerSync (server values reach players when they join), Jötunn (only `IsAdminOnly` entries), or
  nothing (client-side config: a server edit reaches nobody), and whether the DLL mentions a file watcher
  (the mod probably re-reads its file). The editor and the review show it per file. All of this is a string
  scan, so it only informs: a release that changes a config always restarts the server.
- **Stop timeout:** the companion waits at least 120 s for the world save before Docker may kill the game,
  longer if `stop_grace_period` says so. Keep `stop_grace_period: 2m` on `valheim`.
- **Restore** extracts into `config/modmanager/restore-tmp/`, checks the archive (no `..`, no symlinks), then
  swaps world (and configs) in by rename; a failure moves the previous files back. Restored files get the owner
  of the files they replace.
- **Hand-installed server, first start:** without a lock the companion reads `bepinex/plugins`: every folder
  named `Namespace-Name` (the way r2modman and the Mod Manager lay mods out) becomes a lock entry. The version
  is the newest Thunderstore release that existed when the files were copied (the latest release if it
  predates the copy, else the version the DLL itself carries when Thunderstore knows it), dependencies are
  pinned as Thunderstore lists them. Loose DLLs and other folders cannot be identified without an index; the
  page lists them and the admin's first publish from the Mod Manager covers them. `GET/POST /api/takeover`;
  the page offers the takeover again while the lock is empty. Nothing on disk changes: the first applied
  release moves the hand-installed files aside and installs the packages cleanly.
- **First applied release on a hand-installed server:** files in `bepinex/plugins` and `bepinex/patchers`
  that the companion did not install are moved to `config/modmanager/untracked/<time>/` (kept, not deleted),
  so old and new copies of a mod do not both load. The release plan lists them before you apply. The image
  removes them from `/opt/valheim` on the next start (`.synced_from_config`). Mods placed directly in `data/`
  are not seen.
- **`valheim.env`:** only changed lines are rewritten, quoted so Compose reads back the exact value (`$` is
  not expanded), a copy of the previous file goes to `config/modmanager/env-history/`. Compose reads the file
  when it creates the container: apply with `docker compose up -d valheim`; a restart keeps the old values.
- **Atomic writes:** manifest, `installed.json`, player lists, config edits and backups are written to a temp
  file and renamed, so a crash never leaves a half-written file.

### Security

The Docker socket gives whoever controls the companion root on the host, and the token travels over plain
HTTP. Bind the port to `127.0.0.1` or a LAN address, do not forward it through a router or a tunnel (playit,
Cloudflare, …), and reach it from outside through a VPN or an SSH tunnel. With public reads on (default),
anyone who reaches the page can read the mod configs; set `COMPANION_PUBLIC_READ=false` if a config holds a
secret (webhook URLs, API keys).

## Switches

| Variable                      | Default   | Effect                                                                                                                  |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `COMPANION_TOKEN`             | generated | Admin token. Unset → generated once and stored in `config/modmanager/companion-token`. `none` → no writes at all.       |
| `COMPANION_PUBLIC_READ`       | `true`    | Manifest, `.r2z`, configs and worlds readable without a token. `false` → token for everything except `/api/status`.     |
| `COMPANION_MOD_MANAGER`       | `true`    | Deep link and `.r2z` export for the Mod Manager.                                                                        |
| `COMPANION_ALLOW_PUBLISH`     | `true`    | Clients may stage releases (`POST /api/releases`) and apply them; also `PUT /api/manifest` for scripts.                 |
| `COMPANION_ALLOW_CONTROL`     | `true`    | Start / stop / restart via the Docker socket. Off → publish does not restart; restore needs the server stopped by hand. |
| `COMPANION_ALLOW_BACKUPS`     | `true`    | Backups: create, import, restore, delete.                                                                               |
| `COMPANION_ALLOW_ENV`         | `true`    | `valheim.env` editing.                                                                                                  |
| `COMPANION_ALLOW_CONFIG_EDIT` | `true`    | In-place edits of `.cfg` values (viewing stays available).                                                              |
| `COMPANION_ALLOW_PLAYERS`     | `true`    | Admin / permitted / banned lists, online players from the log.                                                          |
| `COMPANION_ALLOW_LOGS`        | `true`    | Log tail and live follow (token required even with public reads).                                                       |
| `PUBLIC_URL`                  | –         | Address the landing page uses for the deep link; defaults to the page's own origin.                                     |
| `VALHEIM_SERVICE`             | `valheim` | Compose service name of the game container.                                                                             |

`/api/status` reports the switches so the page and the Mod Manager hide what is off.

## API

- `GET /api/status` (always public): names, container state, manifest hash, feature switches.
- `POST /api/auth/check`: validates a token (`{ ok }`).
- `GET /api/manifest`: the lock, every package with version, `explicit` and `requiredBy`, config hashes,
  order-independent `hash` (ETag), plus the switches relevant to the client.
- `GET /api/profile.r2z`: the same as an r2modman profile zip (mods + `BepInEx/config`).
- **Working state / staged release** (players are never kicked by surprise): `POST /api/releases` (token)
  takes a lock + optional config files from the Mod Manager or the gist, pulls every zip, checks it and
  merges it into the pending working state (a second publish replaces the lock, staged config edits stay).
  `GET /api/releases/pending` returns it with the plan checked against the server right now (install /
  remove / changed and new configs / conflicts / `restartRequired` / per-file `effects`);
  `GET /api/releases/pending/diff` adds every staged file as before/after text and changed values.
  `DELETE /api/releases/pending/configs/<file>` drops one staged file, `DELETE /api/releases/pending/mods`
  the staged lock, `DELETE /api/releases/<id>` everything. `POST /api/releases/<id>/apply` with
  `{ "when": "now" | "idle" | "at", "at": <epoch ms>, "backup": true, "force": false }` (now = stop if
  needed, backup unless `backup: false`, install, write configs, start; idle = as soon as the log shows
  nobody online; at = at that time; `"none"` clears the schedule; `force` overwrites conflicting files).
  Mods whose download failed are left out of the applied manifest, so the client keeps showing them as
  missing on the server.
- `PUT /api/manifest` (token): direct apply without staging, for scripts and the backup restore.
- `GET /api/configs` (`files`, per-file sync `info`, `staged` list; `?settings=1` adds every setting of
  every file for the search), `GET /api/configs/<file>` (the working copy's settings with type/default/
  acceptable values/`multiple`/`synced`, the `live` values it changes, `info`); `PUT /api/configs/<file>`
  (token) stages value changes in the working state and answers with the release summary and the effect.
- `GET/PUT /api/env` (token), `POST /api/server/restart|stop|start` (token).
- `GET /api/logs?tail=N`, `GET /api/logs/stream` (SSE) — token.
- `GET /api/players` (token): lists, online players and recent sessions; `PUT /api/players/admin|permitted|banned`.
- `GET /api/worlds`; `GET/POST /api/backups`, `POST /api/backups/import` (upload, returns the mod diff
  between the backup's manifest and the running one), `GET /api/backups/<id>`, `DELETE`, `POST /api/backups/<id>/restore`
  (stop, safety backup, replace world, optionally configs and mod versions, start).

## Web UI

`ui/` is a SvelteKit 3 / Svelte 5 SPA with shadcn-svelte and the Mod Manager's "Werkbank" design system, built to
static files and served by the companion itself (no second server). Public: overview with the one-click profile and
the mod list, mod configs. With the admin token: release (the four-step flow), server (start/stop,
`valheim.env`), players, backups, log; config values become editable. German or English from the browser language.

- **Configs:** a search across every setting of every file; sections collapse; each value gets the control
  its type calls for (switch, number with slider for a range, select for an enum, chips for a flags enum,
  colour picker, vector and range fields, a row-per-entry table for `Name:1,Other:2` lists) with a "edit
  as text" escape hatch; zod explains what is wrong, "reset to default" and "on the server: …" per value.
  Saving stages the values in the working state.
- **Release:** server now → working state (what came from where, revert per file or the lock) → review
  (problems, conflicts, restart or not, mods table, per-file value list and text diff via
  `@git-diff-view/svelte`) → release (backup checkbox, overwrite conflicts, now / when nobody is online / at
  a time).

- **Same look as the client:** `bun run sync` in `ui/` copies the tokens (`theme.css`), the shadcn "vega" style, the
  shadcn primitives and the kit components unchanged from `../modmanager-client`. Never edit those copies; change
  the client and sync.
- **Security:** strict CSP per page (scripts only from the server, hashed bootstrap, no `data:` fonts, no
  framing), `nosniff`, `no-referrer`, COOP/CORP; no `{@html}`; the token is sent only as an `Authorization` header
  (the log stream is read with `fetch`, not `EventSource`) and kept in `sessionStorage` unless "remember on this
  device" is ticked; static files are resolved strictly inside `ui/build`.

## Local development

`bun install && bun run build:ui`, then
`COMPANION_TOKEN=x CONFIG_DIR=./dev/config BACKUP_DIR=./dev/backups ENV_FILE=./dev/valheim.env bun run src/server.ts`.
For UI work run `bun run dev` in `ui/` next to it (proxies `/api` to port 9002). Tests: `bun test` (server),
`bun run check:ui` (svelte-check).
