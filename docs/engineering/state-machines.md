# State machines and resource ownership

Read before changing workflows, persistence, readiness, authorization, actor
lifetimes or native adapters. This is the shared engineering authority. Product
requirements, SDK/schema details and version qualification remain in the active
project records. These rules consolidate the imported Finance, Clipper, UI and
Local First memories; the stricter engineering baseline applies workspace-wide.

## Model before effects

Before implementation, record the operation's states, observed facts, events,
owner, input, identity/scope, lifetime and terminal outcomes. Apply this review
recursively to helpers, callbacks, transaction bodies and existing actor files.
Multiple business decisions, independently meaningful stages, or an acquired
resource spanning read/check/write/commit/rollback require a statechart first.
A function named persist/prepare/commit is not automatically a leaf operation.

States and named guards select admission, operation order, success, refusal,
partial success, failure, retry, cancellation and shutdown. Invoke child machines
for independently meaningful workflows. Promise actors execute one selected I/O
operation: a related snapshot read, ID generation, already-selected staging,
commit request, settlement wait or rollback. Related parallel reads and an
unconditional selected batch can remain one leaf. Do not conceal orchestration
inside a promise, action, repository method, transaction callback or controller.
Do not introduce one actor/state per primitive expression merely to satisfy this
rule. Pure validation, narrowing, projection and bounded native handling remain
ordinary functions. Show larger state/ownership designs before implementation.

## Ownership and communication

Choose boundaries by responsibility, independent lifetime and resource ownership,
not file size. Invoke fixed state-owned children; spawn dynamic populations only
under an explicit owner that handles shutdown. Do not manually start child actors
inside I/O leaves and await them through promise bridges. Create roots at actual
host boundaries, with result/error handling and cleanup ownership.

Actor input initializes; later observations arrive through typed events. Use
ongoing public reports for readiness/access and terminal output for finite work.
Parents must not reconstruct policy from private child paths/context or copy full
snapshots into a second lifecycle. Public snapshots/selectors are appropriate at
an explicitly designed observation boundary. Do not add a global bus, registry
or supervisor without a demonstrated requirement. A host-lifetime SDK registry
is not a rendered attachment's private cache or permission to create competing
sessions. Do not remove forwarding/status protocols before locating consumers.

Give each readiness/access decision one owner. Keep data, facts, counters,
resource payloads, references and selected results in context; keep lifecycle
in states, not synchronized phase/stage/pending flags. Actual data discriminants
remain valid. Domain facts must not travel through mutable fields on native
handles, closures or transaction resources. Publish typed outcomes once and pass
that chosen result to persistence and presentation.

Correlate reports with dependency binding, attachment/operation identity and
generation. A → B → A must reject old A reports. Invalidate capabilities immediately
on observed scope/identity/access replacement. Keep I/O bound to its admitted
resources, and enforce scope at admission, result consumption and transaction
commit boundaries rather than scattering checks around every repository leaf.

## Pure transitions and current APIs

Use the exact pinned, published XState version without package or declaration
patches. Read its installed `docs/index.md`, `docs/agents.md` and
`docs/api-stability.json`, plus the project's qualification record. Historical
v5 examples are provenance, not current syntax; use current schemas/function
transitions, immutable patches and queued effects. Prefer contextual inference
and checked contracts. New application/library code follows the strict type
rules in [dependencies](dependencies.md); do not use casts to erase actor types.

Guards/calculations can repeat. They must not mutate context, native resources,
WeakSets or bookkeeping, read clocks/randomness, or perform I/O. Return immutable
patches and queue selected effects. Read facts returned by actors. Completion
guards observe the pre-action context: use completion output, or retain a real
assessment boundary when a decision must observe changes from another region.
Bind invocation inputs from already-admitted facts, not an entry assignment that
has not happened yet. Preserve context-update order when composing patches.

Keep destinations and named domain predicates visible. Use total effect-free
choice nodes for pure routing; meaningful waits/context/effects use supported
conditional transitions. Do not add routing-only/action-only states that merely
repeat completion decisions. Synchronous effects may precede a shared final
state; thrown effects must not acknowledge success. Final states have the
installed version's entry/output semantics and cannot own new work/timers.

