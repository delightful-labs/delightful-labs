# Final actor ownership and retained limits

The orchestration feature is an ownership/refinement change, not a new actor framework. Keep its
source contracts and focused verification in the linked plans; this page is the final ownership map.

## Application and workspace

```mermaid
flowchart TD
  Layout[Root layout integration] --> App[Application readiness]
  App --> Startup[Session acquisition]
  App --> Observer[SDK session subscription]
  App --> Recovery[Finite account recovery]
  App --> Retry[SDK retry invocation]
  App --> Workspace[Exact workspace attachment]
  Workspace --> Init[Identity initialization]
  Workspace --> Creation[Identity-bound creation]
  Workspace --> Integrity[Selected-binding integrity]
  Workspace --> Navigation[URL navigation]
  Workspace --> Bank[Bank owner]
  Bootstrap[WorkspaceBootstrap subscriptions] -. observations .-> Workspace
  Recovery -. request and acknowledge workspace drain .-> App
```

Root layout owns one application actor. The shared SDK session survives layout remounts and is
borrowed by JazzSessionProvider; layout shutdown does not close that cached session. Application
readiness owns its observer, recovery/retry and exact workspace attachment. Application-originated
restore/retry waits for workspace shutdown before calling the public SDK. Once issued, SDK calls
remain invoked until actual settlement under shutdown or observer failure. Recovery survives login
page destruction and separates successful identity restoration from failed/skipped navigation.
A settled SDK mutation advances the root's attachment revision, including same-client failure.

Workspace initialization/creation bind to identity and database; selection alone does not cancel
creation. Integrity and navigation consume generation/binding-specific reports and current access.
One workspace drains before a replacement attachment is admitted. Exact attachment/actor matching
rejects stale detaches, closure and crash reports. Each parent awaits live direct dependents; completed
or failed actors do not owe impossible acknowledgements.

## Bank resources

```mermaid
flowchart TD
  Bank[Bank owner] --> Availability[Availability reports]
  Bank --> History[Historical outcome reports]
  Bank --> Setup[Explicit setup operation]
  Bank --> Operation[Explicit discovery or sync or disconnect]
  Bank --> Rows[Dynamic mapping rows]
  Setup --> SetupWrite[Setup persistence and settlement]
  Operation --> Authorization[Fresh persisted authority]
  Operation --> Provider[Passkey and provider effects]
  Operation --> Mapping[Mapping transaction owner]
  Operation --> Import[Import and disconnect resource owners]
```

Availability publishes capabilities; history retains saved outcomes separately from current work.
Operation-time authority and transaction-time atomic invariants remain necessary. Setup owns the
one-use token and staged passkey; operations own transient unlocked credentials/provider data.
Mapping transactions and imported/disconnected writes retain original scope, actual commit/local
settlement and interruption cleanup. Dynamic rows have independent lifetimes; fixed children remain
invoked across normal/draining substates. No automatic provider fetching or retry was introduced.

### Startup observation contract — reviewed and verified

The workspace coordinator's existing workspace/session/selection states and bank permission guard
own the `WORKSPACE_ACCESS_CHANGED` report. `WorkspaceBootstrap` has separate subscription effects
for `CONNECTIONS_CHANGED`, `MAPPING_DATA_CHANGED` and `HISTORY_CHANGED`. Its general readiness
observation includes identity, membership, catalog and route facts, excluding bank data. Bank data
changes therefore do not trigger workspace startup, navigation, creation or integrity assessment.
The coordinator checks each data event's access revision and identity/workspace scope before
forwarding it; it does not cache or compare bank rows. Bank selects the connection, availability
assesses credential completeness, mapping receives account/link choices, and history receives
saved outcomes without credentials. Navigation and creation contracts are outside this slice.

The access payload contains the decision and identity/workspace scope. Authority change detection
reuses the coordinator's integrity binding instead of computing another membership fingerprint.
Access is published after that binding has been assessed. The integration observes the primitive
published revision to resend current data after access changes, avoiding a snapshot/send dependency
cycle. Query replacement notifications may still generate another focused data event; bank ignores
equivalent selected credentials. Focused browser flows verify startup and scope replacement without
reactive loops; this is not a general performance benchmark.

An access report changes revision when identity, selection, eligibility, membership or allowed
authority changes. Bank clears capabilities and old scope data immediately, and active setup or
operation states enter `resetting`, request cancellation and await their existing settlement output.
The state sequence remains `ready -> setup/running -> resetting -> ready`, or
`setup/running -> shuttingDown -> closed` on shutdown. Access and selected credential events drive
these transitions directly; there is no intermediate environment-change event or stored environment
copy. Availability uses an assessment generation; history owns its saved records and reports the
binding revision and selected connection ID. History is a synchronous projection with ordered
reports, so it needs no separate counter in the bank owner. Mapping/history updates do not restart
credential assessment. Old revisions, stale child reports and observations during shutdown cannot
restore capabilities. Resetting retains its intent when replacement reports arrive.

