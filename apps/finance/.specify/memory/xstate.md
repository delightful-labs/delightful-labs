# XState design memory

These are user-approved architectural lessons from the bank-sync refactor. Read this before
implementing complex workflows, authorization, readiness, or derived UI capabilities. The
constitution is authoritative; use the active feature artifacts for behavior requirements.

## Current v6 migration contract

The connected Finance graph targets unpatched `xstate@6.0.0-beta.1` and
`@xstate/svelte@6.0.0-beta.0`. Historical v5 examples below describe ownership,
not current authoring syntax. Read the exact installed package's docs and stability
manifest before relying on a beta API.

- Calculations can be repeated. Return immutable context patches; enqueue mutable
  bookkeeping and native effects. Mutating a `WeakSet` while selecting a spawn can
  reject the recalculated transition and lose the child.
- Invocation input is selected before its owning state's entry context patch.
  Bind it from the admitted request or assign binding/generation in the incoming
  transition. Retain the same facts for later settlement and drain correlation.
- A targetless `{}` consumes an event. Broad native lifecycle handlers must reject
  unrelated actors with `undefined`, before enqueueing, so the corresponding invoke
  handler can run. Prefer invoke handlers or explicit payload matches.
- Completed/failed children can be removed before their notification arrives.
  Use completion output, and retain recipients with the leases whose later release
  needs them. A child disappearing is not a resource-release acknowledgement.
- The installed Svelte binding's `useActorRef` still calls `stop()` on destruction.
  Own roots explicitly when graceful shutdown and financial/native cleanup must
  finish first. Public actor refs do not confer ownership of start/stop lifecycle.
- Copy live Jazz query rows and arrays with `observeRow` / `observeRows` before
  admitting them as actor observations. Development snapshots freeze plain context;
  retaining a live subscription array prevents Jazz from applying later deltas.
- Native browser/SDK handles are opaque resources. Tests must model that opacity;
  do not disable freezing or use mutable plain-object SDK/canvas substitutes that
  the engine correctly treats as immutable application data.

See `specs/013-local-first-startup/xstate-v6-finance-implementation.md` for
qualification and the still-pending application-worker handoff.

## Mandatory machine-first gate

Apply this gate **before writing the implementation**, not after the user identifies a complex
function. It applies recursively to helpers, promise actors, nested callbacks, transaction bodies,
and code already inside a machine file. Function names such as persist/prepare/commit and comments
such as "one atomic effect" are not evidence that the operation is a leaf.

1. List the operation's independently meaningful steps, decisions, acquired resources, and terminal
   outcomes in the current plan or a short design note. Classify it as a leaf operation or a workflow.
2. Start with an XState machine if it contains any of these:
   - Sequential business decisions, including read -> inspect results -> choose whether/what to write.
   - Distinct stages that need separate cancellation, error, retry, or outcome handling.
   - An acquired resource whose lifetime spans read/check/write, commit/rollback, or cleanup paths.
3. Define states, guards, events, resource ownership, and interruption/cleanup paths first. Then add
   invoked child machines and leaf actors. Do not first implement a procedural async workflow and
   wrap it in `fromPromise`, or plan to convert it into states later.
4. A promise actor may execute one leaf operation: query a related snapshot, generate IDs, stage an
   already-decided set of inserts, request commit, await settlement, or request rollback. Related
   `Promise.all` reads and an unconditional insertion loop can remain one leaf. Combining these
   stages into a promise that makes intervening business decisions is orchestration and fails the gate.
5. Before presenting the change, inspect each changed actor **and the functions/callbacks it calls**.
   Verify that every workflow step is visible as a state/invocation and every business branch as a
   guarded transition. If not, refactor before claiming the change is ready for review. Report the
   state sequence and any retained boundary invariant briefly; type-checking does not validate this gate.

### Transactions are not an exemption

Preserve one SDK transaction across child-machine states when its API supports that lifetime:
open -> read -> guarded checks -> stage writes -> commit -> settle, with rollback/cleanup on the
appropriate paths. Inspect the SDK rather than assuming callback or cancellation semantics.
Do not split the writes into separately committed transactions just to expose more states.
If the SDK requires a callback with restricted lifetime, document the actual restriction and model
policy and resource ownership explicitly; do not invent unsupported async transaction boundaries.

