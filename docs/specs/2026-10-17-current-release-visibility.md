# The current release, visible

Date: 2026-10-17. Status: implemented on `feat/monorepo-viteplus`.
Builds on `2026-10-16-server-sync-review-and-hexium.md` (the sync) and `2026-10-12-gist-sync-integration.md`
(the gist transport).

## Why

The client told the admin and the players a lot about the _next_ release (staged, scheduled, applied, failed)
and nothing about the _current_ one: which release the server actually runs, since when, and what it is
called. Releases only had an id (`r` + base36 time). The owner asked for transparency about the current
release, "at least the name".

## Decisions

- **A release has a name.** The client sends the profile's name with every publish: `StageBody.name` on the
  HTTP transport, `release.json.name` on the gist (next to the existing `message`). The companion keeps it on
  the pending release (`Release.name`, capped at 80 characters) and in the summary. Edits from the web UI have
  no name; the client shows "Edited in the web UI" for them. Older release files without a name show
  "Unnamed release".
- **The lock remembers the release that produced it.** `applyRelease` writes `manifest.release = { id, name,
  appliedAt, source }` (`source` = client | web | gist, the release's `modsFrom`). `loadManifest` keeps it
  (`cleanRelease`), a lock from before this change or from a takeover simply has none.
- **One field everywhere.** `GET /api/manifest` carries it as part of the lock, `GET /api/status.manifest.release`
  and `server.json.manifest.release` repeat it, so both transports see the same thing. The client's
  `ServerCheck.current` holds it; `releaseLabel()` in `server-view.ts` renders the one line used everywhere:
  "`<name> · <id> · applied <relative time>`", or "No release recorded yet …".
- **Where it shows.** The server chip's tooltip (first line), the server dialog (publish, difference and
  in-sync views, under the heading), the profile manager's Server & Sync tab (row "Current release"). The
  status bar stays as it is: the state vocabulary there is about differences, not provenance.
- **Change detection on the gist** includes the release reference, so re-applying the same mods under a new
  release still publishes a fresh `server.json`.

## Not in this change

- The companion's own landing page does not show the release yet (it lists the lock's mods). Worth adding
  when the page is next touched.
- A free-text release name typed by the admin. The profile name is the name; a message field exists on the
  gist transport already and could carry more later.

## Verification

- Companion: `bun test src` (`cleanRelease` keeps a well-formed reference and drops the rest).
- Client: `cargo test` (`Manifest` parses `release`, older locks without it), `vp test` (`releaseLabel`),
  `vp run ci`, the profile manager and server dialog in the mock preview (the mock's server check carries a
  current release).
