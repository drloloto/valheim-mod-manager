# Optional mods — implementation plan

Spec: [2026-10-20-optional-mods.md](../specs/2026-10-20-optional-mods.md). Branch `feat/monorepo-viteplus`.
Status: all steps done 2026-10-20 (results in the spec's Verification section).

1. **Model and lock** — `models.rs::ProfileMod.optional`; `server.rs::ManifestMod.optional`; `manifest_mods`
   copies the flag from explicit entries; `diff` skips optional lock entries; `adopt(profile, manifest,
   add_optional)` (optional entries stay or are added unmanaged). Tests.
2. **Transfer** — `transfer.rs`: `SourceMod.optional`, `Case::Optional` for the server kind (choices per
   the spec), `apply` upserts taken optional entries and flags kept ones; the profile kind carries the flag.
   `commands.rs`: `adopt_server` passes `add_optional = first adoption`. Tests.
3. **Companion** — `manifest.ts`: `ManifestMod.optional?`, `cleanMod` passes `optional: true`. Test.
4. **Client types, store, view model** — `types.ts` (`ProfileMod.optional`, `ManifestMod.optional`,
   `TransferCase` "optional"); `installed.ts` source "optional"; `transfer-view.ts` (`CASES`, `summarize`);
   `store.setOptional(ids, on)`. Tests.
5. **UI** — `source-badge.svelte` style; `InstalledView` filter segment and context-menu check item;
   `PackageDetail` switch; `TransferDialog` labels for the Optional case. `en.ts`/`de.ts`.
6. **Mock** — optional entries in the profile, Optional items in `transfer_plan`.
7. **Verify** — `vp run ci`, `bun run mock:audit`, screenshots; CHANGELOG (0.4.0 Added); spec status.