A narrow transaction-time invariant recheck may remain imperative when necessary for atomicity,
but it must repeat an already-modeled decision, not introduce the workflow's only policy check.
It does not justify hiding acquisition, queries, policy decisions, writes, commit, and cleanup in one
promise actor. Pure validation/transformation, type narrowing, and low-level resource-boundary
handling are not workflows merely because they contain conditionals.

### Failure pattern from workspace creation

Rejected: async persist function -> promise actor wrapping that function -> parent machine invoking
a commit promise that still reads, checks, writes, and commits internally. Each revision leaves the
nested workflow hidden until that nested operation becomes its own resource-owning machine.

Required: persistence owner validates/hydrates and invokes a transaction child. The child owns one
transaction, guarded eligibility, staging, commit, settlement, and rollback; its leaf actors contain
no new orchestration. Apply the same reasoning to the next nested helper without waiting for another
user correction. Do not turn every expression into a state or create one machine per trivial SDK call.

## Start with the model

Write down the states, observed facts, events, ownership tree, and terminal outcomes before effects.
Include cancellation, identity/workspace changes, retries, and shutdown in that first model. For
larger work, show the statechart to the user before implementation.

Sequential business `if` statements are a signal that a child machine may be missing. State derived
from two or more conditions usually belongs in XState. Apply this review inside actors and helper
files as well as components. Moving a function into a machine directory or wrapping it in
`fromPromise` does not expose its decisions to the statechart.

For example, preparation that checks identity, permissions, ownership, and existing/new connection
selection should be a machine with guarded transitions. Its database queries and UUID generation
are focused actors. The same applies to transaction acceptance/omission, mapping eligibility, and
complete/partial result classification.

Do not mechanically turn every predicate into another actor. Guards express decisions, context
stores data, pure functions transform values, and simple form/disclosure state stays local. Keep
low-level abort/disposal checks in resource adapters. Atomic transactions must recheck invariants
inside the transaction, even when a machine already checked them before the write.

## Compose small actors with clear owners

Put machine definitions in `src/lib/machines/`. Integration components bind subscriptions and
platform dependencies, own or attach actors, forward observations, and compose pure presentation.
Do not replace a large component script with a large controller file.

Use child machines for independently understandable workflows: initialization, authorization,
preparation, setup, mapping, account traversal, and individual transaction processing. Invoke children
whose lifetime follows a state; spawn dynamic children under an explicit parent and stop obsolete
ones. Avoid manually starting child actors and awaiting them through promise bridges.

Application readiness starts before SDK initialization. It owns startup and the workspace/integration
subtree once dependencies become available. Keep identity, workspace, membership, and credential
readiness distinct. Model supported observations only: browser online status is not proof of Jazz
sync connectivity, and a missing SDK observer is a reason to omit that state.
Model available local data and locally known authorization independently from initialization
provenance, optional seeding, attribution repair, reconciliation, and remote freshness. A known
local membership and grant may permit an ordinary action without a remote response; an empty or
partial replica cannot authorize bootstrap, restoration, or repair. A recovered identity must not
be treated as new because its local query is empty. Identity, workspace, membership, or grant
replacement invalidates scoped decisions immediately; later observations can restore them.
Local persistence is an observed outcome distinct from remote acceptance, rejection, or an
unknown remote outcome. Preserve operation identity and recovery facts across interruption;
do not replay an unknown write or block unrelated local work while seeking remote resolution.

## State-first UI and form ownership

Status-to-message mappings belong with the owning machine, including connection
status, historical outcomes, import settlement and failure reasons. Publish typed
message descriptors through state metadata or the machine's public view selector;
do not make consuming components interpret domain values using local lookup maps
or conditional chains. Persisted history uses the same machine-owned presentation
contract. Components translate the supplied descriptors with Paraglide and render
them, keeping locale changes reactive. Keep translated strings out of persisted
data and machine context; the machine owns which message applies, while the
component owns translation. Do not add or edit Paraglide messages without the
explicit approval required by localization.md.

