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
    loading --> stale: durable stale result
    loading --> checkingFailure: error
    checkingFailure --> stale: local cache within 24 hours
    checkingFailure --> unavailable: shared mode or expired cache
    ready --> ready: local READ within 5 minutes
    ready --> loading: shared READ or local cache stale
    stale --> loading: READ retries
    unavailable --> loading: READ retries
    stopped --> [*]
```

`STOP` from any active state goes to `stopped`, rejects all waiting callers, and
aborts the invoked async actor. Late completions cannot replace the cache.

## Responsibilities and invariants

- `reader.ts` is the Promise API adapter. It validates configuration, starts the
  actor, sends read events, and disposes it. It holds no separate pending promise
  or snapshot cache.
- `reader-machine.ts` owns the local snapshot, waiting callers, and refresh lifecycle.
  Concurrent reads share one invocation. Success/failure replies are queued
  effects, executed after the transition commits; waiting callers are cleared.
- Transition calculations do not read the clock. Read requests carry their time,
  and failed async work records its completion time outside the transition. Cache
  expiry is checked again after a failed refresh, so an old request cannot serve
  content that expired while it was waiting. No resident aging timers are needed.
- `request-machine.ts` chooses a direct source scan or the durable cache child.
  The reader, request, durable, snapshot, pagination, article iteration and article
  machines compose through named `setup.actors` sources and data-only inputs.
  No loader, transport, clock, or store callbacks are passed through machine input.
  `READ.reply` callbacks are the Promise API boundary, not workflow dependencies.
- `schemas.ts` validates upstream JSON with Zod before filtering publication
  membership. Missing site/type/envelope/cursor data fails the scan. A malformed
  response cannot successfully replace the archive with an empty result.
- Only a completely validated, unchanged-repository scan replaces the snapshot.
  A stale response retains the last successful verification timestamp. Failure
  after 24 hours rejects instead of returning the expired body.
- Runtime upstream validation is separate from the machine's type-only schemas.
  Reader events contain Promise reply callbacks, so the actor is not persisted.
  Durable storage contains validated plain snapshot data, not actor checkpoints.

`PublicationReader.stop()` is idempotent and must be used for production disposal
so queued callers are settled before the actor ends. Development hot reload disposes the previous reader; deployment environment
values remain fixed for the process lifetime.

## Verification

`tests/reader-machine.test.ts` checks states and externally observable results:
unconfigured reads, initial loads, concurrent callers, fresh hits, refreshes,
stale failure/recovery, expiry during a pending refresh, retries, cancellation,
cleared waiters, and ignored late results. `tests/reader.test.ts` checks the actual
loader and the missing-site/malformed-envelope regression.

## Snapshot loading stages

The request or durable machine invokes `snapshotMachine` directly. It invokes
one stage at a time; cancellation propagates through the child actor tree to the
active transport actor. The snapshot machine owns the total 40-second deadline.

```mermaid
stateDiagram-v2
    [*] --> resolvingIdentity
    resolvingIdentity --> readingInitialCommit
    readingInitialCommit --> readingPublication
    readingPublication --> enumeratingRecords
    enumeratingRecords --> preparingArticles
    preparingArticles --> verifyingCommit
    verifyingCommit --> recordingVerification
    recordingVerification --> complete
    complete --> [*]
