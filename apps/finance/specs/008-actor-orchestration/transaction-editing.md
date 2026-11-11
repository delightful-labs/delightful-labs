# Transaction editing ownership

Status: implementation reviewed and verified. The editing slice of D005/D006 is complete;
avatar preparation remains unfinished.

## Model before effects

The edit integration is the only production caller of `data.ts:updateTransaction`. Its callback
transaction hides queries, eligibility decisions, updates, tag reconciliation, check-detail checks,
commit and settlement. Replace it with one resource-owning machine invoked by the existing scoped
form write boundary. Jazz binding, subscriptions and teardown remain in the integration/controller.

```text
edit integration → scoped form → submission → prewrite readiness → edit persistence
                                                                └── one Jazz transaction

validate → open → read transaction → eligibility → read relationships → check details
         → plan tag/row changes → stage → commit → local settlement → succeeded
```

Each precommit stage has an interruption gate. Retain acquisition and reads until they resolve;
then rollback on cancellation, scope replacement or shutdown. Retain rollback until it settles.
After commit is issued, drain local settlement. Preserve interruption priority and report actual
settlement: no acquisition is `notStarted`, confirmed precommit rollback is `rejected`, successful
local settlement is `locallyPersisted`, and false/rejected rollback or postcommit failure is
`unknown`. Separate success, failure, cancelled, scope-changed and closed final states clear inputs
and resources. Creation and editing remain separate domain owners; no generic transaction framework
is needed merely because their SDK cleanup protocol is the same.

## Guarded invariants and planning

- Read the captured transaction ID in the owned transaction before any mutation. Reject missing,
  wrong-workspace, wrong-kind or mismatched-provenance rows. Imported transactions
  are editable under the same current account authority; source and provider ID remain immutable. Preserve the existing restriction against check
  payment conversion and moving an existing check to another account.
- Read tag links, scoped tags (including archived tags) and check details as one related snapshot.
  For check input, require exactly one details row matching the existing `checkDetailsId`.
  Non-check input must have no check-detail rows. These are guarded transitions before staging.
  The read adapter converts synchronous query throws into rejected reads and awaits all issued
  queries with `Promise.allSettled` before propagating failure. Its result unwrapping is SDK error
  handling, not another business eligibility decision.
- Plan retained/removed/new tag assignments without writing. Preserve unresolved historical links.
  Retain explicitly selected historical names, including archived assignments; only new assignments
  require an unambiguous active tag or a newly planned tag. Preserve existing tags' categories.
- Compute normalized transaction updates, optional check updates, deletions, new tag IDs and link
  inserts before staging. Keep organization/kind/source identity and check-link invariants intact.
  Check edits retain optional payer/bank/check-memo metadata under existing behavior.
- Stage the decided changes in the same transaction, then commit once and await the SDK handle's
  local settlement. Promise actors perform individual reads/effects or pure preparation; they must
  not hide read/check/write callbacks or another orchestration workflow.

The installed Jazz begin/commit/rollback semantics were inspected for the creation slice and apply
to the same SDK here. Commit can reject through its handle; cancellation cannot undo an issued
write. Fresh shared form readiness still checks submitted intent and original scope before the
resource owner starts. SDK authorization continues to enforce actual writes.

## Focused implementation scope

1. New `src/lib/machines/transaction-edit-persistence.ts`: domain checks, planning and resource owner.
2. `src/lib/machines/transaction-entry.ts`: separate edit/create composition functions using the shared
   readiness policy, while retaining existing edit draft comparison and creation navigation.
3. `src/lib/components/TransactionEditEntry.svelte`: invoke edit composition with the bound database.
4. `src/lib/data.ts`: remove the obsolete update workflow and its now-unused imports.

The implementation was reviewed before coverage was added or run. Relevant verification covers
historical tags, ambiguity, check invariants, atomic staging, acquisition/read interruption, rollback
and settlement failures, scope changes and offline repeated edits. Creation tests remain relevant
because composition shares the domain policy; avatar preparation stays separate.

## Implementation review

The four-file production migration is implemented. Create/edit form factories now have separate
typed persistence dependencies while sharing the same readiness/schema composition. The edit
integration supplies its bound database; there is no production update promise callback or manual
actor bridge. Original draft equality, historical baseline conversion, retained form success and
creation navigation behavior remain in their existing boundaries.

Recursive actor/helper review found validation and planning to be synchronous transformations,
the relationship read to be one fully drained SDK snapshot read, and staging to materialize an
already-decided write plan. Transaction acquisition, current-row read, guarded eligibility,
relationship read, guarded check compatibility, planning, staging, commit, settlement and rollback
are visible stages. No write is staged before all domain checks succeed.

## Approved verification

The former `updateTransaction` helper cases now test the real edit persistence machine, using a
shared SDK-effect fixture and typed transaction/relationship rows. The old callback-transaction test
scaffolding was removed. Form tests now use the separate edit factory with the bound database.