- A complex form is one UI workflow with a parent machine owning the form lifecycle, editable/locked
  capabilities, validation readiness, submission, and child operation coordination. Do not split
  unrelated pieces into component-local state and infer an overall workflow in Svelte effects.
- The integration component owns subscriptions and dependency binding, translates Jazz observations
  into typed parent events, creates/attaches the root actor, and coordinates graceful shutdown.
  Presentation receives a discriminated view model derived from the parent snapshot and emits typed
  user-intent callbacks. It does not reimplement multi-fact eligibility or keep duplicate pending,
  permission, or linked-state flags.
- Parent and child boundaries follow responsibility, data ownership, and lifetime. Invoke a fixed
  child when its lifetime follows a parent state; spawn only dynamic populations or lifetimes that
  genuinely do not fit invocation. The parent coordinates through typed events and finite invoke
  outputs or explicit long-lived reports; it does not inspect private child state to reconstruct
  policy. Parallel regions are independent dimensions inside one machine, not substitute actors.
- Actor input is initialization, not a reactive binding. Later observation changes use typed events
  with scope/generation correlation. Avoid Svelte effects that read reactive observation state and
  synchronously write back into that same dependency cycle; render selected actor state through
  subscriptions/selectors.
- Convenience lifecycle hooks must preserve the designed drain protocol. In installed
  `@xstate/svelte@5`, `useActorRef` starts the actor and calls `stop()` on component destruction;
  use it only when immediate stop is the intended lifecycle. A root with graceful child cleanup needs
  explicit ownership and shutdown handling.

## Design orchestration boundaries before adding machines

A collection of machines is not yet a well-designed actor system. Before implementation, draw the
ownership tree and record each actor's responsibility, lifetime, accepted commands, public reports,
terminal output and cleanup obligations. Review both the statechart and communication protocol.
The current workspace-focused reference is
[`008-actor-orchestration`](../../specs/008-actor-orchestration/spec.md); its deferred tasks are not
permission to refactor unrelated subsystems.

- Choose boundaries by responsibility, independent lifetime and resource ownership, not file size or
  the existence of an async function. Use nested states for phases of one responsibility. A child
  machine is justified when it encapsulates a coherent workflow/resource or independently meaningful
  lifetime. Do not mechanically add one wrapper per step or merge resource owners just to reduce files.
- Prefer invocation for fixed children. Invoke on a compound parent state when the child must survive
  transitions between its normal-work and graceful-drain substates. Use spawning for dynamic
  populations or lifetimes that genuinely do not fit state ownership; crossing sibling substates alone
  does not require spawning. Parallel regions share one machine/context and receive the same events;
  separate actors have their own state and explicit message contracts.
- Treat child context and state paths as private implementation details. Publish small domain reports
  for ongoing readiness/access changes and use invocation output for finite results. Presentation can
  observe public snapshots/selectors; parents should not copy full snapshots and inspect private
  operation fields to reconstruct child policy. Snapshot observation itself is supported and can be
  appropriate at an explicitly designed boundary.
- Actor input initializes that actor; later facts arrive through typed events. Prefer typed recipient
  references supplied through input/events and `sendTo` for ongoing communication. Use `invoke.onDone`
  and `invoke.onError` at finite-operation boundaries. Do not replace local typed relationships with
  a global bus, registry or generic supervisor without a demonstrated requirement.
- Give each readiness/authorization decision one owner. Other actors consume its scoped result;
  persistence still rechecks atomic invariants. Keep route state distinct from access state and
  identity-wide capabilities distinct from selected-workspace capabilities.
- Correlate asynchronous reports with their dependency binding and operation/observation generation.
  Invalidate published capabilities immediately on identity, environment, scope or authority changes.
  Equal workspace IDs do not make an old result current after switching away and back. Store observed
  facts/results in context, not a second lifecycle made of synchronized flags.
