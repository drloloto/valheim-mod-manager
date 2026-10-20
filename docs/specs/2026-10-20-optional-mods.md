# Optional mods: a per-mod flag that reads as "recommended by the server"

Date: 2026-10-20. Status: implemented on `feat/monorepo-viteplus`, part of 0.4.0.
Builds on `2026-10-14-server-managed-mods.md` (`managed`) and `2026-10-17-transfer-assistant-and-locks.md`
(cases, locks).

## Why

A profile today knows two kinds of mods: the server's (`managed`, locked, required to be in sync) and the
player's own. An admin cannot say "this one is nice to have, client-side, join without it"; a player sees a
server's client-side extras either as hard requirements or not at all. The owner asked for a checkbox per mod
in a profile that gives such mods their own status, readable as "recommended by the server", and said it does
not matter whether the companion also installs them on the server.

## The flag

`ProfileMod.optional` (profile.json, off by default) and `ManifestMod.optional` in the lock. One word
everywhere: **Optional**. It means: not required to play on the server; yours to keep, change or remove.

| where                       | what `optional` does                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| admin's profile, publish    | the checkbox is the admin's statement; `manifest_mods` copies it into the lock (explicit entries only, dependencies are never optional)                                                                                                                                                                                         |
| companion                   | passes the flag through its lock validation (`cleanMod`) and installs the mod as before. The lock hash is over id and version, so flipping the flag alone changes no hash                                                                                                                                                       |
| player's profile, adoption  | an optional lock entry never becomes `managed`: an entry the player already has stays theirs (unmanaged, unpinned) and gets the flag; a missing one is added as an optional entry in the server's version on the **first** adoption only (the link has no `last_adopted` yet), later adoptions leave the player's removal alone |
| diff / in sync              | optional lock entries count neither as "only on the server" nor as a version difference; dropped is only ever a `managed` entry                                                                                                                                                                                                 |
| locks                       | never: optional entries are not managed, so Override does not apply                                                                                                                                                                                                                                                             |
| transfer assistant, server  | its own case **Optional** ("Recommended by the server"): not in the target → Install or Skip (default Install for a target that never adopted, Skip otherwise); same version → nothing; other version → Keep yours (default) or Take the server's                                                                               |
| transfer assistant, profile | the flag travels with a copied entry; cases unchanged                                                                                                                                                                                                                                                                           |
| Installed table             | source "Optional" (between Server and Yours), its own filter segment when present, a check item "Optional" in the context menu (off for locked rows), a switch in the detail pane                                                                                                                                               |

## Decisions

- **Not a third lock state.** Optional entries behave like the player's own mods in every rule (updates,
  pin, remove, enable). The only server-flavoured behaviour is the first-adoption install and the assistant's
  offer. That keeps one vocabulary: Server = decided by the server, Optional = recommended, Yours = yours.
- **First adoption installs, later ones do not.** A player joining through an invite gets the recommended set
  without a dialog; a player who removed one is not nagged, the assistant ("Compare with server…") offers it
  again with Skip preselected.
- **A mod the server turns from required into optional** stays in the profile, becomes unmanaged, keeps its
  version and gets the flag. The other way round (optional → required) is the ordinary `add`/`same`/`version`
  path: it becomes managed.
- **Dependencies are never optional** in the lock, even when only optional mods need them: a few extra
  libraries on the server cost nothing, and the resolver on the player side follows the mods it has anyway.

## Not in this change

- The companion skipping optional mods on the server (the owner: does not matter).
- A per-player "declined" memory beyond the first-adoption rule.
- The companion's landing page marking optional mods.

## Verification

Done 2026-10-20:

- Rust: `server::tests::optional_lock_entries_are_recommended_not_required` (first adoption adds, a later
  one does not, required → optional keeps the entry unmanaged and unpinned, the diff ignores optional
  entries, `manifest_mods` carries the flag on explicit entries only and serializes it once),
  `transfer::tests::optional_server_mods_are_offered_not_imposed` (defaults for a fresh and a seasoned
  target, apply with defaults and with skip/take). `cargo test`: 102 green.
- Companion: `manifest.test.ts` (`optional: true` passes `normalizeManifest`, anything else is dropped).
- TS: `installed.test.ts` (source "optional", order, counts), `transfer-view.test.ts` (group order, summary
  counts an install or a version change only when taken).
- `vp run ci` green (13/13). `bun run mock:audit`: 5/5 pages, baseline findings only.
- Mock preview, German, 1100 × 680 (`apps/client/dev/out/optional/`): the Installed table with the Optional
  badge and filter and the detail pane's switch, the assistant with "Recommended by the server" for an
  existing target (skip preselected) and for a new profile (install preselected).
- Found on the way: a sixth filter segment did not fit the table pane at the minimum window; on a pane
  narrower than 900 px the optional mods file under "Yours" and the segment appears only on a wider pane.
  The badge in the table says "Optional" either way.