Classify events by sender. Only self-coordination belongs in internal event maps;
callback, worker, subscription and child reports are external to that actor.
Reject unrelated native lifecycle reports before enqueueing; consuming an event
can hide its invoke handler. Completed children may disappear before notification.
Consume output and retain the references needed by outstanding leases; a missing
child is not a release acknowledgement. Send only supported commands from the
state that owns the recipient. Preserve interruption priority across nesting and
parallel regions. Native handles stay opaque; do not freeze live SDK rows/arrays
into context. Copy observations through the supported project adapter.

## Browser execution and presentation

In browser applications, the main thread owns DOM, focus, viewport/selection,
rendering and narrow Window-only effects. Application/domain state machines,
SDK operations, persistence, validation, hashing, projections, extraction and
search preparation belong in workers. Moving work into a promise, debounce or
cache does not satisfy the boundary. A Window-only compatibility adapter must be
explicit, narrow and free of domain decisions. This strict baseline governs new
or changed work; it does not authorize an unreviewed rewrite of existing code.

UI interaction machines and their native resources remain component-owned on
the UI thread. Integrations bind subscriptions/dependencies and forward scoped
observations to the owning application runtime; pure presentation receives
bounded view data and callbacks. Complex forms have one workflow owner for
editing, validation readiness, capabilities, submission and operation coordination.
Simple input/disclosure remains presentation state. Do not relocate a large
component into a controller or extract components merely to move templates.

Machines own status/outcome-to-message selection. Views do not reinterpret domain
statuses with lookup maps. Preserve reactive locale and the designed translation
boundary; see [localization](localization.md) for the retained descriptor versus
worker-rendered-text distinction. Do not persist translated text or credentials.

## Transactions, persistence and local usability

Keep one resource owner across acquisition, transaction-local reads, guarded
eligibility, selected writes, commit, durability/settlement and rollback. Keep
checks and writes in the same transaction where atomicity requires it. Inspect
actual SDK callback/lifetime constraints; do not invent unsupported asynchronous
boundaries or split commits just to expose a chart. Atomic invariant rechecks may
remain at the write boundary but cannot be the only place policy is modeled.

Local availability, initialization provenance, remote freshness, local durability
and authority acceptance are different observations. An empty/partial replica is
not global absence or permission to recreate/repair an identity. Known local
records/access can support ordinary work without remote preflight; preserve
explicit online-only operations. Keep optional seeding, repair and reconciliation
from blocking unrelated local work. Retain operation identity and exact intent
for uncertain writes; never blindly replay them or claim remote acceptance from
local completion.

Native transactions have native timing. In IndexedDB, issue related commands
inside the active callback/transaction and acknowledge writes at transaction
completion, not request success. An arbitrary await can auto-commit. Retain narrow
abort/finished-transaction handlers and report actual settlement honestly.

## Errors, cancellation and shutdown

Every invocation, observer and spawned resource needs an unexpected-failure path.
Use invoke error boundaries for acquisition/promise/child errors. Actions are
synchronous; async actions are not awaited. Later DOM/SDK callback errors run
outside the actor stack and need typed reports or explicit rejection. Do not
remove necessary native catches/disposers or hide them in generic wrappers.
Classify failures once, sanitize diagnostics and retain acquired handles for
cleanup even when cancellation arrived during acquisition.

Model cancellation, unmount, navigation, reset, access/account replacement,
credential changes, child crashes, late results and shutdown from the first
statechart. Use native state-owned timers/delays for ordinary timeouts, preserving
actual cleanup obligations; a timeout is not rollback. Observe clocks/deadlines
through owned adapters. A late completion must not restart canceled work.

Graceful shutdown is a protocol: drain issued effects, await actual settlement,
clear secrets/transient bytes, release descendants/resources, then stop owners.
Do not assume stop runs exit actions, clears context or undoes native effects.
Inspect framework destruction ordering. Never await an acknowledgement from a
failed/completed actor. An observer completing on stop is not successful terminal
output or native disposal evidence. Preserve shutdown intent against late reports.
Retry navigation separately after a successful identity mutation.

Before review, inspect the whole changed actor tree and every helper for hidden
orchestration, stale reports, duplicated outcomes, resource leaks and secret
retention. Test real admission, branch order, failures, cancellation races,
unknown settlement and native cleanup after the approval required by
[testing](testing.md). Diagnostics belong at existing creation boundaries and
must not change ownership or log private payloads.