- Keep integration components responsible for Jazz subscriptions, dependency attachment and browser
  effects. They must not become the message router that interprets one actor's private state for
  another. Independent UI actors may remain component-owned; actors sharing domain policy/lifetime
  need an explicit coordinating relationship.
- A parent supervises direct children; each resource owner handles its own cleanup and descendants.
  Graceful shutdown is a domain protocol, distinct from actor stopping. Await real settlement where
  required, but never await an acknowledgement from an already failed/completed child. Distinguish
  normal failure output from an actor crash. Preserve shutdown intent against late reports/retries.
- Review the installed XState version and platform adapter semantics before relying on examples.
  Optional inspection should expose actor lifetimes and event causality without logging secrets or
  private finance payloads. Static checks alone cannot validate an ownership or race model.

Before presenting a refactor, explain which boundaries changed, which policy now has a single owner,
and how stale reports, replacement and shutdown are handled. Work one subsystem/review cycle at a
time; leave unrelated audits as explicit unchecked tasks rather than expanding the current change.

## Let states own behavior

### Prefer guarded invoke completion over route-only states

XState has `entry` and `exit` actions, not a separate `before` hook. Use an `always` transition when
the state represents a meaningful assessment or decision. Avoid adding a transient `before...`
state solely to check interruption and immediately route to the next invoked operation. Put those
guards and routes in the preceding invoke's ordered `onDone` transition array instead. This keeps
the completion boundary and its next decision together without adding a state that has no behavior
of its own.

Keep a separate state when it owns a real business decision, needs to be observed while work is
pending, accepts its own events, or performs a distinct operation. Do not remove assessment states
such as `assessingCheck` just because they use `always`; their guarded branches are the workflow's
policy. Likewise, `entry` actions are synchronous and do not replace an invoked operation or its
error path.

Guards select a transition from the current context and event before that transition's actions run.
If an `onDone` route depends on the invoked result, inspect `event.output` in the guard. If it depends
on a value being assigned by the same transition, either derive the decision from `event.output` or
keep a distinct decision state after the assignment; do not expect the guard to see the new context.

When an invoke acquires a resource, every completion route must retain that resource in context
before entering cleanup. If interruption arrived while acquisition was pending, route to rollback
with the acquired handle assigned. After staging, check interruption in `onDone` and roll back
instead of starting commit. This replaces a route-only gate without weakening cleanup or allowing a
late result to start more work.

Represent complete success, partial success, cancellation, and failures as actual states. Return typed
terminal results so parents route outcomes without interpreting error-message strings. Classify an
outcome once; persistence receives the chosen outcome rather than recalculating it from counters.

Keep observations, counters, scoped data, current resource payloads, actor references, and result
descriptors in context. Do not keep a second lifecycle in `phase`, `stage`, `message`, or independent
flags that must stay synchronized with the statechart. Discriminants identifying actual data variants
are appropriate; distinguish those from copied lifecycle labels.

Readiness, permission, credential completeness, eligible mapping destinations, and available actions
are part of the model. Presentation must not reconstruct these from combinations of props. Render
explicit model choices or tags; translate descriptors and format dates in presentation so locale
changes remain reactive. State metadata can hold message/step descriptors.

Keep saved historical results independent of the current operation's success/failure state. When
nested actors drive the UI, ensure subscriptions actually notify consumers of child transitions;
check the installed framework adapter's behavior rather than assuming root snapshot identity changes.

## Keep timeouts simple

For XState v5 timeouts, use built-in `after` transitions and a named delay in
`setup({ delays })`. Reuse an existing failure/cancellation transition or target.
Timers automatically cancel when their state exits. A timeout should normally
require only a few lines; do not add manual timers, promise races, helper actors,
extra states or result variants solely to implement it. Add separate states only
when they represent a distinct domain outcome or resource-cleanup obligation.
Stopping an invoked actor discards late results; it does not automatically undo
an external operation. Preserve financial-write cleanup and avoid retries of
uncertain writes. See https://stately.ai/docs/delayed-transitions.

## Design cleanup and races explicitly

A normal cancel path is not enough. Account for navigation, component destruction, SDK session
replacement, scope/permission changes, credential replacement, reset, and unexpected child errors.

