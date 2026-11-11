# Import, disconnect and outcome settlement

Scope: `import-transaction.ts`, `import-account.ts`, `import.ts`, `operation.ts`,
their shared types and the bank owner's final-count handoff. Six production files;
implementation review precedes tests.

The existing workflow already exposes validation, authorization, traversal and result
classification. Retain those responsibilities. Individual insert/update plus local
settlement waits are leaf effects; no new orchestration belongs inside promises.

```text
bank (owns reset/shutdown intent)
└── operation (owns command, lock, credential/response and final counts)
    ├── disconnect / chosen outcome write (one issued update + settlement wait)
    └── import (owns account traversal and aggregate counts)
        └── account import (owns transaction traversal and account counts)
            └── transaction import (owns validation and one insert + settlement wait)
```

Statechart/protocol before effects:

- Each traversal receives `CANCEL`. Before a resource-owning child starts, cancellation
  can complete immediately. While a child is active, a compound processing state retains
  its invocation across working/cancelling substates and forwards cancellation to the
  live child. Output/error finishes the wait; no second acknowledgement is requested.
- A transaction import cancels before persistence without inserting. Once persistence
  starts, cancellation waits in a nested substate without stopping the write actor.
  Its finite result distinguishes no write, locally persisted write and unresolved
  settlement. A rejected wait never establishes rollback.
- Account import consumes each finite transaction result once. A locally persisted
  insert observed during cancellation increments imported exactly once, then stops
  traversal. Omitted/existing finite results still retain their observed counts.
- Import merges completed-account counts with the active account's final counts once,
  clears the progress accumulator, and stops before the next account on cancellation.
  Unexpected child failure retains already published progress and marks uncertainty.
- Operation's import invocation survives working/cancelling/failing substates. Cancel
  and lock failure flow to import; cancellation wins over later errors/progress. Final
  child counts replace progress, including on cancellation. No outcome write starts
  after a cancelled import completes.
- Disconnect and the shared outcome-history owner retain their invocations across
  working/cancelling/failing substates. Cancellation cannot retract an issued update;
  lock ownership lasts through its settlement. A write rejection remains unresolved.
  Outcome choice stays in the existing complete/partial/failure decision states;
  their chosen domain payload enters one `persistingOutcome` invocation and is not
  recomputed inside persistence actors. Its result routes using the same chosen payload.
- Published operation results retain counts and settlement uncertainty. A cancelling
  bank consumes final counts rather than leaving progress at the last notification.
  Reset/shutdown keep their existing scrubbed-result behavior, ignore late progress,
  and never publish old operation counts as a replacement workspace's result.
  The bank forwards cancellation only to a live operation; queued output/error is
  sufficient when that child has already completed/failed.

Import-data settlement and outcome-history settlement are separate observed facts:
a successful failure-history update cannot make an uncertain transaction insert
certain. Mapping retains its existing finite-result bridge; because that bridge
does not publish exact settlement, failed/cancelled mapping output is conservatively
unresolved in the operation summary rather than reconstructing private child policy.

Bank retains shutdown/reset intent and forwards cancellation; no new root shutdown
command or supervisor is introduced. Keep original write scope, deterministic import
identity, fresh authorization, explicit provider initiation and credential cleanup.
Cancellation during unlock/fetch continues to abort those platform operations and
discard late results. Clear plaintext credentials/provider responses when finishing
or while awaiting descendant cleanup once those payloads are no longer needed.

The installed SDK write handle exposes `wait({ tier: 'local' })` without an abort
parameter. Retain its result rather than treating actor stopping as side-effect
cancellation. Mapping settlement is already reviewed/verified and remains intact.

## Implementation review

Implementation was reviewed before tests were added/run. The recursive review covers
the new cancellation handlers and their called helpers. Persistence promises still
perform only individual writes with local waits. Pure counter/report transformations
consume child-owned finite outcomes and introduce no read/check/write orchestration.
The scalar settlement projection combines import and history-write facts, rather than
copying lifecycle phases into context. No new background provider request or retry was
introduced. Existing validation, authorization and deterministic IDs remain in place.

## Verification

77 relevant unit tests passed across import settlement, operation, bank owner,
transaction validation and mapping regressions. The 32 new tests exercise pending
insert/update waits, cancelled lookups/authorization/traversal reads, late write
success/failure, cross-account final counts, stopping further traversal, partial
outcomes, idempotent repeat import, lock-failure/cancellation priority, original scope,
reset/shutdown progress rejection, actor failure before resource acquisition, queued
completion and the final count handoff to the bank owner. Existing import/operation
test doubles now publish the explicit result kind and settlement fields.

The import fixture composes the real bank→operation→import→account→transaction tree
and real authorization decisions with controlled storage/platform leaves. It verifies
lock retention through settlement and that successful history persistence cannot
erase uncertain import-data settlement. This is not a live concurrent Jazz write test.

Seven browser checks passed against disposable in-memory Jazz: explicit connection/
account creation/idempotent import, lock startup failure/recovery, cancelled passkey
creation with late completion, mapping/remapping/reload, cancelled sync with a late
provider response and a new explicit sync, and both offline setup/sync checks. The
new provider-response test confirms no automatic retry or late import; the next
explicit sync imports the record once rather than finding an earlier cancelled import.

`pnpm check`, `pnpm check:tests`, focused Prettier and `git diff --check` passed.
No production fixes were needed during verification. The user's persistent development
environment was untouched.

```sh
pnpm exec vitest run src/lib/machines/bank-sync/import-settlement.test.ts src/lib/machines/bank-sync/operation.test.ts src/lib/machines/bank-sync/index.test.ts src/lib/machines/bank-sync/import-transaction.test.ts src/lib/machines/bank-sync/mapping.test.ts
pnpm check
pnpm check:tests
pnpm dev:agent --host 127.0.0.1 --strictPort
# Wait for http://127.0.0.1:5180/ to return 200 before starting Playwright.
pnpm exec playwright test --config playwright.bank-sync.config.ts tests/bank-sync.e2e.ts tests/bank-sync-offline.e2e.ts --grep 'connects explicitly|maps and remaps|lock actor startup failure|cancelled passkey creation|cancels a pending sync|offline'
```

Evidence limits: pending local write settlement is controlled at the unit effect
boundary. Browser tests use real Jazz writes and delayed provider responses; no
browser database-delay hook was introduced. This is focused verification, not a full
application/PWA run. Correlated bank availability/status reporting remains pending.
