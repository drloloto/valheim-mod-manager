# Transfer assistant, server locks, local mod metadata — implementation plan

Spec: [2026-10-17-transfer-assistant-and-locks.md](../specs/2026-10-17-transfer-assistant-and-locks.md).
Branch `feat/monorepo-viteplus`. Status: all steps done 2026-10-17 (results in the spec's Verification
section). The TS lock test lives in `transfer-view.test.ts`, not a separate `locks.test.ts`.

1. **Local mod metadata** — `localmod.rs`: manifest gains `description`, `website_url`; `LocalMeta`
   (`meta.json`, icon as data URL ≤ 256 KB), `meta()` reads it or rebuilds it from the zip, `as_pkg()`,
   `doc()` (README/CHANGELOG from the zip). `commands.rs`: `get_package`/`get_package_doc` fall back to the
   active profile's local mod; `build_state` fills `AppState.local_mods`. Test: meta from a zip with icon.
2. **Override flag** — `models.rs::Profile.override_locks`; `AppState.overrides`; command
   `set_profile_override`.
3. **Locks in Rust** — `transfer::check_locks(old, new, override)`; `set_mods` and `set_mod_enabled` refuse
   a change to a managed entry while the override is off. Tests.
4. **Transfer engine** — `transfer.rs`: `Kind`, `Case`, `Decision`, `Item`, `Plan`, `plan()` and
   `apply()` (pure), tests for every case of both kinds. Commands `transfer_plan`, `transfer_run`
   (server kind: `fetch_server_state` factored out of `adopt_server`; profile kind: copy local folders),
   `restore_snapshot`. Register in `lib.rs`.
5. **Client API and store** — `types.ts`, `client.ts`, `store.svelte.ts`: `localMods` merged into `byId`,
   `lockedIds`/`isLocked`, guards with one toast, `transfer` dialog state, `openTransfer()`,
   `restoreSnapshot()`, `setOverride()`; `linkServer` opens the assistant instead of the diff.
6. **UI** — `TransferDialog.svelte` (two steps: source & target, review & run; grouped by case, per-item
   choice, summary stats, backup and side hints); `InstalledView` locks (switch, menu, bar, Delete, hint);
   `PackageDetail` locks and local mods; `ProfileManager` override switch, "Copy mods…", "Compare with
   server…", "Restore last backup"; `ServerDialog` add-mode target choice. `en.ts`/`de.ts`.
7. **Mock** — `dev/mock-tauri.js`: `transfer_plan`, `transfer_run`, `set_profile_override`,
   `restore_snapshot`, a local mod with icon in the profile, `overrides`, `localMods`.
8. **Verify** — `vp run ci`, `bun run mock:audit`, screenshots of the assistant (both kinds), the DEV app
   with BetterMouseTweaks, `test/e2e.ps1 -Build`. CHANGELOG, spec status.
