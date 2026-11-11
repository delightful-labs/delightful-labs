# Application/session ownership audit

Status: D007 source audit complete. The focused D008/D009 retry ownership slice is reviewed and verified.
The six-file recovery/drain implementation is also reviewed and verified; D008/D009 are complete.

## Current ownership

```text
root layout (one actor per rendered application tree)
└── application readiness
    ├── startup acquisition machine → shared-session adapter → Jazz SDK session
    ├── session subscription (while running)
    ├── session.retry promise (while retrying)
    └── workspace coordinator (one exact attachment; replacement waits for closure)
        └── existing initialization, creation, integrity, navigation and bank owners

JazzSessionProvider (borrows the shared session)
└── SDK client provider / framework consumer lease
    └── WorkspaceBootstrap (subscriptions, attachment and observations)
        └── login page → session.restoreLocalFirst → navigation
```

The browser module `jazz-session.ts` caches one SDK session and one in-flight acquisition.
A rejected acquisition clears the promise so startup can retry. Root layout destruction sends
application shutdown; it does not close the cached SDK session. The provider is supplied `session`,
not `config`, and therefore does not own session creation/closure. This is intentional reuse across
remounts. Application readiness owns its subscription and workspace subtree, not the SDK client's
internal account lifecycle. Do not close the shared session just to dispose a layout actor.

| Boundary             | Commands / observations                                   | Result / cleanup                                                                                   |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Startup              | START, RETRY; existing session input                      | Private ready/error snapshots and result consumed by application; acquisition failure is retryable |
| Application          | START, RETRY, SHUTDOWN; session status/failure events     | Startup-error presentation; exact attached workspace; unsubscribe and await workspace closure      |
| Workspace attachment | ATTACH_WORKSPACE, DETACH_WORKSPACE; exact object identity | WORKSPACE_CLOSED with actor identity; replacement keeps only latest pending attachment             |
| SDK retry            | One public `session.retry()` call                         | Promise settlement; SDK owns account selection/client shutdown/reopening                           |
| SDK provider         | Session subscription and consumer lease                   | Removes old view; acknowledges after Svelte tick, releases lease on destruction                    |
| Login recovery       | Form submission and SDK snapshot                          | Local flags; SDK restoration followed by navigation; no application-owned operation lifetime       |

## Retain these boundaries

- Application readiness already exists before SDK initialization; no new global actor system is needed.
- Startup acquisition rejection, unexpected startup actor failure, observer subscription failure and
  later snapshot-reading failure have distinct recovery paths. Native callbacks bridge errors explicitly.
- Observer failure exits the subscription and drains the workspace before exposing retry.
- Workspace replacement uses exact attachment identity; stale detach/completion/error events cannot
  release a replacement. Shutdown ignores new attachment/retry commands and late startup snapshots.
- The workspace sends its closure notification on its final entry. Its crash is separately matched by
  actor ID. A queued closure/error still releases it after shutdown starts; source inspection did not
  establish a missing-acknowledgement bug requiring a new generic supervisor.
- Browser online state remains a hint, not evidence of SDK delivery. Bank cleanup and finite form
  settlement remain owned by their existing domain actors.

## Findings

### 1. Retry invocation loses its application owner before SDK settlement

In `application-readiness.ts`, `running.SESSION_OBSERVED` targets `.checking`. The SDK's retry
publishes `transitioning` before it awaits view detachment and client teardown. That observation
exits `retrying`, stopping the promise actor even though `session.retry()` continues. A subsequent
RETRY can start another call, which the SDK rejects while busy. Final rejection of the first call
also no longer reaches its invocation's error transition. The SDK normally publishes its own status,
but that does not make promise cancellation equivalent to settlement.

The same invocation is discarded on observer failure or application shutdown. Define the domain
lifetime explicitly: suppress duplicate retries, keep collecting observations, retain the issued
retry until settlement, and preserve shutdown/observer-failure intent. Do not cancel the SDK call
or reopen work when a late observation/promise result arrives.

### 2. Account recovery remains a workflow inside the login component

