# PR #23 review — attachment destination machine

> Later qualification: the user authorized the follow-up cleanup and tests together. The consolidated
> actor tree passes 926 units and 16 actual Jazz/Chromium cases. The required destination actor,
> shared coordinator and renamed API supersede the historical pending/default-path notes below.
> See [current cleanup and qualification](pr23-coordinator-cleanup.md). Changes remain uncommitted.

The user requested createTestAppAttachmentWriter be a machine. This correction follows the locally
qualified wrapper cleanup, preserves that work, and awaits implementation review before tests.

## State and ownership design before implementation

```text
shared journaled write owner
  remote / authority / transaction-read / stage: invoke attachment destination machine
    check expected scope/mapping -> select requested operation in statechart guards
      remote read -> validate observed control -> compare mapped metadata/actual bytes
      authority -> identity admission -> allowed/denied
      transaction read -> validate observed control -> compare mapped metadata/actual bytes
      stage -> identity admission -> one transaction insert -> staged
  shared owner alone: durable intent -> acquire -> stage -> commit -> local/global checkpoints
  shared owner alone: reconcile unknown attempts / rollback / detached custody / lock release
```

The attachment chart's guards own content/authority branching; its I/O leaves perform one SDK read
or insert. Zod shape decoding and exact-value predicates remain pure functions. No presence function
selects workflow outcomes and no object of promise-returning writer methods hides these decisions.
An opaque observation handle keeps SDK rows/bytes out of snapshots and is cleared by an invoked
resource child on completion or abrupt stop. Late read results are discarded at that resource boundary.

The reusable write actor accepts a typed destination actor as a dependency, following the repo's
ActorLogic/Snapshot injection pattern. Preparation and existing callers retain individual leaf
implementations. Attachment calls supply only the native transaction leaves plus the domain actor;
there are no manually started child actors, promise bridges, event buses or duplicate coordinators.
Invoked child input identifies its operation and the immutable binding/intent/step. Transaction read
and stage borrow an opaque access port for the original transaction and transactionCall receipt;
the attachment child implements no commit/rollback or replacement-transaction operation. A static native helper is reused by
the preparation adapter, so attachment no longer constructs an unrelated preparation writer.

Cancellation/current-binding invalidation is forwarded to the invoked domain child. Both owners
latch it and await issued leaves; the child cannot advance from a finished read/admission to an insert
after observing interruption. The shared owner consumes the finite result and handles rollback or
uncertainty as before. Exact staged output is required before commit. Staging retains the narrow
identity invariant beside mutation; this assertion cannot select another effect or retry.

No journal format, destination schema/policy, mapping, write replay, acceptance inference, full
comparison, activation or Finance adoption change. After review, qualify domain observation/admission,
transaction custody, invalidation during reads/staging and prior actual Jazz/Chromium regressions.
Existing tests need construction/import changes to compile, but no new assertions or runs before review.

## Implementation prepared for review

The machine has explicit scope admission, operation selection, read, observation/control/file
checks, exact content comparison, identity admission and insertion states, plus finite domain
outcomes. The old presence outcome selector and promise-writer object are removed. Expected data
stays in the root's existing private request; observed rows stay behind a per-invocation opaque
handle with cleanup on normal completion/stop and owner error. The latter follows the existing
transaction-custodian handling of XState owner errors; it is not a second lifecycle coordinator.

The shared batch/write factories accept an ActorLogic/Snapshot dependency using the existing repo
pattern. Their preparation/default leaf path remains available. Attachment construction passes the
actual machine and native transaction adapter. A tracked call port binds read/stage to the original
transactionCall custody receipt without exposing a separate untracked transaction getter. No domain
child starts an actor manually or obtains its own commit/rollback/settlement capability. Only explicit
staged output permits commit. Every new invoked operation/resource has an error path, and control
messages are forwarded at active-child admission while issued native leaves drain.

Root Svelte/strict TypeScript, package/strict Publint, test app TypeScript, public package-consumer
TypeScript against rebuilt declarations, lint, formatting and whitespace checks pass. Existing
browser test construction was updated to supply the domain actor and separate native adapter;
no assertions were added or run for this correction. No server was started, nothing committed or
pushed, and the later stacked PRs are unchanged. The locally qualified wrapper cleanup remains
present, but its 924/14 runtime counts are historical for this changed actor tree.

After review, exercise actual domain branches and error/cancellation during reads/staging, prove
native receipt retention/rollback, and rerun the full cleanup/native browser regressions before
propagating to #24/#25. No full restore or production safety claim is made.
