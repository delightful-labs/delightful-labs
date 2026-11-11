# Transaction creation ownership

Status: implementation reviewed and verified. The creation slice of D005/D006 is complete;
[editing](transaction-editing.md) is also reviewed and verified. Avatar preparation remains unfinished.

## Ownership

The transaction-entry form and sample-data workflow both call `data.ts:createTransaction`.
That helper hides validation, transaction acquisition, tag reads and decisions, staging, commit
and local settlement inside one async callback. Replacing only the form callback would leave
the same workflow hidden in the sample caller.

The proposed tree is:

```text
integration (Jazz binding, observations, teardown)
├── form → submission → prewrite readiness → creation persistence
│                                         └── one Jazz transaction
└── sample batch → current creation operation → creation persistence
                                             └── one Jazz transaction
```

Keep fresh domain readiness and captured identity/workspace/account scope outside persistence.
The sample batch must use the same creation authorization boundary for each item, rather than
assuming its initial menu eligibility authorizes all 25 writes. Preserve form navigation as an
independent completion effect after persisted success.

## Resource statechart

Creation persistence owns these stages and their failure transitions:

```text
validate → open → read tags → plan → stage rows → commit → wait local → succeeded
                    │         │         │
                    └─────────┴─────────┴── failure/interruption → rollback → terminal
```

Validation and planning are pure. Each promise actor performs one SDK operation; no actor or
helper contains a transaction callback with its own read/check/write sequence. Planning resolves
normalized tag reuse, new tags and ambiguity before staging. Stage check details, transaction,
new tags and links in the same transaction. A synchronous staging action may apply an already
computed write plan; it must not query or make new eligibility decisions.

Preserve current schema checks, integer money representation, optional-field behavior, shared
transaction/check-details ID, organization/kind filtering, active-tag ambiguity rejection and
atomicity. No partial collection of rows is a successful creation result.

The installed Jazz runtime provides explicit `Db.beginTransaction()`, `Transaction.commit()` and
`Transaction.rollback()`. Its callback helper itself opens, commits and attempts rollback on
callback/commit failures. Explicit ownership must preserve that cleanup instead of merely
removing the callback. Commit returns a handle whose transaction ID can reject asynchronously;
local settlement must await the handle, not just the synchronous `commit()` call. Commit can
also wait for pending reads, so finish planned reads before issuing it.

Before commit, cancellation/invalidation/shutdown prevents further staging and enters rollback.
Retain an in-flight acquisition/read until it resolves so its acquired transaction remains owned.
Retain the child while rollback settles. A false rollback result or rollback rejection needs an
explicit uncertain failure result, rather than an unverified claim that resources were released.

After commit is issued, retain the transaction owner through local settlement; cancellation does
not undo an issued write. On commit/settlement rejection, attempt the SDK-supported rollback and
report uncertainty unless evidence establishes rejection. Successful local settlement remains
persisted even when the original caller has closed or changed scope. The caller suppresses stale
presentation/navigation while retaining the actual settlement in its interrupted result.

## Composition and lifecycle changes

Extend the existing prewrite machine's persistence boundary to accept an invoked actor with a
typed finite result as well as existing leaf write effects. Keep its refresh, original-scope and
readiness decisions. Forward interruption commands to live persistence actors and retain them
until completion; do not create an actor-to-promise bridge or inspect private child states.
Preserve the existing leaf-write API for simple single-mutation consumers.

Creation persistence reports actual settlement through its finite output. The prewrite owner
must preserve that output, including failure/uncertainty, instead of automatically interpreting
every completed child as a successful write. Parent interruption priority still applies.

Replace the sample machine's `create(index): Promise<void>` callback with an invoked creation
operation. The integration supplies pure per-item input preparation and current observations.
The batch owns iteration, counts, partial/failure outcomes and interruption. Cancellation stops
future items and drains the current creation child. Use explicit teardown ownership that sends
shutdown and waits before stopping; automatic framework teardown must not stop the batch first.

Remove the production `createTransaction` promise helper when both callers migrate. Keep
`updateTransaction` for the later edit slice. Test fixtures must not justify retaining a hidden
production workflow or adding a manual actor bridge.