`routes/login/+page.svelte` validates a recovery phrase, calls SDK restoration, navigates after success
and classifies failures using three local flags. SDK restoration removes the old client view, so the
page can unmount while its async handler is pending. Its continuation still attempts navigation.
A navigation rejection is classified as restoration failure even after identity selection succeeded.

This warrants one focused recovery statechart with an application lifetime, rather than a page-owned
promise or several generic form/controller wrappers. Pure phrase parsing can stay a leaf; the model
must distinguish invalid input, SDK restore failure, successful restoration, navigation failure and
shutdown. Clear the secret once passed to the SDK and on terminal cleanup; expose no phrase/raw error
in reports. Never retry account mutation merely because navigation failed. Capture original scope and
navigation intent rather than reading a destroyed page's reactive state after restoration.

### 3. SDK view detachment does not acknowledge domain drain

Installed Jazz `2.0.0-alpha.59` `session/state.js` waits for framework consumer leases before shutting
down the old client. `svelte/JazzSessionClientProvider.svelte` acknowledges after a Svelte tick, or
releases the lease on unmount. WorkspaceBootstrap destruction sends DETACH_WORKSPACE synchronously,
but workspace/bank draining is asynchronous. Thus the SDK can begin old-client shutdown while our
resource owners are still draining. Application replacement waits before spawning another workspace;
that wait alone does not hold the old SDK client open.

This is a source-level ordering gap, not a claim that a write has been observed lost. Relevant race
coverage must hold a domain write/cleanup pending while restoring identity. The current public
JazzSession interface has no consumer/drain lease. The SDK has a private framework attachment helper;
do not import it through an unsupported path. Its public JazzApp API offers consumer acknowledgement,
but adopting that API changes the provider/session integration and requires a separate concrete design
and scope review. Do not solve this by recreating SDK account lifecycle internals locally. Locally
initiated mutations can instead be coordinated before invoking the SDK, but all mutation entry points
and view-remount behavior must be accounted for before choosing that approach.

### 4. Startup protocol includes redundant coupling

Application readiness inspects startup state and `context.result` from snapshots. Startup accepts
SESSION_FAILED/SESSION_READY events that no production caller sends; application has its own SDK
subscription. Acquisition and ongoing session observation are already different responsibilities.
A finite acquisition output could simplify this boundary, but no independent user-facing failure was
established here. Defer this cleanup until needed by a reviewed change; do not add a reporting framework
or rewrite startup merely for symmetry with other subsystems.

## Proposed focused review sequence

1. **Retry ownership:** change `application-readiness.ts` only, unless a concrete type boundary requires
   otherwise. Keep one retry invocation across active/draining substates; observations update facts
   without discarding it. Ignore duplicate retry. Await actual settlement and workspace closure when
   interrupted. Preserve shared session reuse, exact attachments and existing failure presentation.
   Draft states: idle → retrying(active / observerFailed / closing) → settled; observer failure and
   shutdown stop new work, drain live workspace, and cannot be downgraded by late reports.
2. **Recovery and SDK drain design:** settle the public integration approach for finding 3 before
   implementing recovery ownership. Aim for one recovery machine plus application and login wiring,
   reusing LoginForm. Discuss any provider/SDK migration or larger file batch first. No new styling,
   schemas, shared form framework or generic supervisor.
3. **Startup simplification only if justified:** retain current acquisition adapter and snapshot
   protocol unless the preceding work demonstrates a need to change it.

D008 begins only after this audit is reviewed. Each implementation is presented before adding or
running its tests, per repository agreements. D009 should cover pending retry observations, duplicate
retry, rejection without a new status notification, shutdown/observer failure during retry, delayed
workspace closure, stale attachment events, restore during pending domain cleanup, remount, successful
identity restoration followed by navigation failure, and late completion without new work. Existing
startup/recovery browser scenarios must retain identity, data, offline behavior and secret disposal.

## Evidence limits

Read application/startup machines, root layout, session/provider adapters, WorkspaceBootstrap,
login recovery, workspace shutdown protocol and existing unit/browser fixtures. Inspected installed
XState 5.33.2 and Jazz 2.0.0-alpha.59 source for snapshot forwarding, consumer acknowledgement,
SDK busy/generation handling and shared-session ownership. No runtime files or tests changed, no
tests run, and no new server started. Source inspection is not runtime verification.

