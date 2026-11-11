# Shared acquired-session readiness: Finance adoption

Status: implementation approved; focused verification complete.
Finance branch: `plan/shared-session-readiness`, from main `bf38397`.
Library implementation: `99faaf0`; approved coverage: `c3c9a5c`, with 33 focused tests passing.
The library design and recursive workflow audit live in
`specs/001-local-first-foundation/readiness/plan.md` in delightful-local-first.

Snapshot: `vendor/delightful-local-first-0.0.0-readiness.tgz`, SHA-256
`52947031226dfdc5bfa86d04b568c455bb3e19e93eb715b11450e0df4026db4e`.
It replaces the startup snapshot; DUI and all pinned runtime versions are retained.

## Ownership and state sequence

The layout supplies createJazzSessionReadinessAdapter alongside its existing restoration binding.
The application invokes one shared readiness child at its root, initially waiting without SDK effects.
After acquisition, bindingReadiness invokes the supplied factory as one leaf, then installs scope,
observation epoch zero, and the capability on the child. Only then does the parent expose session
through its existing context/provider. This prevents workspace attachment during an unbound gap.
The factory never creates another SDK client or account.

```text
Startup attachment reports acquisition
→ bind readiness capability
→ library observes normalized SDK status
→ existing Finance provider and workspace/domain integration

User Retry → Finance workspace drain → matching workspace closure
→ authorized library retry attempt → SDK settlement
→ matching fresh post-retry status → new attachment revision

Shutdown → retain issued retry/restoration until settlement + drain workspace/transfer work
→ readiness attachment completion → startup attachment release → closed
```

The library owns the SDK status subscription and retry invocation. Finance removes its direct
observeSession and retrySession actors. Scope/attachment, observation epoch, and retry attempt
correlation is checked once before application state handlers consume status/failure facts.
The parent retains only observed status/failure, counters, and dependency tokens; it does not inspect
library state paths/context or keep another promise/cache. The mutation rejection observer, workspace
owners, transfer mutation owner, restoration wrapper, and navigation remain Finance responsibilities.

A resolved retry reports settlement first. Finance stays in awaitingStatus until the library's
fresh observation carries afterRetry equal to the issued attempt. Pre-settlement ready notifications
cannot end retry. Rejection enters retryFailed and cannot be erased by an unrelated ready snapshot;
a fresh user Retry is required. Navigation/restoration cannot proceed from that rejected outcome.

An observer failure waits for workspace/issued-operation drain, then the user's Retry sends REOBSERVE
with a fresh observation epoch. It does not call SDK retry or reacquire the session. A workspace-owner
crash with a healthy session observer can recover through Finance's existing attachment coordination
without replacing that observer. Startup acquisition retry remains a separate protocol.

## Interruption and cleanup

During issued retry, shutdown and startup-owner failure ask the library to close its attachment;
that retires observation while retaining the issued SDK retry. Finance remains in its corresponding
drain state until the exact retry settlement arrives. Observer failure similarly cannot discard
retry. Priority is shutdown, startup failure, observation failure, then normal completion.

During restoration, observed session facts do not interrupt the identity operation. Observation or
startup failure requests restoration shutdown and retains its issued mutation until settlement.
A readiness-child crash also enters a restoration drain substate, preserving that operation before
entering the parent's fatal readiness state. Navigation-only retry remains navigation-only.

The application uses explicit completion events and waiting states to finish readiness before startup
release. If the child is already stopped/completed, the shutdown action raises the completion event
without awaiting another acknowledgement. No duplicate lifecycle flags were added. Shutdown clears
local binding/session/failure references; neither attachment closes/logs out the SDK session or stops
the browser acquisition owner.

A readiness-actor crash is distinct from a normal SDK rejection. It enters readinessCrashed after
workspace cleanup and does not automatically issue retry/restoration or recreate that actor. An issued
SDK retry inside a crashed actor has uncertain ownership; stopping an actor is not evidence of SDK
cancellation. This slice offers no automatic in-place recovery from that programming/runtime crash.
The existing generic error presentation remains; its Retry command is intentionally ignored in this
fatal state. Ordinary observer, acquisition, and SDK retry failures retain their explicit recovery.

## Recursive machine-first audit

The only new Finance promise actor constructs one supplied binding and returns its session reference
and capability. It performs no query, persistence, subscription, remote check, or retry orchestration.
The statechart owns acquisition-to-binding, pre-drain authorization, issued retry, refreshing wait,
rejection, reobservation, interruption priority, fatal crash drain, and attachment release. The shared
child owns its subscription and one SDK retry leaf. Existing restoration/navigation actors and their
helpers are unchanged. No actor-start/await bridge, private snapshot interpretation, or second session
cache was introduced. Native session access remaining in the parent is its existing Finance-specific
mutation rejection subscription.

## Approved verification

Implementation review was approved before Finance test migration and execution. The installed library
passed its 33 readiness/backend tests plus full source types, lint/format, package/strict publint,
and built consumer declaration, Node runtime, and Vite checks before packing.

Finance's 68 focused unit tests pass: 63 application readiness cases and five host startup cases.
The fixtures bind the real shared actor/adapter, await binding before workspace assertions, and use
scoped public reports or library observation fault injection instead of the retired parent protocol.
Existing issued-retry/restoration, same-client remount, mutation rejection, navigation-only retry,
startup owner failure, and drain-before-release cases remain covered.

Added coverage rejects foreign bindings, attachment tokens, observation epochs, and retry attempts;
keeps ready-before-settlement busy; preserves rejection feedback after a ready notification;
recovers a failed post-retry refresh through reobservation without repeating SDK mutation; and checks
readiness crash supervision during retry, restoration, and shutdown. Actor crash routing uses injected
XState error events, distinct from actual SDK/observer fault tests. It does not certify cancellation
or settlement of an SDK operation whose owning actor has crashed.

The one initially stale workspace-crash assertion was corrected against the reviewed ownership
contract: a healthy session observer survives a workspace-owner crash. The test now verifies no
unsubscribe/resubscribe and no SDK retry during recovery. No production changes were needed during
this coverage cycle.

Both production cold-restart cases pass: local reads/saves/reloads with an opened but unanswered
remote connection, and fully offline. Every app client closes before reopening the retained profile.
The startup diagnostic case passes with debugging enabled and disabled, including retry and private
data redaction. These results qualify tested paths, not every partial replica or SDK disposal.
All 11 focused authentication scenarios pass: invalid phrases, existing workspace restoration,
modal dismissal, startup retry, restore/session retry failures, same-client remount recovery,
navigation-only retry, and workspace selection.

Normal full-project source checks report zero errors/warnings, including unit fixture types and the
service worker. Browser-test type checks pass. Frozen-lockfile installation succeeds; module resolution
confirms shared physical Jazz, DUI, Svelte, and XState instances. Focused Prettier and diff checks pass.
Repository compiler/test settings were not weakened; the temporary source-only review config is no
longer needed. Browser fixtures were inspected and reused without modification. Recovery scenarios
retain disabled credential screenshots, traces, and videos; all browser work uses disposable agent
environments, leaving the user's 5173/5174 data and servers untouched.

No catalogs, UI styling, schemas, financial rules, workspace policy, or provider behavior changed.
The Finance adoption and its verification changes remain uncommitted for review.
