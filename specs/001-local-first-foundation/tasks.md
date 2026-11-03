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
