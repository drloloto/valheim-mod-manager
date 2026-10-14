# Claude Code notes

Read `../CLAUDE.md` (the workspace: start folder, test stack, the one-sync rule) and [AGENTS.md](AGENTS.md)
first; AGENTS.md has the commands, the repository map and the rules.

Claude-specific additions:

- When the Svelte MCP server is available, run its `svelte-autofixer` on every `.svelte` and `.svelte.ts`
  file you create or change until it reports no issues.
- Bigger changes follow spec → plan → implement with tests: a short design in `docs/superpowers/specs/`,
  a task list in `docs/superpowers/plans/`, then code. No plugin is needed for this; the folder name is
  historical. The owner prefers decisions to be made and stated, not asked, unless the direction itself
  changes.
- Verification before claiming completion: run the gates listed in AGENTS.md and, for UI changes, look at
  the result in the mock preview (`dev/` has a CDP screenshot approach; headless Edge works).
- Never modify the production game server (10.10.10.123). Server-side work lives in the sibling repo
  `../companion`; its contract with this client is the manifest and the `.r2z` profile zip.
- Use Windows paths and PowerShell or the file tools; no Git-Bash `/c/...` detours.
- Commit messages end with a `Co-Authored-By` line for the model that wrote the change.
