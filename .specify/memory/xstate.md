# XState design memory

Read before designing stateful workflows, readiness, authorization, or async operations.
Adapted on 2026-10-31 from Finance's `.specify/memory/xstate.md` at `8ff72f6`.
The constitution and active spec define scope; these rules do not authorize implementation.

## Mandatory machine-first gate

Before writing an async function or `fromPromise` body, list meaningful steps, decisions,
resources, and terminal outcomes in a design note. Start with a statechart when there are
read/check/write decisions, independently meaningful stages, distinct retry/cancellation paths,
or an acquired resource spanning commit/rollback/cleanup. Apply this recursively to helpers,
transaction callbacks, and existing actors. Wrapping procedural orchestration in a promise actor
or moving it to a machine directory does not satisfy the gate.

Define states, guards, events, ownership, interruption, and cleanup first. Promise actors perform
individual leaf operations. Pure transformation, narrowing, and narrow resource-boundary handling
may remain imperative. Do not mechanically create one state or actor per expression or SDK call.

A transaction owner must model eligibility, acquisition, staging, commit, settlement, and rollback
where those are real steps. Keep one atomic transaction when required; do not split writes merely
to expose states or invent async boundaries the SDK cannot support. Recheck atomic invariants at
the write boundary after the modeled decision. Inspect actor helpers recursively before review.

## Actor ownership and communication

- Keep reusable machines under `src/lib/machines/`. Choose children by responsibility, resource
  ownership, and lifetime rather than file size. Draw the ownership tree and public protocol first.
- Invoke fixed children whose lifetime follows a state. Spawn dynamic populations only when their
  lifetime warrants it. Avoid manually starting children and awaiting promise bridges.
- Use typed events/reports for continuing observations and invocation output for finite results.
  Actor input initializes; subsequent facts arrive through events. Child context/state paths remain
  private. Do not introduce a global registry, bus, or supervisor without a demonstrated need.
- Use native `forwardTo`/`sendTo` actions in the state that owns the recipient invocation.
  Do not rediscover a fixed child's lifetime through `self.getSnapshot().children` for routing.
  Nested handlers must include the parent's interruption/binding actions explicitly. Send only
  commands the child can receive; promise leaves settle under the owner's drain protocol. In
  parallel regions, keep existing control-state precedence when the work state sends commands.
- Give each readiness/access decision one owner. Context holds observed facts, payloads, references,
  and results; states own lifecycle. Do not duplicate lifecycle in phase fields or pending flags.
- Correlate reports by dependency binding and generation, not just workspace ID. A → B → A must
  reject old A reports. Invalidate scoped decisions immediately on observed identity/access changes.
- Integration components own subscriptions, dependency binding, actor attachment, and browser effects.
  SDK adapters provide backend leaf operations; machines consume typed boundaries. Presentation
  receives selected view models and callbacks, not SDK handles or actor policy to reconstruct.

## Local usability and forms

Keep local availability, initialization provenance, remote freshness, persistence, and authority
acceptance distinct. Locally usable work must not wait for optional seeding, repair, or reconciliation.
An empty replica is not evidence of a new identity or permission to recreate data. Unknown writes
retain identity/recovery facts and are not blindly replayed.

A complex form has one workflow owner for editing/submission, validation readiness, capabilities,
and operation coordination. Simple disclosure, draft input, and UI-library state may remain local.
Do not infer domain readiness from combinations of component flags or reconstruct access in views.
Translate message descriptors and format values at the presentation boundary so locale changes react.

## Completion, errors, and shutdown

Use explicit success, partial success, cancellation, and failure states with typed terminal results.
Classify outcomes once. Guards run before transition actions; inspect `event.output` when routing
on an invoke result rather than expecting a same-transition assignment to be visible to the guard.
Use meaningful decision states; avoid transient routing-only states where invoke completion guards
already express the decision.

Every invocation needs an unexpected-error path, including observers and child machines. Entry
and exit actions are synchronous; async actions are not awaited. Invoke fallible I/O. DOM and SDK
callbacks outside the actor stack must bridge errors with typed reports or an explicit rejection.
Do not remove narrow resource cleanup catches merely to hide syntax.

Cancellation, unmount, identity/workspace replacement, access loss, retries, and child crashes must
respect resource ownership. Retain an acquired handle even if cancellation arrived during acquisition,
then clean it up. Stopping a promise actor discards output; it does not prove side-effect cancellation.
Closing a dialog does not undo a committed write or identity transition.

Graceful shutdown is a protocol: request drain, settle active work, clear secrets, then stop owners.
Do not assume `actor.stop()` executes exit actions or clears context. Never wait for an acknowledgement
from a failed/completed child. Check framework hooks against the installed adapter: automatic stopping
may run before later cleanup hooks. SDK session ownership may outlive a rendered layout; drain scoped
work before identity-changing calls and track issued calls until settlement. Retry navigation separately
from a successful identity mutation.

Before implementation review, inspect the whole changed actor tree for hidden orchestration, stale
reports, secret retention, duplicated classification, and cleanup bypasses. Identify affected unit
and browser tests; add or run them only after implementation approval. Static checks do not prove races
or cleanup. Inspect at existing actor boundaries without changing ownership or logging private data.

## Extracted workflow dependencies

Forms, workspace initialization/startup, durable explicit-creation ownership/recovery, profile
editing and restoration coordination expose typed factories under documented public subpaths.
Consumers inject policy/schema/storage capabilities rather than fork these statecharts.
Caller-supplied promise capabilities still must be leaf operations; the factory boundary is not
an exemption from recursive workflow review. Host application lifetime owns a Jazz startup
registry, and layout attachments do not acquire competing sessions. See `docs/next-app.md`.