## Retry implementation model

Keep the existing `running` parent and its session observer. Its `retrying` compound state owns
one `retrySession` invocation across `active`, `observerFailed`, `startupFailed` and `closing`.
Only `active` accepts status observations, updating facts without a transition. Interrupt states
stop the observer, clear pending attachments and request workspace shutdown. They retain the retry
invocation until fulfillment or rejection. Normal settlement returns to status checking or failure;
interrupted settlement enters the existing drain/recovery state, which also waits for workspace
closure. Shutdown outranks startup failure, which outranks observer failure. Workspace closure/error
continues to release only the matching owned actor. No retry lifecycle flags are added to context.

The SDK retry promise is a leaf call. The application owns invocation lifetime and terminal routing;
the SDK owns its account/client internals. This slice does not change SDK view-detachment semantics.

## Retry implementation review

Only `src/lib/machines/application-readiness.ts` changes production behavior. The existing session
observer stays attached through ordinary retry observations. Retry retains the SDK invocation across
active and interruption substates, ignores duplicate START/RETRY, and routes settlement according to
shutdown, startup failure or observer failure priority. Interrupt states unsubscribe, discard pending
attachments and request workspace cleanup. Either completion order is supported: workspace closure
can release its actor while retry is pending, or retry can settle before the existing drain finishes.

Unexpected observer/startup/workspace actor errors are handled inside the retry owner while it is
active. Handling them only on an ancestor could exit that owner and discard the SDK invocation;
local transitions preserve its lifetime. Matching workspace errors still release only the current
actor. Startup failure remains distinguishable so recovery restarts the failed startup actor rather
than sending retry to it. Late observations, retries and failures cannot downgrade shutdown.

Recursive source review found no new async orchestration inside helpers: the only retry promise
calls the SDK's public `retry()` once; state transitions own interruption and settlement decisions.
No context flags, new actors/files, private SDK APIs or generic supervision framework were added.
Shared session ownership, attachment matching and provider behavior remain unchanged. The SDK
view-detachment/domain-drain gap in finding 3 remains explicit follow-up work.

Implementation review preceded the verification below. No production fixes were needed during testing.

## Retry verification after approval

- 37 application/startup/shared-session unit tests pass across three files. New retry coverage exercises
  all SDK status observations, duplicate commands, rejection without an error observation, fresh retry,
  success/rejection during shutdown or observer failure, both retry/workspace completion orders,
  unexpected startup/observer failures, actual workspace crashes and shutdown priority over late events.
- 51 workspace coordinator/startup/navigation regression tests pass across three files.
- Four existing startup/session recovery browser checks pass: repeated network startup retry, repeated
  SDK shutdown failure/recovery, selected-identity persistence recovery and recoverable restoration
  with the original client. Identity/data retention, phrase clearing and sanitized diagnostics retain
  their existing assertions.
- `pnpm check` passes with zero errors and warnings; `pnpm check:tests` passes.
- Prettier and `git diff --check` pass.

The workspace fixture now requires a separate explicit cleanup acknowledgement, so duplicate shutdown
commands cannot accidentally complete pending cleanup. Browser fixtures scope populated alerts to main
content, excluding empty accessibility live regions. Production changes remain in the one reviewed
application machine. This verifies retry ownership, not the separate SDK/domain drain ordering gap
or the still-procedural login recovery workflow. Those follow-up slices are verified in [session-recovery.md](session-recovery.md).

## Recovery/drain design follow-up

The [recovery/drain design](session-recovery.md) selects coordination before the two existing public
SDK mutation entry points, avoiding private hooks or provider migration. It records the necessary
same-client remount behavior, failure/secret/navigation outcomes and a six-file production scope.
The six-file implementation is reviewed and verified. See that document for the state sequence,
source inspection, fixture migration and 102 relevant unit/nine browser/static checks. The workspace
pre-drain guarantee covers application-initiated restoration and retry, retaining shared session reuse.
Startup snapshot coupling is retained because the audit established no need to replace that boundary.