Do not assume `actor.stop()` runs machine exit actions or clears context. Send explicit shutdown,
let active children reach cleanup/terminal states, and only then stop/release their owners. Inspect
framework hook registration order: automatic actor stopping can run before a later cancellation hook.
Protect resetting/shutting-down states from later events that would downgrade their intended result.

Replace transient resource payloads as work advances; clear setup tokens, plaintext credentials,
sealing functions, and provider responses on terminal cleanup. Keep persisted encrypted data separate.
A cancelled effect's late result must not advance the workflow or start another provider request.
Treat already-issued database writes according to the SDK's actual cancellation semantics.

When identities or integrations are replaced, tie detach/completion notifications to the actor they
belong to. Do not let an old component tear down a newly attached workspace. Preserve progress counts
across child boundaries without losing or counting them twice.

## Put error handling at the right actor boundary

Use `invoke.onError` for failures of invoked actors, including synchronous acquisition/startup
failures and rejected promise actors. Do not catch and rethrow inside each `fromPromise` merely to
assign a workflow-specific error code. Let the owning transition classify the failure once, preserve
required sanitized diagnostics, and enter the appropriate failure/cleanup state. Keep secrets and raw
provider payloads out of persisted results and logs when moving classification.

Audit every invocation, including long-lived callback observers and machine children, for an
unexpected-error path. An ordinary error state in a child or an `onSnapshot` observer does not handle
the child actor itself failing. Do not send a cleanup command to an actor that has already failed and
then wait forever for its acknowledgement; distinguish failure before resource acquisition from
failure after acquisition. Recovery must preserve cancellation/shutdown priority.

Errors thrown by actions fail their machine; async actions are not awaited. Do not move fallible I/O
into an entry action and expect a local `onError` transition to catch it. Model independently
understandable operations as invoked actors and their decisions as guarded transitions. Moving a
large async helper into `fromPromise` without exposing its lifecycle is not this improvement.

Native browser event callbacks run outside XState's processing stack. `invoke.onError` does not
automatically intercept later DOM callbacks or promise rejections started inside `fromCallback`.
Those adapters must bridge native failures using typed events or explicit promise rejection. A
callback actor's internal promise rejection handler can therefore be necessary. Do not mechanically
remove catches or replace them with a generic helper solely to hide the syntax.

Retain narrow platform/resource handling where cleanup requires it: errors after acquisition must
abort/release resources and await actual settlement. Do not assume a callback actor's disposer runs
on every thrown actor failure; inspect the installed implementation when relying on cleanup ordering.
`try/finally` that clears credential bytes, closes images, or releases timers is resource ownership,
not duplicated workflow state.

For IndexedDB, keep the compare-and-write synchronous inside the active transaction. Validate policy
in the owning machine, then compare the complete observed value atomically at the write boundary to
protect against concurrent changes. Explicitly own opening, transaction selection, abort settlement
and connection closing as states/children. An abort racing a finished transaction can throw; retain
the narrow native-boundary handler and report the actual commit/abort result. Stopping a promise
actor discards its result and is not proof that its side effect was cancelled.