```

Any stage error terminates the load and propagates the original error to the
reader's refresh lifecycle. Cancellation aborts the current stage and rejects the
load without starting later stages. No intermediate result becomes a snapshot.
The final stage checks the repository commit before assigning `verifiedAt`.
A single 40-second deadline aborts the complete load, including an in-flight
request, independently of the per-request timeout. `recordsMachine` explicitly
fetches and validates a page before checking its cursor. `articlesMachine`
iterates matching records with one `articleMachine` child at a time. That child
chooses unsupported-content passthrough, inline hydration, or blob fetching
followed by hydration. Metadata, page schemas, size limits, duplicate detection,
and cursor limits still fail the whole scan. Sorting and URL construction remain
pure data operations. No automatic retries or partial-scan resumption are added.

Tests cover ordered completion, failure at every stage, and cancellation at every
stage (including blob loading during article preparation).

`preparingArticles` prepares metadata and
hydrates content blobs into the package document input; the package performs
block and inline normalization when rendering. The lifecycle is unchanged.

Each snapshot stage declares its required context using v6 state schemas.
Transitions must provide missing results before entering the next stage; actor
inputs need no non-null assertions for prior-stage output.

## Durable mode

When storage is configured, every READ invokes the durable machine even if the
process copy is fresh. Successful stale fallback enters the explicit stale state.
The machine disables local error fallback in this mode; the durable loader alone
chooses a current stored snapshot. Concurrent callers in one process still share
one invocation. Independent instances may scan concurrently; no distributed lock
or background job is needed.

1. Read the current private Blob with `useCache: false`. If its original
   `verifiedAt` is less than five minutes old, return it.
2. Otherwise perform a complete AT Protocol scan with the existing 40-second
   deadline. A successful scan replaces exactly the ETag read before it started.
   Initial creation forbids overwrite. Each write includes a unique revision to
   avoid reusing an old ETag for an identical body (ABA).
3. A failed write/scan or losing CAS re-reads current storage. Discard the losing
   scan. Return the stored winner only while its original verification age is at
   most 24 hours. Never advance verification time during fallback.
4. If storage is unreadable, missing after failure, invalid, from another scope,
   or outside the allowed age, return unavailable. Do not resurrect the process's
   old copy. Cancellation never becomes a stale success.

One versioned JSON object holds the complete inventory, so deletion and body
changes commit together. Stored schema version, publication/owner/namespace,
article identities, paths, dates, URLs, duplicate keys, and a 10 MB read/write
limit are checked. A complete empty snapshot is an authoritative removal.
Storage operations have four-second abort limits; the source scan retains its
40-second total deadline. Publication verification remains configuration-only.

Keys combine a schema version with a hash of publication identity and
environment/branch scope.
Production uses a separate namespace; Preview keys include the branch, not its
commit SHA, so redeployments retain snapshots. This is application namespace
isolation; use a separate private Production store at cutover. No CDN/ISR or
Runtime Cache layer extends freshness.

Tests in `durable-machine.test.ts` and `blob-store.test.ts` exercise cold readers,
shared reads, concurrent first creation, deletion races, storage errors, CAS
preconditions, bounded stale/future times, cancellation, validation, and isolation.
Blob consistency/conditional-write behavior follows the
[SDK contracts](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## Durable cache and Blob operation machines

Both layers use the installed XState v6 contracts. The durable machine invokes
`blobStoreMachine` and `snapshotMachine` directly. The former Promise wrappers
and callback store interface have been removed from application code.
`snapshot-codec.ts` owns envelope encoding, validation and stable object keys;
these data operations are separate from lifecycle transitions.

```mermaid
stateDiagram-v2
    [*] --> reading
    reading --> fresh: valid fresh snapshot
    reading --> refreshing: missing or stale snapshot
    refreshing --> committing: complete scan
    refreshing --> recovering: scan error
    committing --> saved: conditional write accepted
    committing --> recovering: conflict or write error
    recovering --> winner: fresh authoritative snapshot
    recovering --> stale: bounded authoritative fallback
    recovering --> failed: absent, invalid, expired or unreadable
    reading --> failed: invalid or unreadable
```

Freshness decisions use an age captured after each storage read by an async
actor. Transition functions do not read clocks, perform I/O or log. Successful
terminal outcomes preserve the existing log names and verification timestamp.
A lost commit still recovers from shared storage and discards its candidate.

```mermaid
stateDiagram-v2
    [*] --> selecting
    selecting --> reading: read operation
    reading --> readComplete: absent
    reading --> validatingRead: downloaded body
    reading --> failed: download error
    validatingRead --> readComplete: valid snapshot
    validatingRead --> failed: validation error
    selecting --> preparing: write operation
    preparing --> writing: bounded envelope encoded
    preparing --> failed: serialization or size error
    writing --> saved: upload accepted
    writing --> conflict: ETag precondition failed
    writing --> checkingFirstWriter: initial upload error
    writing --> failed: other replacement error
    checkingFirstWriter --> validatingFirstWriter: authoritative object exists
    checkingFirstWriter --> failed: absent or download failed
    validatingFirstWriter --> conflict: valid competing snapshot
    validatingFirstWriter --> failed: validation error
```

Write preparation fails before network work. Initial-writer recovery retains the
original upload error when no object exists, and propagates a failed check as an
error rather than declaring a conflict. Existing SDK options, key format and
serialized schema remain unchanged.

Stopping the reader stops the complete child tree. Cancellation does not enter
stale/conflict recovery. The snapshot machine's state deadline aborts active
source work and fails with `Archive refresh timeout`. No actor snapshots or
callbacks are persisted to Blob. The Promise runner and callback store facade
now live only in test fixtures, where tests need an externally cancellable API.

Blob operation inputs are data only: location/configuration, operation kind,
snapshot and expected version. Production has no callback store facade. The machine registers `downloadSnapshot`,
`validateSnapshot`, `prepareSnapshot` and `uploadSnapshot` under `setup.actors`;
the download/upload actors call the Blob SDK directly with visible options.
Validation is a separate state on both normal reads and first-writer checks.
The download actor owns the request and full bounded stream consumption, keeping
them under one cancellation lifetime before handing plain data to validation.


## Test substitutions

Tests use `.provide({ actors })` to replace the relevant I/O actors, preserving
child-machine state contracts and the real composition path. They do not add
callback fields to production machine inputs. `content-machines.test.ts` also
checks direct page/article state sequences, duplicate records, cursor loops,
page and archive limits, content passthrough, blob precedence, sorting, and
cancellation before a subsequent article starts. Snapshot tests retain failures
and cancellation at every source stage and exercise the machine-owned deadline.