All 336 relevant unit tests pass across 16 files. After correcting fixture metadata types, a focused
rerun of the two changed machine-test files passed all 88 cases. Coverage includes archived and
unresolved assignments, ambiguity for new names versus retained historical names, ineligible tag
reuse, normalized updates, check conversion/account restrictions, missing/duplicate/mismatched check
details, retained optional check metadata, precommit cancellation, acquired-resource retention,
rollback failures, postcommit settlement, shutdown priority and original transaction-ID invalidation
through switching away and back. Both rejected and synchronously thrown relationship-query failures
are verified to wait for the other issued reads before rollback.

`pnpm check` passes with zero errors/warnings. `pnpm check:tests`, Prettier and `git diff --check`
also pass; the former fixture diagnostics are resolved. No production fixes were needed during
verification.

All 32 relevant Playwright checks pass on disposable in-memory Jazz storage: nine form-presentation
checks, eight transaction-edit checks and 15 transaction-workspace checks. These cover repeated
offline edits, reverted drafts, archived-tag retention/removal, check details and payment-conversion
restrictions, read-only historical transactions, plus desktop/mobile creation, cancellation,
pagination/reload and repeated offline sample batches. Creation and shared-form regressions were
included because both composition factories share readiness/schema policy. No browser assertions
needed changes in this cycle.

## Imported transaction editing model

User-approved behavior: imported income and expenses support editing category,
tags, description and memo along with the existing transaction fields. Preserve
source/externalId, row identity and workspace; preserve imported income’s absent
payment method. Do not fabricate a manual source or cash payment. Existing check
conversion/account restrictions remain until the separate check-domain redesign.

Reuse the existing scoped edit owner and transaction-owning child. Validation
binds provenance from the observed transaction, never submitted form fields.
Readiness withdraws capability for invalid references or unusable provider identity.
The persistence machine remains validate → open → read transaction → guarded
eligibility (scope/kind/provenance/check compatibility) → read relationships →
guarded detail compatibility → plan → stage → commit → local settle. Precommit
interruption drains issued reads and rolls back; issued commits settle before
reporting cancellation/scope change/shutdown. Promise actors remain individual
leaf operations; no new workflow is hidden in an async helper.

Jazz update policy rechecks immutable workspace/kind/source/externalId, including
direct writes. The existing bank importer’s findingExisting transition skips a
known stable provider row without updating it, preserving user edits and preventing
duplicate imports. No importer writes or provider requests change in this slice.

Four implementation files: validation/transactions.ts, machines/transaction-entry.ts,
machines/transaction-edit-persistence.ts and permissions.ts. No UI strings, schema
changes or actor lifetime changes. Review before adding/running coverage for
imported income/expense edits, trusted provenance, unchanged/reverted drafts, tags,
repeat-import preservation, direct-write provenance changes and existing manual/
check/authorization regressions.

Implementation ready for review: the four planned production files now bind
observed provenance, accept imported edit variants, retain pristine/reverted
imported-income drafts, and enforce immutable workspace/kind/source/externalId.
The persistence write plan never writes source or externalId; absent imported
payment methods remain null. Recursive review confirms all changed logic is in
existing guarded eligibility or synchronous validation/draft transformations;
no promise actor or helper gained hidden orchestration. Ownership, interruption
and issued-write settlement remain in the existing statechart. No tests added
or run for this slice before implementation approval.

Static review: `pnpm check` passes with zero errors/warnings; focused Prettier and
`git diff --check` pass. Runtime editing and repeat-import behavior are not yet
verified for this slice; coverage awaits implementation approval.

## Imported editing approved verification

The user approved implementation testing. All 178 focused tests pass across five
files: canonical/form validation, readiness/pristine draft comparison, edit-machine
staging/rollback, real SDK authority provenance checks, and importer skip-existing
behavior. Tests prove forged form provenance is ignored in favor of the observed
row; imported income stays without paymentMethod; source/externalId edits reject;
category/tag/description/memo changes persist while identity fields are untouched.

The eight existing transaction-edit browser cases passed, including repeated
offline manual saves, archived/viewer restrictions, check details, metadata and
large amounts. Both imported income/expense cases pass offline edits and reloads
with changed category, tags, amount, description and memo, retained archived tags,
unchanged provenance and pristine/reverted Save behavior. Their initial failure
was a test locator expecting a combobox when TagInput had no suggestions; the
corrected locator targets textbox/combobox roles and avoids the suggestion list.

A real manual bank-sync browser scenario passes: import, edit a provider expense,
repeat explicit sync, and verify edited amount/description/memo remain with the
same externalId and exactly two imported rows. Its existing provider-failure
branch still emits the expected sanitized warning. Browser runs use disposable
in-memory Jazz through dev:agent on port 5180. Interrupted/server-startup attempts
were not counted as successful runs. No production changes were needed during
verification. Type, focused formatting and whitespace checks pass.
