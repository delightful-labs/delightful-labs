# SDK broker binding: separate grants selected

On 2026-11-13 the user selected option two: use the existing Jazz callbacks and
separate generation-storage and broker grants. Do not add the proposed SDK
preparation callback or extend the existing Jazz patch for this integration.
The user also directed future work to prepare a solution without new dependency
patches first. A patch must follow evidence of a concrete limitation and a
discussion; simpler application code is not sufficient reason to lead with it.

After reviewing F2's concrete native adapters, the user approved their tests on
2026-11-14. The separate replacement is qualified below and the old combined
adapter is removed. Actual SDK/session integration remains incomplete.

## Source evidence

The pinned patched `jazz-tools@2.0.0-alpha.60` computes its SharedWorker base name
from the physical database and asset scope. The implementation is in
`dist/runtime/native-runtime/browser-shared-worker-connection.js` and
`dist/runtime/browser-worker-config.js`. These helpers are not package exports.

Its public `RuntimeSourcesConfig.browserWorkerHost` currently exposes
`readGeneration(key)`, `writeGeneration(key, value)` and `open(url, name)`.
The SDK reads generation storage before opening the broker. Thus the application
sees the key first and only later sees the URL and generation-qualified name.
The SDK knows the complete binding at that earlier point, but our integration
does not need to receive it together. F1's combined adapter required that; the
separate grants remove that application-side constraint. Neither requires a
fabricated namespace or same-origin wildcard admission.

## Selected solution: keep the SDK interface unchanged

1. `readGeneration(key)` or `writeGeneration(key, value)` requests an exact-key
   generation grant from the worker-owned capability owner. It permits reads and
   writes for that key and cannot construct a SharedWorker.
2. `open(url, name)` requests an exact canonical script URL and full worker-name
   grant. It permits no generation-storage operation. A different generation
   name is another grant; the adapter does not derive a base name from the key.
3. The existing Local First broker client/transport carries operations for each
   grant. Its bounded FIFO, transferred-port custody, failure outcomes and
   independent close protocol are reused without a new wire operation.

Do not deep-import Jazz helpers, copy physical-root/asset naming algorithms,
infer the broker name from a storage key, or expose namespaces in the UI.
Generation coordination retains its existing SDK storage mechanism; it is
separate from the IndexedDB account-selection store and adds no migration code.

## F2 native boundary implemented and qualified

[broker-host.ts](../../src/lib/runtime/worker/broker-host.ts) now provides:

- `serveFinanceGenerationGrant`: strict UUID scope and bounded SDK generation
  key; exact-key admission; receives only native storage, with no constructor.
- `serveFinanceBrokerGrant`: strict UUID scope, same-origin HTTP(S) script URL
  without credentials and exact bounded SDK name with a safe generation suffix;
  receives only origin/construction, with no storage handle.

Both validate/copy binding strings before listeners or native effects and
delegate lifecycle/close to Local First. Other operation kinds are refused
before their native effect. Accepted connection ports remain SDK-owned after
host closure. There is no callback routing, dynamic grant owner, SDK acquisition,
new statechart or application activation in these pure native wrappers.

The browser fixture and inactive build proof now use the separate adapters.
After native qualification, the old combined `serveFinanceBrokerHost` and its
binding type were removed. No combined compatibility path remains in source.
The proof requires both concrete native exports, not just a rendered module.

Static verification passes against `ea460e9d` with the retained W05 work:
`tsc --project tsconfig.worker-host.json --noEmit`, `check:worker-proof`, changed
source/document Prettier, workspace guidance and `git diff --check`. Neither
the Jazz patch nor the lockfile changed. These are not behavioral test results.

Approved behavioral qualification passes:

- All 145 Finance unit files / 2,006 tests, including 41 separate-grant cases
  and all 12 real-build proof cases. The focused host command passes 90 cases.
  Cross-grant refusal, exact-key/URL/full-name isolation, canonical URLs, unsafe
  generation suffixes, invalid configuration before listeners, caller mutation,
  native receivers, independent close after data failure and no replay after a
  throwing native write are covered.
- All nine production-built native cases across Chromium/Firefox/WebKit.
  Generation reads/writes use real localStorage in disposable browser contexts;
  broker grants receive no storage handle. Nine foreign/cross-kind requests
  cause zero native opens/reads/writes. Closing the generation grant leaves the
  broker usable; both return their exact close identities, refuse late calls
  and preserve the SDK-owned accepted port after broker-host close.
- The two retained IndexedDB cases per engine still cover concurrent real
  workers, binding isolation and retained selection/offline edits through two
  complete browser-process restarts. These are account-store checks, not actual
  Jazz identity/replica or offline application-delivery qualification.

