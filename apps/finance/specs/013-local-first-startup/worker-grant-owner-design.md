# Worker-owned Jazz grant lifecycle

Current slice: F4a defines the private grant binding/acquisition contract before
the grant-owner machines use it. The user approved its concrete implementation
and tests on 2026-11-14; the qualification below passes. F1–F3 and the close
correction retain their own historical evidence. W05/W06 and production activation
remain incomplete; the single-grant owning chart is next.

The user merged [PR #35](https://github.com/delightful-labs/delightful-labs/pull/35)
on 2026-11-14 at main `434a06ee`. The follow-up branch
`feat/finance-worker-grant-owner` is fast-forwarded to that merge, including PR
#34's Markdown-only CI/build selection. F3 results below retain their actual
`ea460e9d` source baseline; the close correction records its own refreshed evidence.

PR review identified hidden native disposal/acknowledgement failures in the
shared close adapter. The [close correction](../../../../packages/local-first/docs/worker-host-close.md#pr-35-review-correction-explicit-native-failure-facts)
was addressed in merged PR #35 before grant-owner work continued.
The user approved the concrete implementation and its tests on 2026-11-14.
Its own qualification passes 1,170 library tests (87 focused), all public package
consumers, 2,006 Finance unit/12 native-browser cases and Clipper's 872 unit,
30 component, 32 worker, 12 extension and eight production-offline cases. The
linked correction record preserves the new model-oracle failure/replay and
sandbox startup failures. F3's historical qualification below remains separate.
The grant-owner follow-up includes this correction.

## Ownership and the concrete missing contract

The SDK's existing `browserWorkerHost` callbacks remain unchanged. A single
worker-owned grant population will route them to F2's separate exact generation
and broker grants. The population must exist before SDK acquisition begins.
It must retain acquired channels and pending acquisition through SDK close.

The current public `brokerHostClient` starts an independent actor at a worker
host boundary. Calling it inside a grant-acquisition promise would start an
unsupervised root inside I/O. Copying its private wire decoder into Finance or
replacing its FIFO/close machine would duplicate the existing shared machinery.

The bounded prerequisite is to expose that same typed channel logic and native
input builder for invocation under a grant child. The old root facade delegates
to these primitives. This is a Local First API change, not a Jazz patch or a
new workflow. No Finance domain machine is moved into the library.

## F3 implementation

Public exports on `delightful-local-first/backend/jazz/worker-broker`:

| Export                                                     | Responsibility                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBrokerHostChannel()`                                | Return the existing worker-channel logic specialized to the private broker protocol. It creates no running actor or native listener.                                                   |
| `brokerHostChannelInput(data, control, identity, options)` | Validate and capture the explicit host-close identity; return the existing native post/listen/discard capabilities. Native listeners start only when the child channel invokes them.   |
| `brokerHostCall(requestId, operation, settle)`             | Validate/copy one bounded operation and UUID, select its protocol reply predicate and effect kind, and return the shared chart's call contract. It posts nothing and chooses no retry. |

Structural operation/reply/result/call/input types are public. Runtime Zod wire
schemas remain private, preserving the existing cross-package version boundary.
Identity creation stays at the native host boundary. No clock, randomness,
mutable registry or actor start occurs in these factory/input calculations.

The existing `brokerHostClient` signature, SDK facade, configured clock,
original close promise and forced disposer remain. Its channel construction and
call preparation now delegate to the same exports. Existing Clipper and Finance
callers continue through that path; no caller is switched to an unqualified
parent-owned runtime.

The shared channel still owns eight-call admission, FIFO sequence, effect
classification, request deadlines, malformed/late port custody, host-close
correlation and blocked/overdue lifetime. An invoked child's ordinary completion
contains a genuine host-close receipt. Forced parent stop is not graceful close;
the application owner must keep the child invoked until that receipt arrives.

## F4a: private grant binding and acquisition contract

This first ownership prerequisite defines facts and validation only. It does
not introduce a second owner, callback registry, Window workflow or native I/O.
The existing generation/broker adapters consume the same extracted binding
schemas, preserving their exact-key/full-name/same-origin admission and error
messages. Their exported types remain available from `broker-host.ts`.

`runtime/worker/grant-binding.ts` owns the generation/broker descriptor union,
canonical same-origin HTTP(S) URL validation and copied native bindings. Its
`financeGrantKey` calculation encodes the runtime generation plus exact descriptor
as a JSON tuple, so separators inside SDK-supplied names/keys cannot alias another
grant. The future owner must validate/canonicalize before calling this key
calculation. No private SDK namespace or generation algorithm is reconstructed.

`runtime/worker/grant-protocol.ts` defines a separate private version-1 protocol.
Every frame includes UUID `runtimeId`, `grantId` and `acquisitionId`. The grant ID
is the native channel scope; the actual close request ID is independently supplied
by the worker owner when invoking the existing shared channel. This keeps an
acquisition report distinct from a successful host-close receipt.

| Frame             | Native observation and required resources                                                              | Owning-chart consequence in the next slice                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `ACQUIRE_GRANT`   | Exact generation or broker descriptor; no transferred ports.                                           | Admit once under the runtime's bounded population and retain the acquisition identity.                                        |
| `GRANT_READY`     | Exactly two distinct declared data/control ports, transferred in that order.                           | Consume only the matching acquisition; invoke the shared channel, or close a genuine late grant if its SDK work was canceled. |
| `GRANT_REFUSED`   | No grant was allocated/retained; no transferred ports. Bounded rejected/overloaded/unavailable reason. | Settle not-issued, retain the failed grant identity and fault new native admission where required.                            |
| `GRANT_UNCERTAIN` | Allocation/cleanup cannot be established; no transferred ports. No raw exception.                      | Fault admission and retain original acquisition/late-result custody; do not select clean closure or retry.                    |

The decoders validate strict frame shape and exact transferred-resource identity.
Origin admission/canonicalization uses `financeGrantDescriptor` with the trusted
runtime origin before the worker posts a request; the Window native binding
rechecks the same admission before constructing the selected grant.
They do not correlate against the current actor, dispose ports, interpret
readiness or select a lifecycle outcome. The owning chart uses the pure
`sameFinanceGrantIdentity` predicate for runtime/grant/acquisition correlation.
Native listeners must close rejected transferred resources before discarding an
invalid/foreign frame. A failed decoder is not cleanup evidence. A valid late
pair stays with its original acquisition owner until genuine channel closure.

The protocol declares the planned limits of 32 retained grants, eight total
outstanding SDK callbacks and 1 MiB of encoded pending request payloads. Aggregate
admission is not implemented/enforced by these constants or schema validation;
the population machine must apply all three before requesting native effects.

The inactive production worker import proof retains the descriptor/key functions
and both decoders; its graph guard now requires both new implementation modules.
Normal startup still acquires no grant or worker SDK. The
existing shared channel continues to own actual broker operations, call FIFO,
request deadlines, resource custody and close failure/receipt handling.

Static checks pass on main `434a06ee` plus this F4a implementation: Finance app/
service-worker checks with zero errors/warnings, strict host and worker-proof
types, the production worker proof, changed-file Prettier,
workspace guidance/peer links and diff whitespace. The worker graph resolves
587 modules, emits 14 JS chunks and one 8,800,443-byte Wasm binary, and renders
both new contract modules with nonzero implementations. These are import/type
checks, not behavior or custody qualification. Logs remain in
`/private/tmp/finance-worker-w05-f4a-*.log`.

After the user's concrete implementation/test approval, qualification passes
against main `434a06ee` plus this F4a change:

- All 2,047 Finance unit tests in 147 files, including 39 new binding/protocol
  cases and two new actual-build omission cases (14 worker proof cases total).
- All 129 focused host cases in eight files. The new contract coverage includes
  canonical URL/key separation, runtime and separator isolation, caller mutation,
  exact field boundaries, strict variants/fields/versions/IDs, all correlation
  components, missing/extra/swapped/undeclared/aliased/fake port pairs,
  resource-bearing failures and zero port effects from pure decoding. Existing
  separate-grant native receiver tests pass through the extracted binding rules.
- All 15 production-built native cases across Chromium, Firefox and WebKit.
  Each engine now decodes actual request/refusal/uncertain/ready frames in a real
  worker, rejects a failure carrying an unexpected port, and echoes distinct
  data/control paths through the transferred pair. The prior root/child broker
  cases and concurrent/cold IndexedDB cases remain, including retained edits
  through two complete offline browser-process restarts.
- Strict host/test and native-fixture types pass. Finance app/service-worker and
  worker-proof checks, the production worker proof, formatting, workspace
  guidance/peer links and whitespace checks also pass.

Reproducible commands from Finance: `pnpm test:worker-host`,
`pnpm test:unit --run`, `pnpm test:worker-bindings`, `pnpm check`,
`pnpm check:tests`, `pnpm check:worker-proof`, `pnpm build:worker-proof` and
`pnpm exec tsc --project tsconfig.worker-host.json --noEmit`. The unit/native suites
use the permitted disposable listeners and isolated browser profiles; their
qualified runs pass on the first attempt. Logs are
`/private/tmp/finance-worker-w05-f4a-*.log`, with final focused results in
`focused-final.log`. No production implementation changed after review.

This qualifies binding extraction and frame/resource decoding. The browser probe
is fixture code, not the production grant-acquisition transport or owner. Aggregate
limits, retained late-acquisition cleanup, actual SDK callbacks and full grant/
session shutdown still require their own implementation and acceptance evidence.

Continue in dependency order:

1. Single-grant acquisition/channel chart: explicit refusal, uncertainty,
   cancellation/deadline and late-grant close; invoke the existing shared channel.
2. Bounded dynamic population and SDK callback command bridge: duplicate joins,
   global call/byte budgets, generation failure faulting and retained identities.
3. Private Window acquisition transport and native custody: allocate one selected
   grant, validate/transfer exact resources and report native failure facts. Keep
   duplicate/lifecycle policy in the worker charts.
4. Compose the single SDK/store/session lifetime and qualify actual SDK callbacks
   under W05/W06 before any production UI/runtime activation.

## Subsequent population and session composition

The following design prepares the next implementation. F3 does not yet add this
population, private grant-acquisition transport or SDK session.

1. At worker initialization, create one runtime-generation binding. Invoke the
   grant population before invoking the existing Local First SDK-acquisition
   owner. The SDK receives three promise-facing methods that only forward typed
   native requests; they never construct actors or ports themselves.
2. Validate/canonicalize each request at that boundary. Select grants by a
   collision-free tuple: generation/key, or broker/canonical URL/full name.
   Scope every entry to the current runtime generation. Do not derive one grant
   identity from the other or reconstruct private SDK namespace algorithms.
3. Bound the whole population to 32 retained grants and eight outstanding SDK
   callbacks, including calls waiting for acquisition. Bound aggregate encoded
   pending request payloads to 1 MiB; request fields retain the stricter existing
   wire limits. Admission precedes native effects. Keep failed identities until
   shutdown rather than evicting and silently retrying the same acquisition.
4. A dynamic grant child owns one acquisition. Duplicate requests join its
   pending acquisition; they remain separately identified operations. Acquire
   exactly one private data/control port pair from the Window native boundary.
   Its reply must correlate runtime, grant and acquisition identities and contain
   exactly the declared distinct transferred ports. Close rejected transfers.
5. After acquisition, invoke `createBrokerHostChannel()` with the captured
   input. Dispatch admitted `brokerHostCall` commands to that child. The parent
   consumes typed settlement reports and never inspects private child context.
   Accepting an OPEN result transfers that port to the SDK, not to a UI view.
6. Retain the acquisition's original outcome through cancellation or deadline.
   A late grant is closed through its genuine control receipt; it cannot resume
   a canceled SDK request. An overdue acquisition is not proof that Window did
   not allocate a grant, and is not permission to replay it.

## Shutdown order and failure

Application drain and native-grant admission are different boundaries. Application
shutdown first refuses new Finance work and drains financial resources. Keep the
native grant population available to already-issued SDK acquisition and SDK
shutdown. Do not prematurely refuse the callbacks those operations need.

After the actual SDK close receipt, close native admission, retain and settle
all issued callbacks, then request closure of every acquired grant. A grant's
close receipt cannot stand in for the SDK close receipt. Close the account store
only after SDK release; W08 later joins the full financial resource tree.

| Population state | Ownership and allowed work                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepting        | Admit bounded SDK callbacks and join/acquire exact grants; includes SDK cleanup while application work is already draining.                         |
| Faulted          | Refuse new native effects after a grant/transport failure, report the fault to the session owner and retain issued effects/resources for cleanup.   |
| Draining         | Enter after SDK closure; refuse new callbacks, await original issued work and late acquisition outcomes.                                            |
| Closing          | Ask each retained channel for close and await its exact original receipt.                                                                           |
| Closed           | All required acquisitions are settled and every acquired grant has an accepted close receipt.                                                       |
| Blocked/overdue  | Report incomplete closure honestly and retain observation of outstanding original receipts. Never manufacture success from a timeout or child stop. |

Rechecked the installed alpha.60 native-runtime implementation for F4a:
`readWorkerGeneration` catches generation-read errors and returns zero, and
`advanceWorkerGeneration` can return `failedGeneration + 1` after a failed write.
A failed generation read or write must therefore fault native admission at its
owner as well as reject that promise. A subsequent SDK `open` cannot bypass the
failure by creating another grant. Both fallbacks require actual SDK acceptance
cases; neither authorizes a new SDK patch or copied namespace algorithm.

Window performs bounded wire validation, exact native grant construction and
synchronous disposal. Routing, duplicate acquisition, policy, failure selection,
admission, deadlines and resource-tree shutdown belong to worker charts.
Descriptors, live ports and raw errors never enter the render protocol.

## Review and qualification boundary

Static implementation checks pass against `ea460e9d` with retained W05 changes:
Local First library types (zero errors/warnings), Finance app/service-worker and
proof types, Clipper coordinator/web/service-worker/extension types, and existing
public-consumer declaration types. Both libraries package with strict publint;
peer links, changed-source Oxfmt/Oxlint, workspace guidance and `git diff --check`
pass. The Finance production worker proof builds with the refactored public
module. An explicit factory return type keeps the generated broker declaration
at 85 lines instead of expanding the entire generic machine into that module.
Logs are `/private/tmp/finance-worker-w05-f3-*.log`.

These pre-review results are static/package checks. Subsequent approved
behavioral results follow below. No Jazz patch, lockfile, dependency or production
startup change is introduced.

Approved behavioral results against `ea460e9d` with retained W05 work:

- Local First passes all 1,160 tests in 56 files. Focused broker/owned-channel/
  close/channel coverage passes 77 cases, including 16 new owned-channel cases.
  Real parent invocation, effect-free factories, invalid identities/payloads,
  captured caller inputs/deadlines, actual close output, late transferred-port
  disposal, throwing observers, data/control failure and forced parent stop
  are covered. No new production fix was needed.
- The actual-tarball runner now qualifies three consumers: close transport,
  existing root broker and owned-child broker. All pass public types with
  declaration checking and exact optional properties enabled, native MessagePort
  operations/close receipts and self-contained production ES-module worker builds.
- Finance passes all 2,006 unit tests in 145 files, including 12 real-build proof
  cases. Its production-built native fixture passes all 12 cases across
  Chromium/Firefox/WebKit: separate grants are exercised under both root and
  child ownership, alongside retained concurrent/cold IndexedDB coverage.
  The fixture parent is disposable test code, not Finance's SDK/session owner.
- Clipper passes 869 unit/native tests in 134 files, 17 component cases in four
  files, all 32 worker/browser cases and all 12 packaged-extension cases through
  its existing root facade. All eight production offline cases also pass against
  two fresh builds, including full stopped-endpoint browser restarts, retained
  local edits, restore/reconnect and one Wasm asset per build.

The first Finance native run passed 11/12 cases but timed out in the unchanged
Firefox cold-account-store restart case. Its synthetic build/profile are retained
at `.svelte-kit/finance-binding-native-aoNSWL`; the orphaned fixture Firefox process
was identified by that exact profile path and terminated. A focused diagnostic
passed with the same timeout/assertions, followed by all 12 cases passing.
Startup progress is now retained on failure. This does not establish the original
timeout's cause or a production-code fix.

The first extension run passed 11/12 cases but failed the offline toolbar's
20-second bar assertion immediately after the test authority was stopped.
The original error context is retained under
`/private/tmp/finance-worker-w05-f3-extension-failure/`. The unchanged focused
scenario passed after inspection. Its existing sanitized machine projection is
now printed on a failed toolbar assertion; no timeout or assertion was weakened.
The subsequent complete extension run passes all 12 cases. No production fix
or established failure cause is claimed. The separate production offline suite
passes all eight cases on its first run.

Reproducible qualification commands (run from the named project with the
workspace's Node 24.22.2/pnpm 10.28.0):

| Project     | Commands                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local First | `pnpm test:unit --run`; focused `vitest run` on broker, owned-broker, close and channel files; `node fixtures/package-consumer/worker-host-close-packed.mjs` |
| Finance     | `pnpm test:unit --run`; `pnpm test:worker-bindings`                                                                                                          |
| Clipper     | `pnpm test:unit`; `pnpm test:worker`; `pnpm test:extension`; `pnpm test:offline`                                                                             |

The initial packaged-extension command built the production test extension;
the final full Playwright extension run reused that same build. Existing CI
commands include the third packed consumer and all 12 native Finance cases.
Types, changed-source format/lint and all 13 workspace tooling tests pass.
Detailed logs remain `/private/tmp/finance-worker-w05-f3-*.log`; initial failed
attempts and successful final runs have separate files. The two failure records
above do not qualify a general flake cause or repair. Prior F2/R2 counts remain
historical rather than being silently relabeled as F3 results.

The larger population/private-acquisition implementation remains its own bounded
review cycle after F3 qualification. W06 must then prove the actual SDK's identity,
replica/offline reuse, multiple tabs, failure handling and complete resource
release. Current production startup remains on its existing single Window SDK.
