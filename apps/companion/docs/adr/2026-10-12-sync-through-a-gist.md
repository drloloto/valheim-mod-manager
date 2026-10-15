# Sync through a sealed gist: spec, results and decisions (2026-10-12 to 2026-10-14)

Kept as a record. Written as the task for the client session on 2026-10-12 and filled in since; it was the
spec the client and companion implementations were built against, with the test log at the end. Where
things are now (2026-10-14): the formats below are implemented in `companion/src/synccrypto.ts`,
`gistsync.ts` and the client's `src-tauri/src/gistsync.rs`; the companion creates the gist and hands out the
code (`syncsetup.ts`, landing page); `spike-sync/` is gone, its fixtures live in the client's
`src-tauri/tests/fixtures/gist/`; the scripts `dev/spike-gist.ps1` and `dev/spike-drive.mjs` became
`dev/dev-app.ps1` and `dev/drive.mjs`; the test stack is driven by `test/up.ps1` and `test/e2e.ps1`; the sync
code is never stored in `.env` or fixtures any more, the companion's `GET /api/sync` is its only source.

---

Task for a Claude Code session started in `modmanager-client/` (this file is outside that repo on purpose;
read it by path). Fill in the **Result** section at the end before you finish.

## Goal

Prove, on a branch `spike/gist-sync`, that the Mod Manager can sync a profile with the companion through a
GitHub gist instead of the companion's HTTP API: no open port on the server, no account for players, nothing
readable in the gist. Working first, polish later. Keep the diff small; do not refactor unrelated code.

The companion side is done and verified end to end (`../companion/src/gistsync.ts`, `gist.ts`,
`synccrypto.ts`, tests in `*.test.ts`). Read those three files first; they are the reference implementation
of everything below. Do **not** change anything under `../companion`.

## What exists already in the client (reuse, do not duplicate)

- `src-tauri/src/server.rs`: `Manifest`, `ManifestMod`, `diff()`, `adopt()`, `manifest_mods()`,
  `StageBody`, `PublishConfig`, `encode_config()`. The gist carries the same shapes.
- `src-tauri/src/commands.rs`: `set_server_link`, `check_server`, `adopt_server`, `publish_profile`,
  `apply_release`. The gist path adds a second transport behind the same intent.
- `models.rs::ServerLink { url, name, token }` is the per-profile link. Add optional fields rather than a new
  struct: `sync_code: Option<String>` (the `vmm1…` code) and `gist_token: Option<String>` (admin only). `url`
  may stay empty for a gist-only link.
- Crates already present: `sha2`, `base64`, `flate2` (zlib-rs backend), `serde_json`, `reqwest`. Add only
  `aes-gcm` and `hkdf` (and `rand_core`/`getrandom` for the nonce if `aes-gcm`'s `OsRng` feature does not
  cover it). Nothing else.

## Formats (must match the companion byte for byte)

### Sync code

`vmm1.<gist id>.<secret>` — gist id `[0-9a-f]{20,40}`, secret 43 chars base64url (32 random bytes, no
padding). Trim whitespace before parsing.

### Key derivation

`key = HKDF-SHA256(ikm = base64url_decode(secret), salt = "valheim-mod-manager-sync/v1", info = "aes-256-gcm", 32 bytes)`

Test vectors:

| secret                                        | key (hex)                                                          |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | `07c49509ba52d94805d55e48337efacccf1c69bb752024dd94238bdd60f9bbf3` |
| secret part of `fixtures/sync-code.txt`       | `60c0d8921085d5b0b5df62a35dc918d3545dfb065cc1f1334143caec66c06e58` |

### Envelope (the text stored in a gist file)

```json
{ "v": 1, "alg": "A256GCM", "kdf": "HKDF-SHA256", "comp": "gzip", "nonce": "<base64, 12 bytes>", "data": "<base64>" }
```