Final app/service-worker, host, fixture and proof types pass, with zero app
errors/warnings. The proof and same-origin ephemeral production application
builds pass. The proof retains both native exports, 585 resolved / 352 rendered
worker modules, 14 chunks and one 8,800,443-byte Wasm asset. Normal client output
contains no proof marker, account-store namespace or native-grant error markers;
no new runtime is activated. Successful native cleanup leaves no fixture
directories. Workspace guidance and all 13 tooling tests pass under the required
Node 24.22.2. Existing CI commands run the updated separate-grant fixtures.
The earlier 19-case production PWA result remains F1 evidence; it was not rerun
for F2's inactive native-adapter replacement.

The initial sandboxed full-suite attempt could not bind existing tests' local
listeners; it recorded 177 skipped tests and native listener errors, not a
qualified run. Its two new negative proof fixtures also initially failed to
remove the requested export because Vite's TypeScript transform ran first.
Putting the fixture source edit in the pre-transform phase fixed the fixtures;
all 12 proof cases then passed. The subsequent listener-permitted full suite
passes all 2,006 tests with none skipped. No production grant fix, relaxed
assertion, timeout increase or Jazz patch was needed.
One workspace-tooling invocation accidentally used the shell's Node 25.2.1 and
failed its symlink-replacement fixture. Correcting PATH to the required Node
24.22.2 makes all 13 existing tooling tests pass, without source changes.

Logs: `/private/tmp/finance-worker-w05-f2-*.log`; the qualified full-suite result
is `full-unit-permitted.log`, distinct from the rejected sandbox setup in
`full-unit.log`. Actual SDK callback routing and aggregate lifetime require the
later owner implementation and its own review/qualification.

## Next bounded ownership design

The [concrete grant-owner design](worker-grant-owner-design.md) now owns the
next implementation sequence. F3 exposes the existing broker channel for child
invocation. After the user's 2026-11-14 approval, that shared refactor passes
1,160 library tests, three packed public consumers, 2,006 Finance tests and
12 native cases, plus Clipper's unit/component/worker/extension/offline checks.
The population and SDK acquisition remain subsequent work.

Implement a worker-owned capability machine before SDK acquisition. The SDK's
existing three promise callbacks only forward typed commands to that owner.
The owner retains per-grant work as a bounded dynamic population, keyed by
`generation + exact key` or `broker + canonical URL + exact full name` within
one SDK runtime generation. Duplicate acquisition joins the retained grant;
each SDK operation is still separately identified and never implicitly replayed.

| Owner state    | Admission and obligations                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Accepting      | Admit bounded callback requests, join matching grants and acquire missing grants through the private Window control channel. |
| Draining       | After SDK closure, refuse new calls and retain original issued effects and late acquisition results.                         |
| Closing grants | After the actual SDK close receipt, ask retained clients to close and wait for every original host receipt.                  |
| Closed         | Report success only after all acquired grants close; no outstanding native receipt may be dropped.                           |
| Blocked        | Report failure/unknown closure honestly, retain late-receipt custody and never claim clean shutdown.                         |

Each grant child owns acquiring, ready, draining/closing and closed/blocked
states, with acquisition failure and late transferred ports handled explicitly.
The grant descriptor and data/control ports are private to the runtime generation;
Window performs only bounded validation, native effects and synchronous disposal.
The design must bound outstanding calls and the total retained grant population
before effects, rather than relying only on each transport's individual bound.
Specify concrete limits and wire schemas in that implementation review.

Native callbacks needed by already-issued SDK acquisition/shutdown remain
available while Finance application work drains. The grant owner closes native
admission after the actual SDK close receipt; application drain alone must not
disable the SDK's cleanup capabilities. Faults independently refuse new effects.

This larger owner/protocol design is recorded for review before implementation.
It is not implemented inside an SDK-open promise or native wrapper. A storage
grant refusal must not authorize a broker; an SDK generation-read fallback must
not be mistaken for successful grant acquisition or retry permission.

## Unselected callback proposal

The earlier proposal was an optional SDK hook publishing URL, base name and
generation key before native I/O. It was not implemented. The user chose the
existing-callback solution; no new Jazz patch is authorized by this record.

## Common ownership requirements

The host owns one retained SDK acquisition, one store and a bounded set of
native broker capabilities for that SDK lifetime. Fixed capability/session
children must exist before SDK callbacks can request grants. Promise-facing SDK
methods forward commands to those owners; they do not manually start children
inside an SDK-open I/O leaf.

The worker chart owns grant admission, request identity, readiness, refusal,
late results and shutdown. Window owns only scoped MessagePorts, native
SharedWorker construction, generation primitives and synchronous disposal.
Descriptors and transferred handles stay off the render protocol. Reject stale
runtime generations and close unaccepted late transfers.

On shutdown, retain pending SDK acquisition and original issued effects. Drain
the application, close the actual SDK, then close the IDB store and broker
capabilities through their original receipts. A failed/overdue child or missing
SDK result cannot acknowledge clean termination. Whole-worker loss is tested
separately from graceful close; unknown operations are not replayed.

W06 must qualify actual SDK identity and replica reuse, full cold/offline reopen,
multiple tabs, generation failure and native cleanup. The current Finance UI
remains on its existing Window SDK until full parity and authorized W21 cutover.
