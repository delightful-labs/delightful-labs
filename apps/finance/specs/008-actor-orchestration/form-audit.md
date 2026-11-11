# Generic form orchestration audit (D004)

Status: source audit complete. No production code or tests changed or executed in this cycle.
The bank reporting implementation was committed separately as `d32f2dc` before this audit.

## Ownership and contracts

```text
page/integration (exact dependency binding, Jazz subscriptions)
└── scoped form controller (starts actor; sends SHUTDOWN before stopping)
    └── scoped form (parallel availability + current workflow)
        ├── availability forwarding/supervision wrapper
        │   └── domain availability (access/readiness policy)
        ├── submission (one captured request/scope revision)
        │   ├── asynchronous schema validation
        │   └── domain operation
        │       └── single-write operation, for current consumers
        │           ├── refresh current facts
        │           ├── review wrapper → domain availability
        │           └── supplied write effect and local settlement
        └── post-save completion (currently transaction-create navigation)
```

The availability and workflow regions are parallel states of one actor, not independently owned
actors. Availability is watched while the form is open; submission exists for one request and
survives pending/cancelling/invalidated/closing transitions. Completion has a separate lifetime
after successful persistence and can retry navigation without issuing another write.

`forms.svelte.ts` owns framework lifecycle and browser form adaptation. Integrations supply
observations, domain options and bound effects. Pure form components receive props/callbacks;
modal disclosure remains presentation state. Closing a modal hides it without cancelling submitted
work, consistent with existing behavior. Do not reinterpret Close as rollback.

`FormObservation.revision` correlates readiness with current facts. Scope comparisons include the
bound environment/database and relevant identity/entity/workspace fields. `scopeRevision` changes
on scope replacement and prevents an old submission's result from appearing after A → B → A.
`FormRequest` captures request ID, original scope, scope revision and submitted values. Operations
return typed success/partial/blocked/interrupted/failure results with explicit settlement.

## Findings and decisions

### 1. Retain the submission and write-settlement boundaries

Submission owns asynchronous validation and its typed failure classification. During validation,
CANCEL/INVALIDATE/SHUTDOWN retain the invocation until validation settles, then discard payloads
without starting an operation. During operation, these commands propagate only to a live child;
completion/error routing preserves closing and invalidation priority.

The single-write machine refreshes facts, checks the original scope, assesses domain readiness,
then invokes the supplied effect. Once writing starts, cancellation/scope replacement/shutdown
retain that invocation until resolve/reject. Rejection is conservatively `unknown`, rather than
claiming rollback. `forms.svelte.ts` subscribes for final completion before requesting shutdown on
unmount, then stops the actor after completion/error. This avoids an automatic framework actor
stop preceding domain cleanup. Retain these semantics; no source evidence justifies merging
submission, operation and post-save navigation into one controller.

Fresh prewrite readiness is distinct from UI readiness. Retain that check and SDK permission /
transaction-boundary invariants. The review wrapper is pure and can be replaced on observations;
it does not itself own a transaction. Verify this boundary with real persistence actors after each
future implementation rather than treating a supplied function's name as proof it is one effect.

### 2. Replace copied submission snapshots with a small public progress report

`scoped-form.ts` stores `SnapshotFrom<typeof submission>` via `invoke.onSnapshot`. Its view selector
uses that complete snapshot only for `hasTag('validating')`. The generic owner therefore couples
to the child's private progress representation and retains more child data than it needs.

Replace this with a typed report for validating/operating progress, correlated to the captured
request ID and scope revision. The child owns that choice; the parent rejects obsolete reports
and preserves its own cancelling/invalidated/closing states above progress. Keep invocation output
for finite results. Do not replace the snapshot with context booleans mirroring child lifecycle.

This is the recommended first small implementation slice: `form-contract.ts`, `scoped-form.ts`
and `scoped-form-submission.ts`, with focused fixtures/tests only after implementation approval.
No domain availability or persistence migration is required for that slice.

### 3. Review readiness adapters as a protocol, not one wrapper at a time

Both the form's availability wrapper and the write machine's review wrapper invoke the same
domain policy and adapt its snapshots through the explicitly supplied `selectAvailability`.
That selector is an intentional public domain projection, not inherently an invalid dependency.
However, review then publishes another private `context.capability` snapshot for its parent to
interpret; the wrappers add lifetimes largely for forwarding, projection and failure handling.

