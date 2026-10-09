# Claude Code notes

Read [AGENTS.md](AGENTS.md) first; it has the commands, the repository map and the rules.

Claude-specific additions:

- When the Svelte MCP server is available, run its `svelte-autofixer` on every `.svelte` and `.svelte.ts`
  file you create or change until it reports no issues.
- Design work follows the superpowers flow: brainstorm → spec in `docs/superpowers/specs/` → plan in
  `docs/superpowers/plans/` → implement with tests. The owner prefers decisions to be made and stated, not
  asked, unless the direction itself changes.
- Verification before claiming completion: run the gates listed in AGENTS.md and, for UI changes, look at the
  result in the mock preview.
- Commit messages end with a `Co-Authored-By` line for the model that wrote the change.
