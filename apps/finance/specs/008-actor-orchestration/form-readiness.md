# Scoped form readiness contract and migration design

Status: implementation reviewed and scoped verification passed. The reviewed adapter was committed
as `52552b1`; subsequent queued-assessment race fixes and verification remain uncommitted.
The verified submission progress work was committed separately as `eb0eba0`.
Installed XState version inspected: 5.33.2.

## Decision and scope

Keep domain readiness policy in its existing machine. Keep its explicitly supplied public
`selectAvailability` projection as a supported boundary. Introduce one reusable readiness adapter
that implements two lifetimes: ongoing observation for form availability, and a finite assessment
for prewrite authorization. Both lifetimes adapt the same domain source and public projection;
neither owns I/O or a persistence resource.

Replace the two separately implemented wrappers in `scoped-form.ts` and `scoped-form-write.ts`
with instances of this adapter. The write parent must consume a finite invocation result, rather
than observing `review.context.capability`. The form receives typed readiness reports through a
recipient actor reference instead of an implicit `sendParent` relationship.

This consolidates genuinely reused projection, correlation and source-supervision behavior. It
retains one adapter between the domain source and each consumer; it does not claim to remove all
actors or snapshot observation. Only that adapter observes the domain's public snapshot projection.
No consumer reads the adapter's private context or infers domain readiness from its tags.

| Migration                                                       | Production scope                                                                                                                       | Decision                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Direct reports from every domain machine                        | Generic core plus account creation, transaction entry, management, profile and workspace rename; broader than one focused review batch | Do not require this rewrite for the current boundary improvement. |
| Shared readiness adapter using existing public domain selectors | Four production files; no domain consumer API migration                                                                                | Proposed next implementation batch.                               |

The four files are `form-contract.ts`, new `machines/scoped-form-readiness.ts`,
`machines/scoped-form.ts`, and `machines/scoped-form-write.ts`. Preserve `scoped-form-policy.ts`
and existing domain options/selectors unchanged. Tests/fixtures follow implementation review.

## Ownership and responsibilities

```text
integration (Jazz observations, exact dependency binding)
└── scoped form
    ├── readiness adapter [watch; form availability lifetime]
    │   └── domain policy source
    └── submission [captured request and scope revision]
        └── operation / single-write owner
            ├── fresh fact observation
            ├── readiness adapter [assessment; one authorization attempt]
            │   └── same domain policy source, with submitted intent
            └── issued write and actual settlement
```

Instances are separate actors; policy logic is reused, not one globally shared actor. The UI
observer cannot authorize a write merely by having reported ready. Fresh observation, original
scope checks and submitted-intent assessment remain in the operation. Database permissions and
atomic persistence invariants remain at their current write boundaries.

The adapter owns only domain-source invocation, observation forwarding, public projection,
correlation and protocol delivery. Domain sources in this migration are resource-free statecharts.
This permits stopping an obsolete assessment on a newer observation without promising to cancel
an issued mutation. Resource-owning observation sources would need a separately designed cleanup
protocol rather than inheriting this assumption.

## Public protocol

Reuse `FormObservation` and `FormCapability`; no additional readiness booleans or copied lifecycle
labels are needed. Keep actor reference types in the machine module so the presentation contract
remains framework/actor independent.

### Ongoing watch

Input contains the initial observation, a watch generation and a typed report recipient. The
adapter accepts later `OBSERVE` events with the existing owner-assigned observation revision.
Its public report is:

```text
FORM_CAPABILITY_REPORTED {
  generation,
  capability: { revision, scope, readiness: ready | blocked(reason) }
}
```

Before publishing, the adapter validates that the projected capability matches its current
observation revision and the scope derived from those facts. A provisional capability such as
account creation's initial revision -1 is ignored; it is not authorization or a source failure.
A stable domain `blocked` result is a valid readiness result, distinct from a crashed source.

The form accepts a report only while availability is watching, when watch generation,
observation revision and current scope all match. Closing/shutdown takes precedence. A new
observation immediately clears the retained capability and enters awaiting readiness before
forwarding facts. The existing readiness guards must continue to block SUBMIT and CHANGE until
a current capability arrives, including during queued-event delivery.

Increment watch generation for every newly invoked watcher, including readiness retry with
unchanged facts. Observation revision alone cannot distinguish an old failed watcher from its
replacement at the same revision. The recipient reference binds reports to the exact form actor;
observation/scope revisions distinguish A → B → A within that actor.

### Finite prewrite assessment

Input contains the refreshed observation after `assessmentObservation` has added submitted
intent, plus a token containing request ID, captured scope revision and assessment generation.
Each authorization invocation gets a fresh assessment generation, even if the observation
revision happens to be unchanged.

