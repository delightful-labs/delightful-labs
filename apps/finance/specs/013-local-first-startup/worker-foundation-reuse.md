# Local First and Clipper reuse for Finance workers

Source review: 2026-11-13, monorepo `main` at `eb0f615f`. This supplements
[code research](worker-migration-research.md) and changes the ownership and
dependency details in the [ordered migration tasks](worker-migration-tasks.md).
This document specifies extraction work; no application/library implementation
has been moved or tested in this research change.

## Selected storage architecture (2026-11-13)

The user selected an IndexedDB AccountStore accessed directly in the application
worker. The [W03 design](worker-native-custody-design.md) supersedes the earlier
permanent localStorage/Window lease approach. Add the missing adapter and native
transaction ownership in Local First; reuse its existing IDB/custody patterns.
The user explicitly excluded migration and old-version compatibility code.
Build no import, legacy fallback, dual writes, source cleanup or coordination.
App/profile key configuration stays app-owned. R1 and the broker part of R2 remain applicable;
the permanent account-storage RPC and remote-lock keeper are not mandatory
extractions. Reuse their relevant receipt/failure scenarios rather than copy an
obsolete storage architecture.

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

### R2. Jazz broker transport; retire account-storage RPC

Sources:
[`scoped-storage-channel.ts`](../../../clipper/apps/web/src/lib/runtime/worker/scoped-storage-channel.ts)
and [`broker-channel.ts`](../../../clipper/apps/web/src/lib/runtime/worker/broker-channel.ts)
compose Local First's worker-channel machine and R1.

Extract the SDK-specific `browserWorkerHost` broker/generation adapter into Local
First. Its native SharedWorker construction and generation primitives are distinct
from the account-selection store. Keep the explicit browser-host and Jazz
integration boundaries; consumers supply admitted URL/name/generation bindings.
Do not silently migrate SDK generation keys to IndexedDB as part of AccountStore.

Finance's new native adapters admit an exact URL/full-name broker grant and a
separate exact-key generation grant through existing SDK callbacks, without a
new Jazz patch. Their native qualification is recorded in the
[SDK binding decision](worker-sdk-binding-decision.md); actual SDK/session
integration remains pending. Clipper admits same-origin URLs and Jazz-prefixed
keys more broadly. Preserve Finance's narrower capability binding. Keep FIFO
effect admission, no replay of
uncertain generation writes, disposal of unaccepted transferred ports and
independent data/control lifetimes. Adopt the shared broker in Clipper, then
Finance; qualify both consumers and remove replaced implementations.

Do not extract the fixed-key account-storage RPC as the permanent shared store.
The selected shared AccountStore directly uses IndexedDB in the worker. Do not
extract a temporary import/compatibility subset: that work is explicitly out of
scope. The new store never reads legacy account-selection records.

### R3. Reuse receipt custody; add the IndexedDB AccountStore

Sources:
[`account-write-custody.ts`](../../../clipper/apps/web/src/lib/runtime/worker/account-write-custody.ts)
and [`scoped-account-store.ts`](../../../clipper/apps/web/src/lib/runtime/worker/scoped-account-store.ts).
The receipt-before-issue ledger, total stop/error handoff and reentrant-disposal
scenarios remain useful. Compare them with Local First's existing transaction
custody before extracting another keeper. Extract only a concrete missing
reusable receipt mechanism; no account payload or transform belongs in detached
custody or public snapshots.

Do not port the worker-held Web Lock or Window-write pipeline into the new IDB
adapter. Same-realm keepers cannot survive complete worker loss; native IDB
transaction commit/abort and atomic reopen are the selected safety boundary.
The new store must retain original native receipts through owner stop/error,
refuse admission on close, acknowledge only transaction completion, and preserve
unknown results without replay. See the [W03 contract](worker-native-custody-design.md).

Do not port Finance's primary/earlier-key import or cleanup. SDK selection
semantics remain SDK-owned within the new store. Clipper supplies its web and
extension/offscreen bindings;
`:clipper` and Finance's `dev` do not become library defaults. The shared adapter
must serve both apps through supported public exports, without copying the
complete Clipper owner or workspace/restore journal.

Move/adapt applicable stopped-owner, reentrant disposal, bounded-admission,
unknown-result and late-settlement scenarios with the shared mechanism. Add
native IDB abort-after-request-success, concurrency, termination and cold-reopen
coverage; old remote-lock tests cannot substitute for it. Keep app-level identity,
namespace and domain regressions in their respective apps. No legacy migration
regressions or mixed-version compatibility machinery are planned.

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
2. **IndexedDB foundation (W04):** library owns the transactional AccountStore,
   native receipts and bounded close. Reuse existing custody/IDB contracts;
   qualify the public adapter before app adoption.
3. **R1/R2 and adoption (W05):** extract remaining broker/close adapters and
   qualify Clipper's shared broker, then Finance's broker/IDB bindings. The user
   approved Finance-first sequencing on 2026-11-13: Clipper's remaining account
   store and hidden capture-runtime conversion is a separate follow-up, not a
   Finance prerequisite. Keep its current account-storage path until that work.
   No migration
   or old-version compatibility work is included. Retire account-storage RPC/remote locks after
   qualification. R3 contributes applicable receipt mechanisms/scenarios, not a
   required copy of its keeper. Activation still waits for W06.
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
