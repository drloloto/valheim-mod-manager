# Server companion and installation readiness — design

Date: 2026-10-10. Source: a day of hand-installing mods on the owner's dedicated server (Docker,
`ghcr.io/community-valheim-tools/valheim-server`) and testing with the client. The production server at
10.10.10.123 is **not** touched by any of this; it only served as the case study.

## 1. What went wrong, and which defect in the client it maps to

| #   | Observed on 2026-10-10                                                                                                                                                                                                                                         | Root cause in the client                                                                                                                                                                      | Fix                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Client resolved `Jotunn 2.29.2` and `Warfare 1.9.3` as dependencies of EpicLoot/Monstrum although 2.30.2 / 1.9.4 existed. 2.29.2 was compiled against the pre-October game build and threw `MissingFieldException: ZRoutedRpc.Everybody` on every player join. | `resolver.rs` installs the **exact** version string a mod declares in its manifest. Thunderstore semantics are "at least this version"; r2modman and TMM install the latest.                  | Dependencies resolve to the latest index version. Explicit profile entries stay pinned. (Implemented, see §4.1.)                                                      |
| D2  | The owner tested without Jotunn, JsonDotNET and BepInEx on the client and nothing in the UI said so.                                                                                                                                                           | Dependency rows on the Installed page never show "not installed" (the status cell only checks explicit mods). Sync errors are toasts that disappear. Play does not look at the plan at all.   | Readiness: persistent banner, red status-bar marker, Play asks before starting an incomplete profile, dependency rows show the missing state. (Implemented, §4.2.)    |
| D3  | Health hints ("older than the game update") would have flagged Jotunn 2.29.2 (July) against the October patch, but Jotunn was a dependency, not an explicit mod.                                                                                               | `health::check` iterates `profile.mods` only.                                                                                                                                                 | Health checks run over the resolved set (explicit + dependencies). (Implemented, §4.1.)                                                                               |
| D4  | Server and client were installed independently (server by hand from a screenshot of the client). Versions drifted twice in one afternoon.                                                                                                                      | There is **no coupling at all**: the client knows nothing about the server, the old `webapp` had its own resolver copy with different rules (skips BepInExPack, no `enabled`, no local mods). | The server publishes a lock (manifest) and the client compares against it before Play. The server never resolves; it installs the lock the client produced. (§2, §3.) |
| D5  | Old `webapp` scope: full Thunderstore browser + Orama search in the browser, profile editing on the server.                                                                                                                                                    | Wrong product: nobody browses mods on a server page.                                                                                                                                          | Replace with a companion whose only jobs are: serve the manifest, show configs, manage worlds/backups/env, restart. (§2.)                                             |
| D6  | My own compatibility check in the spike missed the `static → const` change of `ZRoutedRpc.Everybody`.                                                                                                                                                          | Member-name comparison without the literal flag.                                                                                                                                              | Noted for the spike (`6-game.py`): compare `Field.Flags & Literal`. Not part of this design.                                                                          |

**Answer to "is versioning kept identical between server and client?"** No. Today nothing guarantees it; it
works only when a person copies versions by hand. After this design, the server's `manifest.json` is the
single artifact both sides agree on, the client refuses to start (with override) when its resolved set
differs from it, and a one-click import creates a profile that matches it exactly.

## 2. Companion container

A second service next to `valheim` in the same compose project, replacing `webapp`. It lives in
`C:\Users\schlangeatom\valheim-server\companion` (sibling of this repo, own git), reusing
`bepinexconfig.ts`, `docker.ts` and `paths.ts` from `webapp`; the Orama index, the browse UI and the
server-side resolver are dropped.

```yaml
companion:
  build: ./companion
  volumes:
    - ./config:/config # bepinex/, worlds_local/, modmanager/
    - ./backups:/backups
    - ./valheim.env:/env/valheim.env
    - /var/run/docker.sock:/var/run/docker.sock
  environment:
    - VALHEIM_SERVICE=valheim
    - COMPANION_TOKEN=… # required for every mutation
    - PUBLIC_URL=http://10.10.10.123:9002
  ports: ["9002:9002"]
```

