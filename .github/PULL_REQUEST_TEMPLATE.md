## What

<!-- One or two sentences: what changes and why. Link the issue if there is one. -->

## How it was verified

- [ ] `npm run lint && npm run check && npm test && npm run build`
- [ ] `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (in `src-tauri`)
- [ ] Tried in the app (`npm run tauri dev`) or in the browser preview (`VITE_MOCK_TAURI=1 npm run dev`)
- [ ] Tested with the real game, if the change touches sync, install or launch

## Notes for the reviewer

<!-- Screenshots for UI changes. Say if an AI agent wrote most of this and where you want eyes. -->
