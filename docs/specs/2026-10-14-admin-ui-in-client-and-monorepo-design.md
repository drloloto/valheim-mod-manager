# The admin UI moves into the Mod Manager, and both apps move into one repository

Date: 2026-10-14. Status: Part A superseded, Part B changed by
`2026-10-15-monorepo-viteplus-companion-agent-design.md` (Vite+ monorepo; the companion becomes an install
agent, server management moves into the client). Read that one first. Owner's decisions so far: the gist stays the players'
transport (a self-hosted mailbox behind the game tunnel is the only alternative worth having and can be
added later behind the same sync code); HTTP is the admin surface and stays on the LAN/VPN; the companion
keeps all server-side logic; the client keeps its design, and everything imported from the companion must
look like the client.

## Goal

One user interface: the Mod Manager. A player sees a profile, the server chip, "adopt the server's version?"
and Play. An admin additionally gets a **Server** area with everything the companion web app does today:
release (the four-step guided apply), server configs with the typed editor, start/stop and `valheim.env`,
players, backups, log. The companion's web UI shrinks to a landing page: the button, the sync code, the
one-time sync setup, the takeover hint.

Why: the companion UI is a copy of the client (same Svelte 5 components, kit and shadcn files copied by
`ui/scripts/sync-from-client.ts`, same tokens). Two UIs mean two logins, two onboarding stories, one
copy to keep in sync. The admin's daily loop is "build the pack, publish, friends play", and that belongs in
one window.

## Part A: one repository first (the former Phase 4)

Moving UI code between two repositories through a copy script is exactly the friction this plan removes,
so the repository structure is decided and done before any UI work.

Decision proposed: a monorepo in the client's GitHub repository `drloloto/valheim-mod-manager` (keeps
history, releases, the updater's release URLs):

```
valheim-mod-manager/
  client/           the current repository root: src/, src-tauri/, dev/, static/
  companion/        git subtree of drloloto/companion, history preserved
  packages/ui/      the shared design system: theme.css, style-vega.css, style-desktop.css,
                    components/kit, components/ui (shadcn, generated), utils, format
  packages/companion-api/   the API types (today companion/ui/src/lib/types.ts), used by the companion
                    server (response type checks), its landing page and the client
  test/             the docker test stack and its scripts (today's test/; data/, config/, backups/ ignored)
  docs/             ADRs, specs, plans from both repos (docs/adr, docs/specs, docs/plans)
  CLAUDE.md, AGENTS.md    one set of rules; client/AGENTS.md and companion/AGENTS.md keep only commands
```

Tasks:

1. `packages/ui`: move the client's `src/lib/theme.css`, `style-*.css`, `components/kit`, `components/ui`,
   `utils.ts`, `format.ts` into a workspace package `@vmm/ui`; the client imports it through the existing
   `#lib/components/kit/index.js` alias (re-export) so no page changes. `boundaries.test.ts` keeps enforcing
   kit-only imports from pages.
2. `git subtree add --prefix companion https://github.com/drloloto/companion.git main`; the companion's
   `ui/` imports `@vmm/ui` instead of its copies; delete `ui/scripts/sync-from-client.ts` and the copied
   files.
3. `packages/companion-api`: the companion's `types.ts` becomes the shared contract; the companion server
   imports it for its JSON responses, the client's `src/lib/api/types.ts` imports the server shapes instead
   of mirroring them.
4. `test/` moves in with `up.ps1`, `e2e.ps1`, `e2e/`, the compose files and `.env.example`; the real
   `.env`, `config/`, `data/`, `backups/` are git-ignored.
5. CI: tauri-action with `projectPath: client`; `bun test` and `docker build` for the companion; Dependabot
   paths. Verify with a DEV build and a release dry run before anything else moves.
6. Docs: `client/docs/*` and `companion/docs/*` into `docs/`; root `CLAUDE.md` is today's
   workspace file plus the client's rules; AGENTS.md per app keeps the commands.
7. The old companion repository gets a README pointer and is archived. Claude memory: the two per-folder
   memories (workspace root, `modmanager-client/`) are read once, what is still true goes into the root
   memory, the client folder's memory is retired (sessions start at the root only).

Effort: one day, done alone and verified before Part B starts.

