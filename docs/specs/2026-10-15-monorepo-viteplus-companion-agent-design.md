# One repository on Vite+, and the companion becomes an install agent

Date: 2026-10-15. Status: phase 1 done (branch `feat/monorepo-viteplus`, see section 8), phases 2–5 open.
Replaces Part A of
`2026-10-14-admin-ui-in-client-and-monorepo-design.md` and changes its Part B: the companion no longer keeps
the server-side logic; the Mod Manager takes over server management, the companion shrinks to an agent that
installs, applies and reports. Implementation follows in separate sessions, phase by phase.

Owner's direction (2026-10-15):

- One repository, built on the Vite+ toolchain (viteplus.dev), used fully, not just installed.
- Deploying and updating the companion with `install.sh` is a chore; it should be an image you pull.
- The companion token lies as a raw file on the server; the auth is not good enough for a production server.
- The container loses features over time; the client manages the server, the companion is "more or less an
  install instance / manager".

## 1. What Vite+ is and how it fits

Vite+ 1.0 (MIT) is one CLI, `vp`, over Vite + Rolldown (dev, build), Vitest (`vp test`), Oxlint (`vp lint`),
Oxfmt (`vp fmt`), tsgolint type checks (`vp check`), tsdown (`vp pack`), Vite Task (`vp run`: workspace tasks
with dependency order and caching), staged checks with git hooks (`vp staged`, `vp hooks`), and runtime /
package-manager pinning (`vp env`, `vp install`). One `vite.config.ts` per package plus one at the root;
lint, fmt and check settings live only in the root (`lint.overrides` / `fmt.overrides` per path).
Migration: `vp migrate` from the workspace root; it rewrites `vite`/`vitest` imports to `vite-plus` /
`vite-plus/test`, merges tool configs into `vite.config.ts` and moves scripts to the `vp` surface.
Prerequisites we already meet: Vite 8, Vitest 5, Node ≥ 22.18.

Limits that matter for this code base, and the decision for each:

| limit                                                                       | decision                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsgolint does not type-check `.svelte` files                                | `svelte-check` stays, as a cached `vp run` task (`check:svelte`) that `check` depends on; `vp check` covers the plain `.ts` (companion server, `src/lib/**/*.ts`)                                                                                                                                  |
| Oxlint lints only the `<script>` of `.svelte` files, not the template       | accepted: we have no linter today at all (only `prettier --check`); template rules (a11y) stay with svelte-check's warnings                                                                                                                                                                        |
| Oxfmt formats `.svelte` only with the `svelte` option, still marked new     | try it in phase 1 on the whole tree: if the diff is formatting-only and Tailwind class order is kept, Oxfmt replaces Prettier everywhere; otherwise `fmt.ignorePatterns` for `*.svelte` and Prettier with `prettier-plugin-svelte` runs as a `staged` command for those files until Oxfmt is ready |
| the docs cover pnpm and npm workspaces, not Bun                             | pnpm workspace with a catalog (one version of svelte, vite, bits-ui, tailwind, typescript for all packages); Bun stays the companion's _runtime_ in its image, not the package manager                                                                                                             |
| the companion's 17 test files use `bun:test` and the code uses `Bun.*` APIs | phase 1: `bun test` as a cached `vp run` task; phase 4 (the companion shrinks anyway): the agent moves to `node:` APIs and `vp test`, one runtime and one test runner for the repo                                                                                                                 |
| Rust (Tauri core) is outside Vite+                                          | `cargo fmt --check`, `cargo clippy`, `cargo test` become `vp run` tasks with `cache.input: ["src-tauri/**/*.rs", "src-tauri/Cargo.*"]`, so the full gate is one command and unchanged Rust is a cache hit                                                                                          |

Used fully means:

- **`vp check`** replaces `npm run check && npm run lint` (fmt + lint + types) at the root.
- **`vp run ci`** is the whole gate for a human, an agent and CI: `check`, `check:svelte`, `test`, `build`,
  the cargo tasks, the companion tests, `docker build` of the companion; dependency-aware, cached, `-r` across
  packages. AGENTS.md lists exactly this one command.
- **`vp staged` + `vp hooks`**: pre-commit runs fmt and lint on staged files only (today nothing runs).
- **`vp env`** pins Node in the repo (`.node-version`), CI uses `setup-vp`.
- **`vp pack`** builds `packages/companion-api` (types plus the zod schemas) for the companion image, which
  does not ship the workspace.
- **Root `vite.config.ts`** holds `lint` (typeAware + typeCheck on), `fmt`, `staged`, and `run.tasks` for
  repo-wide tasks; each package's `vite.config.ts` holds only its Vite/test settings and package tasks. The
  AGENTS.md rules that are not lint rules (no raw colours in `.svelte`, kit-only imports, layout) stay tests.

