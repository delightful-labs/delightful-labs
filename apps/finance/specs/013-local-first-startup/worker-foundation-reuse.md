# Local First and Clipper reuse for Finance workers

Source review: 2026-11-13, monorepo `main` at `eb0f615f`. This supplements
[code research](worker-migration-research.md) and changes the ownership and
dependency details in the [ordered migration tasks](worker-migration-tasks.md).
This document specifies extraction work; no application/library implementation
has been moved or tested in this research change.

## Reuse existing Local First APIs directly

The library at `packages/local-first` already supplies substantial foundations.
Its `fixtures/test-app` is a disposable nonfinancial backup/restore consumer, not
another production application-worker runtime to transplant. Its native capture,
restore and packed-consumer fixtures are useful qualification patterns. Finance
already consumes the public backup APIs and row-copy observation helpers.

| Existing foundation | Relevant source | Finance migration use |
| --- | --- | --- |
| Correlated request, bounded channel and independent effect drain | `src/lib/contracts/worker-{request,channel,effect-drain}.ts`; matching `machines/lifecycle` implementations | Reuse public `worker/*/{contracts,workflow}` exports for native adapters. Keep wire decoding at the native boundary. Do not add another request-map/timeout state machine in Finance. |
| Session acquisition/startup/readiness | `backend/jazz/{session,startup,session-readiness}.ts`; `machines/identity/session-{acquisition,startup,readiness}.ts` | Retain one session owner across UI attachments, bind it inside the worker, and project observations instead of exporting the owner. |
| Recovery, restoration and ordered sign-out | `backend/jazz/{recovery-phrase,restoration}.ts`; `machines/identity/{recovery-phrase,restoration,session-recovery,ordered-sign-out}.ts` | Compose existing capabilities rather than copy Clipper's recovery or account host. Keep Window native verification behind scoped adapters. |
| Workspace selection/creation and domain transactions | `machines/workspaces/{selection,creation-owner,domain-transaction,transaction-custody}.ts`; related contracts | Preserve existing identity/scope/drain/transaction semantics. Reuse `DomainTransactionLifecycle`, custody receipts and operation composition; Finance still owns financial invariants and policy. |
| Owned operation lifecycle | `contracts/owned-operation.ts`; `machines/lifecycle/owned-operation.ts` | Own finite capability-spawned work and preserve its result, including unknown settlement; do not introduce a second generic supervisor. |
| Immutable observations | `contracts/observation.ts`, public `data/observations` | Copy SDK-owned live rows before placing them in immutable actor context. These shallow copies do not make arbitrary handles safe wire DTOs. |
| Scoped forms | `machines/forms/scoped-form.ts`; `integrations/forms/controller.svelte.ts` | Reuse the domain form machine while separating DOM integration and noncloneable feedback labels. Change reusable form contracts at the library source and qualify existing consumers. |
| Archive/envelope, native export, restore journal and operation ownership | `backup/`; `backend/jazz/backup.ts`; test-app/native-capture fixtures | Retain public formats and existing recovery machinery. Add a cross-realm submission boundary, not a second archive/restore implementation. |

Paths in this table are relative to
[`packages/local-first`](../../../../packages/local-first). Exact public exports
are declared in its [`package.json`](../../../../packages/local-first/package.json).
Internal machinery should not become an app's deep import just because it is
listed here; extend a supported export only for a concrete missing contract.

## Extract Clipper's reusable native foundations into Local First

### R1. Independent MessagePort close control

Source: [`host-close-channel.ts`](../../../clipper/apps/web/src/lib/runtime/worker/host-close-channel.ts),
with its adjacent tests. It has no article, reader, library or Finance policy.
`serveHostClose` acknowledges only after the native data-host disposer returns;
`workerHostControl` retains observation of a genuine late receipt after transport
errors. It already feeds Local First's shared channel contract.

Move the wire envelope/validation and Window/worker adapters to Local First's
browser worker integration boundary. Keep generic lifecycle decisions in the
existing channel machine. Replace Clipper imports, then replace Finance's
parallel close/drain transport with the shared adapter where equivalent. Preserve
foreign-scope/version rejection, extra-port disposal, failed native close,
duplicate close and late-receipt behavior. Do not equate disposing a control
listener with native host closure.

