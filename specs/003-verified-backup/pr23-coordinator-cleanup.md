# PR #23 consolidated cleanup — implementation and tests authorized together

The user approved all five follow-up findings and tests in one session. Preserve the pending wrapper
and attachment-actor corrections. Work stays local on #23; no commit/publication is implied.

## Owners and protocols before implementation

Use one coordinator factory and one required pair of dependencies: native transaction leaves plus
a finite destination actor. There is no optional actor, method-shape detection, legacy callback
fallback or pair of specialization wrappers. The selected write ID is explicit actor input data.

```text
validate complete binding/intent/selected step -> acquire operation lock -> load exact journal
  missing + preparation step -> create durable intent
  missing + batch -> unavailable (never create a destination/intent)
  loaded -> conflict/preparation/current-batch guards -> invoke one journaled write owner
    invoke destination actor for remote/admission/transaction-read/stage
    durable issued intent -> transaction -> stage -> commit -> independent local/global checkpoints
  finite write output -> guarded preparation/batch outcome -> release lock -> await native release
```

Preparation and attachment each provide a concrete domain machine. They own scope/control/content
and identity decisions; SDK leaves do one operation. Both reuse native transaction leaves. The
coordinator/write owner alone controls journal progression, transaction/rollback/detached receipts,
unknown writes and lock lifetime. Native-only configuration without an actor must fail TypeScript.

The preparation read leaf projects its SDK control row to two comparison facts (present/matches).
Guards select match/missing/conflict; rows never enter snapshots or remain in a separate buffer.
It checks current identity and stages only its incomplete control row. Cancellation latches and
drains an issued read/stage; invalidations remain bound to the exact generation. The attachment
actor retains its owned private byte observation buffer until comparison completes.

Remove fake promise boundaries around synchronous planning validation/allocation/projection/build.
Each runs as one synchronous state assignment with an explicit success/failure fact and guards.
A narrow synchronous error boundary classifies only that operation; it contains no workflow or I/O
routing. Keep discovery and actual cryptographic digests as invoked leaves, preserving their drain
and failure paths. Collapse attachment classification to an ordered set of named outcome guards;
keep real reads, admission, staging and resource lifetime explicit.

## Qualification

Update consumers/tests to the single coordinator and mandatory actor API. Use an explicit destination
machine test double for actor-unit gates rather than retaining callback compatibility in production.
Qualify invalid configuration statically; exercise preparation/attachment, exact step admission,
missing journal, journal CAS failures, separate settlement, unknown/no-replay recovery, cancellation,
late native results, lock release and claim ownership with focused units and actual Jazz/Chromium.
No full comparison/activation, Finance adoption, cross-device or production safety claim.

## Implementation and qualification — completed (2026-11-04)

The single public factory is `createRestoreMachine(native, destination)` under
`delightful-local-first/backup/restore/workflow`; its contracts are under
`delightful-local-first/backup/restore`. Both dependencies are required, with no method detection,
callback fallback or partial-application coordinator wrappers. The requested `writeId` is input.
Preparation and attachment hosts invoke it directly. The old unmerged preparation/batch facades,
coordinators and internal contracts are removed; later stacked branches need migration before
requalification. Journal wire format and destination schema/policies remain unchanged.

The shared write owner returns `written`; only coordinator success transitions report `prepared`
or `batchWritten`. Missing batch journals never become synthetic retained records or newly created
intent. Preparation domain reads return only present/matches facts; transitions classify outcomes.
Identity denial and unexpected identity observation errors stop before issuance. Both concrete
writers are statecharts and share only native transaction leaves. Attachment observation routing
uses one ordered guard list instead of four routing-only states. Synchronous planner operations
have synchronous assignments and guarded failure paths; actual hashes/discovery remain invoked.

Qualification passed on this tree:

- **926 unit tests**, including **43 focused write/coordinator/lock cases**. Two added cases prove
  missing-journal batch continuation cannot create intent/effects and an unknown selected write
  cannot acquire ownership or read the journal. Five initial failures were old write-child success
  assertions; they now assert `written`, while coordinator assertions retain public success names.
- **16 actual Jazz/Chromium cases**. The prior 14 all pass, including exact attachment-byte checks,
  reload/no-replay reconciliation, cancellation, cross-tab locking and second-claim isolation.
  Two added cases inject identity denial and identity-observation failure in the concrete preparation
  destination actor: zero transactions, no destination row, retained not-issued journal, no advance.
- Root Svelte/strict TypeScript, notebook TypeScript, package/strict Publint, public consumer imports,
  compilation and builds, **17 independent reader + 18 notebook export tests**, Oxlint, Oxfmt and
  whitespace checks pass. Package build completed before browser servers started.

The disposable Vite host at http://127.0.0.1:6199/restore.html, Jazz authority, Chromium and contexts
were closed by test teardown. No commit/push, stack propagation or PR merge was performed. Historical
awaiting-review/static-only notes for the wrapper/attachment corrections are superseded by these
checks for this tree. Full comparison of restored records/relationships/bytes, activation, Finance
completeness, cross-device recovery and production restore safety are not established.
