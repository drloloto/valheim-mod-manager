# Claude Code notes (client)

@AGENTS.md

The client's rules come from `AGENTS.md` here (imported above); the repository-wide ones load from the root.
Never modify the production game server (10.10.10.123). The companion lives in `apps/companion`; its contract
with this client is the manifest and the `.r2z` profile zip (and, from phase 4 of the monorepo plan,
`packages/companion-api`).
