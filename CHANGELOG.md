# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Installation readiness: a persistent banner, a red status-bar marker and a "start anyway?" question on
  Play when mods of the active profile are not installed; dependency rows show the missing state too.
- Linked servers (companion container, see `docs/superpowers/specs/2026-10-10-server-companion-design.md`):
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

### Changed

- Dependencies resolve to the newest version in the index; a manifest's dependency version is a minimum.
  Explicit profile entries stay pinned.
- Health hints (deprecated, older than the game update) now cover resolved dependencies, not only explicit
  mods.

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
