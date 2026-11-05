# Foundation cleanup review

This PR addresses AR-01–AR-05 and the currently actionable Zod follow-ups T011/T013.
T012 and ZOD-S01/S02 remain with restore/sign-in implementation. No consumer deployment,
storage migration, new journal, new backend or broad validation rewrite is included.

## Evidence and workflow design

- AR-01: creation-owner handles closing/replacing before storing or classifying child output.
  Child errors also skip unresolved classification. Capture results first; unresolved settlement
  takes precedence over closing/replacement. Retain the original operation binding and record.
  An unresolved owner ignores replacement/restart commands; retry requires its original binding.
  A closing owner only finishes after a known outcome. Reconciliation classifies its
  completed read before applying interruption, so a matching result is not unnecessarily demoted
  to unknown during cancellation. Its final output includes binding/result.
- AR-02: Finance's current reconciliation uses `ReadTier.LocalFirst`; `absent` has no issuance
  evidence. Fresh creation may transact after absent because this invocation has not issued a
  write. Recovery/retry starts with unknown prior issuance. Absence cannot authorize another
  transaction; an explicit host `notStarted` reconciliation result may. Matching must mean the
  host has verified exact content and local durability. Reuse existing journal and stable IDs.
- AR-03: the journal adapter sends TX_ABORTED when abort throws, although only native onabort
  proves abort. Report abort failure and retain the callback actor until native completion/abort;
  do not retry a failed abort recursively. Drain errors take precedence over cancellation.
  IndexedDB close is not transaction rollback. No timer invents transaction settlement.
- AR-04: shared creation inspects Finance attempt fields and initialization consumes Finance
  record names. Keep only generic journal keys/opaque attempts and binding keys. Hosts supply
  binding-match and attempt-ID projections. Normalize initialization observations to identities
  and workspaces; hosts project prepared-attempt identity/workspace IDs. No persisted format is
  rewritten. These are source-breaking API corrections; Finance's pinned package is unchanged.
- AR-05: single-write policy hardcodes locallyPersisted. Require the host to explicitly supply
  its write settlement guarantee, including profile saving. Existing resource-owning persistence
  actors retain their own results. The existing Jazz persistLocal adapter waits on receipt.wait
  with tier local; a mutation's return is not that guarantee. No extra persistence owner is added.

Meaningful resources remain owned by existing XState actors: creation owner -> operation ->
journal/persistence -> transaction. Closing/replacement drains the same invoked child. Pure
projections, schema validation and issue mapping introduce no asynchronous workflow.

## Review and validation

Implementations are presented for review before new regression tests, per AGENTS.md. Existing
consumer fixtures and declarations will be adapted for the changed public contracts. Static
checks and package builds are appropriate before that review; no new behavior is claimed qualified
until its regression cases are approved and run. PR CI runs the repository's existing suite.

## Source evidence

- Pinned `jazz-tools@2.0.0-alpha.59`, `dist/runtime/client.d.ts` (`WriteHandle.wait`) and
  `dist/runtime/client.js` (`WriteHandle.wait` -> `waitForTransaction`), inspected from the installed
  package. DLF's existing `backend/jazz/data.svelte.ts` already supplies `persistLocal`.
- Finance's current `workspace-creation-reconciliation.ts` queries with `ReadTier.LocalFirst`.
  A returned `absent` result therefore carries no conclusive prior-write evidence.
