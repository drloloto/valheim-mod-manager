# App updates from a private GitHub repository

Date: 2026-10-20. Status: implemented, part of 0.4.0.

## Why

The owner keeps the repository private for now but wants friends to receive updates. The Tauri updater
reads `latest.json` from `github.com/<repo>/releases/latest/download/…` and downloads the installer from the
`releases/download/…` link in it. A private repository answers both with 404 unless the request carries a
token, and even then GitHub serves release assets only through its API
(`api.github.com/repos/<repo>/releases/assets/<id>` with `Accept: application/octet-stream`), not through
the download links. A header alone would not do.

## Decisions

- **One field, Settings → Updates: "GitHub access token"** (`Settings.github_token`, local settings file,
  like the Thunderstore token). Empty means the public path, unchanged.
- **With a token the core does the check** (`appupdate.rs`, commands `check_app_update` and
  `install_app_update`; the UI no longer calls the updater plugin directly): the GitHub API lists the latest
  release, the updater is built with the manifest's asset API URL as its endpoint plus `Authorization` and
  `Accept: application/octet-stream`, and the update it returns gets its `download_url` swapped for the API
  URL of the asset with the same file name. Signature verification, install and restart stay the plugin's.
- **Errors say what the token lacks**: 401 (rejected), 404 (no access to the releases or no release),
  anything else with the status.
- **The token is a plain read token** the maintainer hands out (fine-grained, Contents: read on this
  repository, or a classic token with `repo`). It is shared knowledge between friends, not a secret of the
  app; whoever has it can read the repository.

## Not in this change

- Storing the token in the Windows credential store.
- The portable build (no updater).

## Verification

- Rust: `appupdate::tests` (download URL → asset API URL by file name), `cargo test` green.
- `vp run ci` green; the Settings page in the mock preview shows the field under Updates.
- A real round trip (private repository, token, released 0.4.x → 0.4.y) is the owner's test after the tag:
  the first release built by the workflow is what a private check reads.
