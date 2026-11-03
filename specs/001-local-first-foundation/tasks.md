# Current delivery tasks

This is the current completion ledger. Slice plans retain historical review notes; checked items
below apply only to the stated boundary. The Jazz-only MVP is not complete.

## Completed milestones

- [x] Extract existing reusable Finance foundations and adopt them incrementally (library PR #10,
      Finance PR #45). See [extraction audit](finance-extraction.md) and [new-app guide](../../docs/next-app.md).
- [x] Implement and qualify explicit invitation redemption client contract/workflow: 33 unit tests,
      including immutable request capture; public consumer types and runtime pass.
- [x] Implement and qualify Jazz admission and exclusive transaction leaves: 18 adapter tests.
      Request admission is stubbed; actual bearer cryptography is not qualified.
- [x] Implement and qualify the server redemption owner: 71 tests covering policy decisions,
      interruption, expiry, replay/removal, settlement uncertainty and resource handoff.
- [x] Add a disposable notebook schema outside the package and qualify its native client access
      boundary: 15 policy tests. Private updates fail the SDK read guard; private inserts/deletes
      are rejected by authority. This is not a production schema or end-to-end security claim.
- [x] Review and simplify shared workflow/types/data option handling; preserve avatar drafts on
      persisted updates and generate unique profile form control IDs (commit 83cb658).

## Architecture review follow-ups

**Cleanup qualification status:** AR-01–AR-05 were implemented in merged PR #19. The user
then authorized regression qualification on 2026-11-03. The follow-up adds 38 unit cases and five
native Chromium IndexedDB cases, and fixes two reproduced retry/abort regressions in
[PR #20](https://github.com/delightful-labs/delightful-local-first/pull/20). Implementation-head
CI passed on `82cc5e4`; PR #20 is awaiting merge. No further scoped cleanup tasks remain before
[backup T006](../003-verified-backup/tasks.md#current-handoff-2026-11-03). See
[review evidence, migration notes and verification](cleanup-review.md#regression-qualification-completed).
Checked items cover these shared contracts; deployed Finance adoption remains separate.

These findings came from the architecture review of PR #12. The duplicate supplemental journal
was removed there; this follow-up retains the existing journal and SDK boundaries.

- [x] **AR-01 / P1 — Preserve unresolved creation outcomes during drain and binding replacement.**
      `src/lib/machines/workspaces/creation-owner.ts` discards child output/error in its closing and
      replacing branches before classifying settlement. Carry recovery facts and unresolved ownership
      to the supervisor; do not activate a replacement binding or imply clean shutdown on unknown
      settlement. Qualify both child completion and crash during replacement/shutdown, including
      pending commit and failed rollback, with no automatic replay or lost attempt identity.
- [x] **AR-02 / P1 — Keep incomplete absence distinct from mutation never started.**
      `creation-operation.ts` classifies absent reconciliation as recovered/notStarted, and
      `creation-persistence.ts` transacts on absent. Define evidence needed to authorize a retry;
      retain unknown fate after an issued write when only local/incomplete absence is available.
      Qualify restart after issuance, incomplete/offline replicas, matching accepted records and
      deliberate retries with stable IDs. No absent row alone may prove non-commit or trigger replay.
- [x] **AR-03 / P1 — Report actual journal abort evidence.**
      `src/lib/machines/workspaces/journal.ts` sends TX_ABORTED when tx.abort() throws. Preserve
      cleanup failure/uncertainty instead; only a real abort event or separately proven transaction
      fate may establish release. Qualify throwing/refused abort, late completion, blocked open and
      shutdown, ensuring no fabricated cancellation acknowledgement or leaked acquisition.
- [x] **AR-04 / P2 — Remove Finance-specific structural requirements from shared creation.**
      `creation-owner.ts`, `creation-operation.ts`, `creation-persistence.ts`, `initialization.ts`
      and `journal.ts` require organizationId/profileId/workspace.ownerId or Finance-style profile
      provenance. Replace these with minimal opaque identity and host-supplied projections/policies;
      keep financial schemas and provenance rules consumer-owned. Demonstrate an independent app
      without Finance-shaped records while preserving existing consumer recovery, atomicity and
      locally usable offline behavior. Review compatibility and migration before changing exports.
- [x] **AR-05 / P2 — Make the single-write local-durability contract explicit.**
      `forms/policy.ts` labels successful generic write promises locallyPersisted; `identity/profile.ts`
      accepts saveName/saveAvatar returning Promise<unknown>. Require an explicit persistence guarantee
      or receipt/settlement boundary, and use Jazz's real local wait rather than mutation return.
      Qualify a returned SDK receipt before local settlement, delayed/failed local persistence and
      interruption, so no Saved/local-durable result can appear early. Preserve distinct remote fate.

## Invitation redemption: next, in dependency order

- [ ] Implement the exact native read/stage mapping against the disposable host schema; present
      implementation for review before tests. Preserve the existing statechart's resource ownership.
- [ ] Qualify coherent authority reads, trustworthy absence, duplicate/corrupt record handling and
      the exact pinned transaction query shapes. Investigate the Finance transaction-tier discrepancy.
      Do not authorize from incomplete reads or hide outside-transaction orchestration in a leaf.
- [ ] Qualify atomic membership/consumption/evidence staging and concurrent redemption, including
      same/different accounts and operation IDs, stale revocation/role changes and phantom inserts.
- [ ] Qualify real bearer admission and verified write attribution with accepted/rejected credentials.
- [ ] Implement host-facing authenticated transport and status reconciliation, including ownership of
      unresolved native resources. Never serialize server capabilities or automatically replay unknown writes.
- [ ] Implement the invitation redemption composition, localized outcomes and host routing/fragment
      cleanup; qualify cancellation, accessibility and independent package consumption.

## Remaining collaboration and MVP delivery

- [ ] Invitation issuance, secure code generation/digest verification, sharing, explicit rejection,
      expiry and revocation workflows/compositions; preserve private code storage and service time.
- [ ] Authorized member removal and role administration with native app policy enforcement; preserve
      app-owned roles/grants and qualify removed-member/replay behavior.
- [ ] Qualify the complete invitation flow with two authorized identities and an unrelated identity,
      native security/concurrency, and browser transport/cleanup. Keep ordinary local usability
      available offline and with an unanswered authority.
- [ ] Finish the independent Jazz-only new-app MVP demonstration and integration documentation;
      audit all remaining spec acceptance criteria before declaring MVP complete.

The existing tests cover different layers and must not be summed into a claim of native invitation
correctness. Profile browser regressions for the recent draft/control-ID fixes are not yet added.
Full native acceptance gates are in [native-storage.md](workspaces/invitations/native-storage.md).
