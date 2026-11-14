# Grant population: callback custody decision

Status: the user selected approach A and approved F4c1's concrete implementation
and tests on 2026-11-14. The shared native keeper extraction is qualified; the
aggregate callback bridge/population remains next.
[PR #37](https://github.com/delightful-labs/delightful-labs/pull/37) is merged at
main `4301afde` on 2026-11-14. Continue on
`feat/finance-worker-grant-population`, based on that merge.
The separately approved F4c2 checkpoint is uploaded in
[draft PR #39](https://github.com/delightful-labs/delightful-labs/pull/39) at
`dce092be`. Continue population/bridge work on that PR; W05 remains incomplete.
F4c1 was qualified against main `434a06ee` after F4b checkpoint `868e1e32`.
PR #37 subsequently merges main `fca60ca0` on 2026-11-14; the
[grant-owner handoff](worker-grant-owner-design.md) records the formatting-only
conflict resolution and scoped merge checks. Earlier results keep their original
baseline.

## F4c2: SDK call and interruption contracts

This bounded prerequisite prepares SDK callback outcomes and exact operation
bindings before the population/producer bridge. The user reviewed and approved
its implementation and tests on 2026-11-14 ("yes" to proceeding with the F4c2
implementation tests). This is separate from F4c1's earlier approval.

A callback waiting for acquisition has a runtime/callback identity but no broker
wire sequence. After dispatch, a stopped write may have an unknown effect even
if the population never received its wire identity. The existing keeper's result
type only permits unknown failure with a required `WorkerRequestIdentity`.
Fabricating a sequence, or using a not-issued refusal for that write, would report
an outcome the owner did not observe.

Add an opt-in `interrupted` callback result in Local First, with required
`reason: closed | unavailable` and `effectOutcome: not-issued | unknown`, and no
wire identity or successful response. The chart still selects this result and
records it before dispatch; the keeper only retains/delivers it. Existing channel
callers keep their exact result type by default. Neither the wire protocol nor
the SDK is changed. A real channel result still carries its actual wire identity.

Finance's private callback identity is a copied, validated runtime UUID plus
request UUID. Pure call preparation captures the caller's result recipient,
validates/canonicalizes an exact generation key or same-origin broker URL/full
name, then validates the actual canonical operation through public
`brokerHostCall`. Validate again after URL canonicalization where expansion could
exceed the wire bound. Do not copy private broker schemas or SDK namespace rules.

The pending-byte calculation is UTF-8 JSON of the validated canonical operation
payload (OPEN/READ/WRITE fields); fixed identity-envelope overhead is separately
bounded by UUIDs and callback/grant counts. This is a request-budget metric, not
a browser-heap measurement. Preparation reports its byte count but performs no
admission, post, listener, randomness, promise or actor creation. The later chart
must enforce the aggregate 1 MiB/eight-callback/32-grant limits before effects.

This prerequisite does not bind SDK callbacks, construct a native inbox, acquire
grants or activate the runtime. Retain it in the inactive worker import proof.
Approved qualification covers truthful interruption of
waiting/issued callbacks, unchanged existing consumers, opaque-port custody,
canonical URL expansion, caller-mutation capture, invalid scopes/operations,
UTF-8/escaped payload accounting and real-build omission of the new preparation
module. The population, bounded producer inbox and actual SDK fallback ordering
remain subsequent implementation work.

Static review on 2026-11-14 passes Local First source formatting/lint, library
types, `pnpm build:libraries` (including package validation), existing public
consumer declaration types, Finance application/service-worker/strict host/proof
types, the real worker proof build, Clipper web/extension types, shared peer-link
and guidance checks, and whitespace checks. The generated package declarations
retain the default `never` parameter; the worker report contains the rendered
`sdk-call-binding.ts` implementation. These were the pre-approval static checks;
the approved behavioral results below are separate evidence.

`worker-bundle.test.ts`'s existing broker/grant-binding omission fixtures now
remove the new preparation import/catalog entry too: it otherwise retains those
implementations transitively. Their actual missing-module assertions are
preserved, with a separate preparation-module omission case. Direct custody
cases cover waiting/issued interruption, exact callback identity, selected
disposal, throwing observers, accepted native-port survival and late registration.
The existing packed consumer now checks both default result compatibility and
opt-in outcomes without fabricated wire identities. `sdk-call-binding.test.ts`
covers the operation/capture/byte contracts above. No production implementation
changed after review.

### F4c2 qualification on main `4301afde`

Run from this isolated branch using Node 24.22.2 and pnpm 10.28.0:

| Scope             | Command and result                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local First       | `pnpm exec vitest run --config vitest.config.ts`: 1,198 tests in 57 files, including all 24 direct custody cases.                                                                                            |
| Published exports | `node fixtures/package-consumer/worker-host-close-packed.mjs`: all four actual-tarball consumers pass public declaration checks, native effects/receipts and self-contained module-worker builds.            |
| Finance           | `pnpm test:worker-host`: 184 cases in 10 files; `pnpm test:unit --run`: 2,104 cases in 149 files, including 21 call-binding and 16 real-build proof cases; `pnpm test:worker-state`: 18 cases in four files. |
| Native Finance    | `pnpm test:worker-bindings`: all 21 cases across Chromium/Firefox/WebKit, including accepted SharedWorker port survival and full browser-process account-store restarts.                                     |
| Clipper           | `pnpm test:unit`: 872 cases in 134 files and 30 component cases in six files; `pnpm test:worker`: all 32 native worker cases.                                                                                |
| Static            | Library/test and public consumer types, strict Finance host/native-fixture types, changed-file formatting/lint and whitespace pass alongside the pre-approval checks above.                                  |

Logs are `/private/tmp/finance-worker-f4c2-*.log`. All completed runs pass on
their first attempt. Existing production PWA/provider, packaged-extension and
production-offline results below/in the linked keeper record retain their F4c1
baseline; they were not rerun for this type extension and inactive pure helper.
The shared native custody algorithm, live SDK facade and storage implementation
are unchanged. Native/packed tests qualify compatibility; they do not establish
the unimplemented population's aggregate limits or SDK fallback ordering.

The [single-grant design](worker-grant-owner-design.md) remains authoritative for
F4a/F4b. This record makes the next callback ownership decision explicit before
implementing the aggregate population. It does not change the selected SDK
callbacks, exact grant bindings, limits or SDK-before-grant shutdown order.

## What the next owner must do

Invoke one population before SDK acquisition. Its chart admits SDK callbacks,
joins an existing exact grant or spawns one `createFinanceGrantOwner()` child,
and dispatches each admitted operation once after `GRANT_AVAILABLE`. It retains
failed identities until the runtime ends. A late pair after retirement must
follow the existing child's close path, never become available again.

The population enforces 32 retained grants, eight outstanding callbacks across
all grants, and 1 MiB of aggregate encoded pending request payloads before native
effects. Calls waiting for acquisition count toward both callback limits. The
implementation must define the encoded representation and keep reservations
until actual settlement; per-channel eight-call bounds alone are insufficient.

| Population state | Selected behavior                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Accepting        | Validate and copy SDK input; admit bounded calls; join/acquire an exact grant; forward only through an available grant.        |
| Faulted          | Refuse new native effects; report the fault; settle waiting calls as not issued; retain already-issued work and grant custody. |
| Draining         | After actual SDK closure, refuse new callbacks and retain original issued settlements and late acquisitions.                   |
| Closing          | Retire retained grants and wait for their original definitive non-allocation or matching host-close outputs.                   |
| Blocked/overdue  | Report incomplete cleanup and keep observation alive; a deadline or stopped child is never a closure receipt.                  |
| Closed           | Every owned acquisition and callback is settled and every acquired grant has a genuine close output.                           |

After any failed generation read/write, the population must fault admission
before releasing that callback's rejection to the SDK. The installed SDK catches
these errors; its fallback must not authorize another native open. This ordering
needs a real SDK acceptance case, including a read fallback and a write fallback.

## The concrete custody gap

An SDK callback may already have returned a promise while its grant is still
being acquired. Keeping its resolver only in population context is insufficient:
forced stop/error does not run ordinary drain transitions. That promise needs an
explicit terminal rejection path too.

After dispatch, a successful open also returns a live MessagePort. Passing that
port through an event to a stopped/error actor does not establish acceptance.
If reporting fails or the recipient stops before delivery, some native owner must
still hold and dispose the unaccepted port. A fulfilled SDK open transfers its
port to the SDK; later grant closure must preserve that accepted port.

These are native callback/resource obligations, distinct from retry, admission,
readiness and shutdown policy. Those decisions remain visible in the charts.
Neither option below starts an actor inside an SDK promise or patches Jazz.

## Existing code and reuse

- Local First's [worker channel](../../../../packages/local-first/src/lib/machines/lifecycle/worker-channel.ts)
  already registers native observers before dispatch, retains returned resources
  under private tokens, and delivers or discards them on the chart's command.
  Its callback disposer settles outstanding dispatched observers when stopped.
  At the researched F4b checkpoint this machinery was private to
  `createChannelController`. F4c1 now qualifies the extracted keeper and existing
  channel adoption; actual callback routing before grant acquisition is next.
- Its [broker adapter](../../../../packages/local-first/src/lib/backend/jazz/worker-broker.ts)
  validates operations through `brokerHostCall` and invokes that same channel.
  Its existing root facade settles SDK promises directly. The population must
  preserve this native ownership contract while adding aggregate admission and
  failure-before-SDK-fallback ordering.
- Local First's [transaction custody](../../../../packages/local-first/src/lib/machines/workspaces/transaction-custody.ts)
  retains transaction/acquisition/commit promises for detached recovery. It does
  not provide bounded SDK callback registration or unaccepted MessagePort
  delivery, so it is not a drop-in replacement.
- Clipper consumes the shared broker/channel through its existing root facade.
  Refactoring that machinery therefore requires Clipper regression coverage,
  even though Finance's population is the new consumer.

## Two supported approaches

### A. Extract the existing native callback custody into Local First

Expose a small typed native primitive based on the channel's current observer/
resource keeper. Use it in the existing channel and for Finance's callback bridge.
The population chart remains the sole owner of admission, dispatch, fault and
graceful-close decisions. The primitive retains callbacks/ports, performs selected
delivery/disposal, and has an explicit stop/error handoff.

This is the selected direction because the existing channel and the new
bridge need the same custody guarantees, and the user requested reusable
mechanisms in Local First. It requires a shared refactor and qualification of the
existing broker facade, packed public exports and Clipper before adoption.

### B. Keep the shared channel unchanged and add a Finance SDK bridge keeper

Add a native adapter specifically for the existing `browserWorkerHost` promise
methods. It retains callbacks waiting for acquisition, handles their stop/error
settlement, and accepts returned resources from the unchanged shared channel.
The population chart still chooses admission and outcomes. Generic extraction
would be a later review if a second consumer needs that adapter.

This keeps the next production-code diff within Finance, but introduces another
callback keeper alongside the library's existing implementation. It needs its own
ownership and reentrancy evidence. It must not become a second native workflow
or copy the broker's wire decoder, FIFO or close policy.

## Required detail after choosing

F4c1's [public keeper API and ownership boundary](../../../../packages/local-first/docs/worker-callback-custody.md)
now specify `register`, `recordStopResult`, `capture`, `deliver`, `discard` and
`stop`, plus the existing immediate-delivery leaf. The channel delegates native
bookkeeping to this implementation and selects its stop result in the chart.
The extracted helper starts no actor, contains no admission/retry/deadline policy,
and introduces no callback producer inbox. It is a prerequisite, not an
implemented callback bridge or population. Approved qualification passes 1,192
library tests (109 focused), four packed consumers, 2,082 Finance units,
163 focused host cases, 18 worker-state cases, 21 native browser cases and all
19 production PWA cases, plus Clipper's unit/component/worker/extension/offline
regressions. The linked keeper record preserves the tests' native-error-path
fix, initial assertion/environment failures and commands/results.
The root retains that keeper through child failure. An explicit channel
`releasing` state joins the genuine host receipt/issued settlements with typed
native data/custody release facts; failed cleanup blocks completion. This keeps
the additional release decision in XState rather than hiding it in the helper.

The population/bridge implementation still needs these boundaries:

1. Callback custody exists before forwarding a request, including synchronous
   reports/reentrancy. Overload refusal cannot leave an unresolved promise or
   create an unbounded native callback inbox beside the chart's eight-call limit.
2. Native callback registration and resource tokens are receipt bookkeeping.
   Admission, original deadlines, retries, fault selection and graceful shutdown
   remain statechart decisions; no mirrored lifecycle flags in the keeper.
3. A native result remains owned until actual SDK acceptance or selected disposal.
   Stop/error during reporting or delivery must not lose a port or double-settle
   a callback. Generation failure reaches the population before SDK fallback.
4. Correlate grant replies with all three identities and preserve offered pairs
   until `GRANT_ACQUIRED`. The future acquisition transport retains unaccepted
   and contradictory replies, with explicit disposition and alias protection;
   they are not forwarded into completed children.
5. Forced stop/error is disruptive settlement, never successful SDK or grant
   closure. Unknown issued writes are not replayed or relabeled not issued.

Then implement one bounded slice for review before its tests. Qualification must
cover aggregate limits across multiple grants, duplicate acquisition, both SDK
generation fallbacks, synchronous/late replies, observer failure, stop during
acquisition/result delivery, accepted-port survival and SDK-before-grant closure.
The population, transport and actual SDK/session composition remain incomplete.
