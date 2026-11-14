# W05: Finance storage and native broker bindings

The user approved Finance-first sequencing on 2026-11-13. Clipper consumes the
qualified shared broker/close transport; its remaining account-store and hidden
capture-runtime conversion is a separate follow-up. It does not gate W05/W06.
No temporary main-thread exception or migration work is added.

The worktree is refreshed to main `ea460e9d` (Clipper layout PR #21), with W05
changes preserved. Its frozen install and peer-link checks are repeated. Earlier
R1/R2 behavioral results retain their `1b6287d6` baseline. After the refresh,
Clipper types, 869 unit tests, 17 component tests, 32 worker cases, 12 packaged
extension cases and eight production offline cases pass again. That repeats the
approved transport qualification against the incoming layout/shared UI; it does
not run the new Finance slice's implementation tests.
The shared library also passes full types, all 1,144 unit tests, actual-tarball
close/broker consumer checks and format/lint again on this refreshed baseline.

## First bounded Finance slice (F1 historical implementation)

1. [account-store.ts](../../src/lib/runtime/worker/account-store.ts) derives one stable app-owned IndexedDB
   binding and constructs the already-qualified Local First store. Inputs are
   the absolute server endpoint, the selected SDK application scope and optional
   environment. Resolve the registry through public `accountRegistryUrl`; keep
   the current Finance SDK environment default `dev` and preserve an explicitly
   empty environment. Store the opaque SDK selection string under the exact
   canonical registry/environment pair in `delightful-finances-account-selection`.
   There is no localStorage access, legacy-key derivation or selection parsing.
2. [broker-host.ts](../../src/lib/runtime/worker/broker-host.ts) validates an explicit native capability
   binding: fresh host scope, exact resolved script URL and SDK-selected base
   name. Delegate transport to Local First. Admit only the exact canonical URL,
   that base plus a safe generation suffix, and its exact generation-storage key.
   Preserve canonical native opens, raw generation reads and no unknown-write
   replay. Capture validated strings so mutating the caller's object cannot
   retarget an admitted capability.
3. Extend the inactive W02 import proof to retain the real Finance store factory,
   shared broker client and Window adapter. Require the additional library
   implementations in its emitted graph. Importing this catalog invokes none
   of these factories and opens no actor, session, port or storage connection.

These are native/configuration boundaries. Pure schema/URL/admission helpers
select no asynchronous workflow. Local First's existing IDB owner/chart owns
open, bounded calls, native receipts and close; its channel chart owns broker
requests, transfer custody and independent host close. No additional statechart,
SDK registry, retry owner or aggregate promise cleanup is introduced here.

The eventual worker application/session owner retains these capabilities across
acquisition and all issued SDK calls. It must drain financial/application work,
settle retained SDK acquisition, close the actual SDK, then close the account
store and broker through their original receipts. The factories do not aggregate
those steps or claim SDK closure from a store/host receipt. W06 qualifies SDK
ownership; W08 joins the complete financial resource tree.

## SDK binding boundary and activation

Current Finance layout configuration selects the legacy explicit scope for a
configured external endpoint, otherwise the resolved same-origin endpoint; it
does not supply an environment, so the SDK uses `dev`. The new store requires
that selected scope explicitly and uses the public registry resolver. The
existing layout/session path is unchanged in this slice.

The installed SDK chooses its broker base name from the physical database and
asset scope. Its resolver is internal to the package, so this slice neither
deep-imports it nor copies that private naming algorithm. The Window adapter
requires the exact selected binding as input. W06 must establish the controlled
SDK-to-host binding during acquisition and test it against the actual SDK; a
synthetic name or same-origin wildcard does not satisfy that gate.

The normal Finance app remains on its current single Window SDK owner. W02's
separate proof bundle keeps these factories buildable without activating another
SDK or a partial worker shell. Do not delete the superseded inactive Finance
storage/legacy transport until the replacement has its own qualification. No
legacy account records are read or deleted, including when IDB is empty or fails.

## Review and verification boundary

Show this concrete slice before adding or running its implementation tests under
the repository's review gate. Static app/worker/proof types, formatting and
production import builds can validate the implementation first. After approval,
cover registry/environment separation, exact URL/name/key refusal before effects,
caller-mutation isolation, independent close and native workers. Actual SDK
identity reuse, durable replicas, cold reopen and the real selected broker scope
remain W06 acceptance, not claims from an inactive import proof.

## Static implementation evidence

Against main `ea460e9d`, `pnpm build:libraries` passes strict publint and refreshes
the injected UI/Local First packages. `check:worker-proof`, `build:worker-proof`,
`finance:check` and `finance:build` pass; application types report zero errors and
warnings. Changed Finance Prettier and Local First Oxfmt checks, workspace
guidance/peer links and `git diff --check` pass.

The proof contains nine public entries and the retained Window binding. Its
application-worker report contains 585 resolved modules, 352 rendered modules
and 14 chunks. The shared store facade, owner, native handler and broker client
all contribute rendered code. The proof emits one 8,800,443-byte Wasm binary.
Static inspection of the normal client output finds neither the proof marker,
the new database namespace nor the broker-binding error text. No factory is
invoked by that inspection.

Logs are under `/private/tmp/finance-worker-w05-finance-bindings-*.log`. These
results are compilation/packaging evidence, not native behavior or SDK ownership
qualification. The user subsequently approved the concrete slice's tests.

## Approved behavioral qualification

- The full Finance unit suite passes: 145 files / 1,984 tests. Focused host
  coverage passes 69 cases, including 33 new account-binding/broker cases.
  Registry canonicalization, current/default/empty/opaque environments, scope
  and endpoint separation, invalid configuration, exact URL/name/generation-key
  refusal, mutation of caller configuration and native close are covered.
- The import proof adds three negative guard cases: omitted store implementation,
  omitted shared broker and omitted Window adapter. All 11 real-build proof
  cases pass as part of the unit suite; no SDK session is opened by the proof.
- Nine production-built native cases pass: three each in Chromium, Firefox and
  WebKit. Actual workers share canonical store bindings, perform 12 concurrent
  updates without losing data, isolate four alternative bindings and reject
  post-close calls. Three launches of each persistent browser profile retain
  a saved value and an offline edit across two complete process restarts.
- Broker cases use an actual DedicatedWorker and echo SharedWorker with the
  Finance Window adapter. Foreign capabilities cause zero native opens/reads/
  writes; raw generation values and exact close identity survive transport,
  and the accepted SDK-side port remains usable after host closure.

The native fixture serves only its built code from a disposable static origin.
Each cold browser boot loads the document/modules before offline mode; every
store construction/read/update runs offline. There is no app/auth/Jazz backend.
This qualifies native binding persistence, not PWA asset delivery, Jazz replicas
or real SDK broker names. The echo worker is not the Jazz broker.

`pnpm --filter delightful-finances test:worker-bindings` checks fixture types,
builds actual module workers and runs all three engines. The existing production
preview PWA CI job now runs this reproducible command before its browser suite.
The fixture owns its random listener, temporary profiles and generated output;
it touches no user server or storage. A first fixture type check caught a
combined read/close discriminant that failed narrowing; splitting its variants
fixed the fixture before any native case ran. No production fix or weakened
assertion was needed. Both the first native run and the new command pass.

Final application/service-worker, host, proof and fixture type checks pass, as
do the proof build, same-origin production application build and all 19 existing
production PWA/provider-worker cases. The normal client output contains none of
the inactive fixture's markers. Workspace guidance and all 13 monorepo tooling
tests pass. The final native command passes all nine cases and leaves no fixture
directories after success. On failure, CI retains the generated fixture build
and synthetic browser profiles alongside the existing PWA artifacts for three
days; those profiles contain no user data.

An automatic approval review timed out before the final fixture-check process
started. The tool permitted one retry; the narrower native command passed.
This was an approval-system timeout, not a native or application test failure.

The selected SDK-to-host binding solution is recorded in
[worker-sdk-binding-decision.md](worker-sdk-binding-decision.md). The user chose
separate exact grants using the existing SDK callbacks, with no new Jazz patch.
After the user's 2026-11-14 test approval, F2's separate replacement passes
2,006 unit tests, 90 focused host cases and nine native cases across three
engines. Both real exports are required by the inactive proof; its 12 cases pass.
The fixtures use separate grants and the old combined adapter is removed.
F1's earlier counts and proof graph above remain historical evidence. F2 is not
connected to an SDK/session owner; normal startup is unchanged. The decision
record retains qualification details and the next worker-owned grant design.