If the owner prefers two repositories: Part B still works, but the shared UI stays a copy and every
component ported in Part B is ported twice (client and the companion's landing page). Not recommended.

## Part B: the Server area in the client

### Roles

The profile's link decides, no separate login:

| link holds                    | role   | what the client shows                                                          |
| ----------------------------- | ------ | ------------------------------------------------------------------------------ |
| nothing                       | none   | no chip                                                                        |
| sync code only                | player | chip, adopt prompt, release status; no Server tab                              |
| companion URL + admin token   | admin  | everything above plus the Server tab, when the companion answers `/auth/check` |
| sync code + URL + admin token | admin  | gist for sync, HTTP for administration (the owner's own profile)               |

`build_state` computes `server.role`; admin is confirmed by `POST /api/auth/check` once per app start and
re-checked when the Server tab opens. When the companion is not reachable the Server tab stays visible but
shows "not reachable, this works on the LAN or through a VPN" instead of empty pages.

### Information architecture

A **Server** tab in `nav-tabs.svelte` (admins only; badge = pending release) opens a pane with sub-tabs
like Settings: Overview, Release, Configs, Server, Players, Backups, Log. Each sub-tab is one
`src/lib/components/server/<Name>View.svelte`, routes under `src/routes/server/[tab]`. Rule 10 of
AGENTS.md applies (1100 × 680, container queries, `scroll-y`, German catalog).

| sub-tab  | companion page today                                | API                                                   |
| -------- | --------------------------------------------------- | ----------------------------------------------------- |
| Overview | `routes/+page.svelte`                               | `/status`, `/manifest`, `/sync`, `/takeover`          |
| Release  | `routes/release/+page.svelte` (21 KB, four steps)   | `/releases/*`, `/releases/pending/diff`               |
| Configs  | `routes/configs/+page.svelte` (14 KB, typed editor) | `/configs`, `/configs/:file`                          |
| Server   | `routes/server/+page.svelte`                        | `/server/:action`, `/env`                             |
| Players  | `routes/players/+page.svelte`                       | `/players`, `/players/:list`                          |
| Backups  | `routes/backups/+page.svelte`                       | `/backups`, `/backups/:id/restore`, `/backups/import` |
| Log      | `routes/logs/+page.svelte`                          | `/logs`, `/logs/stream` (SSE)                         |

### Data path

- One Rust command `companion_call(profile, method, path, body?) -> Value` (reqwest, the profile's admin
  token as Bearer, JSON through, errors mapped to `AppError::Network` with the companion's message) and
  `companion_stream(profile, path)` that turns the SSE log stream into Tauri events. The typed commands that
  exist (`check_server`, `adopt_server`, `publish_profile`, `publish_gist`, `apply_release`) stay.
- Server config edits: by default part of a release (through the gist or an HTTP staged release: backup,
  restart, plan), optionally live through `PUT /api/configs/:file` as the companion allows today, labelled
  "live" in the UI. Open decision 3 below.
- Types come from `packages/companion-api`; the client's `types.ts` stops mirroring them.

### Components to port, and design uniformity

Only components built on kit/ui are ported; the companion's own CSS files are copies of the client's, so
no stylesheet moves. Any companion-only class or colour is replaced by a client token (`theme.css`); rule 4
of AGENTS.md (no raw colours in `.svelte`) and `boundaries.test.ts` enforce it. Icons stay lucide.

| from `companion/ui/src/lib/components`                                                                                 | to                                                           | note                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/*` (setting-control, color/flags/range/records/vector fields, sync-badge) + `lib/configmeta.ts` with its tests | `src/lib/components/server/config/`, `src/lib/configmeta.ts` | the client's own `ConfigView` (local profile configs) switches to the same `setting-control`, so local and server configs look and behave the same |
| `release/*` (steps, mods-table, config-diff)                                                                           | `src/lib/components/server/release/`                         | the publish dialog's diff list reuses `mods-table`                                                                                                 |
| `shell/status-bar.svelte` pieces                                                                                       | merged into the client's status bar                          | online count, pending release                                                                                                                      |
| `icon-placeholder`                                                                                                     | dropped; the client has `PackageDetail` icons                |                                                                                                                                                    |

Catalog: the companion's `en.ts`/`de.ts` keys move into the client under the existing `server.*` prefix;
the parity test covers them. `dev/mock-tauri.js` gets companion fixtures (status, manifest, configs,
release, players, backups, a log tail) so the browser preview and `dev/screenshot.mjs` work without a
server; every new page is checked at 1100 × 680 in German before it counts as done.

### The companion afterwards

`ui/` keeps one page: the button, the sync code with copy, sign-in, the sync setup form, the takeover
hint. The admin routes and their components are deleted in the last slice (no transition flag: one UI).
The API does not change in this plan; endpoints nobody calls any more are removed later.

### Slices

| slice | content                                                                                                          | effort   |
| ----- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | Part A                                                                                                           | 1 day    |
| 2     | roles, Server tab shell, `companion_call`, Overview, Release, Server (control, env)                              | 1.5 days |
| 3     | Configs editor port, `ConfigView` unified on `setting-control`                                                   | 1 day    |
| 4     | Players, Backups, Log stream                                                                                     | 1 day    |
| 5     | companion UI shrunk, docs, `test/e2e.ps1 -Admin` (DEV profile with admin token → Server tab → release → applied) | 0.5 day  |

About five days of implementation plus the owner's click-through per slice. Each slice ends with the
gates (`npm run check && npm test && npm run build && npm run lint`, `cargo fmt --check && cargo clippy
--all-targets -- -D warnings && cargo test`, `bun test` in the companion) and a commit on its own branch.

### Tests

- Vitest: role derivation from a link, catalog parity, boundaries, layout; mock fixtures for every
  sub-tab.
- Rust: `companion_call` error mapping (401 → "token rejected", unreachable → network), role from link.
- End to end: `test/e2e.ps1` keeps the player path and gains `-Admin`.

### Risks

| risk                                                  | mitigation                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| monorepo breaks CI, updater or Dependabot             | Part A alone, DEV build and release dry run before Part B           |
| admin outside the LAN gets empty pages                | reachability state in the UI, VPN hint, nothing fails silently      |
| two `types.ts` drift                                  | `packages/companion-api` as the single contract                     |
| the config editor looks different from the local one  | one `setting-control` for both, screenshots in both places          |
| parallel sessions on one working tree during the move | Part A is done in one session on a worktree, nothing else in flight |

### Open decisions for the owner

1. Monorepo root: the client's repository `valheim-mod-manager` (recommended) or a new repository.
2. The companion's admin pages: delete in slice 5 (recommended) or keep behind a flag for a while.
3. Server config edits in the client: release-only, or also live over HTTP (recommended: both, release as
   the default).
