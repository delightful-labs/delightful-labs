# Finance worker-owned SDK AccountStore

## State and ownership design

The public Jazz `AccountStore` contract is `read(): Promise<string|null>` and
`update(synchronousTransform): Promise<void>`. Its callback stays in the
application worker; no function or account-selection policy crosses to Window.
This boundary needs a workflow, so its machine precedes the promise facade.

The owner has parallel admission (`open -> closing`) and request work
(`idle -> selecting -> busy -> selecting`). It invokes one existing operation
child for each accepted request. The active request and FIFO queue are bounded
to eight total; excess requests fail before native storage is issued. Queue
entries contain the SDK request and its one response callback. Busy state has a
required current request declared through native v6 state context refinement.
No duplicate lifecycle flags or custom actor wrappers are introduced.

Shutdown closes admission, cancels queued work, raises private
`ADMISSION_CLOSED` so an idle owner can finish after admission has closed,
forwards `SHUTDOWN` to the active child, and waits for the child's real completion. The child owns the primary
and legacy Web Locks and any uncertain issued writes. The owner must not be
force-stopped while that custody remains. A scoped host-close observation is
forwarded to that child and closes admission. A completed uncertain-write result
also closes admission: the operation contract only completes it after actual
host closure, so queued requests cannot run against the retired host.

Unexpected operation errors enter `faultClosing -> faultRetained` if native
closure fails. Active callers remain pending until an actual closure receipt,
then receive an unknown outcome; queued calls are rejected as unissued. This
is fail-closed supervision, not a guarantee that a crashed/force-stopped actor
retained its native resources. The future root must prevent replacement until
this owner reaches a final state and must never use a crash as a drain receipt.

The SDK facade receives a concrete typed owner actor ref that its root has
started. It only submits a request and maps the owner's result to a promise; it does not create another
actor root, manage a queue, retry transforms, or duplicate identity decisions.
A storage-capability binder maps native bridge methods and the independent
close channel to the operation's existing interface. The future worker root
owns those ports, invokes this owner, forwards close observations, and waits
for completion before disposal. No application session is started here.

## Source review and qualification

Reviewed against the exact installed v6 beta1 invoke, typestate, internal-event,
transition-function and lifecycle/error docs, and alpha60's public AccountStore
contract. Strict TypeScript checks pass with exact optional fields and unchecked
index checks. The emitted module imports and constructs the owner graph without
starting actors or invoking storage. Effects remain enqueued, state destinations
are explicit, and request orchestration stays in the owner/operation charts.
The user subsequently authorized completing Finance implementation and tests
together. Six focused owner cases now pass: FIFO and SDK result mapping,
eight-request capacity, idle shutdown, queued cancellation while an issued write
retains custody, failed drain with stale/matching closure, and closing admission
after an uncertain completion. The existing operation campaign uses the published
`@xstate/test` package with an independent custody oracle and passes 100 runs.

Extend the isolated `@xstate/test` workspace with an independent owner-level
admission/queue/shutdown contract: FIFO and eight-request capacity; no transform
retry; queued cancellation; read/update result mapping; unknown-write custody
through shutdown, failed drain and stale/matching receipt; completed unknown
outcome closes admission; and unexpected child failure blocks replacement until
host closure. Retain the native MessageChannel tests. Browser session handoff,
SDK disposal, cold persistence and multi-tab qualification remain later work.
