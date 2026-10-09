# Contributing

Thanks for your interest. This document explains how the project is set up, what the conventions are and how
to get a change merged. If you use AI tools, read the last section; they are welcome here, with rules.

## Setup

1. Install Node.js 22+, Rust stable (rustup) and the Tauri prerequisites for Windows (MSVC Build Tools,
   WebView2). Linux and macOS can run the frontend and the tests, but the app targets Windows + Steam.
2. `npm install`
3. `npm run tauri dev` for the real app, or `VITE_MOCK_TAURI=1 npm run dev` for a browser preview with
   sample data (no Rust toolchain needed).

## Repository map

```
src-tauri/src/      Rust core (index, resolver, install, sync, profiles, share, config, game, logs, commands)
src/lib/api/        invoke client, types, reactive store (Svelte 5 runes)
src/lib/browse/     Browse page logic: criteria, filter engine, ranges, tokens, views (pure, tested)
src/lib/desktop/    selection, virtualization, shortcuts, guards, column prefs, storage (pure, tested)
src/lib/i18n/       translation catalogs and t()
src/lib/components/ kit (own components), shell (title/top/status bar), app (pages), ui (shadcn, generated)
src/routes/         SvelteKit routes (SPA); /dev/kit is the component showcase
docs/               architecture, AI workflow, design reference, historical specs and plans
dev/                browser mock of the Tauri backend
```

## Gates

Every pull request has to pass what CI runs:

```bash
npm run lint         # prettier --check
npm run check        # svelte-check
npm test             # vitest
npm run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`npm run format` and `cargo fmt` fix formatting.

To build an installer locally use `npm run tauri:build:local`; `npm run tauri:build:portable` skips the
installers and produces the portable zip in `dist/` (executable, `portable` marker, README). Plain
`npm run tauri build` also signs the updater artifacts and fails without the private key
(`TAURI_SIGNING_PRIVATE_KEY` with the key content); only maintainers need that.

## Conventions

- **Language:** code, comments, commits and docs are English. UI texts go through `t("key")`; English is
  the reference catalog, German must contain the same keys (a test checks this).
- **Svelte 5 runes only.** No `export let`, no `$:`, no `on:click`.
- **Kit boundary:** pages under `src/routes` and `src/lib/components/app` import UI only from
  `#lib/components/kit/index.js` and `#lib/components/shell/*`, never from `#lib/components/ui`. A test enforces it.
- **No hard-coded colors** in `.svelte` files. Colors are tokens in `src/lib/theme.css`, exposed as Tailwind
  utilities through `src/app.css`.
- **Pure logic is tested.** Filtering, selection, column prefs, formatting and the like live in plain
  TypeScript modules with Vitest tests. Components stay thin.
- **Rust:** every module has unit tests; `cargo clippy -D warnings` is the bar. User-facing error messages
  are English sentences.
- **Commits:** conventional commits (`feat(browse): …`, `fix(sync): …`, `docs: …`, `chore: …`).

## Making a change

1. Open an issue first for anything beyond a small fix, so the direction can be agreed on.
2. Branch from `main`, keep the change focused.
3. Add or update tests for logic changes. Run the gates.
4. Open a pull request using the template. Describe what changed and how you verified it, including whether
   you tested in the real game.

## Releases

Maintainers tag `vX.Y.Z` on `main`. The release workflow builds the Windows installers, the signed updater
manifest (`latest.json`) and the portable zip and attaches them to a draft GitHub release; the draft is
reviewed and published by hand. Versions live in `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json` and must match (the workflow refuses otherwise).

The workflow needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the updater private key, generated
with `npx tauri signer generate`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is in
`src-tauri/tauri.conf.json`. Losing the private key means existing installations can no longer verify
updates, so keep it backed up.

## AI-assisted contributions

This project is itself developed with AI agents, so using them is expected, not frowned upon. The rules:

- **You own the result.** Read what the agent wrote, run the gates, test the behavior. Do not open a pull
  request you could not explain.
- **Start the agent from `AGENTS.md`.** It carries the conventions above and the commands. Claude Code also
  reads `CLAUDE.md`.
- **Keep specs for bigger work.** Non-trivial features start with a short design in `docs/superpowers/specs/`
  (see [docs/ai-development.md](docs/ai-development.md)). Reviewing a design is cheaper than reviewing a
  thousand lines of code.
- **Say so in the PR** when an agent did most of the work. It helps reviewers know where to look.