Wait for a valid projected capability, then finish with invocation output:

```text
{ kind: assessed, token, capability }
```

This includes valid blocked decisions. The operation checks the token, observation revision and
original request scope before consuming the result. A matching assessed result enters the existing
decision states: ready → writing; blocked → denied/unavailable according to domain classification.
No polling, manual actor-to-promise bridge, automatic retry or private snapshot subscription is
needed. The finite adapter stops its pure domain child on completion.

On an observation change while authorizing, the operation leaves the old assessment, updates facts
and rechecks scope before invoking a new assessment with fresh intent and generation. Old output
cannot satisfy the replacement assessment. Late results are checked against the captured token in
addition to the invocation boundary; a matching workspace ID alone is insufficient.

## Statecharts and terminal behavior

```text
readiness adapter
├── observing (invokes one domain source)
│   ├── watching
│   │   └── matching public capability → send correlated report; keep observing
│   └── assessing
│       └── matching public capability → assessed [final output]
└── failed [final output]
```

Input chooses watch or assessment as a statechart decision; do not mirror it with independent
lifecycle flags. Context contains observed facts, invocation correlation, recipient and a selected
capability/result only where needed. Source snapshots are transient projection input, never stored.

The form retains its existing parallel availability/workflow regions. Watcher failure enters
availability.failed, clears readiness and invalidates an active submission. Retry is accepted only
when work has settled and the workflow is idle; it invokes a fresh watcher with a new generation.
The single-write operation retains refresh → scope check → authorization → decision → writing.
Its writing invocation still spans pending/cancelling/invalidated/closing and preserves settlement.

### Error and interruption boundaries

- Source startup/runtime failure uses the adapter's invocation error transition and produces a
  typed failed completion. Unexpected source completion is also failure; active snapshots do not
  constitute error supervision. A thrown public selector fails its adapter and is supervised by
  the consumer's `invoke.onError`, rather than moving the selector into an unawaited async action.
- Watch failure completion has `kind: failed`; the form treats watcher `onDone` as failed readiness.
  Assessment failure completion has `kind: failed` and its assessment token; the operation reports failure/notStarted and
  must not treat it as an ordinary blocked capability. Neither result exposes private error payloads.
- Before write issuance, CANCEL/INVALIDATE/SHUTDOWN can stop the pure assessment immediately.
  After issuance, the existing write owner must await resolve/reject and retain original scope.
- A watch crash during active submission follows the existing invalidation/drain path. Do not
  await acknowledgement from a failed watcher or let a report restore readiness before retry.
- Shutdown prevents late reports, retry and observations from reopening readiness. It still lets
  the live submission/write resource owners settle, then releases the form actor.
- Post-save completion remains independent: readiness refresh cannot turn persisted success into
  an unsaved submission, and completion retry must never repeat persistence.

## Machine-first gate

The adapter is a focused statechart for invocation, watch-versus-finite assessment, report validity,
completion and failure. Projection and report construction are pure operations; sending a report
is a leaf action. No promise actor or acquired persistence resource is introduced. Reuse the
existing guarded domain decisions; do not move readiness policy into adapter conditionals.

The known hidden transaction and avatar workflows remain explicit later slices. Their resource
ownership must be designed before rewriting those effects; changing the readiness boundary does
not make the existing `write` callback a leaf by definition.

## Implementation and verification review plan

Implement only the four-file adapter migration above, then inspect every changed actor and its
called selectors/helpers before presenting it for review. Preserve public domain selectors and
bound dependencies rather than expanding into route/component or schema changes.

After implementation approval, update test doubles to speak the explicit protocol and verify:

- Real-recipient watch reports; valid ready/blocked results; provisional, stale and wrong-scope
  projections; immediate readiness withdrawal; observer retry at the same revision; A → B → A.
- Finite output and submitted-intent authorization; stale assessment output; fresh observations
  winning over refresh results; request scope and exact database binding changes before writes.
- Source startup, later crash, unexpected completion and selector failures at both boundaries;
  no write on failed readiness; live write settlement after watch failure or authority changes.
- Shutdown priority, no impossible acknowledgements, draft/reset behavior, submission progress,
  completion retry and framework unmount draining.
- Browser access/progress/reset/modal flows and actual account/workspace/transaction forms as
  appropriate to the migrated generic boundary, using disposable agent storage.

The four-file implementation now follows this model. No tests were added or run before review.
Larger direct-domain migrations remain excluded.

## Implementation review evidence

- `scoped-form-readiness.ts` invokes the supplied pure policy source across watching/assessing
  states. It projects each active snapshot once, validates the projected revision/scope in guarded
  transitions, and either sends a typed report or completes with a finite assessed output.
  Source failure/unexpected completion enter a distinct failed final state. Projection exceptions
  remain adapter errors supervised by both invoking consumers.
