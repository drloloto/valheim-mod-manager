# Gist sync as a first-class server link

Date: 2026-10-12. The spike on `spike/gist-sync` (spec and result: `../../../../spike-sync/CLIENT-SPIKE.md`)
showed that a profile can follow a server through one sealed GitHub gist instead of an open companion port:
the companion writes `server.json`, the admin's Mod Manager writes `release.json`, both AES-256-GCM sealed
with a key derived from the sync code. Read, adopt, publish and the companion's status report work end to
end against the test stack. This spec turns the spike into the product feature on the client side.

## Decisions

1. **One link, two transports.** `ServerLink` keeps `url` + `token` (HTTP companion) and `sync_code` +
   `gist_token` (gist). A link has exactly one transport: a sync code drops the URL. Everything above the
   transport (check, diff, adopt, publish, pre-play gate, status) is shared; only `gist_of()` decides.
2. **A sync code is accepted wherever people paste it**: alone, at the end of the companion's address
   (`http://host:9002/vmm1.…`), in the address, token or sync-code field of "Link server…", and in "Add
   server…". `find_sync_code` is the single parser; the first attempts of the owner proved that any other
   rule produces 401s.
3. **The server only ever sees enabled mods.** Check, diff and publish on both transports are built from
   `server_mods()`; a disabled mod is neither "to be installed" nor part of a release.
4. **Server status lives in the toolbar.** A chip after the section tabs shows, left to right: transport
   icon (cloud = gist, server = companion URL), server name, state with a dot (checking / in sync /
   "2 mods · 26 configs differ" / "release staged" / unreachable), and the role: **admin** (a token is
   stored, publishing possible) or **read only** (players). Clicking opens the publish dialog for an admin
   with something to do, the diff dialog otherwise, and re-checks when unreachable. The tooltip names the
   transport and what differs. The status-bar entry stays as the short form.
5. **The diff dialog offers the admin's way out.** Next to "adopt" and "start anyway", an admin gets
   "Publish my profile instead…", because for the admin a difference usually means the server is behind.
6. **Background re-check every five minutes** for the active profile while the app is open. Gist reads go
   through the ETag cache (a 304 is free on GitHub's side); HTTP checks are LAN calls.
7. **Rate limits are named.** A 403 with an empty bucket tells the admin which bucket (`gist_update`, 100
   writes per hour per user, shared with the companion) and when it resets. The companion side writes
   `server.json` only when the server changed (fixed in `../companion` on 2026-10-12).
8. **Dev build and scenario stay.** `tauri.dev.conf.json`, `dev/spike-gist.ps1` and `dev/spike-drive.mjs`
   are the regression check for this feature against the test companion; they are not part of the release.

## Out of scope (client)

- Companion UI for creating the gist and handing out the sync code, token handling on the server, write
  back-off: `../companion` (its spike files are still uncommitted there).
- Discarding a staged release over the gist (needs the companion UI).
- Automatic config sync without a release.

## Merge

The branch `spike/gist-sync` was merged into `main` as one feature on 2026-10-13, after the owner had used
the toolbar chip and the add-by-code flow in the DEV build against the test companion. No data migration:
old links deserialize unchanged. The DEV build and the scenario scripts stay as the regression check.
