# Valheim Mod Manager

A fast, standalone mod manager for Valheim on Windows. It replaces r2modman for the local game: browse
Thunderstore, build profiles, let dependencies resolve themselves, launch through Steam with mods or vanilla.
No server, no Docker. Start the app and play.

> **Built with AI.** This project is developed with AI coding agents (Claude Code) driving the implementation
> and a human owner setting direction, reviewing and testing against the real game. See
> [docs/ai-development.md](docs/ai-development.md) for how that works and what it means for contributors.

**Status:** early, pre-1.0. Windows + Steam only. Expect rough edges and report them.

## Features

- **Browse Thunderstore** with a real filter system: include/exclude lists (status, category, author, profile,
  dependencies, flags) and range filters with histograms (updated, created, downloads, rating, size,
  dependency count). Active filters show as tokens; filter sets can be saved as views.
- **Profiles:** create, switch, clone, rename, delete, repair. Each profile is a complete `BepInEx/` folder.
- **Dependency resolution** including BepInExPack; installs run in the background with parallel downloads
  and a shared zip cache.
- **Updates** per mod or all at once; mods can be enabled and disabled individually.
- **Play** with mods or vanilla. The game folder stays clean: only `winhttp.dll` and `doorstop_config.ini`
  are placed there, and Steam receives the doorstop arguments that point at the profile.
- **r2modman-compatible sharing:** import and export profiles as a code or `.r2z` file.
- **Local mods** (`.zip`/`.dll`) via file picker or drag and drop.
- **Config editor** for BepInEx `.cfg` files (user configs are never overwritten by updates).
- **Live log** with level filter and search.
- **Tables** with configurable columns (show/hide, drag to reorder, resize, density) and explorer-style
  multi-select (click, Ctrl/Shift+click, Ctrl+A, arrow keys, Delete, right-click menu).
- **English and German** interface; the language follows the system by default.
- **Migration** from r2modman and the Thunderstore Mod Manager: existing profiles are found automatically and
  imported with their configs.
- **Health hints:** duplicate DLLs across mods, deprecated mods, mods last updated before the current game
  update.
- **Auto-update** with signed releases (one check at startup, install on confirmation) and a **portable**
  zip that keeps all data next to the executable.

## Install

Download the latest installer (`.msi` or `.exe`) from the
[Releases](https://github.com/drloloto/valheim-mod-manager/releases) page. The binaries are not code-signed
yet, so Windows SmartScreen will warn on first start; choose "More info → Run anyway". Installed versions
check for updates once at startup (can be turned off) and install them only when you confirm; update
packages are signed and verified before installation.

**Portable:** download `valheim-mod-manager-<version>-portable-win64.zip`, unpack it anywhere and run the
executable. The `portable` file next to it keeps profiles, cache and settings in a `data` folder in the
same place. Portable builds do not self-update; replace the executable with the next zip.

**Coming from r2modman or the Thunderstore Mod Manager?** Open the profile menu → "Import from r2modman /
TMM…". Your profiles are listed and imported with their configs; the originals stay untouched.

Requirements: Windows 10/11, Valheim installed through Steam, WebView2 (included in Windows 11, installed
automatically on Windows 10 when missing).

## How it works

Every profile lives in `%APPDATA%\io.github.drloloto.valheim-mod-manager\profiles\<name>\` with its own
`BepInEx/` tree. When you press Play, the app syncs the doorstop files into the Valheim folder and starts the
game via `steam.exe -applaunch 892970` with `--doorstop-target-assembly` pointing at the profile. Switching
profiles therefore copies nothing; the profile folder itself is the mod installation.

The Thunderstore index (~7,000 packages) is fetched once, compacted by the Rust core, cached on disk and kept
in memory. The UI receives a slim JSON and filters it locally in a single pass per keystroke.

## Tech stack

| Layer   | Technology                                                                                   |
| ------- | -------------------------------------------------------------------------------------------- |
| Shell   | [Tauri 2](https://tauri.app) (Rust, WebView2), custom title bar, persisted window state      |
| Core    | Rust: Thunderstore index, dependency resolver, installer, sync worker, r2modman share format |
| UI      | [SvelteKit 2](https://svelte.dev) as an SPA, Svelte 5 runes, TypeScript                      |
| Styling | Tailwind CSS 4 with design tokens, [shadcn-svelte](https://www.shadcn-svelte.com) primitives |
| Data    | Thunderstore API (`/c/valheim/api/v1/package/`), legacy profile API for share codes          |
| Tests   | Vitest (frontend logic), `cargo test` (core), svelte-check, clippy, Prettier, rustfmt        |
| CI      | GitHub Actions: checks on every push, Windows installers on tags                             |

See [docs/architecture.md](docs/architecture.md) for the module map, the IPC surface and the data layout.

## Development

This repository is a Bun workspace on the Vite+ toolchain: the Mod Manager in `apps/client`, the server
companion in `apps/companion`, the shared design system in `packages/ui`. Prerequisites: Node.js 22.18+, Bun 1.4+,
Rust (stable, via rustup), the Tauri prerequisites for Windows (MSVC Build Tools, WebView2).

```bash
bun install                                   # the whole workspace
bun run --cwd apps/client tauri dev           # desktop app with hot reload
bun run --cwd apps/client tauri:build:local   # installer (.msi / .exe) in apps/client/src-tauri/target/release/bundle, unsigned
bunx vp run ci                                # every check, test and build, Rust included (cached)
```

**Signed builds:** `bun run --cwd apps/client tauri build` additionally produces the updater artifacts and therefore needs the
updater private key: set `TAURI_SIGNING_PRIVATE_KEY` to the content of the key file (and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has a password; the `_PATH` variant is not honored by the current CLI). CI does this through repository secrets; for a
local installer use `tauri:build:local`.

**Dev session:** `bun run mock` starts the DEV app (own data dir, cyan accent) and, at `http://localhost:1420`,
the same UI in the browser on a mock backend (`apps/client/dev/mock-tauri.js`: 3,000 sample packages and a
fake profile). `bun run mock:web` is the browser part alone, no Rust toolchain needed. The mock is never part
of a build.

**Component showcase:** `/dev/kit` in the dev server shows every kit component with sample data.

Conventions, the kit boundary and the test gates are described in [CONTRIBUTING.md](CONTRIBUTING.md).
AI agents start at [AGENTS.md](AGENTS.md).

## Localization

English is the reference catalog (`src/lib/i18n/en.ts`); German lives in `de.ts`. A test enforces that every
language has the same keys and placeholders. To add a language, copy `en.ts`, register it in `t.ts` and add
it to the language setting. Messages from the Rust core are English only.

## Contributing

Questions, ideas and show-and-tell go to
[Discussions](https://github.com/drloloto/valheim-mod-manager/discussions); bugs and concrete feature requests
are issues. Pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first; it covers
setup, conventions and how AI-assisted contributions are handled. Security issues go through
[SECURITY.md](SECURITY.md).

## Acknowledgements

[Thunderstore](https://thunderstore.io) hosts the mods and the API. [r2modman](https://github.com/ebkr/r2modmanPlus)
defined the profile format this app stays compatible with. [BepInEx](https://github.com/BepInEx/BepInEx) and
[Unity Doorstop](https://github.com/NeighTools/UnityDoorstop) make modding possible in the first place.

## License

[MIT](LICENSE). Not affiliated with Iron Gate, Coffee Stain, Thunderstore or Valve.
