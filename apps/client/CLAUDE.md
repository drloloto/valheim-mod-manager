# Claude Code notes (client)

Read the root [CLAUDE.md](../../CLAUDE.md) and [AGENTS.md](../../AGENTS.md) first, then [AGENTS.md](AGENTS.md)
here. Sessions start at the repository root, not in this folder.

- Never modify the production game server (10.10.10.123). The companion lives in `apps/companion`; its
  contract with this client is the manifest and the `.r2z` profile zip (and, from phase 4 of the monorepo plan,
  `packages/companion-api`).
