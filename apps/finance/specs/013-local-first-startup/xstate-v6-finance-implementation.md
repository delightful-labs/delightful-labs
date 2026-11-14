# Finance v6 conversion and worker migration

## Current W03 checkpoint: IndexedDB selected

The user selected an IndexedDB-backed AccountStore on 2026-11-13. The
[revised design](worker-native-custody-design.md) assigns atomic storage and
native transaction receipts to Local First in the application worker. The
previously proposed permanent Window account-storage/lock service is superseded.
The SDK's custom AccountStore is supported by the installed API and existing
session configuration; no new session registry or SDK patch is proposed.

The user then explicitly removed all migration/old-version compatibility code
from scope: no import, localStorage fallback, dual writes, source cleanup,
migration markers or old-tab/reload/rollback coordination. W03 is complete under
that instruction. A missing IDB record follows ordinary SDK first-use behavior.

## Current W04 checkpoint: shared IndexedDB store qualified

The user reviewed the concrete store and explicitly approved adding/running its
native/browser tests. The [verification record](worker-account-store-verification.md)
records all 1,111 Local First unit tests (53 files), 60 native cases (20 each in
Chromium/Firefox/WebKit), the packed public consumer/types/build, full type checks
and packaging/lint/format results. One retained regression exposed corrupt stored
undefined being mistaken for absence; an exact-key cursor read fixes it.
The native suite is part of library verify and the existing Local First CI job.

W04 is complete as the shared-store/packed-consumer foundation. W05 owns actual
Finance/Clipper adoption and remaining broker/close extraction; W06 qualifies
the connected persistent SDK/runtime. Those tasks remain unstarted. No migration
code or production startup hookup was added. The source base remains `670fb720`;
existing user storage/servers are unchanged. The user authorized a foundation
PR, with the branch rebased onto refreshed `main` `02f886be` before publication.

## Current W02 checkpoint: inactive bundle proof complete

2026-11-13, isolated branch based on `main` `670fb720`: the user approved the
build-only approach, reviewed the concrete implementation, then explicitly
approved adding/running its focused regressions. See the
[implementation and qualification record](worker-bundle-design.md).
Dedicated worker types/proof build, application/service-worker types, test types
and the normal production build pass. The main proof graph contains 486
resolved / 310 rendered modules, 14 chunks and the emitted Wasm chain, with
required implementations retained and no resolved Svelte integration. Normal
client output excludes the probe.

All 35 focused unit tests pass, including eight real-build guard scenarios.
All 19 production browser cases pass: the existing 16 PWA/offline/Wasm scenarios
and three native tests of the actual emitted ES-module provider worker (valid
response, malformed JSON and HTTP failure). Browser discovery assigns the new
file only to the production runtime. W03's current storage decision is recorded above. The
Window SDK/domain owner remains active; this proves bundling and existing worker
compatibility, not persistent application-worker operation or cutover.

## Current monorepo checkpoint: W01

2026-11-13, `main` at `670fb720`: W01's
[ownership/route inventory](worker-ownership-inventory.md) and
[reproducible baseline](worker-baseline.md) are complete. Fresh checks passed:
frozen install and workspace links; application/service-worker types with zero
errors/warnings; browser-test types; production builds; 142 unit files / 1,940
tests; 16 production PWA cases; and the existing plain-archive fixture that
exports, independently opens and restores 521 transactions. Its measured
export/open was 1,088ms, restore 1,549ms, longest observed Window task 74ms.
These are one desktop/dev fixture sample, not production performance targets.
The baseline records a corrected initial browser setup failure and existing dev
diagnostic warnings; it does not claim warning-free runtime or full feature/
cross-browser qualification. Application/library/test implementation is unchanged.

The [W01–W21 backlog](worker-migration-tasks.md) owns current completion state.
W02's inactive production import proof is complete; W03's selected IndexedDB
design and explicit no-migration instruction are recorded above. The Window SDK/domain owner remains active; no
application-worker activation, shared extraction, deployment or production
storage change has been performed by W01.

## Historical conversion checkpoint

The source/archive and authorization statements below retain their original
session scope; they are not blanket approval for the current worker backlog.

Status: connected-graph conversion qualified by unit/type checks; application
worker handoff remains in progress. No production deployment is included.

The user authorized completing Finance implementation and tests together while
away, then applying the Clipper findings to the other maintained repositories.
That supersedes the earlier per-batch implementation/test review pauses.

