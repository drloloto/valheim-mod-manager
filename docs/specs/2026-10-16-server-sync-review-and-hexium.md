# Server sync review and Hexium as a second package source

Date: 2026-10-16. Status: implemented on `feat/monorepo-viteplus` (plan:
`docs/plans/2026-10-16-server-sync-fixes-and-hexium.md`).
Builds on `2026-10-14-server-managed-mods.md` (adoption) and `2026-10-12-gist-sync-integration.md` (transport).

## Part 1: review of the install/uninstall path between companion and client

Read end to end: client `server.rs` (diff, adopt, in_sync), `commands.rs` (check_link, check_gist, adopt_server,
set_mods), `resolver.rs`, `sync.rs`; the store (`refreshServerStatus`, `checkAllServers`, `requestLaunch`),
`server-view.ts`, `ServerDialog.svelte`; companion `manifest.ts`, `releases.ts` (stage, refreshPlan,
applyRelease), `install.ts` (planChanges, applyManifest), `gistsync.ts`.

The companion side is sound: a release removes the files of every installed mod the lock no longer lists,
installed.json is rewritten, and the saved manifest is filtered to what is really installed, so a failed
download never shows up as "on the server". server.json (gist) is written from that manifest. Nothing to
change there for part 1.

The client side has the gaps that explain "a server mod stayed in the profile":

| #   | finding                                                                                                                                                                                                                                                                                                                                                             | effect                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `server::diff` does not know `managed`. A mod the server dropped lands in `only_local`, and `in_sync` ignores `only_local` for players. `server-view.ts` counts the same way.                                                                                                                                                                                       | No prompt, no adoption, the mod stays installed. The diff dialog, when opened by hand, lists it as "in your profile, not on the server" with no hint that adopting removes it.         |
| F2  | `adopt` writes managed entries with `pinned: false` (the spec says pinned) and `resolver::updates` only skips `pinned`/`implicit`.                                                                                                                                                                                                                                  | Managed mods show "update available" (the permanent warning triangles), "Update all" moves them off the server version, the chip says "differs", adoption reverts. A loop.             |
| F3  | `adopt_server` stores `last_adopted` only on the gist transport. The 0.3.0 migration in `adopt` (`legacy`: link has `last_adopted`, nothing managed) therefore never fires for URL links.                                                                                                                                                                           | A profile adopted by 0.3.0 over a URL keeps every mod the server has dropped since, as "own".                                                                                          |
| F4  | `adopt_server` on a gist whose server.json has `manifest: null` (companion before its first lock) takes `unwrap_or_default()` and adopts an empty list.                                                                                                                                                                                                             | Every managed mod is removed. Must be refused ("the server has no lock yet").                                                                                                          |
| F5  | A server mod the index does not know (delisted on Thunderstore, or Hexium-only) cannot be resolved: it is `only_server` forever and adoption cannot install it. `run_sync` keeps it as an explicit entry, so nothing is deleted, but the profile never reaches "in sync".                                                                                           | Today rare; with Hexium (698 packages Thunderstore does not have) the normal case. Part 2 carries the source in the manifest and merges both indexes, which removes this class.        |
| F6  | Package ids with a hyphen in the team name (`LVH-IT-UseEquipmentInWater` on Thunderstore, 28 packages on Hexium such as `bruceirons-team-ResponsiveCombat`) and pre-release versions (`0.10.6-rc.1`): the companion's `cleanMod` rejects them (the whole stage fails with "invalid mod entry"), `splitId` splits at the first hyphen, so the download URL is wrong. | Such a profile cannot be published. Fix: the manifest carries `ns` and `name` next to `id`; `cleanMod` accepts them and semver pre-release versions; `splitId` prefers the given pair. |

Not changed: ids stay case-sensitive everywhere (Thunderstore is), a disabled managed mod still counts as
"differs" and adoption re-enables it (the server requires it; the dialog says so), and a player's own mod the
server later lists becomes the server's.

### Decision: "dropped" is its own kind of difference