## 2. Repository layout

The monorepo lives in `drloloto/valheim-mod-manager` (keeps history, releases and the updater's release URLs;
open decision 1 of the old spec, decided here).

```
valheim-mod-manager/
  apps/client/            the former modmanager-client repository root (src/, src-tauri/, dev/, static/, scripts/)
  apps/companion/         drloloto/companion via git subtree (history kept): the agent + its landing page
  packages/ui/            @vmm/ui: theme.css, style-*.css, components/kit, components/ui (shadcn), utils, format
  packages/companion-api/ @vmm/companion-api: the agent's API as zod schemas + types; client and agent import it
  test/                   docker test stack, up.ps1, e2e.ps1, e2e/ (config/, data/, backups/, .env ignored)
  docs/                   adr/, specs/, plans/ from both repositories
  vite.config.ts          root: lint, fmt, staged, check, run.tasks (ci, cargo, docker)
  pnpm-workspace.yaml     packages + catalog
  CLAUDE.md, AGENTS.md    one set of rules; apps/*/AGENTS.md keep only app-specific commands
```

Clean-up that comes with the move (things in the client root today that are not part of the app):
`Analyse.md`, `build/`, `dist/`, `ds-bundle/`, `spike/`, `web/` are reviewed one by one: build output goes to
`.gitignore`, spikes and analyses that still matter go to `docs/`, the rest is deleted. `package-lock.json`
and both `bun.lock` files are replaced by one `pnpm-lock.yaml`.

## 3. The companion as an install agent

### What it is afterwards

A small service next to the game container that does what only something on that host can do, on request
of the Mod Manager, and nothing else:

| stays in the agent (needs the host)                                                              | moves to the client (decision and UI)                                         | goes away                                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| apply a release: download the pinned mods, write `BepInEx/plugins`, write configs, backup before | release planning, diff, "when to apply", config editing with the typed editor | the admin web UI (all routes except the landing page)       |
| game lifecycle: start, stop, restart, status, wait-for-idle                                      | the Server area (Overview, Release, Configs, Server, Players, Backups, Log)   | `ui/scripts/sync-from-client.ts` and every copied component |
| backups: create, list, restore, export, import                                                   | backup browsing and restore decisions                                         | config metadata parsing for the UI (`configmeta`)           |
| read: log tail and stream, player lists, `valheim.env`, installed files, world list              | `valheim.env` editing UI, player list editing UI                              | `.r2z` export on the server (the client builds profiles)    |
| the gist sync (it must run when no client is open) and applying scheduled releases               | gist publishing (already in the client)                                       | read access without credentials on the LAN                  |
| self-update (pull the new image, recreate itself) and health                                     | "companion update available", the update button                               | `install.sh`, `reparse.sh` as user-facing scripts           |

The landing page stays: what this is, the sync code button for players, pairing for the admin.

The API becomes versioned (`/api/v2/...`), every request and response defined once in
`packages/companion-api` (zod), validated on both sides. v1 is removed when the client stops using it (the
client and the agent are released together from the monorepo, so there is no long compatibility window).

### Deployment and updates without install.sh

- The image is built in CI and published to `ghcr.io/drloloto/valheim-companion:<version>` and `:latest`
  (linux/amd64 and arm64), signed with cosign, released together with the client.
- Install: one command on the server, no repository checkout, no build on the host:
  `docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD":/project ghcr.io/drloloto/valheim-companion setup`.
  `setup` is today's `onboard.ts` (it already runs inside the image): it reads the compose project
  read-only, prints the plan, writes `compose.companion.yaml` and wires it in with Compose `include:` when
  the user's Compose supports it (2.20+), otherwise with today's marked `COMPOSE_FILE` block. Same safety:
  check first, nothing changes before confirmation, rollback on failure.
- Update: the client shows "companion 0.6.0 available" (the agent reports its version, the client knows the
  release it ships with) and the admin clicks Update; the agent pulls the new tag and hands over to a
  one-shot helper container that recreates the companion service (the agent cannot replace itself while
  running). By hand it stays `docker compose pull companion && docker compose up -d companion`.
- `uninstall` and `status` stay as subcommands of the image (`docker run … companion uninstall`).

### Security and auth

What is wrong today:

1. One static bearer token for everything, no expiry, no revocation, no identity (the roadmap's audit log
   has nobody to name).
2. The token is stored in plain text in `/config/modmanager/companion-token`, which is inside the game's bind
   mount: every BepInEx mod, which is arbitrary code running in the game container, can read it.
