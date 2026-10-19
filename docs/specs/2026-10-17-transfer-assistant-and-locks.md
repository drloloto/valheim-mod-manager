# Transfer assistant, server locks and local mod metadata

Date: 2026-10-17. Status: implemented on `feat/monorepo-viteplus`.
Builds on `2026-10-14-server-managed-mods.md` (the `managed` flag) and `2026-10-16-server-sync-review-and-hexium.md`
(the diff with `dropped`).

## Why

Linking a profile to a server today ends in one dialog with three buttons (adopt, into a new profile, keep
mine). The player does not see what happens to each mod, the server's mods stay editable afterwards (only
"Update all" skips them), and a mod they imported from a zip shows a bare title in the table. The owner
asked for clarity per mod when a profile is server-managed and when the link is made, for a small assistant
that also copies mods between profiles, for an override switch per profile, and for local mods to carry
their icon and metadata.

## The cases, per mod

The assistant compares a **source** (a server's lock, or another profile) with a **target** profile and
sorts every mod into one case. The vocabulary is the same in the assistant, the table and the diff dialog.

| case      | meaning                                               | server source does                                                  | profile source does              |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `add`     | in the source, not in the target                      | installed, **server-managed**                                       | copied (own mod)                 |
| `same`    | same mod, same version                                | becomes **server-managed** (locked)                                 | nothing                          |
| `version` | same mod, other version                               | set to the server's version, **server-managed**                     | take the source version, or keep |
| `dropped` | server-managed in the target, no longer on the server | removed, or kept as the player's own (client-side)                  | –                                |
| `extra`   | in the target, unknown to the source                  | **keep** (client-side only, default) or remove; local mods likewise | untouched (a copy is additive)   |

Hints come from Thunderstore's categories: an `extra` that is server-side gets a warning ("will not work
without the server"), a client-side one a reassurance. Local mods (`local-*`) can never be on the server;
they are always `extra` for a server source and are copied with their files for a profile source.

## Decisions

- **One engine, two entry points.** `transfer.rs` plans and applies both kinds; `transfer_plan` and
  `transfer_run` are the commands. The server kind reuses `server::adopt` for `add`/`same`/`version`/
  `dropped` and only adds the per-item decisions on top (`dropped` → keep as own, `extra` → remove). The
  profile kind upserts the taken entries and copies local mod folders. The pre-play diff dialog keeps its
  fast path ("adopt and start"), on the same engine defaults.
- **Target: existing or new.** A new target for a server source is a fresh profile carrying the same link
  (a clean server profile; the current profile is untouched, that is the protection). A new target for a
  profile source is an empty profile. The existing target is snapshotted (`.snapshots/<stamp>-transfer`)
  before anything is written; the assistant says so, and "Restore last backup" in the profile manager
  (`restore_snapshot`) puts the newest snapshot back and repairs the installation.
- **Where it opens.** Linking a server in the profile manager (save & check) opens the assistant with the
  server as source and the profile as target instead of the diff dialog. "Add server…" gets a target
  choice: new profile (as before, automatic) or an existing profile (link it, then the assistant). The
  profile manager's maintenance row has "Copy mods…" (source = that profile) and, on a linked profile,
  "Compare with server…". The invite-link path (`e2e.ps1`) stays automatic.
- **Locks.** A `managed` entry is read-only while the profile's **Override** is off: no remove, no version
  change, no enable/disable, no pin toggle, in the table, the selection bar, the context menu, the detail
  pane and the Delete key. The Rust side enforces the same in `set_mods` and `set_mod_enabled`
  (`transfer::check_locks`), so no client path can drift a server mod by accident. The table says why
  ("Managed by the server · Override in the profile settings").
- **Override** is `Profile.override_locks` (per profile, off by default), a switch in the profile manager's
  general tab with the risk spelled out: the server will see the difference, the mod may not work with the
  server, and the next adoption resets the server's mods anyway. The flag reaches the UI as
  `AppState.overrides` (names of profiles with it on).
- **Local mod metadata.** `import_local` reads `description`, `website_url` and `icon.png` from the zip and
  writes `meta.json` next to it (icon as a `data:` URL, capped at 256 KB). `build_state` returns the active
  profile's local mods as synthesized packages (`AppState.localMods`): the table shows icon and description,
  the detail pane shows readme and changelog from the zip (`get_package` and `get_package_doc` fall back to
  the local mod). A zip imported before this change gets its `meta.json` on the next state build.

## Not in this change

- A free choice "clone the current profile, then adopt" inside the assistant; the diff dialog's "Into a
  new profile" still does that.
- Config files in a profile-to-profile copy (the server kind takes them as before, optional).
- A snapshot browser; only the newest snapshot can be restored.

## Verification

Done 2026-10-17:

- Rust: `transfer::tests` (the owner's matrix for the server kind incl. an empty profile, apply with keep
  and remove, the additive profile copy with and without Override, `check_locks`), `localmod::tests` (meta,
  icon, readme and changelog from a zip, self-healing `meta.json`, a bare DLL). 100 tests green.
- TS: `transfer-view.test.ts` (grouping, decisions, summary, locked ids).
- `vp run ci` green (13/13). `bun run mock:audit`: 5/5 pages, only the known baseline findings (switch
  thumbs, header cells, resize handle).
- Mock preview, German, 1100 × 680 (`apps/client/dev/out/transfer/`): the Installed table with lock
  icons on server mods and the local mod with icon and description, its detail pane (icon, description,
  website, readme tab), the assistant's setup and review steps, the profile manager's general tab with
  Override and the maintenance buttons, "Add server…" with the target choice.
- `pwsh test/e2e.ps1 -Build`: PASS, unchanged expectations (invite link → the DEV app links by the sync
  code, adopts the lock's 11 mods and the configs, shows "in sync"). Note: the e2e resets the DEV data dir
  (`dev-app.ps1 -Reset`), so anything placed there by hand is gone afterwards.
- DEV app (the fresh debug build) with the owner's BetterMouseTweaks-1.0.0.zip as a local mod of
  "PetersWelte": `meta.json` was built from the zip on the first state build (name, version, description,
  website, icon as a data URL, dependency on BepInEx).
