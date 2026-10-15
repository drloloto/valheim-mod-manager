## What

<!-- One or two sentences: what changes and why. Link the issue if there is one. -->

## How it was verified

- [ ] `vp run ci` (format, lint, type checks, svelte-check, tests, builds, the Rust core)
- [ ] Tried in the app (`pnpm -C apps/client tauri dev`) or in the browser preview (`VITE_MOCK_TAURI=1 pnpm -C apps/client dev`)
- [ ] Tested with the real game, if the change touches sync, install or launch

## Notes for the reviewer

<!-- Screenshots for UI changes. Say if an AI agent wrote most of this and where you want eyes. -->