- [IndexedDB abort steps](https://w3c.github.io/IndexedDB/#dom-idbtransaction-abort) throw
  InvalidStateError during committing/finished; they do not imply abort occurred. The journal keeps
  its native handlers until completion/abort rather than fabricating a cancellation event.

## Compatibility and consumer migration

This is a source-breaking correction of extracted APIs, not a persisted-data migration. Existing
journal database/version/store/keyPath and host record schemas remain unchanged. Do not clear old
records or relabel them notStarted: prior issuance stays unknown unless there is actual evidence.
Finance remains pinned to its existing package until a separate adoption change.

- `CreationBinding` requires only `key`. Hosts may extend it and pass that Binding as the final
  generic argument to creation operation/owner. The key must include every identity, profile and
  backend dimension that invalidates an operation; host binding-match policy remains required.
- Creation operation requires `matchesBinding(record, binding)` and `attemptId(record)`.
  Finance can supply its existing user/profile comparisons and organization ID projection in its
  wrapper; DLF no longer reads those fields. Journal factory also accepts `attemptId(record)`.
  Clear requests now carry `attemptId` instead of `organizationId`.
- Retry requests carry `settlement: 'notStarted' | 'unresolved'`. The owner passes its known result;
  retrying a creation cancelled before issuance therefore remains available. After restart, a
  recovered record has unknown issuance until reconciliation supplies evidence. A bare missing row
  is not such evidence. Persistence input carries `issuance: 'new' | 'unknown'` from that decision.
  A host may return reconciliation `notStarted` only for the exact attempt with conclusive evidence;
  do not rename LocalFirst `absent` to this new outcome. `matching` requires exact content and local
  persistence verification. No remote wait is introduced for a genuinely fresh local creation.
- On unresolved settlement the owner retains `context.operation`, `context.record` and
  `context.result`. Supervisors observe that state as recovery required, rather than waiting for a
  clean shutdown acknowledgement. Replacement observations update the desired binding without
  dropping the original operation. RETRY reconciles the original record only under its binding.
  A child crash without a returned record can reload the existing journal by the original key.
- Initialization discovery projects host rows into `identities: [{ id, initialWorkspaceId }]`,
  `workspaces` and `serverConfigured`. `selectReady(attempt)` projects prepared IDs into
  `{ identityId, workspaceId }`. Ready outcomes use those generic names; unavailable reasons use
  `identityMissing` and `duplicateIdentities`. Finance's wrapper can translate these into its current
  public result names. The test app compile-only consumer shows generic creation composition.
- `createSingleWriteFormOptions` requires `settlement: 'locallyPersisted' | 'confirmed'`.
  `createProfileFormOptions` requires `saveSettlement` for both save callbacks. This is a declared
  host guarantee, not an SDK receipt inferred from arbitrary promise completion. For Jazz local
  writes, host save leaves await the existing `persistLocal(receipt)` adapter before resolving.
  Resource-owning persistence actors continue to return their own actual settlement results.
- Optional `forms/zod` exports `zodFormIssues` for the existing injected `validationIssues` slot.
  It copies issue paths/codes only; consumer localization supplies messages. Other validators and
  existing schema injection remain supported. No message strings or input values are copied.

## Profile draft review (T013)

Retain the current checks. Name dirtiness compares a partially edited string after trim/empty-to-null
normalization; avatar dirtiness distinguishes a nonempty selected File from remove/unchanged.
These are simple comparisons, not submission validation. Reusing submission schemas would run
transformations/reject incomplete drafts at the wrong boundary; a second permissive schema would
add machinery without simplifying these checks. No Zod conversion or behavioral change is needed.

## Regression qualification after implementation approval

- Creation owner: unresolved completion and child crash during replacement/shutdown; retained
  binding/record; replacement observations cannot discard recovery; known notStarted retry.
- Operation/persistence: fresh absent can create; unknown absent cannot issue another transaction;
  exact matching and conclusive notStarted recovery; cancellation/read errors retain unknown fate.
- Native journal: abort during committing followed by actual completion; actual abort; close/open
  errors; no fabricated TX_ABORTED and no cancellation masking a failure. Use actual browser
  IndexedDB for native ordering rather than mocks that never produce a terminal event.
- Form policy/profile: declared guarantee passed through; host receipt resolution before local
  durability must not be used as a valid locallyPersisted save implementation.
- Zod adapter: field/array paths and codes, unknown errors, absence of values/messages; built public
  subpath and test app type compatibility. Keep the current profile dirty checks unchanged.

No new regression tests were added or run before this implementation review. Existing initialization
examples/assertions were mechanically adapted to the renamed contract. Static Svelte/TypeScript,
Oxlint, formatting, package/strict Publint and public consumer declaration checks are run locally;
the PR's normal CI runs the pre-existing suite. Passing that suite does not replace these new cases.

## Settlement statechart revision

Review found settlement policy hidden in operation/persistence output callbacks. Output now only
reads the result prepared by transitions. Operation finishing first applies closing/cancelling,
then checks settlement evidence, then classifies the final outcome. An unknown prior attempt with
no notStarted proof enters unresolved settlement explicitly; interruption remains closed/cancelled
with unresolved settlement. Persistence routes its completed work through the same explicit decision,
using its issuance evidence. No new effects, async boundaries, stored phase flags or native resources
are introduced. Existing cancellation/drain behavior stays with the invoked children.

## Regression qualification completed

The user reviewed/merged PR #19 and authorized the testing follow-up on 2026-11-03. On
`test/foundation-cleanup`, local verification passes:

- 31 creation/owner/persistence/initialization cases exercise the actual composed machines with
  controlled leaf completion. They cover replacement/shutdown completion and crash, retained
  original binding/record, rejected retries under another binding, known-settlement replacement,
  known notStarted retry, absent/verified recovery, late journal results, read errors, cancellation
  before issuance and drain through each reported settlement. Terminal context, state and output
  agree. A test app-shaped bootstrap uses the host ID projection without Finance fields.
- Seven form/Zod cases cover explicit local/confirmed host guarantees, delayed host promises for
  name/avatar removal, exact save arguments, and issue paths/codes without values/messages.
  Local wait uses the existing persistLocal adapter. Confirmed tests verify declared host-result
  propagation, not native remote confirmation. The Node consumer also imports forms/zod publicly.
- Five real Chromium cases use the packaged journal factory and native IndexedDB, each with a
  unique disposable database that is deleted afterward. They prove persistence/read/selected-clear,
  real cancellation rollback, refused abort during native commit followed by completion, native
  VersionError on open, and an actual ConstraintError with rollback. Native-handler observation
  records events before the adapter reports them; no fake abort/complete events are injected.
  The browser bundle builds during check:consumer, and the cases run in the normal browser suite.
- All 677 unit tests across 29 files and the 11 separate-process backup reader cases pass. Formatting,
  Oxlint, Svelte/TypeScript, package/strict Publint, consumer declarations/bundles and Storybook build
  pass. GitHub CI passed on implementation head `82cc5e4` in
  [PR #20](https://github.com/delightful-labs/delightful-local-first/pull/20), including the normal
  browser suite. PR #20 remains awaiting merge at this handoff.

The tests reproduced and fixed two production-code defects:

1. An unresolved owner's guarded RETRY rejected a different binding but then fell through to the
   root RETRY handler. An explicit unguarded no-op alternative now consumes that rejected event.
2. Explicit IndexedDB abort rejects pending requests with AbortError while transaction.error is
   null. The native adapter was treating those consequences as a new failed transaction. It now
   waits for the native abort event for settlement, while retaining actual request/transaction
   errors. The native ConstraintError case verifies those real failures are still reported.

No storage format, consumer dependency, deployment or user data changes are included. These checks
close the scoped shared-library cleanup findings; they do not claim production Finance migration,
all-browser qualification or a completed backup/restore feature. T006 remains the next feature.

## Workspace journal native disposal correction — design (2026-11-04)

The user requested committing the test app cleanup and continuing the established cleanup workflow.
Test app correction committed locally as 8e5efe0. This slice addresses the audit's older workspace
journal resource-disposal finding; it does not rewrite journal policy or qualify the separate restore
journal. Follow the preceding cleanup workflow, including focused tests.

Keep the current control/work statechart and read/validate/choose/stage/settle/close semantics.
Replace opening/acquisition/close promise handoffs with a fixed native database owner invoked for
the running scope. The chart commands OPEN -> observes OPENED/OPEN_FAILED -> ACQUIRE -> observes
ACQUIRED/ACQUIRE_FAILED -> existing transaction resource -> CLOSE -> observes CLOSED/CLOSE_FAILED.
The native owner retains each handle before reporting it, covering actor stop before delivery.
It performs no journal row validation, conflict selection or retry decisions.

Disposal detaches reports, attempts abort of an acquired transaction and closes the owned database.
An IndexedDB open request itself cannot be cancelled: if success arrives after disposal, close that
connection immediately; if an upgrade starts after disposal, abort its upgrade transaction rather
than create the store. Bridge upgrade callback failures into a typed native failure. Keep schema,
database version, store/key paths and public result/input contracts unchanged.

The transaction adapter detaches handlers and aborts on disposal; late read callbacks consult the
detached reporter. Native abort can throw for a committing/finished transaction. Disposal must not
invent TX_ABORTED or claim rollback from that exception; graceful cancellation still observes actual
native completion/abort. Abrupt stop has no drain acknowledgement and cannot undo an already
committed write. No locks, fallback storage, timeouts, durable recovery protocol or new app UI.

Qualify same-stack stop during opening, acquired-handle handoff and staged transaction stop with
real IndexedDB, including successful database deletion proving no retained connection. Run existing
workspace journal native cases and relevant workspace creation units. This is bounded disposal
work, not a new universal IndexedDB abstraction.

### Workspace journal disposal qualification (2026-11-04)

Implemented the fixed native database owner and transaction callback disposal. The existing work/
control states and schema/CAS semantics are retained. Open/acquire/close are chart-commanded native
operations; handles are retained before reports, including the acquisition-to-observer handoff.
The exported WorkspaceJournalEvent union includes these native reports so typed consumer journal
compositions continue to accept the factory. Public input/result contracts are unchanged.

All 213 workspace unit cases pass across seven files. All nine real Chromium journal cases pass:
five existing persistence/conflict/cancellation/commit-error/version/constraint checks plus four
new stop probes for existing-database open, first-use open/upgrade, acquired handle delivery and
staged transaction teardown. Successful database deletion verifies no retained connection in those
probes, and the staged-stop case observes a native abort and reads back no committed record.
Playwright used a task-owned preview on localhost port 6014. Package/strict Publint, Svelte/
TypeScript, public-consumer declarations, lint, formatting and whitespace checks pass. The consumer
check caught an event-type mismatch; aligning the exported protocol union resolved it.

No full repository/browser suite was run. These results qualify this bounded native disposal
correction, not browser-process crash safety or rollback of already committed data. A stopped open
request may still settle; late connections close, and late upgrade callbacks abort their upgrade
transaction. Graceful CANCEL/SHUTDOWN continues to wait for actual native settlement. The separate
backup restore-journal correction is not qualified by these workspace journal results.

Test app source correction is committed locally as 8e5efe0. This workspace journal correction is
uncommitted. No push or merge.
