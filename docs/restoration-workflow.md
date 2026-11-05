# Identity restoration child

Status: implementation reviewed; focused restoration coverage added for review. Finance's
runtime still uses its existing restoration implementation. The design is in
[the restoration plan](../specs/001-local-first-foundation/restoration/plan.md).

## Public entries

```ts
import { createRestorationMachine } from 'delightful-local-first/restoration/workflow'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import type { RestorationResult } from 'delightful-local-first/restoration/contracts'
```

The contracts entry is actor/SDK-free. The workflow entry exports `RestorationInput`, which includes
an XState report recipient. Create an adapter for the host's existing session and total live session
accessor; the adapter exposes `binding`, `capability`, and `invalidate()`. Create the child machine
from that fixed capability and invoke it from the existing application-owned restoration wrapper.
Its input is `{ scope: { binding, attempt }, phrase, reportTo }`. Do not own it in a route component
or stop it when the route disappears. The host serializes identity-changing commands.

The recipient receives `RESTORATION_VALIDATED` and `RESTORATION_PREPARE_REQUESTED`, each containing
only binding and attempt. It must clear the parent's submitted phrase copy, finish its actual
workspace/resource drain, and reply with `{ type: 'PREPARED', binding, attempt }`. Stale/foreign
permits and duplicates cannot start another invocation. Input is initialization, not a reactive
subscription; host binding invalidation must call `adapter.invalidate()` and send
`BINDING_INVALIDATED`. A changed account within the same session during restoration is expected;
the fixed session binding is not an account-generation token.

## Invocation-time capability binding

Finance acquires its session after defining application readiness. Its host integration can import
`restorationMachine` and `SuppliedRestorationInput` from the workflow entry and supply
`{ scope, phrase, reportTo, capability }` through invoke input. That capability is fixed for this
actor lifetime; replacement requires the normal interruption/settlement protocol and a new actor.
The existing `createRestorationMachine(capability)` convenience API remains supported. Both entries
use the same statechart definition and leaf actors; no dynamic registry or manual child startup.
Both APIs now pass the same lifecycle suite, including the invocation-time entry used by Finance.
The built-package consumer also uses the supplied-capability entry.

## Lifecycle and output

States are assessing → validating → awaitingPreparation → restoring → readingIdentity → restored.
Invalid input ends before preparation or mutation. Failure and partial identity observation have
separate terminal outcomes. `CANCEL`, `SHUTDOWN`, or `BINDING_INVALIDATED` during an issued restore
enter `restoring.settlingCancellation` under the same invocation. They wait for either SDK outcome,
then return cancelled. Repeated interruptions do not restart or detach the invocation. Before issue,
interruption returns cancelled immediately. A stale binding is rechecked at permit, SDK call, and
result acceptance boundaries; a silent host change still needs an observation to trigger prompt
invalidation while waiting.

Finite output carries binding, attempt, outcome, and `mutation`:

- `invalid`: `notStarted`.
- `cancelled`: `notStarted` before invocation or `settled` after invocation settlement.
- `failed`: the invocation rejected, `settled`; this is not a rollback guarantee.
- `identityUnavailable`: invocation fulfilled but ready identity was not confirmed, `settled`.
- `restored`: `settled` with `identityId`; navigation and remote-data availability are separate.

`settled` describes the restoration invocation, including a failure at its adjacent binding check;
it does not establish that the SDK mutated identity. There is no automatic mutation retry. The
parent keeps navigation and navigation-only retry, session readiness, workspace reattachment,
shutdown, and observer/startup failure priority. If a parent stops this child or crashes while the
SDK call is pending, this machine cannot abort that operation or recover supervision on its own.
Do not claim that stopping an actor or closing its view waits for settlement.

### Coordinator child-crash handling

The `recovery/coordination` wrapper completes in a final `restorationChildFailed` state after an
unexpected restoration-child crash. Its typed output has the same outcome and reports mutation as
`notStarted` if no `PREPARED` permit was sent, or `unknown` after a permit. A permit is permission
to issue, not evidence of SDK issue or settlement. This result never claims ordinary settled
`restoreFailed` or `closed` completion and must not authorize automatic retry or workspace reattachment.

