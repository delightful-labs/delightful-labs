# Independent checks tasks

The user authorized the complete adoption implementation as one batch, then approved
its test phase with “do tests”. Current status supersedes the historical intermediate
review notes and test counts in the plan and protocol documents.

## Completed implementation and review

- [x] Confirm independent Check identity and the shared received/written backend.
- [x] Make payment method optional for income and expense; require a Check reference exactly when the method is Check.
- [x] Investigate exclusive-assignment prototypes and record SDK limitations; remove abandoned assignment schema/helpers and prototype tests.
- [x] Adopt independent Checks in the root schema and organization/account permission rules; deny legacy checkDetails access and references.
- [x] Implement the Check resource child, independent ledger/tag resource child, staged-save coordinator, and form checkpoint retention/forwarding.
- [x] Adopt shared canonical validation, stable transaction/Check IDs, create/edit integration, and inline received-Check controls without an existing-Check selector.
- [x] Move the attached Check with its transaction in one SDK transaction, retaining its ID and requiring source/destination write authority.
- [x] Review the complete implementation before migrating and running tests.
- [x] Align the MVP and independent-Check requirements with the approved behavior.

## Completed verification

- [x] Verify direct SDK references for both transaction kinds, compatible multiple references, invalid payment/reference pairings, missing Checks, and organization/account mismatches.
- [x] Verify selected-member Check writes, denied ungranted-account inserts, viewer reads/write denial, authorized account movement, and deletion denial in root permission tests.
- [x] Verify Check and ledger child settlement, rollback, failure, cancellation, invalidation, and shutdown behavior in their resource-owner tests.
- [x] Verify form checkpoint retention/forwarding and contract rejection of incompatible retry scope/account values.
- [x] Verify coordinator inline Check creation before the ledger write and transaction creation with an unspecified payment method.
- [x] Migrate tests away from the retired create/edit persistence actors and embedded Check contract.
- [x] Run the complete unit suite: 74 files and 1,023 tests pass.
- [x] Run the 25 transaction edit/workspace browser scenarios across focused runs, including Check metadata/account movement, imported editing, offline saves, retained tags, navigation, exact large amounts, and sample batches.
- [x] Pass application/service-worker checks, browser-test TypeScript, changed-test formatting, and whitespace checks.

Browser verification used disposable in-memory Jazz on agent ports 5180/5181.
Stale imported-payment and localized sample-button expectations were corrected;
a workspace-readiness timeout passed on retry after allowing startup more time.
Playwright now excludes duplicate tests under .delta worktrees. The temporary
alternate-port configuration was removed. These runs do not claim the entire
repository browser suite passed. No schema deployment or data reset was performed.

## Composed workflow and movement verification

- [x] Add direct coordinator coverage for a saved Check followed by ledger rejection, stable-ID retry without another Check insert, uncertain Check and ledger reconciliation, matching/missing/conflicting ledger results, remote read tiers, cancellation/invalidation/shutdown while either child settles, and identity/workspace/binding replacement before the ledger write.
- [x] Verify source/destination authorization for atomic Check/transaction moves in both directions of money flow: owners/admins, all-account members, selected members with both writes, source-only/destination-only writes, read grants, absent grants, viewers, and nonmembers with orphan grants. SDK authority tests confirm denied batches preserve both original accounts and the Check reference. Foreign/archived destinations and invalid ledger categories are also rejected atomically. Resource-child tests cover successful staging, staging failure before commit, and unknown settlement after commit.

Focused follow-up verification: 84 tests pass across the coordinator, ledger
resource child, and root permissions (18 coordinator, 14 ledger child, 52 authority
tests). These extend the earlier full-unit and browser results above; they do not
claim another full-suite/browser run. No production changes were required.

## Explicitly deferred

- [ ] Add written-check creation controls; expense references already use the shared backend.
- [ ] Enforce one transaction per Check and handle shared-reference edge cases; the user approved keeping the current flow simple.
- [ ] Add existing-Check selection/reuse only if separately requested; current entry is inline only.
- [ ] Apply schema changes to an existing environment through a separately authorized reset or transition. Alpha data may be discarded; no legacy migration is required by this implementation.