References: [invocation errors](https://stately.ai/docs/invoke),
[callback actors and errors](https://stately.ai/docs/actors),
[promise actors](https://stately.ai/docs/promise-actors),
[IndexedDB transactions](https://www.w3.org/TR/IndexedDB/).

## Supervise observers and stale notifications

Session observers can fail while subscribing or later while reading an SDK snapshot. Handle
acquisition with `invoke.onError`; bridge later SDK callback failures with a typed event. Exit the
observer, unsubscribe, and ask the workspace to finish bank cleanup before exposing recovery.
Restart an unexpectedly failed startup actor on retry instead of sending commands to a dead actor.
Keep late startup snapshots and errors from interrupting shutdown.

Supervise pure availability/history/mapping children before their errors can kill a bank owner with
active operations. Route those failures through the existing shutdown/cancellation states and await
the resource-owning child. A failed or completed bank child cannot acknowledge a subsequent shutdown;
its workspace must classify the failure or finish an already-requested shutdown immediately.

For dynamically spawned workspace errors, match the reported actor ID to the currently owned
reference. Consume stale notifications without releasing a replacement workspace. A child may already
be done while its parent's `onDone` event is still queued; check liveness when forwarding resource
notifications so a completed child does not receive credential payloads through warning logs.
Fallible integration callbacks such as selecting an organization belong in an invoked actor with an
error transition, rather than an entry action that can fail the entire workspace.

## Review and verification

Review the complete actor tree after focused changes, including startup and presentation boundaries.
Look for hidden branching promises, duplicated result classification, flags outside the model, and
teardown paths that bypass cleanup. Prefer a small reviewed change over another broad mechanical
rewrite.

When an actor contract changes, update test doubles to accept its typed initialization/observation
inputs and emit its public reports, including binding/generation correlation. A fake child that only
sets private state tags cannot verify a message protocol. Capture reports with a real actor recipient;
test stale-report rejection and actual settlement rather than merely renaming fixture fields.

Follow the repository review gate: do not add or run tests until the user approves the implementation
being covered. Formatting and type checks do not establish runtime correctness. After approval, test
state transitions and visible behavior, especially cancellation/races, cleanup, authorization changes,
partial progress, and parent/child subscription rendering. Do not record an implementation as proven
merely because it type-checks.

The SvelteKit plugin used by unit tests regenerates the same environment files as the dev server.
Finish unit/Svelte checks before starting a browser run; concurrent regeneration can replace a live
server's Jazz environment and produce misleading startup failures. Use the isolated in-memory Jazz
configuration in `playwright.bank-sync.config.ts` for reproducible bank/readiness browser checks.

## Inspect without changing ownership

The completed [orchestration ownership map](../../specs/008-actor-orchestration/architecture.md)
records the application, bank and independent form roots. Keep diagnostic instrumentation at existing
actor creation boundaries; an inspection requirement does not justify reparenting actors or adding a
registry, bus or generic supervisor. Use XState's built-in inspection API and evaluate Stately
Inspector before adding custom tooling. The custom trace adapter was removed at the user's request.
Inspection integrations must exclude credentials and private finance payloads. See
[`inspection.md`](../../specs/008-actor-orchestration/inspection.md) for the current environment-gated
Stately integration, attached roots and verification limits.

Shared SDK session ownership is distinct from a rendered layout's actor lifetime. Coordinate known
identity-changing SDK calls after workspace drain; retain issued calls until settlement, and reattach
even when a recoverable SDK failure retains the same client. Do not extend that guarantee to external
SDK calls or all formerly mounted route actors without an explicit ownership protocol. Keep navigation
failure separate from successful identity restoration; retrying navigation must not repeat mutation.

Remove forwarding/status protocols only after finding their actual production consumer. Startup
acquisition does not also need unused SDK-status commands, and a parent with no snapshot consumer
does not need syncSnapshot merely to preserve its child's lifetime or render a subscribed integration.

## Late workspace catalogs after recovery

A recovered identity can finish profile initialization before its workspace catalog arrives. A first
empty local catalog is not a final absence result. If unscoped entry automatically opens the chooser
for an empty catalog, preserve that entry's route intent so a later sole workspace can canonicalize
it. Keep the intent only for the same ready identity and original route/automatic chooser; discard it
on explicit selection, unrelated navigation, session loss, or an observed ambiguous catalog. Explicit
chooser visits remain independent of ledger selection. Guard the resolution against catalog loading
and errors. Test arrival both during and after navigation; do not hide the race with longer waits or
force ordinary local navigation to wait for remote freshness.

## Shared foundation adoption

Finance's generic scoped form/readiness/submission/write/controller lifecycle, profile workflow,
workspace initialization/startup, explicit-creation ownership/journal/recovery and restoration
coordination now come from Delightful Local First. Keep Finance files as typed dependency/policy
adapters. Update generic behavior in the library instead of copying machines back into this app.
Native finance schema transactions, financial resource drains, routing and legacy attribution
repair remain app-owned. See `docs/finance-foundation-extraction.md` for the exact boundary.