### R2. Scoped account-storage and Jazz broker transports

Sources:
[`scoped-storage-channel.ts`](../../../clipper/apps/web/src/lib/runtime/worker/scoped-storage-channel.ts)
and [`broker-channel.ts`](../../../clipper/apps/web/src/lib/runtime/worker/broker-channel.ts),
which already compose Local First's worker-channel machine and R1.

Move the fixed-key storage primitive/client and the SDK-specific
`browserWorkerHost` broker/generation adapter to Local First. Keep a small,
explicit browser-host integration and a Jazz-specific backend integration rather
than a universal RPC framework. Consumers supply admitted bindings: current and
permitted legacy keys, broker URL/name/generation namespace and native factories.
The app must not provide arbitrary storage authority through a UI request.

Before sharing, reconcile differing admission guarantees: Finance currently binds
the broker to an exact URL/base name and storage to specific primary/legacy keys;
Clipper's broker checks same origin and Jazz-prefixed generation keys more broadly.
The shared API must preserve Finance's narrower capability binding, not weaken
it to the least restrictive source. Preserve close-before-bind revocation, FIFO
effect admission, no replay of uncertain generation writes, disposal of every
unaccepted transferred port and independent data/control lifetimes.

Adopt these exports in Clipper first, then connect Finance's existing account
selection/legacy charts through thin app-specific bindings. Remove superseded
transport implementations after both consumers qualify.

### R3. Account-update custody and native lease integration

Sources:
[`account-write-custody.ts`](../../../clipper/apps/web/src/lib/runtime/worker/account-write-custody.ts)
and [`scoped-account-store.ts`](../../../clipper/apps/web/src/lib/runtime/worker/scoped-account-store.ts).
The ledger records the original native write receipt before issuing it; a
detached keeper can outlive a stopped/erroring actor and waits for settlement
or host closure before releasing native custody. These mechanisms are not
Clipper domain behavior and should live in Local First when shared.

Extract the narrow receipt ledger/keeper and SDK AccountStore composition after
reviewing the crash-safe custody design in W03. Keep Finance's primary/earlier-key
selection, cleanup rules and financial operation policy in Finance. Do not make
Clipper's account key derivation (including `:clipper`) a library default.

Important limit: `scopedAccountLock` acquires `navigator.locks` in the worker and
the keepers live in that same realm. Its actor-stop/error tests do not establish
survival of complete worker termination while Window still has queued writes.
R3 must compose with W04's native lease/admission solution; copying it unchanged
does not complete crash safety. Native lease identity and safe-close requirements
belong in the shared primitive so both consumers can benefit from the correction.

Move applicable stopped-owner, reentrant disposal, dropped-acknowledgement,
late-close, bounded-admission and release-receipt regression scenarios with the
shared code. Keep/add app-level namespace, identity and domain regressions in
each app. Whole-realm termination and competing-tab qualification remain separate
native acceptance requirements.

### R4. Disposable browser-worker job

Source:
[`machines/browser-worker-job.ts`](../../../clipper/apps/web/src/lib/machines/browser-worker-job.ts),
with focused tests, generated/model coverage and native caller integration.
It is already generic over request/reply and accepts worker construction, decoder,
transferables, cancellation signal and timing. The only app import is the
`monotonicNow` helper; move the required clock primitive or inject it without
bringing reader/search timeout policies into the foundation.

Move this finite lifecycle to Local First with separate contracts and workflow
exports, then update Clipper's image job consumer. Finance's SimpleFIN request and
appropriate finite image jobs can use it rather than repeat worker construction,
reply decoding, abort handling and handler/worker cleanup. Caller statecharts own
deadlines, retry/fallback, provider consent and result interpretation.

