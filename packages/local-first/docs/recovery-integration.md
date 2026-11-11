# Owned Recovery Integration and Jazz Adapter

**Status**: Implementation committed; focused adapter/integration coverage added for review.
Finance adoption remains a separately reviewed change.

## Ownership model

```text
Host Jazz session/provider/client (unchanged, host-owned)
└─ host integration subscribes to the existing account observation
   ├─ adapter.observeAccount(handle) → non-secret scope
   └─ RecoveryScopeSource publishes scope synchronously
      └─ RecoveryPhrase (keys source and capability)
         └─ RecoveryPhraseBinding (one actor and scope subscription)
            └─ existing recovery machine
               └─ one local phrase-export leaf
```

The new Svelte entry is a composition and an owner of local resources, not a session manager.
It renders the existing pure AccountRecovery component. Its small keyed wrapper gives each fixed
source/capability pair a separate actor lifetime: replacement destroys the prior binding before
mounting another. This boundary exists to own a dependency lifetime, not merely relocate markup.
Messages are outside the key and update without restarting the actor.

Business states and decisions remain in the existing recovery machine: availability, hidden,
revealing, revealed, failure, and shutdown. Scope notifications send OBSERVE; user actions send
REVEAL, RETRY, or HIDE. No new promise workflow, root registry, second session, or hidden startup
repair is introduced. The view continues to have one Close action and no acknowledgement UI.

## Public entry points

```ts
import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import type { RecoveryScopeSource } from 'delightful-local-first/recovery/contracts'
```

RecoveryPhrase props are `source`, `capability`, and `messages`. Source implements the small
actor-free subscribe contract; a Svelte readable of RecoveryScope is structurally compatible.
The source publishes its current scope on subscription and subsequent invalidations promptly.
Subscription acquisition must either return cleanup or throw without leaving an active subscription;
SDK observation errors belong to the host and must invalidate its published availability.

The library attaches only on client mount. Server rendering creates no source subscription,
SDK access, started actor, or secret output. Scope-source acquisition failure closes/stops the local
actor and raises a sanitized integration error. Teardown sends SHUTDOWN first, then unsubscribes,
and stops the actor even if unsubscription throws. Message/view subscriptions are component-scoped.
The host session/client is never started, logged out, or stopped by this code.

## Jazz boundary

`createJazzRecoveryAdapter(getAccount)` accepts a total synchronous accessor for the host's current
opaque AccountHandle, or null/undefined. The factory acquires nothing and creates no subscription.
Its returned methods are:

- `observeAccount(handle)`: project the host's observed handle into RecoveryScope. Stable handle
  references preserve the scope; actual replacement advances generation, including same-user
  replacement and observed A → B → A. Only the local-first issuer is advertised as eligible for an export attempt; missing retained
  root material still produces an explicit export failure rather than a successful phrase.
- `invalidate()`: release this adapter's observed handle and advance generation. Publish the returned
  unavailable scope if listeners are still active. This is reference cleanup, not logout/revocation.
- `capability`: stable readPhrase/isCurrentScope functions for the recovery machine.

The binding token is a new non-secret object per adapter, never the SDK handle. Actual handles remain
inside the backend closure. Current-scope validation compares binding, generation, identity, and
physical live handle reference. A host getter failure returns false rather than making a stale scope
current. A local export also repeats this exact binding predicate adjacent to its synchronous export.

The SDK leaf calls exportLocalFirstSecret and RecoveryPhrase.fromSecret without an await, query,
mutation, bootstrap, remote preflight, or resource acquisition. It returns the phrase through the
invoked operation only. The intermediate root is not retained. SDK failure is handled by the existing
machine's sanitized failed view; no raw error or phrase goes to an inspector or host callback.

This is the mandatory machine-first audit: observeAccount/invalidate only project observed facts;
currentAccount is the same primitive validation used in the modeled guard and export recheck;
readPhrase performs one resource-free SDK export/encoding. No helper hides a read/check/write
workflow or acquired-resource transaction. Subscription and actor cleanup remain explicit integration
lifecycle wiring. Partial progress/commit/rollback states do not apply to this local operation.

Jazz alpha.59 is an optional exact peer, with an exact development dependency. Its imports remain
external in dist. Because exported roots are tracked in a module-private WeakMap, the consumer must
supply the physical Jazz module instance that issued the account handle; matching versions alone are
insufficient. The later packed Finance adoption must verify this. The development OpenTelemetry API
is pinned to 1.9.1 to satisfy the SDK's telemetry peer ranges, matching Finance's declared baseline.

## Host wiring for the future Finance slice

Keep Finance's existing SDK observation in its integration component. Create one adapter for that
observation lifetime, using its current session account getter. The host's scope publisher forwards
each account snapshot through adapter.observeAccount before notifying the library. A Svelte readable
can own this existing session subscription and invalidate the adapter in its final cleanup.

Do not create another provider/client to satisfy this contract. Do not call invalidate merely because
one view closes if a host-shared source still has other listeners. Source finalization owns the
adapter's reference cleanup; individual view teardown owns only its own actor/subscription. Replacing
the source or capability keys the entire library binding; do not replace them for unrelated renders
or a locale/wording update.

All known identity/session changes must publish scope invalidation before exposing new identity UI.
The live accessor also catches changed handles before reveal and result acceptance if notification
has not arrived yet. Neither mechanism can intercept arbitrary unobserved external identity changes
or erase strings already retained by a caller. JavaScript reference cleanup is not memory zeroing.

## Coverage and next adoption

Adapter tests use SDK-issued handles and an isolated in-memory account store. They cover local
export, generation stability and replacement, A → B → A, foreign bindings, invalidation, unsupported
issuers, getter failures, and unavailable retained roots. Assertions never print generated secrets.
SSR checks render the real composition without acquiring subscriptions or exporting a phrase.

Synthetic browser stories exercise subscription cleanup, source/capability replacement, late results,
unmount/remount, scope invalidation, live message changes, and sanitized subscription failure.
The built-package consumer fixture also exports through a host-issued Jazz handle using public
package entries. This checks module sharing in this repo's dependency graph; it does not qualify an
independently installed tarball or Finance's graph. Focused packed Finance adoption remains next.
