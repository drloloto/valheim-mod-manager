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

The toolchain is Vite+ (`vp`) on a pnpm workspace. `vp` comes with the workspace (`vite-plus` dev dependency);
from a shell without the global CLI, prefix it with `pnpm exec`.

```bash
pnpm install                      # the workspace; also installs the git hooks (vp config)
vp run ci                         # THE gate: format, lint, type checks, svelte-check, tests, builds, Rust core (cached)
vp check --fix                    # format and lint fixes (the pre-commit hook runs this on staged files)
vp run --filter @vmm/client test  # one task of one package (also: build, check:svelte, rust)
pnpm -C apps/client dev           # the client in the browser (VITE_MOCK_TAURI=1 for the mock backend)
pnpm -C apps/client dev:app       # the DEV app (own data dir and scheme, see apps/client/AGENTS.md)
```

Run `vp run ci` before declaring any task done; an unchanged package replays from the cache, so it is cheap.
Release builds run it with `--no-cache`.

## Rules for the whole repository

1. English everywhere: identifiers, comments, commit messages, docs, UI keys. German only in the client's
   `de.ts` (and the companion UI's catalog).
2. One version per shared dependency: add it to the `catalog:` in `pnpm-workspace.yaml`, reference it as
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
  button's link → the DEV app links and adopts. Run it before claiming the hand-off works.
- The production game server (10.10.10.123) is never modified from here, not even read. The companion in
  `test/` is the only server anything may be pushed to. `%APPDATA%\io.github.drloloto.valheim-mod-manager`
  is the owner's real data; test scenarios never write there.