Prefer a direct, typed readiness report contract carrying observation revision and scope, with
supervision at the actual invoking boundary. Preserve current stale-report rejection, immediate
readiness withdrawal on new observations, scope matching, startup/error/completed-child handling
and readiness retry. Do not copy the bank protocol mechanically: forms have an additional
submitted-intent assessment and a finite prewrite decision, while UI readiness is ongoing.

A protocol migration affects domain availability implementations for account creation, transaction
entry, management, profile and workspace rename. Discuss that larger batch before editing it, or
stage it through a clearly defined adapter. Do not silently expand a three-file cleanup into a
cross-application rewrite. Retain the composition-only `scoped-form-policy.ts` helper unless a
concrete protocol revision makes it redundant.

### 4. Transaction create/edit effects contain unmodeled workflows

The supplied write chain is `transaction-entry.ts` → integration callback →
`data.ts:createTransaction/updateTransaction`. The promise adapter in `scoped-form-write.ts`
does not make these effects leaf operations.

Creation validates input, acquires a transaction, stages transaction/check rows, queries tags,
chooses reuse/create/ambiguity outcomes, stages links, commits and waits locally. Editing queries
the existing transaction, checks edit restrictions, updates the row, reads links/tags/check details,
chooses retention/removal/addition and check-detail eligibility, stages writes, commits and waits.
These are workflows under the mandatory machine-first gate, including their transaction callbacks.

Give transaction persistence an explicit resource owner, preserving one SDK transaction:
open → read → eligibility/plan → stage → commit → local settlement, with precommit rollback and
postcommit settlement paths. Preserve tag ambiguity rules, unresolved historical assignments,
check-detail invariants and all existing write atomicity. The installed Jazz client exposes
explicit begin/commit/rollback APIs; the bank/workspace implementations already use resource
owners, but their domain policy must not be copied as a generic transaction controller.

Split create and edit into focused review cycles. Before implementation, inspect the high-level
SDK transaction API and its cleanup semantics for this exact path. Creation is also called by
sample-transaction integration; account for that caller explicitly rather than leaving a manual
actor-to-promise bridge in `data.ts`. Do not move read/check/write into another promise helper.
Simple profile/account/category/tag/rename data helpers currently perform validation/projection
plus one mutation/local wait; they do not need a transaction machine just to rename that boundary.

### 5. Avatar preparation is resource orchestration inside validation

`profileAvatarFormSchema` runs `resizeAvatar` and reads the encoded blob inside an async transform.
`domain/avatar.ts` acquires an ImageBitmap, initializes a resizer, creates a target canvas, resizes,
encodes, and closes the bitmap in `finally`. The current submission owner waits for the whole
validation promise on interruption, so actor cancellation is not evidence of leaked bitmap cleanup.
Nevertheless, the meaningful preparation stages and resource lifetime are hidden from the chart.

Treat this as its own profile preparation slice: keep pure file/value validation in the canonical
validation module, but expose decode/prepare/resize/encode/read-bytes/cleanup under a resource-owning
machine. Retain narrow bitmap cleanup at the platform boundary and preserve interruption priority.
Do not fold this work into the transaction persistence migration or introduce styling changes.

### 6. Retain independent post-save completion

The only production `complete` callback found is transaction-create navigation. The form invokes
it only after persisted success in the current scope; failure permits retry without saving again.
Same-scope readiness refresh does not undo saved success. Scope replacement/cancellation/shutdown
stop the completion invocation and discard its late result. The adapter checks AbortSignal before
calling SvelteKit `goto`; stopping the actor cannot promise to undo browser navigation already
accepted by the platform. Document and verify that limit rather than adding database-style drain
machinery to navigation.

## Review sequence and verification

1. Public submission progress report: remove full child snapshot copying without changing resource
   lifetimes, form behavior, domain policy or presentation components.
2. Readiness/report boundary review: design the ongoing UI and finite prewrite protocols together;
   agree on migration scope before changing all domain consumers.
3. Transaction creation resource ownership, then transaction editing ownership, each with installed
   SDK semantics and original-scope cancellation/settlement specified before effects are written.
4. Profile avatar preparation ownership, preserving canonical validation and platform cleanup.

Each implementation is a separate focused review cycle under D005. D006 stays unchecked until
approved relevant unit/Playwright coverage verifies report generations, permission/intent changes,
validation and prewrite interruption, issued-write settlement, partial/error outcomes, completion
retry, scope replacement and unmount draining. Update typed test doubles to speak public reports.
Existing test source was inspected for intended behavior, but no tests were run for this audit.
Application/session supervision and opt-in diagnostics remain separate unaudited work.
