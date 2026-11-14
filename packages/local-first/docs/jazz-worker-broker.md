# Jazz worker broker extraction

W05/R2 moves Clipper's existing broker/generation transport to the public
`backend/jazz/worker-broker` integration. R1's `worker/host-close` provides its
independent native close control. The existing `worker/channel/workflow` still
owns request admission, eight-call bounds, FIFO sequence, deadlines, unknown
outcomes, late transferred-port custody and host-close correlation. No new
channel machine, application host or SDK session is introduced.

The Window boundary owns the data/control ports and native error listeners for
opened SharedWorkers. An `OPEN` transfers exactly one native broker port; the
SDK then owns that accepted port. Failed/unaccepted transfers are closed. Host
closure detaches its listeners and closes its data port; it does not close a
port already transferred into SDK custody. A data error leaves independent close
control observable. The worker facade never retries unknown opens or generation
writes and exposes the original host-close promise separately from forced stop.

The native host receives two mandatory pure admission capabilities:
`admitOpen(url, name)` and `admitGeneration(key)`. Apply them to bounded decoded
requests before native opens/reads/writes. Wire schemas, SDK-prefixed names,
generation representation checks and native port validation stay private to the
library, avoiding the Zod minor-version coupling found during R1.

Clipper's app adapter supplies its current same-origin URL admission and Jazz
generation-key prefix. Finance's separate adapters admit one exact resolved
URL/full worker name or one exact generation key, refusing the other operation
kind. The existing SDK callbacks provide these values; no new SDK patch or
private naming algorithm is required. Native grants are qualified; actual
Finance SDK/session integration remains pending.
There is no permissive default and no change to either app's selected identity
or broker namespace. The SDK retains generation selection and parsing of raw
stored values; generation storage stays in the required Window primitive and
is independent of the new IndexedDB AccountStore.

The shared code lives inside Local First's Jazz integration boundary because it
implements `RuntimeSourcesConfig.browserWorkerHost`; it imports no app schema,
domain or UI. Clipper keeps a small adapter with its app admission policy and
delegates its worker facade to the shared implementation. Existing native
broker fixtures continue through that same adapter. Replaced broker mechanics
are removed from Clipper.

The library's ES2022 declaration target requires an ordinary Promise for the
retained close receipt instead of Clipper's `Promise.withResolvers`; this is a
construction detail, not a new settlement/timeout policy. The existing forced
disposer still cannot prove native host closure.

R1 was reviewed and qualified before this next slice. R2 implementation must be
shown before its implementation tests are added or run. Qualification must cover
packed public imports and real Window/worker/SharedWorker ports, policy refusal
before effects, FIFO/overload, malformed/orphaned transfers, native errors and
late receipts after data failure. Finance adoption remains a later bounded
slice, including its exact admission regressions. No account-storage import,
fallback, migration, cleanup or new storage bridge is part of this extraction.

## Implementation and qualification

### Qualified F3: child-owned broker channels

The same public subpath now exposes `createBrokerHostChannel`,
`brokerHostChannelInput` and `brokerHostCall`, plus structural operation/reply/
result/call/input types. This lets a worker grant owner invoke the existing
channel as a child instead of starting a root from inside acquisition I/O.
The factories start no actor or listener; identity is supplied explicitly and
captured before native use. Protocol decoding and transfer custody remain here.

The root `brokerHostClient` keeps its existing API and delegates construction/
call preparation to those primitives. The shared channel statechart and native
host policy are unchanged. Consumer-owned shutdown must wait for the child's
actual close output; parent stop is not a receipt.

The concrete [Finance grant-owner design](../../../apps/finance/specs/013-local-first-startup/worker-grant-owner-design.md)
records the next population/session composition and qualification scope. This
After the user's 2026-11-14 test approval, F3 passes 1,160 library tests including
16 new owned-channel cases, all 77 focused broker/close/channel cases and three
actual-tarball consumers with strict declaration checking, native ports and
production module-worker builds. Finance passes 2,006 unit tests and 12 native
cases across three engines. Clipper passes 869 unit/native tests, 17 component
cases, 32 worker cases, 12 packaged-extension cases and eight production offline
cases. The linked design retains the two initial browser failures and successful
focused/full reruns; no production repair is claimed. The R2/F2 counts below
describe earlier qualified code. No Jazz patch is added, and actual Finance
grant-population/SDK ownership remains pending.