## Converted graph

Finance uses unpatched XState 6.0.0-beta.1 and Svelte binding 6.0.0-beta.0.
The official 0.1.0-beta.1 codemod was followed by manual contract, generic
input/output, resource, parallel-region, invocation and error-handling fixes.
Production machines, their test graphs and browser restoration probes use native
schemas, function transitions, queued effects and logic factories. SDK and
transaction handles retain their owning actors and graceful drain protocols.

The qualified DLF artifact incorporates source commit
`dbc452eda6d874e67f24ec971be0a689dca8ef68`, preserving Finance's existing alpha.60
native adapter delta. DUI uses `7a7f61b236220bb5edb2bef4390b9db075775e43`'s v6
artifact; exact lineage is recorded in `vendor/xstate-v6-provenance.json`.
Superseded archives are removed. Jazz retains its reviewed alpha.60 worker patch;
XState has no patch or declaration override.

Native qualification exposed issues a codemod cannot resolve: replayed mutable
drain bookkeeping, lifecycle handlers consuming unrelated invocation errors,
failed children removed before lease retirement, and invocation input reading
values only assigned by entry. DLF's initial/retried form watcher and workspace
initializer were fixed at their shared source. Finance's integrity and transaction
inputs now bind the admitted facts directly. Test fakes preserve native handle
opacity, and child-crash tests exercise actual actor failure rather than forge
kernel notifications. Stale domain reports remain covered.

Inspection consumes native v6 events and projects bounded, sanitized actor
topology for the hosted viewer. It does not transmit live context, SDK handles,
credentials, finance rows or raw error payloads. Initialization failures are also
observed through actor creation when no transition exists.

## Validation

- Finance unit suite: 140 files, 1,909 tests passed on Node 24.22.2.
- Application check: 2,082 files, zero errors and warnings. Local checks read
  existing generated localization artifacts whose catalogs match this checkout;
  catalogs, localization configuration and generated content were not changed.
- Playwright/probe TypeScript, service-worker TypeScript and isolated worker-state
  TypeScript checks pass.
- Native host tests: 36 passed, included in the full unit suite.
- Isolated worker-state tests: 17 passed, including the published `@xstate/test`
  100-run custody campaign (seed 60401). This is generated coverage, not exhaustive
  native interleaving proof.
- DLF's composed form, readiness and startup regression suites: 22 passed, with
  library TypeScript and declaration packaging checked separately.

## Remaining worker work

The calculation-purity follow-up moved bank clock/identifier allocation into
owned leaves and backup request preparation behind opaque one-use submissions.
Late preparation drains through cancellation, replacement and shutdown; raw
passwords remain outside actor snapshots. The latest pre-merge full unit run
passed 1,916 tests.

PR #65's production recovery fixes are now incorporated from merged main,
including the fresh-proof Jazz patch, automatic workspace selection and usable
partial bank discovery. Their v6 regression suites pass 57 tests, including the
real native proof checks. Two browser flows verify automatic multi-workspace
sign-in and mixed-result discovery after the merge.

CI exposed a live-array ownership error: readiness passed a Jazz subscription's
workspace array into immutable actor context, freezing the SDK's mutable delta
target in development. The integration now supplies `observeRows` copies.
All 55 workspace browser tests pass, including admin/member/viewer rename and
switch-back cases, older archives, and password/plain export and restoration of
521 transactions. Application types report zero errors/warnings. These checks
used a disposable server; no production deployment or localization generation
was involved.

The bounded storage/broker bridge, correlated independent host drain, account
operation charts and bounded AccountStore owner/facade are foundations. They are
not activated in the application. The SDK, domain machines and subscriptions
still belong to Window in this conversion checkpoint.

Before activation, qualify worker termination against queued Window storage
writes and native Web Lock release. Worker-held locks may disappear before a
queued Window write; graceful actor drain alone does not prove crash safety.
Resolve that custody boundary, then implement the worker-owned session/domain
tree and validated UI commands/projections without a duplicate Window SDK owner.
Window retains navigation, WebAuthn, files and canvas capabilities.

Qualify the actual handoff, shutdown, replacement, account switching, offline
writes, cold restart, multiple tabs and host failure in browsers. Preserve explicit
provider consent and uncertain-write custody. The passing conversion checks do
not complete or certify this remaining worker migration.
