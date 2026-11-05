# PR #23 review correction — explicit restore-operation lock actor

The review identified that operationLock placed availability/acquisition/release decisions in one
callback. Replace that owner with a finite state machine; keep a callback only at the Web Locks
protocol boundary. The user subsequently approved this correction for qualification with “continue”. The earlier
combined implementation/test authorization had applied only to the previous note slice.

```text
checkingSupport -> supported guard -> active.acquiring
  unsupported -> unavailable
active native bridge (one Web Locks request, nonqueued exclusive/ifAvailable)
  acquiring -> native offer: available -> held / null -> releasingUnavailable
  held -> RELEASE -> releasing
  acquiring -> RELEASE -> releasing (late offers cannot admit work)
  held -> native failure -> lost -> report LOCK_FAILED -> await parent RELEASE
  releasing / releasingUnavailable -> native settled -> released / unavailable
  request failure -> failed
```

The chart emits LOCK_ACQUIRED only on entering held. Native offers carry a boolean fact, not
workflow outcomes. The bridge always returns its holding promise to the browser callback; a typed
RELEASE command resolves it. Promise resolution/rejection becomes a typed event. Its disposer
resolves the same promise as abrupt-stop fallback, including release before a delayed callback.
No support check, branching on availability, retry, workflow notification or parent coordination
belongs inside the native bridge. The lock resource lasts through active substates.

Preparation/batch coordinators invoke this lock owner with a stable child ID. On work completion,
conflict or interruption they enter an explicit releasing state inside the owned scope, send RELEASE
and await the child's finite output before completing. Cancellation while acquiring also releases
and waits; a late grant cannot start journal/writer work. Other active journal/write leaves drain
before release, preserving their existing resource owners. A reported lock loss requests shutdown
of the writer and waits for its output before release; subsequent guards see the interruption.
Native lock failure during release reports incomplete, retaining the existing journal evidence.

No new lock key, queueing, AbortSignal combination, lease timer or recovery/replay policy. The key
still uses application/environment/identity/operation; the invoked lifetime owns correlation. Web
Locks are same-browser mutual exclusion, not destination authority or write settlement evidence.
Unexpected owner crash/actor.stop is still an abrupt fallback without a write-drain promise.

After review, qualify support/refusal/rejection, delayed grant and release, disposal before grant,
loss/drain, full-scope release after write/rollback, and actual two-tab exclusion/reacquisition.
Re-run existing preparation/batch units and native browser regressions. Previous passing totals do
not qualify this changed ownership tree. No tests will be added or run before review approval.

## Implementation prepared for review

`operationLock` is now the lifecycle machine. Its native child has no support/availability branch,
parent workflow notification, retry or error-routing decision: it issues one browser request, reports
native facts and resolves its holding promise on RELEASE/disposal. Promise rejection (including a
synchronous request throw captured by the leaf) is reported as a native fact. The machine's held entry
alone reports LOCK_ACQUIRED. Separate normal/unavailable release states wait for native settlement.
A native loss during ownership reports LOCK_FAILED and waits while the parent shuts down/drains its
writer; failed release returns incomplete without discarding journal evidence.

Both coordinators retain the lock invocation through an explicit releasing state, then consume its
finite output before returning. Conflict and child-error paths also release explicitly. Invalidations
remain bound to the original generation. There is no destination/schema, write/journal format,
permission-policy or replay change. Abrupt stops still resolve the browser hold as fallback and do
not claim to drain issued application work. Reviewed state/event and resource boundaries; tests await
review. Follow-up qualification must include delayed native settlement so parent completion cannot
silently regress to release-on-disposal, plus prior native two-tab exclusion/reacquisition cases.

Static checks pass: root Svelte/strict TypeScript, package build/strict Publint, public consumer and
notebook TypeScript, Oxlint, Oxfmt and whitespace checks. No tests added/run, no server started, and
no commit/push made for this review correction. Changes are local on PR #23's branch; propagation
to the later stacked PRs follows review and qualification.

## PR #23 qualification — completed

After review approval, all **924 units** pass, including **41 focused preparation/write/lock cases**.
Ten new cases exercise independent native grant/hold/release-acknowledgement gates: normal completion
awaiting release, cancellation before a late grant, abrupt disposal before grant, refusal, request
rejection/synchronous throw, failed release retaining completed evidence, loss during staging with
drain/rollback, and batch completion/rollback retaining both the lock and completed journal prefix.
Two initial test waits incorrectly observed child state changes through parent snapshots; they were
corrected to observe the actual leaf boundary. No production correction was needed after review.

All **13 real Jazz/Chromium cases** pass on PR #23's tree, including native two-tab exclusive
ownership/cancellation/reacquisition and attachment/preparation recovery without replay. The already
qualified large-attachment harness correction from PR #24 was backported to keep complete byte
comparison in Chromium, dispose per-test contexts and bound only the 1 MiB case at 90 seconds.

Root Svelte/strict TypeScript, package/strict Publint, public consumer compilation/builds/runtime
checks (17 reader and 18 notebook export tests), notebook TypeScript, lint, formatting and whitespace
checks pass. Disposable Vite/Jazz/Chromium resources were shut down. Later stacked notebook/note
qualification follows propagation; these 13 cases do not establish their changed-tree qualification.
No complete restore, Finance completeness or production safety claim follows.

## PR #24 propagation qualification

The parent correction was carried into the notebook-root branch without rewriting history. All
22 actual Jazz/Chromium preparation/attachment/notebook-root cases pass on the propagated tree.
No source correction was required; the existing 924-unit shared suite (41 focused cases) and
package/consumer checks cover the same unchanged shared implementation. Only the handoff notes
needed conflict reconciliation. The later note branch still requires propagation and qualification.
