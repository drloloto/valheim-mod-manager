# Claude Code notes

Read [AGENTS.md](AGENTS.md) first (the repository map, `vp run ci`, the sync and test-stack rules), then the
`AGENTS.md` of the app you work in.

Claude-specific additions:

- When the Svelte MCP server is available, run its `svelte-autofixer` on every `.svelte` and `.svelte.ts`
  file you create or change until it reports no issues.
- Bigger changes follow spec → plan → implement with tests: a short design in `docs/specs/`, a task list in
  `docs/plans/`, then code. The owner prefers decisions to be made and stated, not asked, unless the direction
  itself changes.
- Verification before claiming completion: `vp run ci` and, for UI changes, the result in the client's mock
  preview (`apps/client/dev/` has a CDP screenshot approach; headless Edge works).
- Use Windows paths and PowerShell or the file tools; no Git-Bash `/c/...` detours.
- Commit messages end with a `Co-Authored-By` line for the model that wrote the change.
