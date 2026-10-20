# Gist sync integration — implementation plan

Spec: [2026-10-12-gist-sync-integration.md](../specs/2026-10-12-gist-sync-integration.md).
Branch `spike/gist-sync`; the transport, link model, dialogs, dev build and scenario scripts exist.

## Tasks

1. **Toolbar chip** — `shell/server-chip.svelte`: transport icon, name, state dot + text, role badge;
   click routing; tooltip with transport and the first differences. Mounted in `top-bar.svelte` after the
   tabs. `store.serverAdmin` says whether publishing is possible for the current link.
2. **Diff dialog** — "Publish my profile instead…" for admins (`ServerDialog.svelte`, diff mode footer).
3. **Background re-check** — five-minute interval in `store.init()`, cleared with the listeners.
4. **i18n** — `chip.*` and `server.publishInstead` in `en.ts` and `de.ts`.
5. **Mock** — gist links in `dev/mock-tauri.js`: `discover_server` with a code, `check_server` with
   `gistRelease` and `configsChanged` for a gist link, so screenshots show the chip in every state.
6. **Wording** — drop "spike" from code comments; architecture note; changelog entry under Unreleased.
7. **Verify** — gates, autofixer on the changed `.svelte` files, mock screenshots (chip states, de), the
   scripted scenario against the test companion (`spike-gist.ps1 -Reset -Cdp`, `spike-drive.mjs none` and
   `add`).