3. The token is printed to the container log on first start; logs are kept and shipped around.
4. HTTP without TLS: anyone on the LAN can read the token off the wire, and a fake companion can feed the
   client a manifest (the client installs DLLs from it).
5. Reads are open without a token on the LAN by default (`COMPANION_PUBLIC_READ`).
6. The agent holds the Docker socket, which is root on the host; a stolen token is a lot of power.
7. The client keeps the token in `profile.json` in plain text.

The new model:

- **Pairing, then per-device credentials.** `docker exec companion pair` (or the landing page, from the
  host's loopback only) shows a pairing code valid for 10 minutes, single use. The client sends it with a
  device name and gets a random 256-bit device token. The agent stores only `sha256(token)` with name,
  created, last used and last address. Devices are listed and revoked from the client; revoking the last
  one is refused unless a new pairing is open. No token is ever printed or written in plain text.
- **TLS with a pinned certificate.** The agent creates a self-signed key pair on first start; the pairing
  code carries the certificate fingerprint, the client pins it. All admin traffic goes over HTTPS; the
  landing page and `/health` may stay on plain HTTP for players' browsers. A fake companion on the LAN fails
  the pin.
- **Agent state out of the game's reach.** Hashes, the TLS key, the gist token and the audit log live in the
  companion's own named volume (`companion-state`, mode 0600, not mounted into the game). The `/config`
  bind mount is used only for what the game reads (mods, configs).
- **Least privilege for Docker.** The agent talks to a docker-socket-proxy that allows only the calls it
  needs for the game service (inspect, start, stop, restart, logs, image pull and container create for the
  self-update helper), instead of the raw socket.
- **Defaults closed.** No unauthenticated reads except landing page, health and the sync code button;
  failed auth is rate-limited per address; every write lands in the audit log with the device name.
- **Client side.** Device tokens go into the OS credential store (Windows Credential Manager through the
  `keyring` crate), `profile.json` keeps only the server address and fingerprint. Existing links with an
  old token are migrated once: the client pairs with the old token as a one-time pairing code (the agent
  accepts the legacy token for pairing only, until the owner turns it off).
- **Gist stays as it is for players**: sealed with the secret in the sync code, read-only for whoever has
  it (ADR `2026-10-12-sync-through-a-gist.md`). The server-side GitHub token moves into the state volume.

## 4. Phases

Each phase is its own branch, ends with `vp run ci` green and a DEV click-through, and is merged before the
next starts. No publish in between: the owner cuts one big release at the end.

| phase | content                                                                                                                                                                                                                                                                                                                                                                                                                                   | effort   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | Monorepo + Vite+: pnpm workspace, `apps/client` (git mv), companion subtree into `apps/companion`, `vp migrate`, root `vite.config.ts`, `vp run` tasks for svelte-check, cargo, bun test, docker; Oxfmt trial (section 1); hooks; `packages/ui` extracted, companion UI imports it, copy script deleted; `test/`, `docs/` moved; root clean-up; CI with setup-vp and tauri-action `projectPath: apps/client`; DEV build + release dry run | 1.5 days |
| 2     | Image on GHCR, `setup` / `update` / `status` / `uninstall` subcommands in the image, Compose `include:`, self-update via helper container, version reporting; `install.sh` reduced to a three-line wrapper around `docker run … setup`, then removed                                                                                                                                                                                      | 1 day    |
| 3     | Auth: state volume, pairing, device tokens (hashed), TLS with pinning, socket proxy, rate limit, audit log, client keychain storage, legacy-token migration; `test/e2e.ps1` pairs the DEV app                                                                                                                                                                                                                                             | 2 days   |
| 4     | `packages/companion-api` (zod, `/api/v2`), the client's Server area (old spec Part B, slices 2–4) on top of it, agent loses the admin UI and the moved logic, agent on `node:` APIs and `vp test`                                                                                                                                                                                                                                         | 4 days   |
| 5     | Docs, ADRs (Vite+, auth model, agent scope), roadmap rewritten, old companion repository archived with a pointer, release                                                                                                                                                                                                                                                                                                                 | 0.5 day  |

## 5. Tests

- Phase 1: the existing suites unchanged and green under `vp test` / `bun test`; `vp check` clean; a
  formatting-only diff after the Oxfmt switch (reviewed, committed on its own).
- Phase 2: `setup` against the test stack in `test/` (fresh project, project with an override file, project
  that already has the old `install.sh` block → migrates it); self-update from one local tag to the next.
- Phase 3: unit tests for pairing expiry and single use, hash-only storage, revocation, rate limit, the TLS
  pin (wrong fingerprint is refused); e2e: pair, act, revoke, act → 401.
- Phase 4: contract tests: every `/api/v2` handler's response parses with its schema; the client's mock
  (`dev/mock-tauri.js`) serves fixtures generated from the same schemas.

## 6. Risks

| risk                                               | mitigation                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| the monorepo move breaks the updater URLs or CI    | stays in `valheim-mod-manager`; release dry run before phase 2                                      |
| Oxfmt mangles `.svelte` or Tailwind class order    | trial on the whole tree first, Prettier fallback for `.svelte` only                                 |
| Vite+ caching hides a stale result                 | `cache.input` explicit for cargo and docker tasks; `vp run --no-cache ci` in the release workflow   |
| a self-update kills the agent mid-way              | helper container does the recreate; the old container stays until the new one is healthy            |
| pairing locks the owner out                        | `docker exec companion pair` always works on the host; revoking the last device needs a new pairing |
| players' path regresses while the admin side moves | `test/e2e.ps1` (player path) runs in every phase                                                    |

## 7. Decisions (owner, 2026-10-15: "go" on the recommendations)

1. TLS with a pinned self-signed certificate.
2. Agent runtime after phase 4: Node with `vp test`.
3. Folder names `apps/client` + `apps/companion`.

## 8. Phase 1 result (2026-10-15)

Done, in this order of commits: client into `apps/client`, docs into `docs/`; companion as a git subtree
(history kept); the test stack into `test/` (secrets and runtime state ignored, `*.example` committed); one pnpm
workspace with a catalog; `vp migrate`; `@vmm/ui`; CI, release, Dependabot and the agent rules.

Findings and decisions made on the way:

- **Oxfmt replaces Prettier completely.** `vp migrate` reformatted the existing tree with Oxfmt (Svelte and
  Tailwind class sorting on) and the only diffs were the rewritten imports, so there is no Prettier fallback.
  The files no formatter had seen before (companion sources, old docs, test scripts) got one formatting-only
  change.
- **Lint starts at 0 errors, 47 warnings.** The code never had a linter. Most warnings are fire-and-forget
  promises in the client store (`no-floating-promises`), unused imports and test `await`s on values; they are a
  follow-up (mark the intentional ones with `void`, fix the rest), not blockers.
- **pnpm 12** stores build-script approvals as `allowBuilds:` in `pnpm-workspace.yaml` (esbuild only).
- **Task caching needs the generated paths excluded**: SvelteKit writes `.svelte-kit/`, `build/` and
  `node_modules/$app` while it runs, Vite's scan touches `src-tauri/target`, and Kit stamps
  `build/_app/version.json`; with those excluded an unchanged tree replays all 12 tasks from the cache.
- **`svelte-check` needs a Svelte config next to the shared components** (`packages/ui/svelte.config.js`).
- **The companion's tar scenario runs on Linux only** (GNU tar on Windows reads `C:` as a host); CI runs it in
  the Linux job.
- **The companion image builds from the repository root** (workspace lockfile, `pnpm deploy` for the two
  runtime dependencies). Not built locally in phase 1 (Docker Desktop was off); the CI Linux job builds it.
  Until phase 2, `install.sh update` on a real server only works from a full repository checkout, because the
  compose file `onboard.ts` writes still says `build: ./companion`. Phase 2 replaces that with the GHCR image.
- The moved Rust `target/` held absolute paths of the old location and had to be rebuilt once (`cargo clean`).

Closed after phase 1 (same day, with Docker running):

- **Lint at zero**: the 47 warnings are fixed (fire-and-forget calls marked `void`, comma expressions written as
  blocks, unused code removed); `await-thenable` is off only for the companion's bun:test files.
- **The image builds and runs from the monorepo**: the Dockerfile installs without lifecycle scripts (the root
  `prepare` needs git) and includes `@vmm/ui`; `test/up.ps1 -SetupSync`, `test/e2e.ps1` (PASS) and
  `install.sh status` were run against the test stack.
- **`install.sh` / `onboard`** write a compose file that builds from the repository checkout
  (`context: ./valheim-mod-manager`, `dockerfile: apps/companion/Dockerfile`) and default to the folder the
  checkout sits in; the `.env` marker line is unchanged, so existing installations are still recognised.
- **The companion reports the version from package.json** (it reported a drifted constant, 0.3.0).
- **The on-disk folder is `valheim-mod-manager`** (renamed from `modmanager-client`); pnpm's links and the Rust
  `target/` were rebuilt for the new path.

Left on purpose: the companion's tar scenario still runs on Linux only (CI), as decided by the owner; the old
`../companion` repository is archived on GitHub in phase 5, after the monorepo is pushed.