The result must continue to wait until synchronous handler cleanup and native
`terminate()` return; a cleanup failure cannot acknowledge settlement. Browsers
do not provide an asynchronous worker-exit receipt. This disposable-job primitive
is unsuitable for the long-lived financial runtime or native commit draining.
Provider payloads must remain transient and absent from public snapshots or
diagnostics; adapt the integration rather than admitting secrets as ordinary
inspectable job context. Worker-side provider request decoding is still required.

## Reuse patterns, but do not move the complete Clipper implementation

- **Application host/client:** `host-machine.ts`, `client.ts`, `serve-application.ts`
  combine reader/tag/library/auth protocols and application projection. Keep those
  app compositions in Clipper. Build Finance composition from shared resource
  contracts; do not parameterize a 700-line domain host into a generic framework.
- **Recovery owner:** `recovery-owner.ts` already wraps Local First's recovery
  capability/machine. Finance should compose that supported library API directly.
  A shared owner wrapper is optional only if both apps need the exact additional
  source/child lifetime, not a prerequisite of this migration.
- **Reader surface lease:** `surface-lease.ts` coordinates reader position,
  fullscreen, document identity and library commands. Retain it in Clipper.
  Borrow the offered/accepted/released/native-close pattern for Finance's actual
  file/canvas capability; extract a smaller generic lease only if both concrete
  consumers require the same lifecycle. No new generic surface bus is planned.
- **Query bindings:** Clipper's `records.ts` demonstrates direct worker-side
  `db.subscribe`, LocalFirst reads and scoped transaction adapters. Keep article,
  reader, image, tag and library queries in Clipper. Add the missing non-Svelte
  observation mechanism to Local First (W09) with app-defined queries/decoders
  and explicit disposal/failure, rather than moving the domain records object.
- **Transaction custody:** Clipper's `backend/jazz/transaction.ts` consumes an
  existing library lifecycle contract but retains detached transactions in an
  app-realm set. Start with the library's existing custody/transaction owner.
  A reusable native receipt recipient is a possible later extraction; a retained
  set is not a reconciliation algorithm or proof of settled writes. Do not move
  Clipper's transaction body or impose its durability choices on Finance.
- **Connection observation:** `backend/jazz/read-connection.ts` is a small SDK
  subscription adapter and a reasonable secondary Jazz adapter extraction if
  Finance needs the same public link facts. It does not prove remote freshness
  or authorize automatic sync, and does not block the worker foundation.
- **Product protocols:** Clipper command schemas, reader/search/image policies,
  worker-rendered i18next feedback, article projections and extension authentication
  stay in Clipper. Finance retains its schema, tenancy/provider rules, Paraglide
  descriptors, access decisions, financial invariants and archive domain profile.

## Extraction order and acceptance

1. **Inventory and contracts (W01/W03):** confirm existing public APIs, pick the
   smallest missing shared contract and define exact app capabilities.
2. **R1 then R2 (W05):** library owns native close/storage/broker adapters;
   update and qualify Clipper before Finance adoption. W02's inactive production
   import probe can proceed independently.
3. **R3 with W04/W05:** implement native crash-safe lease/admission at its shared
   owner and adapt both apps; preserve app-specific account selection. Do not
   activate Finance's SDK before this gate and W06 persistence qualification.
4. **R4 before W17/W18:** extract the disposable lifecycle and update Clipper;
   Finance adopts it per finite domain job. This is independent of R3's design.
5. **W09/W10:** put reusable non-Svelte query/form boundary mechanisms in Local
   First and consume them from Finance without forcing Clipper's product feedback
   or form conventions to change.

Each extraction is a separate implementation/review cycle, not permission for a
cross-app rewrite. Keep compatibility wrappers only while consumers migrate;
finish by deleting replaced implementations so future fixes have one owner.
Public subpath names are proposed at implementation review, not invented here
as already available exports.

For every shared change, verify library types/exports and the packed-package
consumer, not only monorepo source resolution. Move generic regression coverage
with its code; retain app integration coverage. Qualify actual Clipper and
Finance production worker bundles and supported native browsers, including
storage namespaces, late replies, transferred-resource disposal and native
shutdown. Existing source tests were inspected, not rerun in this research.
