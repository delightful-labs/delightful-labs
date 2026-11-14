# Worker-owned Jazz grant lifecycle

Current slice: F3 exposes the shared broker channel for ordinary child ownership.
The user approved its implementation tests on 2026-11-14; qualification results
are recorded below.
F1/F2's earlier results remain qualified historical checkpoints, not test results
for this refactoring. W05/W06 and production activation remain incomplete.

The checkpoint is uploaded in
[PR #35](https://github.com/delightful-labs/delightful-labs/pull/35). Its branch
now includes main `d279e7ef` (runtime-client direction and Clipper Svelte/lifecycle
updates). Results below retain their actual `ea460e9d` source baseline; draft
status distinguishes this saved checkpoint from refreshed integration acceptance.

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

The SDK catches some generation-read failures and may fall back to generation
zero. A failed generation grant must therefore fault native admission at its
owner as well as reject that promise. A subsequent SDK `open` cannot bypass the
failure by creating another grant. This requires an actual SDK acceptance case.

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
