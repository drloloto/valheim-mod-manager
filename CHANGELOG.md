# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