- `scoped-form.ts` supplies its own typed recipient, increments watch generation on each new
  invocation, clears capability on observations/retry and validates report generation/revision/scope.
  Its existing availability failure, submission invalidation and shutdown states remain in place.
- `scoped-form-write.ts` invokes the same adapter for fresh submitted-intent assessment, consumes
  only a matching typed invocation result, and fails closed before write issuance for failed or
  inconsistent completion. It no longer reads a review snapshot or private capability context.
  Its actual writing invocation and settlement/interruption transitions are unchanged. Obsolete
  assessed/failed completions are ignored before current-result classification.
- Recursive source review found no new promise actor, I/O workflow or resource handling hidden in
  the adapter: projection, scope comparison, report construction and finite output are pure; sending
  and forwarding are leaf message actions. Existing `observe`, `assessmentObservation`, selectors,
  write effects and completion helpers remain at their documented boundaries. Transaction/avatar
  resource ownership remains unfinished work, as identified in the source audit.

## Queued assessment replacement fix

Runtime verification exposed a replacement race: a subscription can deliver a newer observation
when an old assessment becomes done/error, before the old invocation notification reaches its
parent. Merely rejecting the old success as invalid caused the fallback transition to fail the
replacement assessment. The same problem applied to normal failed output and actor errors.

Finite failure output now carries the captured assessment token. The operation consumes older
assessment generations without changing state, while current failed or inconsistent completions
still fail closed before write issuance. The review invocation has an explicit child ID.

For an actor error, the owning transition records a generation-specific failure fact only if the
currently owned review actor is itself in error. `authorizing.checkingError` then either enters
failed or returns to pending while retaining the replacement invocation on the authorizing parent.
This uses direct-child liveness, not private readiness policy. No independent lifecycle flag is
introduced: context retains the observed failure generation; states own the decision and lifetime.
No extra public operation command or event is introduced. Terminal cleanup clears the failure fact.

Tests reproduce queued success, normal failure and actor error with real source/adapter/operation
actors and reentrant observation delivery. Each keeps the replacement assessment alive, issues no
premature write, and allows exactly one write after the current assessment completes.

## Approved verification

- 211 unit tests passed across 12 focused files: readiness adapter, scoped owner/submission/progress/
  write/completion, controller lifecycle, and the workspace rename, transaction entry, management,
  profile and account creation consumers. This includes 32 new readiness tests capturing real typed
  reports and finite results, provisional/stale/wrong-scope projections, same-revision watcher retry,
  A → B → A, source startup/later crash/completion, projection errors, actual settlement and queued
  assessment replacement. The two old event sends were migrated to the explicit report contract.
- Nine form browser checks passed in one run: access/reset, modal behavior, scope replacement,
  actual account creation, offline workspace rename/reload, validation/progress/cleanup and the two
  new readiness withdrawal and failure/drain/retry scenarios. The actual transaction edit check
  then passed on a focused rerun after aligning its old button-label locator with current UI copy;
  it covers repeated offline saves and retained archived tags. Its startup wait now matches the
  existing 30-second allowance. No product label or presentation behavior changed.
- `pnpm check` passed with zero errors/warnings. `pnpm check:tests`, focused Prettier and
  `git diff --check` passed. No browser server ran concurrently with unit/Svelte regeneration.

Commands:

```sh
pnpm exec vitest run src/lib/machines/scoped-form-readiness.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-write.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/scoped-form-progress.test.ts src/lib/machines/scoped-form-completion.test.ts src/lib/forms.test.ts src/lib/machines/workspace-rename.test.ts src/lib/machines/transaction-entry.test.ts src/lib/machines/management.test.ts src/lib/machines/profile.test.ts src/lib/machines/account-creation.test.ts
pnpm exec playwright test --config playwright.config.ts '^/Users/matthewjamesderocher/Projects/delightful-finances/tests/(form-presentation|transaction-edit).e2e.ts$' --workers=1 --grep 'scoped fields|modal preserves|scope replacement|existing account modal|shared edit mode|submission reports|readiness|always-visible form'
pnpm exec playwright test --config playwright.config.ts '^/Users/matthewjamesderocher/Projects/delightful-finances/tests/transaction-edit.e2e.ts$' --workers=1 --grep 'always-visible form'
```

Absolute file-path filters exclude the hidden `.delta/worktrees` test copies; adjust the checkout
prefix locally. Browser checks use disposable agent storage. Source/error/report interleavings are
controlled in unit actors; browser scenarios use the shared controller and actual form components,
with real Jazz writes in the app scenarios. These are scoped results, not a full application/PWA
run. Transaction persistence resource ownership and avatar preparation remain unfinished work.
