# Instructions for AI agents

This file is the entry point for coding agents (Claude Code, Codex, Cursor, Copilot and others). Humans read
[CONTRIBUTING.md](CONTRIBUTING.md); it says the same things with more context.

## What this is

A Windows desktop mod manager for Valheim: Tauri 2 (Rust core) + SvelteKit 3 SPA (Svelte 5 runes, TypeScript,
Tailwind 4, shadcn-svelte). It talks to the Thunderstore API, installs BepInEx mods into per-profile folders
and launches the game through Steam. Architecture: [docs/architecture.md](docs/architecture.md).

## Commands

```bash
npm install
npm run tauri dev                 # real app
VITE_MOCK_TAURI=1 npm run dev     # browser preview with mock backend at http://localhost:1420
npm run check && npm test && npm run build && npm run lint
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Run the full set before declaring a task done. `npm run format` / `cargo fmt` fix formatting.

## Where things live

- `src-tauri/src/commands.rs` is the IPC surface; every Tauri command is listed there and in `lib.rs`.
  `src/lib/api/client.ts` mirrors it on the TypeScript side, `src/lib/api/types.ts` holds the shapes.
- `src/lib/api/store.svelte.ts` is the single reactive store. Pages read from it; mutations go through its
  methods, which call the Rust commands and reload state.
- Browse filtering: `src/lib/browse/` (criteria → engine bitmasks → `store.filtered`). Pure and tested.
- Desktop behaviors (selection, shortcuts, virtualization, column prefs, localStorage): `src/lib/desktop/`.
- UI building blocks: `src/lib/components/kit/` (ours) over `src/lib/components/ui/` (shadcn, generated, do
  not edit by hand; regenerate with `npx shadcn-svelte@latest add <name>`). Overrides for the generated
  components go into `src/lib/style-desktop.css`.
- Design tokens: `src/lib/theme.css`; the design reference is `docs/design/2026-10-02-mod-manager-designs.html`
  (variant 1a "Werkbank", filter system from 2a).
- Translations: `src/lib/i18n/en.ts` (reference) and `de.ts`. Use `t("key", { vars })` from
  `#lib/i18n/index.svelte.js` in components, from `#lib/i18n/t.js` in pure modules.

## Rules

1. English everywhere: identifiers, comments, commit messages, docs, UI keys. German only in `de.ts`.
2. Svelte 5 runes only. No legacy syntax.
3. App pages (`src/routes/**`, `src/lib/components/app/**`) import UI only from `#lib/components/kit/index.js` and
   `#lib/components/shell/*`, never from `#lib/components/ui`. `boundaries.test.ts` fails otherwise.
4. No `oklch(...)`, `#hex` or `rgb(...)` in `.svelte` files. Add a token to `theme.css` instead.
5. New logic goes into a pure module with a Vitest test; components stay thin. Rust modules get unit tests.
6. Every new UI string is a catalog key in `en.ts` and `de.ts`. The parity test fails on missing keys.
7. Keep `package.json`, `Cargo.toml` and `tauri.conf.json` versions identical.
8. Do not add dependencies casually; prefer what is already there (bits-ui, lucide, Intl APIs).
9. Never kill all Node processes to stop the dev server; stop by port (it would also kill tool servers).

## Workflow for bigger changes

Write a short design first into `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (goal, decisions,
architecture, tests), then implement task by task with tests first. Existing specs and plans show the
expected depth. Commit in meaningful slices with conventional commit messages.

## Verifying UI work without the Tauri window

Start the mock preview, then drive a headless browser over the Chrome DevTools Protocol (Edge ships with
Windows: `msedge --headless=new --remote-debugging-port=9222`) to click and screenshot. The mock lives in
`dev/mock-tauri.js`; extend it when a new command is needed.