Stack: Bun + Hono, no build step, static HTML for the two human pages. Decisions, not options:

- **The server installs a lock, it does not resolve.** `PUT /api/manifest` receives the fully resolved mod
  list (every package with its version, explicit flag and `requiredBy`), downloads the zips from
  Thunderstore, extracts them with the same layout rules as `install.rs` (BepInEx root / subfolders / bare),
  writes `installed.json`, restarts the game container. BepInExPack is skipped on the server (the image ships
  BepInEx); the manifest still lists it so the client can match it.
- **One format.** `manifest.json` (below) is the server's profile. `profile.json`/`installed.json` of the
  old webapp are migrated once on first start.
- **Read is public on the LAN, write needs the token.** Players open the companion page without login;
  everything that changes the server carries `Authorization: Bearer <COMPANION_TOKEN>`.

### 2.1 Manifest (lock) format

```json
{
	"schema": 1,
	"generatedAt": 1791234567890,
	"server": { "name": "PetersWelte", "world": "PetersWelte", "gameVersion": "1.0.17", "bepinex": "5.4.2351" },
	"mods": [
		{ "id": "RandyKnapp-EpicLoot", "version": "0.14.13", "explicit": true, "requiredBy": [] },
		{ "id": "ValheimModding-Jotunn", "version": "2.30.2", "explicit": false, "requiredBy": ["RandyKnapp-EpicLoot"] }
	],
	"configs": { "EpicLoot.cfg": "sha256:…" },
	"hash": "sha256 over mods sorted by id + version"
}
```

`hash` is what the client compares; `configs` lets the client tell "same mods, server configs changed".

### 2.2 Endpoints

| Method   | Path                                  | Auth  | Purpose                                                                                                                                                                                                               |
| -------- | ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/manifest`                       | –     | The lock. ETag = `hash`.                                                                                                                                                                                              |
| GET      | `/api/profile.r2z`                    | –     | The same as an r2modman profile zip (export.r2x + `BepInEx/config`). The client's existing `.r2z` import consumes it unchanged.                                                                                       |
| GET      | `/api/configs`, `/api/configs/{file}` | –     | Parsed BepInEx configs, read-only (reuse `bepinexconfig.ts`).                                                                                                                                                         |
| GET      | `/api/status`                         | –     | Container state, game version from the log, last save time, players online (from log tail), uptime.                                                                                                                   |
| GET      | `/`                                   | –     | Human page: server name, mod table with versions, link to the config viewer, **"Open in Mod Manager"** button = `valheim-mod-manager://import?url=<PUBLIC_URL>/api/profile.r2z&name=<server name>&link=<PUBLIC_URL>`. |
| GET      | `/configs`                            | –     | Human config viewer (sections, keys, values, descriptions).                                                                                                                                                           |
| PUT      | `/api/manifest`                       | token | Install the lock: download, extract, write `installed.json`, restart. Body may include config files (multipart) to overwrite `BepInEx/config`. Returns a job id; `GET /api/jobs/{id}` streams progress (SSE).         |
| PUT      | `/api/configs/{file}`                 | token | Change values in place (existing `saveConfigChanges`).                                                                                                                                                                |
| GET/PUT  | `/api/env`                            | token | `valheim.env` as key/value (server name, world, password, BepInEx flag). Restart required flag in the response.                                                                                                       |
| POST     | `/api/server/{restart,stop,start}`    | token | Docker Engine API over the socket (existing `docker.ts`).                                                                                                                                                             |
| GET      | `/api/worlds`                         | token | Worlds in `worlds_local`: name, size, last save, chunk format (`.db2/.fwl2` vs `.db/.fwl`).                                                                                                                           |
| GET/POST | `/api/backups`                        | token | List / create `backups/<world>-<timestamp>.tar.gz` containing `worlds_local/<world>`, `bepinex/config`, `manifest.json`.                                                                                              |
| POST     | `/api/backups/import`                 | token | Upload a backup. Response is a **diff**: mods in the backup's manifest vs the running manifest (added / removed / version changed) and config files that differ. Nothing is applied yet.                              |
| POST     | `/api/backups/{id}/restore`           | token | Stop the server, replace the world folder (and optionally configs and mods per the diff the caller confirmed), fix ownership, start. A safety backup is taken first, always.                                          |

