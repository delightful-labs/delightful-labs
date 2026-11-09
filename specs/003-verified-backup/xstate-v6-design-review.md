# XState v6 design review and migration acceptance

Review baseline: DLF `814494d`, DUI main `a8fd11f`, Clipper main `78d611f`,
Finance main `218bd98`, inspected 2026-11-09. This is a source/design review;
DLF behavioral qualification still requires implementation approval.

## Evidence and authoring standard

Read the documentation shipped in `xstate@6.0.0-beta.1/docs` before authoring,
starting with `index.md`, `agents.md` and `api-stability.json`. That manifest
identifies the exact export stability for this beta. Web examples can differ
from the installed release. Use the published package without patches, local
declaration overrides, casts or untyped actor escapes.

This review read the agent and migration guides, execution order, actions,
transitions, context, choice states, internal events, state input, typestates,
invokes, async logic, subscriptions, lifecycle/errors, parallel states,
persistence, durable execution, testing, selectors and inspection.

| Decision               | Review requirement                                                                                                                                                                                                     | Source                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Transition calculation | No external mutation, native calls, wall time or randomness; queue effects and retain immutable earlier snapshots. Reject before enqueueing.                                                                           | [Execution order](https://stately.ai/docs/xstate/v6/how-xstate-runs-machines), [actions](https://stately.ai/docs/xstate/v6/actions) |
| Routing                | Use choice nodes for total, effect-free decisions. Keep `always` for waiting or steps that update context/run effects. Visible literal destinations aid review; a runtime graph of function transitions is incomplete. | [Choice](https://stately.ai/docs/xstate/v6/choice-states), [graph analysis](https://stately.ai/docs/xstate/v6/transition-functions) |
| State contracts        | Refine established facts with typestates. Evaluate state input for data confined to one active state; data needed for drain/reconciliation must survive it. Neither provides runtime validation automatically.         | [Typestates](https://stately.ai/docs/xstate/v6/typestates), [state input](https://stately.ai/docs/xstate/v6/state-input)            |
| Event origin           | Separate public commands, child/native reports and self-coordination. Only the last can use internal events; parent/sibling reports would be rejected. Validate realm/network inputs independently.                    | [Internal events](https://stately.ai/docs/xstate/v6/internal-events)                                                                |
| Child lifetimes        | Invoke state-owned work; spawn only with explicit longer lifetime/stop ownership. Type child protocols where practical; handle results from events rather than completed-child lookups.                                | [Invoke](https://stately.ai/docs/xstate/v6/invoke), [lifecycle](https://stately.ai/docs/xstate/v6/lifecycle-and-errors)             |
| Cancellation           | Pass signals to cooperative leaves. A timeout/stop is not a native write rollback. Drain or retain unresolved receipts before shutdown; no blind retry.                                                                | [Cancellation](https://stately.ai/docs/xstate/v6/cancellation), [timeouts](https://stately.ai/docs/xstate/v6/timeouts)              |
| Terminal behavior      | Final entry/exit actions are supported; output sees entry context updates. Final nodes cannot run transitions/invokes/timers. Keep exit, cleanup and notification order explicit.                                      | [Final states](https://stately.ai/docs/xstate/v6/final-states)                                                                      |
| Observation            | Read initial state before subscribing; `actor.select` does not replay its current value. Observe dead letters separately from inspection and define host error ownership.                                              | [Selectors](https://stately.ai/docs/xstate/v6/selectors), [inspection](https://stately.ai/docs/xstate/v6/inspection)                |
| Persistence            | Inventory actual restored XState snapshots before adding versions/migrations. Native handles and secrets are not checkpoints. Jazz journals and XState durable steps have different guarantees.                        | [Persistence](https://stately.ai/docs/xstate/v6/persistence), [durability](https://stately.ai/docs/xstate/v6/durable-execution)     |

New features need an ownership reason. Route states, global registries, durable
execution and framework bindings are not automatic upgrade requirements. The beta
marks `xstate/durable`, validation and pure-system facilities experimental; do
not introduce them merely to complete a migration checklist.

## Findings corrected in DLF

1. **Final entries were misclassified.** The previous conversion relocated cleanup
   away from final entries and risked changing source-exit/terminal ordering.
   Restore the original owning final entries and
   remove `createFinalTransitions` and its helper file. Targets are again literal
   objects in the chart. Native drain still happens before terminal entry. This
   correction requires terminal-output and exit/cleanup-order regression checks.
2. **Release admission mutated past snapshots.** `session-acquisition.ts` called
   `WeakSet.add` during transition calculation. Released attachments now use an
   immutable array of weak references, pruned on accepted release. Previous
   snapshots retain their own membership, and live attachment tombstones remain
   weakly retained. Qualify repeated release, stale acquisition and `can()` purity.
3. **Native preparation and cleanup bypassed the effect queue.** Journal
   preparation/claim, restore validation, reader/export disposal, inspection
   transfer and envelope key/buffer release now queue their native operations.
   Journal decode/encode reports completion before the chart evaluates the next
   step, without adding an awaited microtask to the IDB callback path. Decoded
   journal observations belong to chart context and clear at termination; borrowed
   result publication is an entry effect, not a mutation in `facts(context)`.
   Qualify transfer-before-disposal, borrowed output lifetime and native IDB
   liveness; do not infer those guarantees from queueing alone.
4. **Decision-only states retained v5 scaffolding.** Total, effect-free routing
   nodes now use choice states. Conditional waits and context/effect-producing
   steps retain `always`; choices must always return a destination.
5. **Self-coordination was public.** Move only verified self-raised events into
   internal schemas: envelope/inspection `SYNC_APPLIED`, backup scope
   `HANDOFF_SETTLED`, startup `DRAIN_SEED`/`REPLACE_SEED`, recovery
   `RELEASE_REQUEST`, restoration `RELEASE_CREDENTIAL`, readiness `PROJECTED`,
   and form `OBSERVATION_CHANGED`/`CAPABILITY_ACCEPTED`/`AVAILABILITY_FAILED`.
   Native callback and child reports stay deliverable. These private events are
   intentionally removed from the inferred public actor protocol.
6. **Child contracts and resource assumptions were implicit.** Session readiness
   declares typed observer/retry children with stable IDs. Journal-step `running`
   requires a prepared request through a state context schema, replacing a
   repeated runtime assertion. Generic factories retain their typed actor input,
   event and output contracts; extending `schemas.children` across generic
   injected sources still needs a sound beta-compatible design and type checks.
   Do not widen sources or patch XState to force an optional feature.

The weak references are in-memory admission bookkeeping, not durable state.
Native custody remains a private receipt adapter; this review does not establish
that arbitrary generic resources can be serialized or safely frozen. DLF roots
with such resources are non-persistable by contract. Do not export their context
as a worker DTO or checkpoint.

## Parallel ownership audit

The eight parallel charts have explicit interruption and work dimensions. This
source inventory is not runtime equivalence evidence.

| Chart                             | Regions                 | Required race/exit evidence                                                                                                                            |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forms `scoped-form.open`          | availability / workflow | Availability shutdown must not end submission custody; completion waits for both regions. Scope invalidation wins over late capability/result reports. |
| Profile avatar `running`          | control / flow          | Cancellation prevents later staging while draining an issued write; preserve partial outcomes and temporary resource cleanup.                          |
| Creation operation `running`      | control / work          | Journal/reconciliation/persistence completions observe interruption without resetting it; retained attempts survive unknown settlement.                |
| Creation transaction `running`    | control / work          | Open/read/stage/commit checkpoints consume cancellation; commit already issued is drained and custody retained if uncertain.                           |
| Invitation authority `running`    | control / work          | Do not lose a late acquired transaction or create a second recovery owner after output handoff.                                                        |
| Invitation redemption `redeeming` | control / request       | Late request completion does not overwrite cancellation/closed outcomes.                                                                               |
| Workspace journal `running`       | control / work          | Native IDB completion/abort evidence survives closing; request success alone never acknowledges commit.                                                |
| Workspace naming `writing`        | control / work          | Cancellation/change-of-binding does not restart the write or reset the control region.                                                                 |

For each, compare v5/v6 same-event handling, sibling reentry and the complete
state value. Use `args.value` for the current calculation. A region-local target
no longer resets siblings in v6; add wider resets only where product behavior
requires them. Do not infer sibling updates from the same event before they apply.

## Other repositories

- **DUI:** the merged SwipeActions chart has no parallel/native transaction or
  snapshot-restoration boundary. `revealing` and `armed` are resident states,
  so their conditional `always` transitions remain appropriate. `restoring`
  patches context and `chosen` emits, so neither is a choice node. Keep dismissal
  completion public: it comes from the mounted DOM animation owner. Do not move
  these machines into workers. Record this review in its follow-up documentation.
- **Clipper:** current main already contains the complete application worker.
  Its `host-machine`, `account-store`, `storage-channel`, `broker-channel`,
  protocol and DLF transaction bridge are migration units, not templates to
  replace with generic async functions. Preserve the alpha.60 Jazz patch pairing,
  same-account Web Lock/storage identity, drain acknowledgment and worker shutdown.
  Native callback-origin reports cannot become internal events. Upgrade v5
  diagnostics and audit explicit child IDs, subscriptions and completion lookups.
- **Finance:** its current provider worker owns a disposable HTTP request, not
  Jazz/domain runtime. Split Window UI/browser capabilities from a worker-owned
  session, workspace, query and transaction graph. Keep WebAuthn/focus/navigation
  in Window; preserve explicit user-initiated provider operations. Update v5
  inspection consumers and framework bindings alongside complete actor graphs.

Clipper/Finance main now use Jazz alpha.60 and newer shared artifacts. DLF's
current migration branch still uses alpha.59: no implicit Jazz upgrade or consumer
archive compatibility is inferred from this review. Qualify the chosen shared
artifact against the exact consumer runtime. local-first-ux-patterns is excluded.

## Required evidence before merge

After implementation approval, migrate relevant tests/fixtures and compare the
retained v5 baseline with v6 traces. Cover forbidden events, event bubbling,
private-event rejection, pure `can`/transition evaluation, previous-snapshot
immutability, final output/cleanup order, cancellation/reentry, late acquisition,
unknown writes and child/host errors. Native and browser checks remain necessary.

Use bounded `waitFor`, virtual time for timers and controlled completion ordering.
Keep existing expectation strength; do not edit baselines to accept unexplained
differences. Sampled traces, bounded exploration and platform qualification are
different evidence. Record event cases, bounds, engine/SDK versions and omissions.

Run production checks and package/declaration checks before review. Full checks,
packaged consumers, real native ownership and UI/worker acceptance follow their
review gates. A readable chart or a successful type check is not a parity claim.

## Validation of this revision

Production TypeScript/Svelte (`pnpm check:library`), changed-source Oxlint, Oxfmt,
Git whitespace checks and `pnpm package`/strict Publint pass on the unpatched
beta. No implementation tests or codemod replay ran; the implementation-review
gate still applies. PR #37 uses `[skip ci]` until that gate is cleared.