- `data` = AES-256-GCM(key, nonce, plaintext = gzip(JSON bytes), aad = file name) → ciphertext ‖ 16-byte tag
  (exactly what the `aes-gcm` crate's `encrypt` returns).
- AAD is the gist file name (`release.json` or `server.json`), so a file cannot be moved to the other slot.
- `comp` may be absent (then no gzip). Reject any other value. `nonce` and `data` are standard base64 (with
  padding), the secret in the sync code is base64url.
- A file whose text is not an envelope (for example the placeholder `{}`) is ignored, not an error.
- Fresh random nonce per seal. Never reuse one.

### `server.json` (companion → everyone)

```ts
{ v: 1, updatedAt: number,
  server: { name: string, world: string },
  manifest: { hash: string, generatedAt: number, mods: ManifestMod[] } | null,
  configs: { path: string, contentBase64: string }[],   // relative to BepInEx/config, forward slashes
  configsSkipped: string[],                               // too big for the mailbox
  release: null | { id, companionId, state: "staged"|"scheduled"|"applied"|"failed"|"rejected"|"discarded",
                    handledAt, problems: string[], error: string|null, schedule, plan: {install,remove,configs}|null } }
```

### `release.json` (admin → companion)

```ts
{ v: 1, id: string,            // [A-Za-z0-9._-]{1,64}; the companion handles each id once → always generate a new one
  createdAt: number, message?: string,
  mods: ManifestMod[],         // the lock, same as StageBody.mods
  configs?: { path, contentBase64 }[],
  apply?: { when: "now" | "idle" | "at" | "none", at?: number } }   // default "none" = stage only
```

### GitHub API

- Read: `GET https://api.github.com/gists/{id}` with headers `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: valheim-mod-manager/<version>`, `If-None-Match: <etag>`
  from the previous response (304 = unchanged). A file with `truncated: true` must be fetched again from its
  `raw_url`. Never poll `gist.githubusercontent.com/.../raw/<file>` without a commit hash: the CDN serves
  stale copies.
- Write: `PATCH /gists/{id}` body `{"files": {"release.json": {"content": "<envelope text>"}}}` with
  `Authorization: Bearer <gist token>`. Only this file; never touch `server.json`.
- Rate limit without a token: 60/h per IP. For the spike: fetch on app start, on profile open, and on a
  "Check now" button. No background timer yet.

## Behaviour to build (minimum)

1. **Link by code.** In the server link dialog accept a sync code (detect by the `vmm1.` prefix) next to the
   URL. Store it in `ServerLink.sync_code`. Validate by fetching and opening `server.json`; show server name
   and world as the existing discovery does.
2. **Check.** `check_server` for a gist-linked profile reads `server.json`, decrypts, and runs the existing
   `diff()` against the local resolved set, plus a config diff (sha256 of each `configs[].contentBase64`
   decoded vs the profile's `BepInEx/config/<path>`). Remember the last adopted `manifest.hash` + a hash over
   the config contents in the profile so an unchanged server does not prompt again.
3. **Adopt.** The existing "adopt server version?" flow: `adopt()` the mods, write the config files from
   `server.json.configs`, run the sync. Must finish before the game starts; this is the whole point.
4. **Publish (admin).** With `gist_token` set: build the lock with `manifest_mods()` + configs with
   `encode_config()` (as `publish_profile` does), wrap in `release.json` with a fresh id (`rel-<unix ms base36>`),
   `apply` from the existing schedule UI (`now` / `idle` / `at`), seal, PATCH. Then show
   `server.json.release` as the status until it reads `applied` or `failed`.
5. **Tests.** Rust unit tests: sync code parsing, the two key vectors, seal→open round trip, open rejects a
   wrong key / tampered data / wrong file name, and **both fixtures decrypt**:
   `fixtures/server.json.sealed` must equal `fixtures/server.json.plain` (compare as `serde_json::Value`),
   same for `release.json`. HTTP goes through a small trait so the gist client can be tested without the
   network (or against the fake gist below).

Keep UI work to what the flow needs: a code field in the link dialog, the adopt prompt that exists, a status
line for the release. German + English catalog keys as per the rules.

## End-to-end check (optional but valuable)

**Real GitHub (preferred):** the test companion (`../test`, container `test-companion-1`) is polling a real
secret gist right now. Its sync code is `fixtures/sync-code-github.txt`; the gist token (classic PAT, `gist`
scope, expires 2026-10-19, test only) is the `COMPANION_GIST_TOKEN` line in `../test/compose.companion.yaml`.
Reading needs no token. A publish with `apply: now` restarts the test game server and the companion writes
`release.state = applied` within about a minute. Verified on 2026-10-12 with the companion's own CLI.

**Fake gist (offline):** the companion repo has a stand-in API and the test stack can run against it:

```powershell
cd ..\companion
bun run src/testing/fakegist.ts 9777                                   # keep running
bun run src/gistsync.ts create --token spike --api http://127.0.0.1:9777   # prints a sync code
# put the code into ..\test\compose.companion.yaml (COMPANION_SYNC_CODE=…), then
cd ..\test; docker compose up -d --no-deps --no-build companion
```

Point the client at `http://127.0.0.1:9777` instead of api.github.com (an env var or setting is fine for the
spike), link with the code, token `spike`. In both setups `bun run src/gistsync.ts read <code> [--api …]` in
`../companion` shows what the companion wrote, and `docker compose logs companion` in `../test` shows the
`[sync]` lines.

## Gates

`npm run check && npm test && npm run build && npm run lint` and
`cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`. Commit on the
branch in meaningful slices; do not merge.

## Result (fill in)

- Branch / commits: `spike/gist-sync` in `modmanager-client`: `9298f89` (Rust: gistsync.rs, link model,
  check/adopt/publish_gist), `2ccf8c8` (UI: link by code, gist publish dialog, status line, config diff),
  `02508fb` (ignored network read test), `0a423c6` (fix: `ServerLink` takes the frontend's camelCase
  names; before that the pasted sync code was dropped and the link fell back to HTTP), `0045ca9`
  (ignored end-to-end publish test), `8a84ed4` (403 names the rate-limit bucket), then the DEV build
  and the scripted scenario (see "Test scenario"). Not merged.
- What works (link, check, adopt, publish, status):
  - Link: the sync code goes into the address field of "Link server…" (detected by `vmm1.`); the token
    field is then the gist token. Stored as `ServerLink.sync_code` / `gist_token`, URL empty.
  - Check: `check_server` reads and opens `server.json`, runs `diff()` on the manifest and a byte
    comparison of every `configs[]` entry against `BepInEx/config/<path>`. `in_sync` = mods equal and
    (no config differs or `last_adopted == "<manifest.hash>:<sha256 over configs>"`). ETag cache per
    gist in `AppCtx`, so repeated checks are 304s. Fetch on app start, profile switch, dialog "Check now".
  - Adopt: the existing diff dialog; `adopt_server` takes mods + configs from `server.json`, remembers
    `last_adopted`, syncs. Pre-play gate unchanged (adopt finishes before the game starts).
  - Publish: new command `publish_gist(profile, with_configs, when, at)`: `manifest_mods()` +
    `encode_config()`, `release.json` with `rel-<ms base36>`, sealed, PATCHed. The dialog offers
    now / idle / at / stage only. Status line shows `server.json.release` (id, state, plan counts,
    problems, error) with a "Check now" button; no background timer.
- Test output: `cargo test`: 82 passed, 0 failed, 3 ignored (one is the network test:
  `VMM_TEST_SYNC_CODE=<code> cargo test -- --ignored reads_a_real_gist`). `npm test`: 126 passed.
  `cargo clippy -D warnings`, `cargo fmt --check`, `npm run check`, `npm run lint`, `npm run build` clean.
- End-to-end: not against the fake gist. Against the real GitHub gist (`sync-code-github.txt`): the
  client opens `server.json` → server "PetersWelte", world "PetersWelte", 7 mods, 47 configs, release
  `rel-github-1` = `applied`; second read served from the ETag cache. Publish from the client code
  (`publishes_to_a_real_gist`, the server's own lock, `apply: none`): `rel-mv57dt6t` sealed and PATCHed,
  the test companion reported `staged`, plan 0/0/0, within 12 s. That no-op release is still staged on
  the test companion.
  Through the real app (DEV build steered over CDP, `dev/spike-drive.mjs`, 2026-10-12 17:24 local):
  seeded profile `Spike-PetersWelte` (copy of the owner's profile, 9 mods) → check reachable, differs
  (2 mods to install) → publish with configs, `apply: none` → the companion reported `rel-mv5ejmiv`
  as `staged`, plan install 2 / remove 0 / configs 26, after 30 s. Screenshots show the DEV badge, the
  gist publish dialog with diff and release status.
- Test scenario (no typing, no shared data): `pwsh dev/spike-gist.ps1 -Build -Reset` builds the DEV app
  (`tauri.dev.conf.json`: identifier `…valheim-mod-manager.dev`, so its data lives in
  `%APPDATA%\io.github.drloloto.valheim-mod-manager.dev`, window title and badge say DEV, cyan accent,
  no deep-link registration), copies settings, index cache and the `PetersWelte` profile from the
  installed app (read-only), writes the link (sync code from `fixtures/sync-code-github.txt`, token from
  `../test/compose.companion.yaml`) and starts the app. `-Cdp` opens WebView2 remote debugging on 9229;
  `node dev/spike-drive.mjs [none|idle|now] [out dir]` then checks, publishes and waits for the
  companion, with screenshots. The installed app's folder is never written.
- Deviations from this spec and why:
  - `fixtures/server.json.plain` is not what `server.json.sealed` contains: the sealed file is a snapshot
    ~50 s younger (`updatedAt` 1791795321271 vs 1791795271278, other `generatedAt`, different config
    bytes). Verified with the companion's own `openJson`. The client repo carries the sealed fixture
    decrypted by the companion code as its plain fixture (`src-tauri/tests/fixtures/gist/`), and that
    equality is what the test asserts. `release.json.plain` matches its sealed file.
  - Fixtures are copied into the client repo (tests must not depend on a sibling folder).
  - The trait is `pub(crate) trait Mailbox` with `async fn` (Rust ≥ 1.75); the in-memory test
    mailbox covers placeholder handling, seal-on-publish and open-after-publish.
  - Publish and apply are one step on the gist (`release.json.apply`), so the HTTP dialog's second
    step (apply / discard buttons) is not shown for gist links; discard is not possible over the gist.
  - A sync code is recognised wherever and however it is pasted (`find_sync_code`): alone, at the end of
    a URL such as `http://127.0.0.1:9002/vmm1.…`, in the address, token or sync-code field of "Link
    server…", and in "Add server…" (autoconfig): `discover_server` reads server.json for a code, the
    client creates the profile, links it and adopts mods + configs (`81b8236`; verified with the driver's
    `add` mode: new profile in sync, 0 config differences). Background: the owner's first attempts put
    the code into the token field or behind the companion URL and ended with an HTTP link and a 401.
  - The server only ever sees enabled mods (`server_mods`): check, diff and publish on both transports
    drop disabled mods and what only they pulled in. Before `81b8236` a disabled mod was listed as "will
    be installed on the server" and one such release (`rel-mv5l0xes`) was applied to the test companion.
  - `VMM_GIST_API` (env var) replaces api.github.com for the fake gist.
- Open questions for the companion side:
  - **Blocking: the companion writes `server.json` on every poll** and runs into GitHub's separate
    `gist_update` bucket: 100 writes per hour **per user**, shared by the companion and the admin's
    publishes (same account). Evidence: after the 11:49:09Z restart the first `PATCH HTTP 403` came at
    12:13:32Z (≈ 96 polls at 15 s), `X-RateLimit-Resource: gist_update`, `Limit 100`, `Used 100`, reset
    12:49:11Z; the decrypted `server.json` has `manifest.generatedAt` 134 ms before `updatedAt`, so the
    manifest is regenerated per poll and the body hash never matches `lastServerHash`. Fix on the
    companion: hash the body without `generatedAt` (or compare `manifest.hash` + config hash + release
    state), and keep polling and writing well under 100/h (write at most every few minutes, back off on
    403 instead of retrying every poll, read the reset header). The client now names the bucket and
    the reset time on a 403 (`8a84ed4`). **Done on the companion side 2026-10-12 (uncommitted in
    `../companion`, next to the other uncommitted spike files):** the server.json hash leaves out
    `manifest.generatedAt`, so an unchanged server writes nothing (test: regenerated manifest → no
    write, changed mods → write); `GistMailbox` remembers a 403 with an empty bucket and throws the
    same `RateLimited` error without a request until the reset (test with a stub server: two puts and
    two fetches = two requests); the poller logs a repeating error once and "sync works again" after.
    The test stack keeps `COMPANION_GIST_POLL=60`; credentials moved from the compose file to `../test/.env`.
  - `server.json.release` only reflects the last id; a client that published twice quickly sees only
    the second. Fine for the spike.
  - 47 config files in the real gist vs 19 in the fixture: with the 1 MB truncation the raw_url path
    is taken; works, but a `configsSkipped` entry per skipped file would let the client say what is missing.
  - No way to discard a staged release through the gist; the admin needs the companion UI for that.
  - Unauthenticated reads are limited to 60/h per IP; a player opening the app a few times an hour is
    fine, a background poller would need the ETag path to count as free (it does with a token only).

## Status 2026-10-13, evening: the hand-off is built and tested end to end

The missing piece was the onboarding: nothing created the gist, nothing gave players the code, and the
companion page's button still went the HTTP/r2z way. Now (companion uncommitted, client on branch
`feat/companion-handoff`):

- **Companion:** the admin signs in on the landing page and pastes a GitHub token (dedicated account, classic
  token, `gist` scope only) into _Sync without an open port_. `POST /api/sync` creates the gist, stores code
  and token in `config/modmanager/sync.json` (mode 0600), starts the poller; `GET /api/sync` returns the code
  (public read data like the manifest); `DELETE /api/sync` turns it off. The environment variables still win
  when set. `COMPANION_DEEPLINK_SCHEME` picks the button's URL scheme (`src/syncsetup.ts`, tests in
  `syncsetup.test.ts`).
- **Landing page:** shows the sync code with a copy button instead of the address, and the button's link is
  `scheme://import?code=<sync code>&url=…&name=…&link=…` (url/link stay for older clients).
- **Client:** `parseDeepLink` reads `code` (wins over `url`) and accepts `valheim-mod-manager-dev:`; a link
  with a code runs `discoverServer(code)` + `addServer` (new profile, linked by code, mods + configs adopted,
  sync started). The DEV build registers its own scheme `valheim-mod-manager-dev` (`tauri.dev.conf.json`,
  `lib.rs` registers in dev too), so a test companion with `COMPANION_DEEPLINK_SCHEME=valheim-mod-manager-dev`
  never opens the installed app.
- **End to end, 2026-10-13 22:25 local, test stack only:** headless Edge drove the real companion page
  (sign-in, token into the form, submit) → gist `a2e139c9…` created, code on the page, poller wrote
  `server.json` (8 mods, 75 configs) within seconds. The button's link, opened through the OS exactly as
  Chrome does after "Open app", reached the running DEV app: profile `PetersWelte` created in the DEV data
  dir, linked by code (`lastAdopted` set), 8 mods installed, 75 config files written, chip "in sync · read
  only", all within 12 s. Scripts: scratchpad `companion-setup.mjs` (page) and `app-state.mjs` (app
  screenshot over CDP); worth moving into `dev/` next to `spike-drive.mjs`.
- **Not re-run on the new gist:** the admin publish from the client. Its mechanics are unchanged since
  yesterday's verified run (`rel-mv6kpfbv` applied). To run it by hand: in the DEV app _Link server…_ → paste
  the gist token → _Publish_; or `dev/spike-drive.mjs now` after the dev profile has the token.
- **Hand-installed servers (added later the same evening, `companion/src/takeover.ts`):** the owner's
  server got its mods as folders `Namespace-Name/<dlls>` copied by hand, so the companion started with an
  empty lock and the button produced a profile with 0 mods. Now a server without a lock seeds it from
  `plugins/`: every `Namespace-Name` folder is a package; the version is the newest Thunderstore release that
  existed when the files were copied (latest if it predates the copy, else the DLL's VERSIONINFO version when
  Thunderstore knows it, else latest as a guess), dependencies pinned from Thunderstore. Verified on a copy
  of the owner's plugins (`test/config/modmanager/untracked/…`): all six packages resolved to exactly the
  versions the lock later held after the first publish (BetterArchery 2.0.5, EpicLoot 0.14.13, Monstrum
  1.6.0, Warfare 1.9.4, Jotunn 2.30.2, JsonDotNET 13.0.4) plus BepInExPack as a dependency, and the r2z
  carries them. Loose DLLs stay unidentified and are listed on the page; the admin's first publish covers
  them. `GET/POST /api/takeover`, button on the page while the lock is empty.
- **Still open:** the gist token in the client's `profile.json` should move to the Windows credential store;
  the gist poller's 60 s cadence means a player's "Check now" can lag a release by a minute.

## Status 2026-10-13

Client side merged into `modmanager-client` `main` (merge commit `b625952`; spec
`docs/superpowers/specs/2026-10-12-gist-sync-integration.md`): toolbar chip with transport, state and
role, enabled-only server view, sync code recognised in any field, DEV build and scripted scenario as the
regression check. Open on the companion side: the rate-limit back-off and hash fix are still uncommitted
in `../companion`, and the companion UI for creating the gist and handing out the sync code does not exist
yet.