The transition exits restoring, invalidates its binding, and clears its own request and binding
references before completion. Output retains no raw child exception, phrase or credential. No
queued failure-propagation event or intentional output throw is needed. A child crash during
shutdown still produces the explicit failure result.

Hosts must handle `restorationChildFailed` in `invoke.onDone`, preserving their existing unknown
mutation handling; keep `invoke.onError` for unexpected coordinator crashes. This changes the prior
invocation-error protocol and needs consumer review before adoption. Finance's existing error-path
handling has not been migrated as part of this library correction.

`RecoveryRestorationBinding.invalidate` is a total, synchronous, idempotent reference release,
implemented by the Jazz adapter with one assignment. It must not perform fallible SDK work. This
cleanup does not cancel an already-issued restoration, prove settlement, recover lost SDK
supervision, or qualify abrupt ancestor teardown. The host still owns those limitations.
The user authorized implementation and tests together. All six coordinator tests pass with the
finite-result protocol: failure before/after permit, cleanup-before-completion ordering, shutdown,
cleared sensitive references and normal SDK rejection/success regressions. A crash does not recover
lost supervision of an outstanding SDK operation. Finance adoption remains separate.

## Sensitive data and leaf audit

The child clears its phrase context when parsing succeeds, and clears credential context through a
raised internal event after XState binds restoration invoke input. All terminal states clear both
fields. The parser/SDK invocation may retain its input until settlement, and caller-held input or
snapshots cannot be erased by the child. Never inspect, persist, log, or retain this actor tree's
input, events, outputs of leaf invocations, context, or snapshots. Public reports/results contain no
credential, phrase, raw SDK error, or session handle. JavaScript cleanup is not byte zeroing.

This is the recursive machine-first audit: parse is one local SDK conversion; restore is one
session-bound SDK call after the same modeled binding recheck; identity is one session snapshot
projection. Validation, preparation, mutation, settlement after cancellation, and outcome decisions
are explicit states/guards. `currentSession` is only a total reference/binding predicate and catches
host accessor errors. `invalidate` releases the adapter's bound-session reference without logout,
close, subscriptions, credential caching, or navigation. No helper hides an acquired-resource or
read/check/write workflow. The host owns the session and all resource-drain decisions.

## Verification and remaining adoption

All 81 focused restoration tests pass: 34 machine scenarios against each capability entry
(68 total) and 13 Jazz adapter scenarios.
The machine tests use real XState actors and a typed recipient, including stale/duplicate permits,
invalid/empty parsing, interruptions at validation/preparation/restore/identity observation, both
SDK outcomes after interruption, silent binding changes, partial identity observation, sanitized
outputs, and context cleanup. They verify that interruption preserves the same invoked actor.

Adapter tests use the real Jazz parser and in-memory SDK-issued account handles with a typed
host-session double. They check binding rejection/invalidation, failing accessors, expected account
changes, ready/unavailable projections, retained issued calls, and propagation of SDK/read failure
without retries or unrelated lifecycle calls. Generated credentials are compared using booleans.

The built-package consumer resolves declarations and runtime imports through the new public entries.
Its isolated host double delegates restoration to the actual SDK account manager; the built workflow
and adapter recover the intended identity/root without network or database/client startup. This
qualifies public exports and that local dependency graph, not Jazz's real session/client lifecycle.
Types, lint, formatting, package build, publint, and the consumer declaration/runtime/Vite checks pass.
No production changes were needed after implementation approval. The test harness uses a small
local deferred helper to retain the repository's ES2022 TypeScript library baseline.

Finance adoption is committed as `1e63e89`, based on main after PR #35 merged. Its updated
application-owned recovery fixtures pass 34 focused unit scenarios, and ten protected real-session
authentication scenarios pass. Detailed verification is tracked in Finance's adoption notes. Neither workflow API owns host workspace
draining or navigation. This library check does not qualify arbitrary SDK/client versions.