## Implementation review batch

The reviewed scope was eight production files. Source inspection identified one additional
integration argument to remove; that expansion was explained before editing. Both callers and
the shared invocation boundary migrate together:

1. New `src/lib/machines/transaction-create-persistence.ts`: resource owner and pure write planning.
2. `src/lib/machines/scoped-form-write.ts`: invoked persistence boundary and interruption forwarding.
3. `src/lib/machines/scoped-form-policy.ts`: composition types for actor-backed persistence.
4. `src/lib/machines/transaction-entry.ts`: shared creation operation composition.
5. `src/lib/components/TransactionEntry.svelte`: supply the bound database instead of an async workflow.
6. `src/lib/machines/sample-transactions.ts`: invoke creation and drain the current item.
7. `src/lib/components/SampleTransactions.svelte`: observations, item preparation and teardown wiring.
8. `src/lib/data.ts`: remove only the obsolete creation helper/imports.
9. `src/lib/components/TransactionEditEntry.svelte`: remove its unused creation callback argument.

Creation now follows validate → open → optional tag read → plan → stage → commit → local settlement.
Interruption is a parallel control region, so acquisition, reads, staging and cleanup remain invoked
until they settle. Guards prevent progression into another precommit stage after interruption.
Rollback success before commit reports `rejected`; false/rejected rollback or a failure after commit
reports `unknown`. Final states clear captured input and transaction payloads.

The shared write boundary accepts exactly one leaf effect or persistence actor, forwards interruption
only to a live child and routes finite results to explicit terminal states. Existing leaf consumers
retain their write API. The creation/edit composition also requires its corresponding database or
save dependency. The sample batch retains each child's finite result and counts locally persisted
items even when scope changes or shutdown wins presentation priority. Its integration subscribes
for completion before sending shutdown, then stops the actor after draining.

Recursive source review covered all changed promise actors and their helpers. Validation and row
planning are synchronous transformations; the staging leaf materializes the decided rows in one
transaction. SDK acquisition, query, commit, local wait and rollback each have separate invocations.
No production actor-to-promise bridge or callback transaction remains in creation.
[Editing ownership](transaction-editing.md) replaces the former editing callback in its separate slice.

## Approved verification

Creation tests moved from `data.test.ts` to the persistence actor boundary. Shared fixtures replace
only SDK effects; normalization, check details, tag reuse/creation/ambiguity and atomic transaction
composition retain coverage. The batch and transaction-entry tests now invoke the real creation
machine. Browser seeds use that persistence actor instead of retaining the removed promise API.

The relevant 15-file unit run passed 283 tests. Six further composed-operation cases were then
added; the focused two-file rerun passed all 46 tests, bringing the covered total to 289 tests.
Coverage includes retained acquisition and reads on interruption, awaited rollback, false/rejected
rollback, failures before/after commit, original-scope invalidation, reentrant acquisition/shutdown,
shutdown priority, postcommit draining, finite failure propagation, partial sample batches, failed
child supervision, per-item authorization refresh and independent post-save navigation.

`pnpm check` passes with zero errors/warnings; `pnpm check:tests`, Prettier and `git diff --check`
pass. The former fixture diagnostics are resolved. Production implementation did not change during
this verification cycle.

All 32 relevant Playwright checks pass: nine form-presentation checks, eight transaction-edit
checks and 15 transaction-workspace checks. These exercise real in-memory Jazz persistence,
desktop/mobile creation and cancellation, independent completion/navigation, offline create/edit,
historical tags, check details, pagination/reload and repeated offline income/expense sample batches.
The sample tests verify two batches per kind and actual persisted counts of 25 then 50.

The first browser file filter also matched a hidden worktree and was interrupted. The subsequent
run used an absolute checkout-anchored filter. Existing workspace tests had obsolete unscoped URLs
and an Overview cancel destination; inspection of the unchanged production component confirmed that
Cancel returns to its income/expense section. Assertions now verify the exact workspace plus current
section and pagination. The focused workspace rerun passed all 15 checks; the 17 other checks had
already passed. No route or cancellation behavior was changed to satisfy those tests.
