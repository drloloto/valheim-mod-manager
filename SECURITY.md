# Security

## Reporting

Please do not open public issues for security problems. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability") on this repository. You will get a response within a few days.

## Scope

Things that matter here:

- Path traversal when extracting mod zips or writing config files (the core guards against it; see
  `safe_join` and `zip_entry_parts` and their tests).
- Anything that could run code from a downloaded package outside the profile folder.
- Handling of profile codes and `.r2z` files from untrusted sources.

The app downloads mods from Thunderstore over HTTPS and runs them in your game; what a mod does inside the
game is outside this project's control.

## Releases

Installers are built by GitHub Actions from tagged commits and are currently not code-signed. Verify that you
download from this repository's Releases page. Update packages are signed with the project's minisign key
(public key in `src-tauri/tauri.conf.json`) and verified by the updater before installation.