Backups are tar.gz, not hard-link snapshots; the world folder is a handful of files and the compare step
needs a manifest inside anyway.

## 3. Client side: linked server

A profile can be linked to a companion. `profile.json` gains an optional block:

```json
"server": { "url": "http://10.10.10.123:9002", "name": "PetersWelte", "token": null }
```

- **Deep link.** Scheme `valheim-mod-manager`, via `tauri-plugin-deep-link` + `tauri-plugin-single-instance`.
  `import?url=…&name=…&link=…` downloads the `.r2z`, runs the existing `apply_import`, stores the `server`
  block, activates the profile. The result is a profile that matches the server lock exactly: every mod in
  the manifest becomes an explicit, pinned entry, so the resolver cannot drift from it. The companion's
  landing page is the one click.
- **Check before Play.** For a linked profile, `launch_game` fetches `/api/manifest` with a 2 s timeout and
  compares `hash` with the local resolved plan. Mismatch → the UI shows a diff dialog (server has X, you have
  Y) with "Adopt server versions" (rewrites the profile to the manifest, syncs, then launches) and "Start
  anyway". Unreachable server → a status-bar note, Play proceeds.
- **Publish = staged release (decision of 2026-10-10, evening).** No auto-update, players are never kicked
  by surprise. Step 1 "Pull to server and check": `POST /api/releases` with the local resolved plan and,
  by default, the profile's config files; the companion downloads and checks everything, reports a plan
  (install / remove / config changes) and problems, changes nothing live. Step 2: "Apply now (restart)",
  "Apply when nobody is online" (scheduler watches the server log), "Apply at <time>", "Keep pending" or
  "Discard". A backup of world + configs + manifest is taken before every apply. The status bar shows
  "release pending" while a release waits.
- **Status bar.** Linked profile shows "● PetersWelte in sync" / "⚠ differs from server" / "server
  unreachable".

## 4. Implemented now

### 4.1 Core

- `resolver.rs`: explicit mods keep their version; dependencies resolve to the newest index version. A
  dependency on a BepInExPack still canonicalizes to the Valheim pack. Tests updated.
- `health.rs`: `check` takes the resolved id set (explicit + dependencies) so stale/deprecated hints cover
  libraries like Jotunn.

### 4.2 Frontend

- `src/lib/readiness.ts` (pure, tested): from `AppState` and the sync flag derive
  `{ status: "ready" | "syncing" | "missing" | "noProfile" | "unknown", missing: [{ id, version, explicit, requiredBy }], errors }`.
  `missing` = `plan.toInstall` enriched with `requiredBy` from `plan.resolved` and `explicit` from the
  profile; `errors` = `plan.errors`.
- Store: `readiness` derived; `retrySync()` re-submits the current mod list, which enqueues a sync.
- Installed page: destructive banner above the table when `status === "missing"` and not syncing: count,
  names, "Install now" button; dependency rows get the red "not installed" cell like explicit mods.
- Play button: when not ready, the label carries a warning marker and the click opens a confirm dialog
  ("3 mods are not installed. Jotunn, JsonDotNET … The game would start without them.") with "Start anyway".
  Mod+Enter goes through the same gate.
- Status bar: red "{n} not installed" link to the Installed page while missing.
- Mock backend: one dependency is left uninstalled so the preview shows the banner.

## 5. Not in scope

Deep link plugin, server link, publish flow and the companion itself (§2, §3) are the next spec/plan. The
semantic search spike stays a spike.

## 6. Tests

- `resolver.rs`: dependency takes latest; explicit pin wins over a dependency's newer declaration; diamond
  case; BepInExPack canonical.
- `health.rs`: a stale dependency that is not an explicit mod is reported.
- `readiness.test.ts`: no profile; plan missing (index not loaded); syncing; one missing dependency with
  `requiredBy`; explicit mod missing; errors propagate; ready.
- i18n parity test covers the new keys.
