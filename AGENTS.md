# Instructions for AI agents

Entry point for coding agents (Claude Code, Codex, Cursor, Copilot and others) in this monorepo. Humans read
[CONTRIBUTING.md](CONTRIBUTING.md). Each app's own `AGENTS.md` adds its commands and rules.

## What this is

One game server's tooling, in one repository:

| folder            | what                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/client/`    | the Valheim Mod Manager: Tauri 2 (Rust core) + SvelteKit SPA, Windows. Rules: [apps/client/AGENTS.md](apps/client/AGENTS.md) |
| `apps/companion/` | the companion next to the docker game server (Bun + Hono), shrinking to an install agent; `ui/` is its landing page          |
| `apps/invite/`    | the static invite page (`join.html`) a companion's invite link points to                                                     |
| `packages/ui/`    | `@vmm/ui`: tokens, the shadcn-svelte vega style, the shadcn primitives (`components/ui`, generated) and shared kit parts     |
| `test/`           | the local docker test stack (game server + companion image) and the end-to-end player path. Not production                   |
| `docs/`           | `specs/`, `plans/`, `research/`, `design/`; the companion's ADRs are still in `apps/companion/docs/adr`                      |

The direction and the open phases: [docs/specs/2026-10-15-monorepo-viteplus-companion-agent-design.md](docs/specs/2026-10-15-monorepo-viteplus-companion-agent-design.md).

## Commands

The toolchain is Vite+ (`vp`) on a Bun workspace. `vp` comes with the workspace (`vite-plus` dev dependency);
from a shell without the global CLI, run it as `bunx vp`.

```bash
bun install                       # the workspace; also installs the git hooks (vp config)
vp run ci                         # THE gate: format, lint, type checks, svelte-check, tests, builds, Rust core (cached)
vp check --fix                    # format and lint fixes (the pre-commit hook runs this on staged files)
vp run --filter @vmm/client test  # one task of one package (also: build, check:svelte, rust)
bun run mock                      # DEV app (tauri dev, own data dir, cyan) + the browser preview with the mock backend on http://localhost:1420
bun run mock:web                  # the browser preview alone (no Rust toolchain needed)
bun run mock:audit                # every page at 1100 × 680 in German: screenshots + layout audit (apps/client/dev/out)
bun run mock:shot 1100 680 /installed out.png   # one page (LOCALE, ACTION, PORT: see apps/client/dev/screenshot.mjs)
bun run --cwd apps/client dev:app # the DEV app alone, without the mock in the browser (see apps/client/AGENTS.md)
bun run mock:seed                 # copy the installed app's profiles into the DEV app's data dir afresh (mock does it once)
vp run test:migration             # seed the test stack with a server snapshot, start the companion on it, verify (see below)
vp run stack:up | stack:verify | e2e   # the pieces: start the companion, verify, the player path end to end
```

Run `vp run ci` before declaring any task done; an unchanged package replays from the cache, so it is cheap.
Release builds run it with `--no-cache`.

## Rules for the whole repository

1. English everywhere: identifiers, comments, commit messages, docs, UI keys. German only in the client's
   `de.ts` (and the companion UI's catalog).
2. One version per shared dependency: add it to `workspaces.catalog` in the root `package.json`, reference it as
   `"catalog:"`. Workspace packages are referenced as `"workspace:*"`. New dependencies only when nothing in the
   workspace does the job.
3. Formatting, lint and type-check settings live only in the root `vite.config.ts`; package configs hold their
   Vite settings and their tasks. Generated code (`packages/ui/src/components/ui`, build output) is ignored there.
4. Decisions and test results go into the repository (`docs/specs`, `docs/plans`, ADRs), not only into chat.
5. Commit only when asked; conventional commit messages; one working tree per session (`git worktree add` for
   parallel work).
6. Windows: PowerShell and `C:\` paths. Never kill all Node processes; stop by PID or port.

### One sync, one source of truth

- A server is identified by its sync code `vmm1.<gist id>.<secret>`. The companion creates it and is the only
  place it comes from: its landing page button carries it, `GET /api/sync` returns it, players paste it or the
  companion's address. Never copy a code into a file, a script, a fixture, a commit message or a chat reply.
- The only test credential is `COMPANION_GIST_TOKEN` in `test/.env` (a throwaway GitHub token, gist scope).
  Read it into a variable, never print it, never write it into other files. `test/.env`, `test/valheim.env` and
  `test/frpc.toml` are local and git-ignored; their `*.example` files are the committed shape.

### The test stack

- `pwsh test/up.ps1 [-SetupSync] [-Reset] [-NoBuild]` builds the companion image from `apps/companion` (with
  the repository root as build context) and starts it. It is the only way to start the stack.
- `pwsh test/e2e.ps1 [-Build]` runs the player's path end to end: landing page in headless Edge → the
  button's link → the DEV app links and adopts. Run it before claiming the hand-off works. After `bun run mock`
  (`tauri dev`) the debug exe expects the dev server on port 1420, so run `e2e.ps1 -Build` to get a standalone one back.
- `vp run test:migration` (= `test/seed.ps1`, `test/up.ps1 -SetupSync`, `test/verify-migration.ps1`) is the
  migration test: the stack is seeded with a snapshot of a real server (`test/snapshots/*.tar.gz`, local and
  git-ignored: a compose folder without the game binaries, the compose `.env` and the companion's secrets),
  the companion built from `apps/companion` starts on that state, and the verify script checks that it serves
  the lock, installed.json, the on-disk comparison (reparse) and the profile zip unchanged. The test stack's
  own `sync.json`, `sync-state.json` and `companion-token` survive a seed; the previous `test/config` is kept
  as `test/config.prev`. `SNAPSHOT=<tar.gz>` picks a snapshot; the default is the newest.
- The production game server (10.10.10.123) is never modified from here, and never read unless the owner
  says so for that one occasion (a snapshot is streamed read-only over SSH, no file is created there). The
  companion in `test/` is the only server anything may be pushed to. `%APPDATA%\io.github.drloloto.valheim-mod-manager`
  is the owner's real data; test scenarios never write there (`dev/seed-dev-data.ps1` only copies from it and
  strips the server links of the copies).
