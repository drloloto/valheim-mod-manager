# The client: instructions for AI agents

The repository-wide rules, the gate (`vp run ci`) and the test stack are in the root [AGENTS.md](../../AGENTS.md).
This file adds what only concerns the client. Humans read [CONTRIBUTING.md](../../CONTRIBUTING.md).

## What this is

A Windows desktop mod manager for Valheim: Tauri 2 (Rust core) + SvelteKit 3 SPA (Svelte 5 runes, TypeScript,
Tailwind 4, shadcn-svelte). It talks to the Thunderstore API, installs BepInEx mods into per-profile folders
and launches the game through Steam. Architecture: [docs/architecture.md](../../docs/architecture.md).

## Commands (from `apps/client`, or with `bun run --cwd apps/client` from the root)

```bash
bun run tauri dev                 # real app, shares the installed app's data dir
bun run dev:app                   # DEV app: own identifier and data dir (…valheim-mod-manager.dev), DEV badge, cyan accent
bun run build:dev-app             # the same as a standalone debug exe (src-tauri/target/debug)
VITE_MOCK_TAURI=1 bun run dev:app # DEV app plus the browser preview with the mock backend at http://localhost:1420 (root: bun run mock,
                                  # which first copies the installed app's profiles into the DEV data dir: dev/seed-dev-data.ps1)
VITE_MOCK_TAURI=1 bun run dev     # the browser preview alone (root: bun run mock:web)
vp run build | test | check:svelte | rust   # the package's cached tasks; `vp run ci` at the root runs them all
```

`vp check --fix` (root) fixes formatting and lint; `cargo fmt` the Rust side.

## Where things live

- `src-tauri/src/commands.rs` is the IPC surface; every Tauri command is listed there and in `lib.rs`.
  `src/lib/api/client.ts` mirrors it on the TypeScript side, `src/lib/api/types.ts` holds the shapes.
- `src/lib/api/store.svelte.ts` is the single reactive store. Pages read from it; mutations go through its
  methods, which call the Rust commands and reload state.
- Browse filtering: `src/lib/browse/` (criteria → engine bitmasks → `store.filtered`). Pure and tested.
- Desktop behaviors (selection, shortcuts, virtualization, column prefs, localStorage): `src/lib/desktop/`.
- UI building blocks: `src/lib/components/kit/` (the client's own, exported through `kit/index.ts`, which also
  re-exports the shared ones) over `@vmm/ui` in `packages/ui`: tokens (`theme.css`), the vega style, the
  desktop overrides (`style-desktop.css`), the shadcn primitives in `components/ui` (generated, do not edit by
  hand; regenerate in `packages/ui` with `bunx shadcn-svelte add <name> --overwrite --no-deps-install`; its
  `components.json` maps the `#lib` alias through `packages/ui/tsconfig.json`. The CLI rewrites
  dependency versions in `packages/ui/package.json`: put the `catalog:` references back) and the small shared
  kit parts both apps use.
- The design reference is `docs/design/2026-10-02-mod-manager-designs.html` (variant 1a "Werkbank", filter
  system from 2a).
- Translations: `src/lib/i18n/en.ts` (reference) and `de.ts`. Use `t("key", { vars })` from
  `#lib/i18n/index.svelte.js` in components, from `#lib/i18n/t.js` in pure modules.

## Rules

1. Svelte 5 runes only. No legacy syntax.
2. App pages (`src/routes/**`, `src/lib/components/app/**`) import UI only from `#lib/components/kit/index.js` and
   `#lib/components/shell/*`, never the primitives (`#lib/components/ui`, `@vmm/ui/components/ui`).
   `boundaries.test.ts` fails otherwise.
3. No `oklch(...)`, `#hex` or `rgb(...)` in `.svelte` files. Add a token to `packages/ui/src/theme.css` instead.
4. New logic goes into a pure module with a test (`vite-plus/test`); components stay thin. Rust modules get unit
   tests.
5. Every new UI string is a catalog key in `en.ts` and `de.ts`. The parity test fails on missing keys.
6. Keep `package.json`, `Cargo.toml` and `tauri.conf.json` versions identical.
7. Prefer what is already there (bits-ui, lucide, Intl APIs) over a new dependency.
8. Layout must survive the minimum window (1100 × 680) and the German catalog. Width decisions use
   container queries on the pane (`@container`, `@sm:` …), never the viewport; tables fit their columns
   with `fitColumns`; text in flex rows gets `min-w-0 truncate`, icons and counts `shrink-0`; scroll
   containers use the `scroll-y` utility (`layout.test.ts` enforces it). Details in
   `docs/specs/2026-10-11-small-window-layout-design.md`.

## Verifying UI work without the Tauri window

Start the mock preview (`bun run mock` at the root, or `bun run mock:web` without the DEV app), then `bun run mock:audit` screenshots every page at
1100 × 680 in German into `dev/out/` and runs `dev/layout-audit.js` (overflow, stray scrollbars, overlapping
text) on each. `bun run mock:shot 1100 680 /installed out.png` does one page; `LOCALE`, `ACTION`, `PRESET` and
`PORT` (see the header of `dev/screenshot.mjs`) set the language, click a row first or use another port. Both
drive headless Edge over the Chrome DevTools Protocol without dependencies; from Git Bash set
`MSYS_NO_PATHCONV=1`, or the route `/installed` turns into a Windows path. Check every changed page at
1100 × 680 in German before claiming a UI change done. The mock lives in `dev/mock-tauri.js` and reports a dev build
(cyan accent, DEV badge) like the DEV app; extend it when a
new command is needed. In Claude Code, `/ux-review` (`.claude/skills/ux-review`) writes a heuristic UX review
from those screenshots.