`ServerDiff` gets `dropped: Vec<ManifestMod>`: managed (or legacy-managed) entries the manifest no longer
lists. `diff` takes the profile, not only the resolved map. `in_sync` is false while `dropped` is not empty,
for players and admins alike. The diff dialog lists them as "{id}: the server removed it, adopting uninstalls
it"; the chip counts them. Adoption writes `pinned: true`; `updates` skips `managed`. `last_adopted` is
written on both transports (`<manifest hash>:<config hash>`, the companion's `/api/manifest` has both).

## Part 2: Hexium

[Hexium](https://hexium.gg) is a second Thunderstore-compatible package host. Verified live on 2026-10-16
against `valheim.hexium.gg`:

| endpoint                                                    | status                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/api/v1/package-listing-index/` → `package-listing-chunk/` | same shape as Thunderstore (gzipped JSON list of chunk URLs); 1 chunk                                       |
| `/api/v1/package/`                                          | same fields as Thunderstore's v1 list; `versions[].download_url` is the CDN file                            |
| `/api/experimental/package/{ns}/{name}/[{version}/]`        | same shape as Thunderstore's (also on `hexium.gg`)                                                          |
| download                                                    | `https://cdn.hexium.gg/uploads/{ns}/{name}/{version}.zip` (301 to the stored file); no `/package/download/` |

Overlap on 2026-10-16: 1 888 packages on Hexium, 13 396 on Thunderstore, 1 190 on both (by `owner-name`),
698 Hexium-only, 305 shared packages whose latest version differs (either side can be ahead). `uuid4`
matches for only 870 of the 1 190, so the id is the key, not the uuid. 832 dependency strings of Hexium
packages point at packages that only Thunderstore hosts, so one merged index is the only index that resolves
them. Hexium's categories differ: `Client-only` / `Server-only` / `Client & Server` / `Client (& Server)` /
`Modpack` / `Npc` instead of `Client-side` / `Server-side` / `Modpacks` / `NPCs`.

### What the competitors do (read, not copied)

- **Gale** (`competitor/gale`, GPL-3.0, so patterns only, no code): one `Backend` enum
  (`thunderstore | hexium`), one index struct per backend behind a `Thunderstore` facade that resolves an
  id against "prefer X, fall back to the other"; the profile stores the backend per mod; the r2x manifest
  entry carries `source` (default thunderstore) and an import falls back to the other backend when the stored
  one does not have the mod; the export code goes to Hexium when a profile has Hexium-exclusive mods;
  the game config lists which backends a game has. Markdown (readme/changelog) comes from the same
  experimental endpoints on either host.
- **ValheimModManager** (`competitor/ValheimModManager`, Python, no licence file: patterns only): one
  package cache per source, `source` column per installed package (`thunderstore | hexium | local | unmanaged`),
  "match installed to remote" tries the preferred source, then the one whose versions include the installed
  version; a category table maps both stores' server/client audience names.

### Decisions

1. **One merged index.** `thunderstore::fetch` fetches both listing indexes (each with its own
   change-detection blob URL, cached as before) and merges by id: versions are the union, deduplicated by
   version number with Thunderstore preferred, sorted newest first; categories are the union after
   normalising Hexium's names onto Thunderstore's; counts take the larger value. `Version` gains
   `src` (`thunderstore | hexium`) and `dl` (the download URL as listed; empty for Thunderstore, whose URL
   is derived). `Pkg` gains `srcs: Vec<Source>` and `hx_url` (the Hexium page), `url` stays the
   Thunderstore page when there is one. The slim index the browse page gets carries `srcs`.
2. **The profile does not change.** `ProfileMod.source` stays `thunderstore | local`: "thunderstore" means
   "a package store", resolution is by id and version. The resolver puts the chosen version's `src` into
   `Resolved`; `run_sync` downloads from that version's URL. No profile migration, old clients still read
   new profiles.
3. **The manifest carries the source.** `ManifestMod` gains `source` (`thunderstore` default, `hexium`),
   `ns` and `name` (F6); `hashMods` stays `id@version`, so hashes and `last_adopted` do not move. The
   companion downloads from the source it is told (Hexium's CDN pattern, the experimental API as fallback)
   and `takeover`/`reparse` try Thunderstore first, then Hexium. Clients older than this do not read
   `source` and resolve by id, which works for everything Thunderstore has.
4. **Adoption of a Hexium-only mod** needs the merged index; with Hexium turned off in the settings
   (`hexium: bool`, default on) the resolver reports "not in the index" and the diff dialog says to turn
   Hexium on. The r2x export writes `source: hexium` for Hexium-only versions (Gale's field); import reads
   it but resolves by id anyway.
5. **UI:** a source filter in Browse (`all | thunderstore | hexium`, a `srcs` token in the criteria), source
   badges and the "open on Hexium" link in the package detail, the Hexium toggle in Settings, and the
   readme link rule (`thunderstore-links.ts`) learns Hexium package URLs. The installed table's source
   column keeps its meaning (server / own / local / dependency); the store is shown by the badge in the
   detail panel only.

### Out of scope

Hexium accounts, publishing modpacks to Hexium, Hexium profile codes (`legacyprofile`), the companion
UI, and Thunderstore's `is_active` per version.

## Verification (2026-10-17)

The two checks step 14 of the plan left open, now scripted and run:

- **Live index refresh, Hexium on and off.** `cargo test hexium_refresh -- --ignored --nocapture` in
  `apps/client/src-tauri` refreshes into a temporary cache against both stores: 14,165 packages merged,
  689 Hexium-only, 1,213 in both stores; switching Hexium off rebuilds the index without them and the cache
  follows. Green.
- **Publish and adopt with a Hexium-only mod against the test stack.** `test/up.ps1 -SetupSync` on the
  snapshot lock (11 mods), then `POST /api/releases` with the lock plus `SAFADOS-SaveOnTime 1.0.1`
  (`source: hexium`, Hexium only, no dependencies beyond BepInEx): the companion downloaded it from Hexium
  ("downloaded SAFADOS-SaveOnTime 1.0.1", no problems), `apply` installed `plugins/SAFADOS-SaveOnTime/SaveOnTime.dll`,
  the lock now carries 12 mods with the store. `test/e2e.ps1 -Build` afterwards: the fresh DEV app adopted
  the 12 mods, the DLL came from Hexium (9,728 bytes), the app shows "in sync". PASS.

Found and fixed on the way: a cache from before Hexium (`pkgs` plus one blob URL) loads fine and counts as
fresh, so after the update the index stayed Thunderstore-only until the TTL ran out, and adopting a lock with
a Hexium mod failed with "Package not found". `Index::lacks_hexium` now makes the worker refresh such an
index regardless of its age, and `ensure_index` merges Hexium in before answering a command, so the first
adoption after the update resolves. The e2e script polls for the adopted profile instead of waiting a fixed
15 s, because that first adoption now includes the merge. Also: after `bun run mock` (`tauri dev`) the debug
exe expects the dev server on port 1420; `e2e.ps1 -Build` restores a standalone one (noted in `AGENTS.md`).
