# Claude Code notes

@AGENTS.md

The repository rules come from `AGENTS.md` (imported above, nothing to read first). Working in `apps/client`
adds `apps/client/AGENTS.md` through `apps/client/CLAUDE.md` the same way. Start sessions in this folder:
memory, `.claude/settings.json` and the hooks are per start folder.

Claude-specific additions:

- When the Svelte MCP server is available, run its `svelte-autofixer` on every `.svelte` and `.svelte.ts`
  file you create or change until it reports no issues.
- Bigger changes follow spec → plan → implement with tests: a short design in `docs/specs/`, a task list in
  `docs/plans/`, then code. The owner prefers decisions to be made and stated, not asked, unless the direction
  itself changes.
- Verification before claiming completion: `vp run ci` and, for UI changes, `bun run mock:audit` (every page
  in the mock preview, German, 1100 × 680) with a look at the screenshots. `/ux-review` writes a heuristic
  UX review from those screenshots, on request only.
- Use Windows paths and PowerShell or the file tools; no Git-Bash `/c/...` detours.
- The PostToolUse hook in `.claude/settings.json` runs `vp check --fix` on every edited source file; do not
  run formatting by hand.
- Commit messages end with a `Co-Authored-By` line for the model that wrote the change.
