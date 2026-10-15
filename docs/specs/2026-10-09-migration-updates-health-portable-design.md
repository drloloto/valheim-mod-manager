# Migration, auto-update, health hints, portable build — design

Four additions chosen for the first public release. Not in scope: other Thunderstore games, server sync,
modpack sharing beyond r2modman codes, Linux.

## 1. Migration from r2modman and Thunderstore Mod Manager

Both managers keep profiles as folders with a `mods.yml` (list of manifests: `name` = `namespace-name`,
`versionNumber {major, minor, patch}`, `enabled`, `onlineSource`) and a `BepInEx/config` tree:

- r2modman: `%APPDATA%\r2modmanPlus-local\Valheim\profiles\<name>\`
- Thunderstore Mod Manager: `%APPDATA%\Thunderstore Mod Manager\DataFolder\Valheim\profiles\<name>\`

**Core (`migrate.rs`).** `candidates(roaming)` scans both locations and returns `{ manager, name, path,
mods }`. `read_profile(dir)` parses `mods.yml` into `ProfileMod`s (entries with `onlineSource: false` or
without a namespace are reported as skipped) and collects config files; the result feeds the existing
`share::apply_import`, so migration behaves exactly like an `.r2z` import (unique name, configs optional,
sync queued, profile activated). Commands: `list_foreign_profiles`, `import_foreign_profile(path, name,
with_configs)`. A folder picker covers custom data directories.

**UI.** "Import from r2modman / TMM…" in the profile menu opens a dialog listing the found profiles with
manager, name and mod count; each row imports on click. Configs are imported by default.

## 2. Auto-update

`tauri-plugin-updater` with signed artifacts. The public key lives in `tauri.conf.json`, the private key in
the owner's `~/.tauri/` and in the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The release workflow publishes `latest.json` next to the installers;
the endpoint is `releases/latest/download/latest.json`.

**UI.** On startup (when the "check automatically" setting is on and the app is not portable) the store
checks once; a found update shows in the status bar and in Settings → Updates with "Install and restart".
Settings also has "Check now". Portable builds show a hint to download the new zip instead.

## 3. Health hints

`health.rs` computes issues from profile, `installed.json`, index and Steam's `appmanifest_892970.acf`:

- `duplicate`: the same `.dll` file name installed by more than one package (bundled libraries, double
  installs). Doorstop and `BepInEx/core` are ignored.
- `deprecated`: an explicit mod that Thunderstore marks deprecated.
- `stale`: an explicit mod whose last update is older than the game's last update (`LastUpdated` from the
  app manifest). This is a hint, not a verdict.

Issues travel in `AppState.health`; the game's `lastUpdated` and `buildId` in `AppState.game`. The Installed
page shows a collapsible banner with all issues and a warning marker on affected rows; the detail panel lists
the issues of the selected mod.

## 4. Portable build

If a file named `portable` sits next to the executable, the data root is `<exe dir>/data` instead of
`%APPDATA%`. `AppState.app` reports `portable` and `dataDir`. The release workflow zips the bare executable
with a `portable` marker and a short readme as `valheim-mod-manager-<version>-portable-win64.zip`. The
updater is skipped in portable mode.

## Tests

- `migrate.rs`: parse a real-shaped `mods.yml`, skip local entries, scan a temp layout.
- `health.rs`: duplicates across packages, deprecated and stale detection, ignored folders.
- `game.rs`: parse `LastUpdated` and `buildid` from an app manifest.
- Frontend: types only; dialogs are thin.
