# Finance workflow extensions

Read the authoritative [shared state/resource guide](../../../../docs/engineering/state-machines.md)
and [scope/approval rules](../../../../docs/engineering/scope.md) first. The user's
stricter common engineering baseline governs new/changed work, including browser
worker placement. Historical UI-thread/v5 placements below explain existing
adapters; they do not authorize new domain orchestration on the UI thread.
Finance's constitution, schema/provider rules and active feature remain local.

The following retained details describe Finance's SDK bindings, financial drains,
message descriptors, actor integrations and recovery behavior. Common machine-first,
transition, error, transaction, test and shutdown rules now have one shared owner.

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
qualification and the maintained application-worker handoff status.

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