The fresh operation-boundary authorization statechart still reads current facts, and persistence
retains its atomic invariant checks. No asynchronous workflow or new resource owner was added.
Availability coalesces equivalent reports within one generation, and mapping actors are rebuilt
for mapping/discovery changes or scope/credential invalidation rather than history updates.

Diagnostics classify ordinary denied/unavailable states separately from failures. History marks its
saved outcomes with `historical-outcome`, so a recorded failed sync does not emit a fresh machine error.
Unexpected child crashes remain errors and are attributed to their source actor when XState reports
a thrown transition only through the parent's error event.

After review, availability/report/bank-owner/import-settlement fixtures and coordinator mocks were
migrated, including explicit owner initialization and the history actor's scoped input/report contract.
Controlled settlement fixtures acknowledge completion separately from repeated cancellation. The
focused checks pass in an isolated snapshot: 214 unit tests across 14 files, 10 bank/startup browser
checks and two workspace switch/membership browser checks, `pnpm check` and `pnpm check:tests`.
The startup regression opens `/`, displays and reloads saved failed history, and observes no machine
error logs or automatic provider requests. Other scenarios cover scope/revision rejection, authority
changes, explicit operations, offline behavior, late responses, cleanup and genuine history crashes.

## Forms and domain persistence

```mermaid
flowchart TD
  Integration[Route or integration] --> Form[Independent scoped form root]
  Form --> Readiness[Bound readiness reports]
  Form --> Submission[Submission and progress owner]
  Submission --> Validation[Pure validation]
  Submission --> Domain[Domain operation]
  Form --> Completion[Independent post-save completion]
  Domain --> Transaction[Guarded transaction resource owner]
  Domain --> Avatar[Avatar preparation and cleanup]
  Avatar --> Write[Existing scoped readiness and write child]
```

Forms remain integration-owned roots, rather than being reparented into the application for logging.
The shared controller binds observations and DOM values; presentation receives a public view and
callbacks. Readiness owns reusable eligibility; progress reports avoid copying private child snapshots.
Transaction creation/editing expose preflight and one atomic transaction's read/check/stage/commit/
settle/rollback decisions. Avatar draft validation is pure; its domain operation owns decode/resize/
encode/read and bitmap/canvas disposal before invoking the existing write owner. Navigation completion
failure can retry completion without repeating a persisted write.

Independent account-order, archive, recovery-phrase and developer-sample actors keep their existing
owners and presentation/domain responsibilities. Development inspection observes these roots and
the application/form descendants without changing parentage or creating a global actor registry.

## Proven redundant code removed

- Startup SESSION_FAILED/SESSION_READY commands had no production senders. Application readiness is
  the SDK observation owner; startup retains acquisition/retry only.
- Workspace `syncSnapshot` forwarding had no application consumer. WorkspaceBootstrap's explicit
  subscription already renders the exact actor. Domain reports and closure/crash protocols remain.
- Earlier reviewed slices removed private status copying and hidden resource orchestration where
  their audits demonstrated a concrete responsibility/settlement problem. No general controller,
  transaction, availability or supervisor abstraction was added merely to equalize file sizes.

## Remaining exceptions and platform limits

- Startup acquisition still uses its existing snapshot/result boundary. The audit found no behavior
  requiring a reporting framework or finite-output rewrite; unused SDK status commands were removed.
- The SDK owns account/client internals and shared-client shutdown semantics. Coordination covers the
  application's restore/retry entry points, not arbitrary external SDK calls. No private consumer APIs.
- Route-owned submitted forms retain their own drain/settlement protocol. This feature adds no global
  barrier over every formerly mounted route actor. Do not claim application-wide rollback or write drain.
- Cancellation cannot retract issued provider requests, SDK mutations, database commits or accepted
  browser navigation. Await meaningful settlement and keep uncertainty/partial success explicit.
- Pica owns its shared worker pool; avatar cleanup releases owned bitmap/canvas resources, not private
  SDK worker fields. IndexedDB transaction activity constraints still apply to journal boundaries.
- Browser online status is a hint, never proof of SDK delivery. Finance stays useful offline.
- The custom inspector was removed at the user's request. No replacement is configured. Future
  diagnostics should evaluate XState/Stately tooling and exclude credentials and private payloads;
  see the [inspection decision](inspection.md).
- Validation evidence is scoped. Passing these checks does not claim a final rerun of all unrelated
  finance, permissions, provider, cross-device and PWA browser suites.

The [workspace architecture](../006-multiple-workspaces/plan.md#actor-ownership), [bank audit](bank-audit.md),
[form audit](form-audit.md), [session audit](session-audit.md) and their linked implementation plans
retain the concrete contracts and verification evidence behind this final map.
