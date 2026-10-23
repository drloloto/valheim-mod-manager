# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.4.3] - 2026-10-23

### Changed

- The package index lives on disk per store, one package per line, with the slim list and an offset table
  in memory; lookups read one record. The core process idles at a few tens of MB instead of ~800 MB, starts
  without parsing a 130 MB cache and refreshes as a stream (the old `cache/index.json` is converted once).

### Fixed

- BepInEx's console no longer freezes the game when clicked: on a modded launch the app turns the console's
  QuickEdit mode off for `valheim.exe` only (a per-program setting in the user's registry).

## [0.4.2] - 2026-10-20

### Fixed

- Adding or changing any mod in a profile linked to a server failed with "Managed by the server: …" as soon
  as the server had dependencies of its own (the lock rule looked at the list before the server's
  dependencies were carried back in, so they counted as removed).
- A mod the server turns from required into optional stayed locked in the players' profiles: the comparison
  did not report the change, so no adoption converted it. It is now listed ("the server only recommends it
  now") and the adoption hands it back to the player, unlocked and removable.
- Optional mods arrive switched off: the first adoption of a link adds them disabled, and the transfer
  assistant's "Add, switched off" does the same, so a player opts in by enabling.

## [0.4.1] - 2026-10-20

### Fixed

- Updates from the private repository: the release workflow already writes API asset URLs into
  `latest.json` for a private repository, and the update check in 0.4.0 did not recognise them, so a check
  with a token found the update but could not download it. Such URLs now pass through unchanged.

## [0.4.0] - 2026-10-19

### Added

- Hexium as a second mod store. The index merges Hexium's package list with Thunderstore's by package id:
  mods only Hexium has appear in Browse (filter "Store"), the detail panel links to both pages, a release
  both stores have is downloaded from Thunderstore. Profiles are unchanged; the lock published to a
  companion names the store per mod, and the companion (and its takeover of hand-installed servers)
  downloads from Hexium when told to. Settings → "Include Hexium" turns the second store off.

- The release the server runs is visible: its name (the profile that was published), its id and when it was
  applied, in the server chip's tooltip, the server dialog and the profile manager's Server & Sync tab. The
  companion records it in the lock when a release is applied; older locks show "no release recorded yet".

- The transfer assistant: linking a server, "Copy mods…" and "Compare with server…" in the profile manager,
  and "Add server…" into an existing profile all show every mod in its case before anything changes:
  installed, version change, becomes server-managed, removed by the server (remove or keep as yours), only
  in your profile (keep as a client-side mod or remove, with a warning for server-side mods). The target is
  an existing profile or a new one; an existing profile is backed up first and "Restore last backup" in the
  profile manager brings it back.

- Server-managed mods are locked: no remove, no other version, no disable, no pin change, in the table, the
  selection bar, the context menu and the detail pane, and the Rust side refuses such edits too. The new
  "Override" switch in a profile's general settings lifts the lock for that profile, with the risk spelled
  out.

- Local mods (imported zips) carry their icon, description, website, readme and changelog, read from the
  zip; mods imported earlier get their metadata on the next start.

- Optional mods: a per-mod mark in a profile ("Optional" in the context menu and the detail pane) for mods
  that are not required to play on the server. An admin's marks travel in the published lock; on a player's
  side such mods show as "Optional" (recommended by the server), stay theirs to keep, change or remove,
  arrive with the first adoption of a link and are offered again by the transfer assistant ("Recommended by
  the server": install or skip). The companion passes the mark through and installs them as before.

- Updates from a private repository: Settings → Updates has a field for a GitHub access token with read
  access to the app's releases. With it, the update check and the download go through the GitHub API
  (the public download links of a private repository do not work); without it, nothing changes. The token
  stays in the local settings file.

### Fixed

- A mod whose maintainer moved to Hexium (deprecated on Thunderstore, newer releases on Hexium) no longer
  shows as deprecated and no longer falls under the default "hide deprecated" filter: deprecation follows
  the store with the newer release, and on a tie both stores have to say so.
- A mod the server dropped was never uninstalled: the comparison counted it as the player's own extra and
  reported "in sync". It is now its own kind of difference ("the server removed it, adopting uninstalls
  it"), for players and admins alike, on both transports.
- Server mods no longer show "update available" and "Update all" leaves them alone: adoption pins them to
  the server's version, as the server-managed-mods spec always said.
- Adopting over a companion address now remembers the adopted state like a sync code does; adopting a sync
  code whose server has not published a mod list yet is refused instead of emptying the profile.
- Publishing a profile with a mod whose team name contains a hyphen (`LVH-IT-…`) or a pre-release version
  failed on the companion ("invalid mod entry"). The lock now carries namespace and name next to the id,
  and the companion accepts both.

### Changed

- The profile manager is built from the app's own parts (setting rows, section labels, segmented switches,
  status dots): the cards and the detail tabs now share spacing, type and colors with the Settings page and
  the toolbar instead of carrying their own.
- `bun run mock` starts the DEV app together with the browser preview on one dev server; the preview now
  wears the DEV colors and badge like the DEV app. `bun run mock:web` is the browser preview alone.
- The companion lives in this repository (`apps/companion`). `install.sh update` moves an installation made
  from the old companion repository to this checkout: only the `build:` block of `compose.companion.yaml`
  changes, the previous file is kept, the game container is not touched.

## [0.3.1] - 2026-10-14

### Added

- Invite links: the companion's page and the publish dialog ("Copy invite link") hand out a link that
  opens the Mod Manager with the server's sync code and name (`valheim-mod-manager://import?code=…`), or
  a static page (`web/join.html`) that does, when the companion is told where that page is published.
  Pasting the companion's address asks it for its sync code, so players never need the address afterwards.
- A linked profile keeps the player's own mods. Adoption writes the server's mods (shown as "From the
  server" in the list) in the server's versions, removes what the server dropped and leaves everything
  else alone. "In sync" means every server mod is there in the server's version; a player's extra mods
  are no difference and no longer prompt. Profiles adopted by 0.3.0 are read as the server's full list
  once, so their next adoption behaves as before (`docs/specs/2026-10-14-server-managed-mods.md`).

### Changed

- DEV build: own scheme `valheim-mod-manager-dev://`, so the test companion's button opens the DEV app
  and never the installed one. `dev/dev-app.ps1` starts it against the test stack and `dev/drive.mjs`
  steers it over CDP; they replace `dev/spike-gist.ps1` and `dev/spike-drive.mjs`.

## [0.3.0] - 2026-10-13

### Added

- Sync through a sealed GitHub gist: link a profile with the sync code the admin hands out (alone or at
  the end of the companion's address, in "Link server…" or "Add server…"), compare, adopt and publish
  without an open port. Publishing picks when the server applies (now, when nobody is online, at a time,
  or stage only); the server's answer shows up in the publish dialog.
- Server chip in the toolbar: transport, name, state (in sync, what differs, release waiting, unreachable)
  and role (admin with a stored token, or read only). The diff dialog offers admins "Publish my profile
  instead…". The linked server is re-checked every five minutes.
- DEV build (`npm run dev:app`, `npm run build:dev-app`) with its own data folder, a DEV badge and a cyan
  accent, plus a scripted scenario against the test companion (`dev/spike-gist.ps1`, `dev/spike-drive.mjs`).

### Fixed

- A disabled mod is no longer offered to the server as "will be installed"; check, diff and publish see
  enabled mods only (both transports).
- Adopting a server no longer lists the server's dependencies as the player's own mods: they stay pinned to
  the server's versions but show up as dependencies, like in the admin's profile. Publishing the adopted
  profile reports them as dependencies again.
- Configs belong to the server: "in sync" means mods and versions, config differences are no longer
  reported or compared. A profile created from a server takes its config files once (checkbox in "Add
  server…"); publishing sends no configs unless asked.
- The toolbar chip and the status bar now say the same thing about the server, in the same words, and the
  server name is never empty. A player whose profile differs is sent to adopt before being told about a
  waiting release; linking a profile that differs opens the comparison right away, with "Adopt server
  versions" / "Keep my profile" outside of Play.
- GitHub's rate-limit answer on publishing names the bucket and the reset time instead of "HTTP 403".

### Changed

- Dependencies: reqwest 0.13, sha2 0.11 with hkdf 0.13, base64 0.23, winreg 0.56, tokio 1.53.2, marked 18,
  jsdom 30 (Dependabot #5, #7 to #12). TypeScript stays on 6 until SvelteKit's peer range allows 7.

## [0.2.0] - 2026-10-11

### Added

- Installation readiness: a persistent banner, a red status-bar marker and a "start anyway?" question on
  Play when mods of the active profile are not installed; dependency rows show the missing state too.
- Linked servers (companion container, see `docs/specs/2026-10-10-server-companion-design.md`):
  "Add server…" from an address, deep link `valheim-mod-manager://import?…` from the companion's page,
  comparison with the server before Play and at app start ("adopt and start", "into a new profile", "start
  anyway", optionally with the server's configs), publishing as a staged release (pull and check on the
  server, then apply now, when nobody is online, or at a time).
- Profile snapshots: before a profile is rewritten from a server, its mod list, installed.json and configs
  are copied to `<profile>/.snapshots/` (ten kept).
- Readme, changelog and wiki of a mod in the detail panel (tabs next to "Details"), with a wide reading
  view for image-heavy modpack pages. Links open in the system browser; readme and changelog are cached per
  version. "Thunderstore ↗" stays for everything else.
- Every import (code, `.r2z`, server, r2modman migration) asks whether all mods and dependencies should be
  downloaded, installed and enabled right away (on by default). Off creates the profile as exported, nothing
  is downloaded until "Install now" on the Installed page.
- "What changed" before every mod update: the changelog slice between the installed and the new version,
  for one mod or for "Update all"; the update runs only after confirmation.
- Pinned versions: picking an older version pins the mod, update detection and "Update all" skip it, the
  list shows a pin and the context menu toggles it.
- Dependants: "Used by" in the detail panel, as a hidden browse column, a filter and a sort key, computed
  from the index without extra requests.
- Config editor: slider plus number field for BepInEx value ranges, "Reset to default", leftover entries
  the mod no longer binds are marked.
- Server comparison marks server-side mods missing on the server (they cannot work) and client-side mods
  that do not matter there.
- Thunderstore package links inside a readme open the package in-app instead of the browser.
- Publish a profile as a Thunderstore modpack: manifest, generated README, icon, changelog and optionally
  the config files, validated by Thunderstore, uploaded and submitted with a team service-account token
  (Settings → Thunderstore).

### Changed

- The mod index comes from Thunderstore's `package-listing-index` (the deprecated `/api/v1/package/` stays
  as fallback); an unchanged index is detected without downloading it, chunks retry once.
- Mod downloads retry once before a mod is dropped from the sync.
- Readme and changelog caches expire after a week (authors can edit them on Thunderstore).
- A real Content Security Policy for the app window (scripts only from the app, no frames or objects).
- Dependencies resolve to the newest version in the index; a manifest's dependency version is a minimum.
  Explicit profile entries stay pinned.
- Health hints (deprecated, older than the game update) now cover resolved dependencies, not only explicit
  mods.

### Fixed

- Layout at the minimum window size (1100 × 680) and with the German catalog: tables drop columns by
  priority instead of letting text overlap, the detail panel stacks its buttons and stats, the selection
  bar wraps, settings and config rows collapse on narrow panes, status-bar entries truncate, dialogs never
  grow taller than the window, and scroll containers reserve their gutter so an appearing scrollbar no
  longer shifts content. `dev/screenshot.mjs` and `dev/layout-audit.js` verify this in the mock preview.

## [0.1.0] - 2026-10-09

First public version.

### Added

- Thunderstore browsing with include/exclude list filters, range filters with histograms, filter tokens,
  saved views, a sort menu and a column picker.
- Profiles: create, switch, clone, rename, delete, repair; r2modman-compatible import and export (code and
  `.r2z`).
- Dependency resolution with BepInExPack handling, background sync with parallel downloads and a shared
  download cache, per-mod enable/disable, updates per mod or for all.
- Launch via Steam with mods or vanilla; doorstop files are synced into the game folder on Play.
- Local mods (`.zip`/`.dll`) via file picker or drag and drop.
- BepInEx config editor and live log viewer.
- Tables with configurable columns (visibility, order, width, density) and explorer-style multi-select.
- English and German interface with system-language detection.
- Browser preview with a mocked backend for UI development.
- Migration from r2modman and the Thunderstore Mod Manager (profiles found automatically, configs included).
- Health hints for the active profile: duplicate DLLs, deprecated mods, mods older than the last game update.
- Signed auto-updates with an opt-out, and a portable build that keeps data next to the executable.
- Built on SvelteKit 3, Svelte 5, Vite 8 and Tauri 2.
