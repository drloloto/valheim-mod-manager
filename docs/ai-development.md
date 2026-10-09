# How this project is developed with AI

This is an honest description of the process, so you know what you are looking at and how to join in.

## The short version

Nearly all code in this repository was written by AI coding agents (Claude Code, models of the Claude 5
family) working in sessions directed by a single human owner. The owner decides what to build, reviews
designs and results, tests against the real game on their machine and merges. The agents explore the code,
write specs, implement with tests, run the gates and report back.

That is not a disclaimer, it is the method. We believe it produces a maintainable codebase when the process
is disciplined: designs before code, pure logic with tests, strict gates, and a human who reads.

## The loop

1. **Direction.** The owner describes an outcome in plain language, often with a screenshot or a complaint
   ("the filters are not good enough", "the header is too busy").
2. **Exploration.** The agent reads the relevant code and docs before proposing anything.
3. **Design.** For anything non-trivial the agent writes a short design into
   `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`: goal, decisions, architecture, tests. Early
   specs and plans in that folder are in German; later ones are English.
4. **Implementation.** Pure logic first, with Vitest or `cargo test`, then components. The agent runs
   `npm run check`, `npm test`, `npm run build`, `cargo clippy`, `cargo test` and, for UI work, looks at the
   result in the browser preview (`VITE_MOCK_TAURI=1`) by driving a headless browser.
5. **Review.** The owner reads the summary, checks the result in the app and pushes back. Changes land as
   conventional commits with a `Co-Authored-By` line naming the model.

The `superpowers` skill set for Claude Code (brainstorm → spec → plan → implement → verify) shaped this flow.
You do not need it to contribute, but `AGENTS.md` carries the same expectations in tool-neutral form.

## What the human does

- Sets priorities and taste. The "Werkbank" design in `docs/design/` came out of a design session; the agent
  implements against it.
- Catches what tests cannot: feel, layout, whether a feature is actually useful when managing 100 mods.
- Tests the parts no CI can reach: Steam, doorstop, a real Valheim installation.
- Owns the data model decisions (profile layout, compatibility with r2modman) and the release.

## What this means for contributors

- **Read `AGENTS.md`** before pointing an agent at the repo. It encodes the conventions a reviewer will check.
- **Specs are cheap, reviews are not.** For features, open an issue with a sketch of the design or a draft
  spec. Agreeing on the shape first avoids wasted agent runs.
- **Tests are the contract.** Pure modules (`src/lib/browse`, `src/lib/desktop`, the Rust core) are where
  behavior is pinned. If you change behavior, change the test; if you add behavior, add a test.
- **Expect agent-written code to be reviewed like any other.** It is held to the same gates. "The AI did it"
  is neither a defense nor a problem.
- **Human-written contributions are just as welcome.** The process is about rigor, not about which hands
  typed.

## Known limits of the approach

- The agents cannot run the Tauri window or Steam. Everything around launching the game is verified by a
  human. If you find a bug there, a precise report with `BepInEx/LogOutput.log` and the app's data folder
  state is worth a lot.
- Early history is in German (commit messages, specs, the design file). The code itself is English now.
- Documentation can drift from code faster than usual because code moves fast. If a doc and the code
  disagree, the code and its tests win; please fix the doc in the same PR.