### Historical R2 extraction and qualification

The concrete slice moves broker mechanics to `backend/jazz/worker-broker.ts`,
keeps shared Zod wire schemas in the private `worker/host-close-protocol.ts`,
and replaces Clipper's broker implementation with its app admission adapter.
The native close public API is unchanged. Clipper's `open` wrapper retains the
original native receiver as well as the URL/name and raw generation values.

`pnpm build:libraries` passes strict publint. Full Local First application/test
types and Clipper coordinator/web/service-worker/extension types pass with zero
errors/warnings. Library format/lint, changed Clipper format/lint, workspace
guidance/peer-link checks and `git diff --check` pass. Logs remain in
`/private/tmp/finance-worker-w05-r2-*.log`. These are static/package results only;
The user subsequently authorized R2 tests by asking to continue. The reviewed
mechanics tests now live with the library implementation; Clipper retains its
app admission/integration cases. Three new library cases verify exact URL/name
admission and refusal of valid-prefix foreign generation reads/writes before
native effects.

PR #29 is now merged at main `1b6287d6`. The integration branch was fast-forwarded
to that merge without changing its tree or the pending W05 implementation. This
merge notification did not supply test approval; the subsequent explicit
continuation authorized the R2 qualification recorded here.

Approved results against main `1b6287d6`:

- All 1,144 Local First tests in 55 files pass. Focused broker/close/channel
  coverage passes 61 cases, including 24 broker cases.
- Clipper passes 869 unit/native tests in 134 files and 14 component tests in
  three files. Its focused runtime subset passes 70 cases in 14 files.
- All 32 actual worker/browser cases and all 12 packaged-extension cases pass,
  including accepted SDK port ownership, late transfer disposal, independent
  close after data failure, cold worker startup and repeated settings teardown.
- All eight production offline cases pass against two fresh production builds.
  These include linked/existing/expired identities across two full offline
  browser-process restarts, retained local edits and reconnect, cold reader
  startup with both servers stopped and HTTP cache cleared, update/failure
  cache behavior and one emitted Wasm binary per build. This repeats Clipper's
  existing-storage qualification through the shared broker, not IDB adoption.
- Actual-tarball public consumers pass strict types, native MessagePort effects
  and receipts, and self-contained production ES-module worker builds for both
  close and broker exports. This reproducible check runs in `check:consumer`/CI.
- Web and extension production builds, full library/test/consumer and app types,
  library formatting/lint, changed Clipper formatting/lint, workspace links and
  guidance pass. Existing large-chunk advisories remain.

This qualifies the shared broker with Clipper's current SDK and unchanged
account storage. It is not adoption of the IndexedDB AccountStore by either app,
nor qualification of Finance's exact broker binding. Those remain W05 work.

Next-step source review found that extension `runtime.ts` still owns its SDK and
capture actors in the hidden Window page. Its reload capability stops the app
attachment and reloads the document; the retained startup registry is a separate
host owner. Switching this path to IDB would retain the hidden-page SDK rather
than complete a worker-only runtime. The user approved Finance-first sequencing:
Clipper's remaining account-store and hidden capture-runtime conversion is
deferred as a separate follow-up. No temporary hidden-page exception,
account-storage binding or extra shutdown framework was introduced. Finance
W05/W06 do not depend on that Clipper work.

After refreshing to main `ea460e9d` (Clipper layout/shared UI changes), frozen
installation, peer links and fresh library packaging pass. Repeated Clipper
types, all 869 unit tests, 17 component tests in four files, 32 worker cases,
12 packaged-extension cases and eight production offline cases pass. The
component count reflects the incoming AccountDrawer coverage. Logs for this
refresh are `/private/tmp/finance-worker-w05-ea460e9d-*.log`; the original counts
above retain their original baseline.

The refreshed baseline also passes full library/test types, all 1,144 library
tests in 55 files, both actual-tarball close/broker consumers, library format/lint
and workspace guidance checks. These repeated tests exercise the approved
shared transport and contain no new Finance binding implementation tests.
