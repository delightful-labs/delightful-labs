# SDK callback owner: F4c3

Status: the user separately approved this concrete implementation and its tests
on 2026-11-14 ("yes" to the F4c3 review request). Qualification below passes on
PR #39's branch after F4c2 (`dce092be`, planning follow-up `e4a3bf28`) and its
CI fixture correction `bc61a737`, based on main `4301afde`. This is a prerequisite
for the bounded intake/population, not that population or a live SDK bridge.

## Why a callback needs an owner

One SDK callback can wait for grant acquisition, issue an operation, encounter a
failure that Jazz would catch, settle its SDK promise, and still retain an
uncertain native operation. Those are distinct stages. Keep them in one small
child machine rather than phase flags in a population array or native closure.
The population admits/spawns at most eight such children and owns its aggregate
budget; the existing grant child still owns acquisition, wire requests and close.
The native keeper retains callback/port custody across child/root failure.

The implemented factory is `createFinanceSdkCallOwner()` under `machines/runtime/`.
It starts no root, promise facade, worker, port or listener when constructed.
Its only asynchronous leaf performs one selected shared-keeper delivery.
All admission, dispatch, fault gating and reservation-release decisions remain
in the chart. The helper that captures input is pure validation/copying only.

## Input and lifetime

Input supplies a prepared canonical call, admitted origin, exact runtime/grant/
acquisition identity, original close request UUID, grant/report recipients and
the keeper's `recordStopResult`/`deliver` capabilities. Initialization revalidates
and copies the call, recomputes its payload bytes, checks its advertised binding
and callback request UUID, and captures those native methods before effects.

The population/native boundary must register the SDK recipient before offering
the call or creating this child. It retains the full shared keeper outside this
child until native cleanup completes. Missing registration cannot become proof
that a callback was delivered. The later adapter must retain native results before
reporting, associate tokens with their exact callback, and reject duplicate or
foreign reports without discarding another callback's resources.

The child has no acquisition/request/close timer of its own. Existing grant and
channel owners retain their original deadlines. No retry or new grant is selected
here. A parent deadline may report incomplete drain; it cannot manufacture a
missing delivery or close receipt.

A matching close before a broker result interrupts an issued callback without
inventing its wire sequence: unknown for an effect, not-issued for a query's
effect. The population fault gate still precedes SDK rejection. Actual results
arriving later remain the native adapter's custody obligation; they cannot be
forwarded to a completed child. Availability for an already stopped grant also
cannot issue a new request.

## States and receipts

| State                       | Selected behavior                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `waitingForGrant`           | Wait for the exact grant's availability. A matching close before availability requests a population fault and cannot dispatch later.                                                                                           |
| `issued`                    | Before forwarding one REQUEST, record the chart-selected conservative stop result: unknown for OPEN/WRITE, not-issued for READ. Repeated availability cannot dispatch again. Await the native callback's actual broker result. |
| `awaitingAdmissionFault`    | Report `SDK_CALL_REQUIRES_FAULT`. Release no failure to Jazz until the population sends matching `ADMISSION_FAULTED` after closing native admission. This covers read/write fallback and broker failures.                      |
| `delivering.nativeDelivery` | Invoke one shared-keeper delivery; a native exception blocks completion and reports `SDK_CALL_BLOCKED`.                                                                                                                        |
| `delivering.sdkSettlement`  | Independently await the actual SDK recipient's matching `SDK_CALLBACK_SETTLED` observation after its native resolve/reject returned.                                                                                           |
| `checkingRelease`           | After both delivery regions finish, choose definitive release or retention using the result and any actual close receipt already observed.                                                                                     |
| `retainingSettlement`       | The SDK promise has settled, but the call/byte reservation remains until the exact grant's genuine host-close output.                                                                                                          |
| `blocked`                   | Report incomplete custody and retain references for root cleanup. No successful output.                                                                                                                                        |
| `released`                  | Output only callback/grant identity and release evidence; clear call payload, recipient/custody capabilities, result and token. No accepted SDK port appears in output.                                                        |

The keeper's `deliver()` returns void, including when no registration exists.
Its return is not SDK settlement evidence. The parallel delivery join therefore
requires both actual recipient settlement and completion of the native delivery
operation. A throwing recipient, missing registration, absent report or native
cleanup failure cannot silently free a reservation. Synchronous receipt reporting
must work while the delivery invocation is still completing.

Only the future native SDK recipient can report `SDK_CALLBACK_SETTLED`. It must
retain that fact if reporting fails, and must not throw after accepting an SDK
port merely because its report failed: that would incorrectly return accepted
custody to the keeper. Stop, timeout, subscriber completion and an attempted
delivery cannot synthesize this report.

Every non-success broker result requests the population fault gate before SDK
delivery. `CANCEL_WAITING` is a private population command affirming that admission
is already closed by fault or actual SDK closure; it selects a not-issued result
only before dispatch. It does not cancel or relabel issued work. Early or foreign
fault acknowledgements do not authorize a future failure delivery.

