# Server-managed mods in a linked profile

Date: 2026-10-14. Status: implemented on `feat/companion-handoff`, ships with the next client release.
Complements `2026-10-12-gist-sync-integration.md` (the transport); this is what adoption does to a profile.

## Decision

A linked profile has two kinds of Thunderstore mods: the server's, and the player's own. Adoption
("Server-Versionen übernehmen") touches only the server's.

| entry                                  | adoption does                                                     |
| -------------------------------------- | ----------------------------------------------------------------- |
| listed by the server                   | written in the server's version, enabled, pinned, `managed: true` |
| `managed`, no longer listed            | removed (the server dropped it)                                   |
| not managed, not listed (player's own) | left exactly as it is                                             |
| local (imported zip)                   | left exactly as it is                                             |
| player's own, but the server lists it  | becomes the server's: version replaced, `managed: true`           |

`ProfileMod.managed` is the only new state. The UI shows it as "Vom Server" under the mod name and
never changes it (`set_mods` restores the flag on every round trip). A snapshot is taken before each
adoption, as before.

"In sync" means: every server mod is present in the server's version. A player's own extras are not a
difference and do not prompt. For an admin (a link with a token or gist token) an extra mod is unpublished
work and counts, as before (`server::in_sync`).

## Why not "the profile is the server list"

That was the behaviour until now, and it is what r2modman does on import. It made every player who added a
client-side mod (a minimap, a UI tweak) lose it on the next adoption and see "weicht ab" until then. The
server cannot tell client-side from server-side mods (there is no reliable marker in a package: not the
Thunderstore category, not the DLL without parsing IL), so the client does not try. The server's list is
enforced; whatever else a player runs is theirs, and if it needs the server it simply will not work.

## Migration

Profiles adopted by 0.3.0 carry no `managed` flags but were the server list in full. `adopt` recognises
them (link has `last_adopted`, no entry is managed) and reads every Thunderstore entry as managed once, so
their next adoption behaves exactly as 0.3.0 did. A profile linked but never adopted keeps its mods on the
first adoption. Nothing is migrated on disk; the flag appears when the next adoption writes it.

## Tests

- `server::tests::adopt_replaces_the_servers_set_and_keeps_the_players_own_mods`
- `server::tests::adopt_reads_a_profile_adopted_before_managed_existed_as_the_server_list`
- `server::tests::in_sync_ignores_a_players_own_mods_but_not_an_admins`
- `test/e2e.ps1` (workspace): invite link → DEV app links and adopts, unchanged expectations.
