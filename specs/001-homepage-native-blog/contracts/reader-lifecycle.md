# Reader lifecycle — XState v6

The reader uses exact dependency `xstate@6.0.0-beta.1`. It follows the installed
package's v6 contracts: `schemas`/`types`, `createAsyncLogic`, transition context
patches, and queued effects. It does not use v5 `assign` or `fromPromise` APIs.
Sources: bundled `node_modules/xstate/docs/agents.md`, `async-requests.md`,
`transition-functions.md`, and `cancellation.md`.

```mermaid
stateDiagram-v2
    [*] --> configuration
    configuration --> unconfigured: publication absent
    configuration --> empty: publication configured
    unconfigured --> unconfigured: READ returns null
    empty --> loading: READ
    loading --> ready: validated snapshot
    loading --> unavailable: failure
    ready --> ready: READ within 5 minutes
    ready --> refreshing: READ after freshness window
    refreshing --> ready: validated snapshot
    refreshing --> stale: failure, cache at most 24 hours old
    refreshing --> unavailable: failure, cache expired
    stale --> refreshing: READ retries
    unavailable --> loading: READ retries
    stopped --> [*]
```

`STOP` from any active state goes to `stopped`, rejects all waiting callers, and
aborts the invoked async actor. Late completions cannot replace the cache.

## Responsibilities and invariants

- `reader.ts` is the Promise API adapter. It validates configuration, starts the
  actor, sends read events, and disposes it. It holds no separate pending promise
  or snapshot cache.
- `reader-machine.ts` owns the cache, waiting callers, and refresh lifecycle.
  Concurrent reads share one invocation. Success/failure replies are queued
  effects, executed after the transition commits; waiting callers are cleared.
- Transition calculations do not read the clock. Read requests carry their time,
  and failed async work records its completion time outside the transition. Cache
  expiry is checked again after a failed refresh, so an old request cannot serve
  content that expired while it was waiting. No resident aging timers are needed.
- `load-snapshot.ts` coordinates a complete archive read; identity, RPC,
  pagination, article conversion and schemas live in separate focused modules.
- `schemas.ts` validates upstream JSON with Zod before filtering publication
  membership. Missing site/type/envelope/cursor data fails the scan. A malformed
  response cannot successfully replace the archive with an empty result.
- Only a completely validated, unchanged-repository scan replaces the snapshot.
  A stale response retains the last successful verification timestamp. Failure
  after 24 hours rejects instead of returning the expired body.
- Runtime upstream validation is separate from the machine's type-only schemas.
  The actor contains callback/function references and is not persisted; durable
  snapshots and coordination across Vercel instances remain a later integration.

`PublicationReader.stop()` is idempotent and must be used for production disposal
so queued callers are settled before the actor ends. Configuration replacement
and development hot reload dispose the previous reader.

## Verification

`tests/reader-machine.test.ts` checks states and externally observable results:
unconfigured reads, initial loads, concurrent callers, fresh hits, refreshes,
stale failure/recovery, expiry during a pending refresh, retries, cancellation,
cleared waiters, and ignored late results. `tests/reader.test.ts` checks the actual
loader and the missing-site/malformed-envelope regression.

## Snapshot loading stages

`load-snapshot.ts` owns one short-lived `snapshotMachine` actor per refresh and
bridges the reader's abort signal to that actor. The machine invokes one stage at
a time; each asynchronous stage owns its transport cancellation signal.

```mermaid
stateDiagram-v2
    [*] --> resolvingIdentity
    resolvingIdentity --> readingInitialCommit
    readingInitialCommit --> readingPublication
    readingPublication --> enumeratingRecords
    enumeratingRecords --> normalizingArticles
    normalizingArticles --> verifyingCommit
    verifyingCommit --> complete
    complete --> [*]
```

Any stage error terminates the load and propagates the original error to the
reader's refresh lifecycle. Cancellation aborts the current stage and rejects the
load without starting later stages. No intermediate result becomes a snapshot.
The final stage checks the repository commit before assigning `verifiedAt`.
The original refresh start time is shared by all RPC stages, preserving the
existing total time budget. Pagination and article preparation remain focused functions;
the machine coordinates their lifetimes rather than modeling each record as a
state. No automatic stage retries or partial-scan resumption are introduced.

Tests cover ordered completion, failure at every stage, and cancellation at every
stage (including blob loading during article normalization).

After Standard Reader adoption, `normalizingArticles` prepares metadata and
hydrates content blobs into the package document input; the package performs
block and inline normalization when rendering. The lifecycle is unchanged.