Success and pre-dispatch refusal/interruption can release after confirmed SDK
delivery. Conservatively retain **all failed wire calls** until matching grant
closure: a READ timeout may report no effect but still does not establish native
request settlement. For WRITE, an unknown result also cannot prove settlement.
Correlation checks include the runtime/callback UUIDs, grant/acquisition UUIDs,
actual broker scope/request identity and original host-close request UUID. Broker
reply acceptance reuses the public validator; OPENED also requires a native token.

## Required population composition

The population receives two different facts:

1. `SDK_CALL_DELIVERED` says both delivery receipts were observed and whether the
   reservation remains retained. It does not mean the child has completed.
2. Child output `released` authorizes freeing the aggregate call/byte reservation.

After **actual SDK closure**, the population may retire grants once all SDK
callbacks have delivery receipts, including callbacks retaining uncertain work.
Their matching grant-close outputs then release retained reservations. Waiting
for every retained child to complete before asking grants to close would deadlock.
Observe retained child refs/outputs through supported spawned-child subscriptions;
a missing/stopped child is neither receipt. Keep late acquisition pairs under
their transport owner until the grant's real `GRANT_ACQUIRED` report.

An intake bound before XState's mailbox is still required. `send()` is not an
admission acknowledgement; an eight-call guard inside the chart alone cannot
bound queued callbacks. A native adapter must bound registrations/payloads before
posting offers and coalesce failure notification without retaining an unbounded
overflow inbox. Its failure gate must establish native admission closure before
letting a generation error reach Jazz. These requirements are not implemented by
this child. No SDK/dependency patch is proposed.

## Review and qualification

The factory is retained in the inactive application-worker catalog and required
rendered implementation list. No production caller or shared/Clipper behavior is
changed. Static types/build evidence is recorded after completing source review.

Source review passes on 2026-11-14: Finance app/service-worker types (zero errors
or warnings), strict host types including `--noUnusedLocals`, worker-proof types,
the real worker build, changed-file formatting, shared guidance/peer links and
whitespace checks. The generated worker report includes the rendered call-owner
implementation. Logs are `/private/tmp/finance-worker-f4c3-*.log`. These are static
checks, not evidence of native/race behavior. The approved behavioral evidence
below is separate. PR #39's `bc61a737` hosted checks all passed before this slice
was uploaded; those results are not relabeled as F4c3 hosted qualification.

Approved direct state/behavior and generated sequence coverage use
real keeper/MessagePorts and a parent fault gate. Cover exact identity rejection,
one dispatch, stop-result ordering, missing/throwing SDK recipients, independently
ordered delivery receipts, fault-before-Jazz-rejection, early/late grant closure,
READ timeout and unknown-WRITE reservation retention, cancellation before/after
dispatch, child/root error and stop, opaque-port survival, and final payload release.
Do not claim actual SDK fallback integration before the native bridge/population
exists. Qualify native/packed existing owners as warranted by actual changes.

Real-build broker, grant-binding/protocol and SDK-call-preparation omission
fixtures now remove this owner's import/catalog entry as well, because it retains
those modules transitively. A separate owner-omission case preserves the real
missing-module assertion. No production implementation changed during testing.

### Approved qualification before the latest-main refresh

Using Node 24.22.2/pnpm 10.28.0 on `bc61a737` plus F4c3:

| Scope                   | Result                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct callback owner   | All 43 cases pass: actual keeper, parent fault gate, native ports, real grant/channel integration and late native closure after a WRITE timeout.                                                                                                                                      |
| Generated obligations   | 400 sequences, seed `20261115`, up to 24 commands, comparing observable obligations with the real owner/keeper. All configured reference-model state nodes, event types and transitions are covered.                                                                                  |
| Finance units           | 2,148 cases in 150 files, including 17 real-build proof cases.                                                                                                                                                                                                                        |
| Focused host suite      | 227 cases in 11 files.                                                                                                                                                                                                                                                                |
| Worker-state suite      | 19 cases in five files, including the new callback sequences and the prior 400 grant-owner sequences.                                                                                                                                                                                 |
| Native browser bindings | All 24 cases across Chromium/Firefox/WebKit. Three new cases exercise the real call owner in a dedicated Worker, an explicitly withheld SDK settlement receipt, a transferred SharedWorker port and genuine grant closure. The accepted port still echoes after grant/keeper closure. |
| Static/build            | Finance app/service-worker/strict host/native-fixture/model/proof types, real worker proof build and touched-file formatting pass.                                                                                                                                                    |

The generation-fallback test uses a caller promise that attempts a fallback after
rejection; it does not claim actual Jazz fallback integration. The browser fixture
owns exactly one callback and uses the real existing grant owner, not a substitute
production population. Generated steps observe quiescent macrosteps; they do not
prove every platform schedule. Native receipt-order and cleanup cases complement
that bounded exploration. Actual SDK callbacks/session composition and the
physical intake/aggregate limits remain pending.

The first formatting pass found a test-source typo; the first test type check
found an overly broad inferred fixture sender. The fixture now uses a checked,
explicit callback-event capability without a cast. All behavioral runs passed
their first executed attempt. Focused native selection passed 3/3; full native
qualification passed 24/24 without skips. Logs are
`/private/tmp/finance-worker-f4c3-*.log`. No new counterexample was produced.
