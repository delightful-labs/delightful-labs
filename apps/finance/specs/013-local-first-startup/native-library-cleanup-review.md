# Native-library cleanup specification

Status: C01–C08 complete, including explicit retained-owner dispositions for C06
and C08. C09–C10 remain open. Complete
focused deletion batches before redesigning shared runtime contracts. The user requested
this specification and an agent handoff on November 19. This does not authorize
an unreviewed rewrite, dependency patch or production release.

Reviewed November 19, 2026, against latest `main`, `b69e6ad6` (merged PR46).
Scope: Finance, Clipper web/extension, Local First and UI. This is a source-backed
structural review and proposed backlog, not an exhaustive correctness audit or
approval to implement every refactor. No runtime code, dependencies, catalogs or
storage identities changed during this review. No tests were run for these notes.

Both production web deployments serve the merged worker integration and Jazz
`2.0.0-alpha.67`. All hosted qualification passed on final source `0aac2c92`.
The older generic Accounts heading belonged to the isolated preview. Normal
SvelteKit pages now supply their headings and document titles; no outstanding
visual bug was confirmed by that old note.

## Existing guidance to use

- [Finance workflow memory](../../.specify/memory/xstate.md): pure transition
  calculations, native handles outside frozen context, one owner, public reports,
  native form behavior and graceful shutdown.
- [Finance v6 migration specification](xstate-v6-migration.md) and
  [implementation record](xstate-v6-finance-implementation.md): installed API
  contracts and migration evidence, with older checkpoints kept as history.
- [Effect-boundary review](xstate-v6-effect-boundaries.md): allocation and tracing
  belong in owned effects; preparation, cancellation and release need one owner.
  Its bank allocation examples are already corrected: `logged-operation.ts`
  allocates IDs/times in async actors, and `operation.ts` allocates operation
  facts in `startWork`. Do not reopen those historical findings without evidence.
- [Original orchestration map](../008-actor-orchestration/architecture.md):
  responsibility and resource lifetimes, not a mandate to restore its old roots.
- [Shared state/resource guide](../../../../docs/engineering/state-machines.md)
  and [dependency guidance](../../../../docs/engineering/dependencies.md): common
  authority for both apps and libraries. App memories retain domain rules.
- [Clipper workflow memory](../../../clipper/docs/memory/xstate.md),
  [Local First design review](../../../../packages/local-first/specs/003-verified-backup/xstate-v6-design-review.md)
  and [UI design review](../../../../packages/ui/docs/xstate-v6-design-review.md)
  qualify their respective boundaries.

The `xstate-v6-worker-host`, `legacy-host`, `host-drain` and account-store review
files also exist, but describe removed prototypes. They are not current work
orders. Read installed `xstate@6.0.0-beta.1` and `@xstate/svelte@6.0.0-beta.0`
documentation/source for authoring; a mechanical v5 conversion is insufficient.
The installed Svelte `useSelector` supplies a readable store without owning the
actor. `useActorRef` starts an actor and stops it on component destruction; it
must not replace a root's outstanding resource-drain protocol.

## Required outcomes

1. Reduce drift and the number of version-sensitive integration points across
   Finance, Clipper, Local First and UI by sharing common behavior, resource
   lifecycles and adapters. Prefer existing public implementations and package
   boundaries. Total line count is a cost to report, not the sole adoption gate:
   a shared implementation can be worthwhile even with some consumer glue if it
   eliminates independently maintained behavior. Do not create another generic
   wrapper, supervisor or RPC framework to obtain reuse.
2. Keep domain decisions, eligibility, issued operations and cleanup visible in
   the owning XState charts. Preserve native Svelte rendering/store behavior and
   Jazz session, query, transaction, authorization and synchronization ownership.
3. Preserve deployed behavior, local identities/data, offline use, permissions,
   exact financial values, provider consent and resource settlement. This cleanup
   does not reopen the completed worker migration.
4. Make subsequent SDK upgrades smaller by concentrating necessary lifecycle and
   build adaptation, using representative native acceptance checks and recording
   upstream limitations instead of implementing speculative compatibility code.

## Task status and acceptance

C01–C08 are complete. C06 and C08 include reviewed retained-owner decisions
below. C09–C10 remain open pending their acceptance evidence. The source evidence and constraints for each
task follow this checklist. Update this status and its evidence after each slice;
do not mark an item complete merely because code moved to a smaller file.

- [x] **C01:** Remove confirmed unused migration event aliases and their now-unused
      imports; existing source/test type checks pass without assertions or wider types.
- [x] **C02:** Fixtures use the real Finance composition; obsolete fallback UI and
      fixture-only public controls are removed while native worker coverage remains.
- [x] **C03:** Both apps and shared fixtures consume one SDK asset-resolution
      boundary; consumer SDK identity, production assets and WebKit behavior remain valid.
- [x] **C04:** Clipper and Finance reuse the native session integration; linked,
      restored, expired, signed-out and offline identities retain their behavior/data.
- [x] **C05:** The identified child-dependent policy decisions consume explicit
      reports; host rendering no longer enumerates private child actor trees.
- [x] **C06:** Reviewed feature owners remove repeated coordination, expose public
      reports/close results, and preserve draft, interruption and settlement semantics.
- [x] **C07:** Each receiving path decodes once; repeated view reset/subscription
      bookkeeping is reduced with no stale data or lost immediate pending feedback.
- [x] **C08:** Where native Svelte/XState bindings reduce code, adopt them without
      changing DOM resource ownership, error handling or graceful shutdown.
- [ ] **C09:** Record the before/after ownership decision for finite worker reuse.
      Share common lifecycle behavior to reduce app drift; report code costs and
      document any justified boundary-specific exceptions.
- [ ] **C10:** Production-bound fixtures use the actual adapter; identical builds
      are reused only across matching configurations with separate authorities and full coverage.

Each completed implementation slice must list changed ownership/API surfaces,
removed duplication, checks actually run and any unresolved limitation. Use the
existing tests appropriate to the change; add coverage only for a real gap.

## Current implementation evidence — November 19, 2026

- Git: preserved the three uncommitted handoff documents on
  `docs/native-library-cleanup-review`; fresh `git fetch origin main` confirmed
  HEAD and origin/main both `b69e6ad6`. No reset, merge, commit or deployment.
- C01: rescanned TypeScript identifiers/declarations before editing. Removed 65
  unused NativeEvent aliases from 58 Finance files and one unused XState
  OutputFrom type import. Retained used aliases and all runtime event contracts.
  No runtime ownership/API change, assertions, widened types or replacement helper.
- C01 verification: Node 24.22.2 / pnpm 10.28.0; Finance svelte-check (zero
  errors/warnings), service-worker tsc and tests/tsconfig tsc all passed.
  `pnpm monorepo:check-links` passed. Initial diagnostics came from stale
  pre-alpha.67 dependencies/Local First build output; restored the frozen lockfile,
  packaged current Local First with svelte-package directly and refreshed injected
  copies. No catalogs were regenerated. All generated output stayed in this
  isolated checkout; running user/other-agent checkouts were untouched.
- C02: user selected real production route components with fixture routing rather
  than moving native-worker scenarios into the SvelteKit harness. WorkerAccounts
  now requires route content and retains only shell/navigation/notice composition.
  Removed its alternative accounts/login/ledger/form markup, ten obsolete props,
  and the now-unreferenced WorkerLogin component. Root layout drops those props.
  Removed public client selectWorkspace/selectTransaction/selectTransactionKind
  and their private selectContext/reset helper; machine SELECT_CONTEXT and route
  handling remain intact. Native session, identity, storage, permissions, provider
  and financial drain ownership are unchanged. This removes 269 net production
  source lines across four files, adding no production abstraction.
- C02 fixture: a 63-line Svelte composition mounts actual account, login,
  workspace/classification and transaction pages/layout/components under the same
  WorkerAccounts and Finance context. A 15-line fixture-only page observation
  supplies the standalone Vite build's `$app/state`; history/anchor/navigation
  callbacks always call production observeRoute. Removed followRoutes and the
  fixture's alternate context-selection mode. Seed/fault/held-operation controls
  remain confined to the fixture worker. Scenarios use production account dialogs,
  separate recovery/login pages and post-save list navigation, native automatic
  single-workspace selection and action-relative navigation counters.
- C02 verification: Finance svelte-check reports zero errors/warnings; test tsc
  passes, including after the final restore assertion change. The existing
  `vitest.worker-application.config.ts` suite retains all 22 scenarios per browser.
  Full Chromium/Firefox/WebKit run: 63 passed, with three failures from the same
  obsolete restore counter expectation. After correcting only that test's local
  navigation baseline, focused restore rerun: 3 passed / 63 intentionally skipped.
  Thus all 66 cases passed across the full run plus focused correction; no passing
  source suite was repeated for that test-only correction. Coverage includes real
  archive and navigation drains, malformed views, detach/remount, exact money/check
  edits, retained drafts, recovery/refusal, identity restoration from another
  profile, classification history and full process restarts with app/auth/Jazz
  endpoints unreachable. Native build also retains Window/worker graph assertions
  and one broker asset assertion. Initial sandbox listener denial was resolved
  through sandbox escalation; it was not an application failure.
- Verification commands were invoked directly through `pnpm exec` to avoid
  lifecycle scripts regenerating Paraglide catalogs: `svelte-kit sync`,
  `svelte-check --tsconfig ./tsconfig.json` (FINANCE_PREVIEW=true),
  `tsc --project src/service-worker/tsconfig.json --noEmit`,
  `tsc --project tests/tsconfig.json --noEmit`, and
  `vitest run --config vitest.worker-application.config.ts --reporter=verbose`.
  Final focused native rerun used
  `--testNamePattern='restores existing finance from another'`.
  `git diff --check` passes. No production build/deploy, dependency version change,
  catalog generation or user-data operation was performed. Generated artifacts
  and disposable browser profiles/authorities stayed in this isolated checkout.

- C01/C02 and the original handoff documents were committed as `c505acea`
  after the user requested “Commit and continue”; that instruction approved the
  concrete C03 proposal from the prior turn. No push, merge or deployment.
- C03: added `resolveJazzWorkerAssets(consumerUrl)` to the existing Node-only
  Local First `backend/jazz/worker-build` export. It returns three asset paths;
  resolution starts at the consuming module's installed SDK and follows that
  SDK's WASM dependency. Finance, Clipper web/extension, Local First fixtures and
  Finance's restore experiment consume it. Deleted Clipper's path-only tooling
  module and Finance's obsolete WASM re-export. A fresh source search finds the
  broker production path and WASM binary filename only in this build boundary.
  App aliases, environment prefixes, cache policy, asset names and WebKit's
  `codeSplitting: false` are unchanged. No browser lifecycle or shared session
  API changed. Documented Node-only usage in Local First's worker-broker guide.
- C03 verification: Node 24.22.2/pnpm 10.28.0; Local First svelte-check (zero
  diagnostics), library tsc and changed-file Oxlint passed. Packaged with
  svelte-package directly, refreshed injected packages using frozen installation
  without lifecycle scripts; monorepo package-link checks passed. The existing
  packed transport consumer passed public types/native receipts/self-contained
  workers plus the extended build-export checks for matching SDK/WASM versions,
  SDK-relative broker identity and existence of all three assets.
- C03 production builds: Finance full SSR/client/prerender build and Clipper web
  SSR/client/Netlify output passed; Clipper extension build passed. Each has
  exactly one broker worker and one WASM binary (same ZC330TX3 content hash).
  Finance used Vite's native createBuilder/buildApp API with its existing
  configuration and only the Paraglide compiler hook omitted, using existing
  generated catalogs. Its initial build-API call built only the client and was
  not counted as the full production check. Adapter-auto's local-target notice
  and existing extension chunk-size warning remain; no hosted deployment was run.
- C03 native checks: Finance WebKit detach/continued observation, held-archive
  drain and cold offline process-restart scenarios all passed (3/3; 63 deliberately
  unselected). Clipper's actual production-worker WebKit startup passed (1/1),
  using one matching offline-a production build and disposable authority/profile.
  Local First's changed fixture asset config passed both native archive-export
  cases (2/2). Finance tests tsc, Clipper web svelte-check, extension svelte-check
  and extension tsc passed; both Svelte checks report zero diagnostics.
  Full C01/C02 suites were not repeated for this build-only change.
- C03 checks used direct tool commands to avoid code/catalog generation. Outputs,
  caches, parser bundles, packed temporary consumer and authorities remained in
  this isolated checkout or disposable OS temporary directories. No storage keys,
  dependencies, patches, credentials, user servers or user data changed.

- C04: the user approved the refined design after C03. Clipper now constructs
  the existing `createJazzSessionRuntime` at its web/extension worker boundaries
  and offscreen host. Its application chart consumes the public connection and
  one native binding generation. Removed the startup registry, duplicated native
  status/readiness/restoration adapters, three token maps, explicit SDK thin-client
  preparation and unused registry-based capture/record helpers. Domain library
  construction remains a scoped lease, allocated after native local readiness and
  released after issued work drains. Existing `createLibraryBinding` and domain
  capabilities remain Clipper-owned. Net production deletion: 847 lines across
  ten files; no shared runtime API, dependency or patch change was needed.
- C04 identity changes use the existing `createSessionChangeMachine`, restoration
  workflow and ordered sign-out input accepting `SessionRuntimeChangeInput`.
  Provider settlement, native post-provider observation and captured binding
  admission remain in order; replaced/local identities are not signed out again.
  Web `initial: 'device'`, extension existing-account admission, provider consent,
  current account-store keys/backends and cache namespace inputs are preserved.
  Old shared adapters remain published because package-consumer/native fixtures
  still use those public contracts; the parser leaf remains in use too.
- C04 shutdown: the application drains domain work but does not close the SDK.
  The worker host also waits for actual reader-surface cleanup, checks detached
  transaction custody, then invokes the existing `sessionCloseMachine`, which
  retains pending acquisition and native close through overdue feedback. Only its
  real closed result permits account-store then broker closure. Forced stop,
  failed domain output and retained custody never authorize clean realm closure.
  The offscreen host likewise requires clean domain output and shared session
  close before reload. Native handles stay inside the shared adapter's closures.
- C04 verification: Clipper web svelte-check, extension svelte-check and extension
  tsc pass (zero Svelte errors/warnings). Changed-file Oxlint and formatting pass;
  `git diff --check` passes. Direct production web/extension builds and the matched
  packaged extension test build pass. Updated only development optimizer entries
  from retired adapters to the current public runtime exports. Jazz schema
  generation performed by existing isolated browser dev scripts produced no
  tracked source changes; no Paraglide catalogs were generated or edited.
- C04 workflow checks: 52 focused cases passed, including generated host
  acquisition/shutdown campaigns, held root and article writes, A → B → C
  replacement, provider/session overdue effects, stale admission and custody
  refusal. The broader Clipper suite then passed **1,007 tests in 155 files**.
  Review subsequently restored the original terminal `closed`/`ownerFailed` view
  labels; 43 affected workflow/host cases passed after that narrow correction,
  including explicit terminal-view assertions. Old adapter-only fake tests were
  replaced with native-runtime resource leaves; shared session lifecycle,
  ordered-sign-out and restoration suites passed **115 cases**. Existing package
  consumer types, session consumer and ordered-sign-out consumer also passed.
- C04 native checks: all **32 worker browser cases** passed, including actual
  A → B → A restoration with an attached reader, forced stop, immediate shutdown
  during acquisition, real late surface receipts, malformed/expired proof recovery
  and child-resource recovery. All **22 account browser cases** passed, including
  first-use without signup/authority, invalid restoration, permission/proof refusal,
  full offline browser restart, resumed capture and restored-profile sync.
- C04 production native checks: **8/8 selected cases** passed across the existing
  offline/auth suites: linked, existing and expired backend identities each survive
  two full offline process restarts and reconnect; native startup passes Chromium,
  Firefox and WebKit; abrupt worker-stop/offline recovery and annotation restart/
  reconciliation pass. Those production tests used one immutable matching offline-a
  build; unchanged shell-update cases were not rerun. The final terminal-label
  correction was followed by a fresh production build and targeted workflow checks.
- C04 packaged Chromium extension: **12/12 cases** passed on the final matched
  extension artifact, including signed-out and stale-account refusal, restoration
  into the existing library, offline restart/capture, reference retention, repeated
  settings teardown and real toolbar admission. Finance's shared-integration
  WebKit restore, archive-drain and cold offline restart checks passed **3/3**;
  unrelated Finance suites were not repeated. All endpoints, profiles, storage and
  generated output were disposable and isolated from user/other-agent servers.
  Existing large-bundle warnings, isolated schema-location notices and rejected
  late UI/controller event diagnostics remain; none caused a failing check.

Remaining: C08–C10. C06 classification and C07 are complete; retained feature
owners and verification evidence are recorded below. No publishing, push, merge, storage migration or dependency
change is part of this work. The Finance standalone routing fixture intentionally
does not qualify SvelteKit's router itself; its existing browser suites retain
that acceptance boundary.

## Proposed fixes

### C01 — Delete unused XState migration type scaffolding

**Confirmed, low risk.** An AST scan found 65 unused `NativeEvent…` type aliases
in 58 non-test/non-fixture Finance source files, totaling 674 declaration lines.
Examples: [provider-request.ts](../../src/lib/machines/bank-sync/provider-request.ts),
[image-editor.ts](../../src/lib/machines/images/image-editor.ts) and
[internal-transfer.ts](../../src/lib/machines/transfers/internal-transfer.ts).
These aliases name native completion/error event unions but have no references;
the actual machines already infer events through `setup({ schemas })`.

Delete the aliases and imports used only by them. Keep used event declarations
and real actor contracts. This removes unnecessary contact with numerous XState
exports without adding a replacement helper. Verify source/test types after the
complete deletion batch; it needs no new behavior tests or generated tooling.

### C02 — Remove the alternative Finance UI and test-only client controls

**Confirmed.** [WorkerAccounts.svelte](../../src/lib/components/worker/WorkerAccounts.svelte)
contains a substantial `else` UI for callers without `pageContent`. The normal
[root layout](../../src/routes/+layout.svelte) supplies route content; the other
caller is [the worker application fixture](../../tests/worker-application/client.ts).
The old generic Accounts heading is in that fallback.

The public client methods `selectWorkspace`, `selectTransaction` and
`selectTransactionKind` are called by that fixture, while production uses route
observation and native navigation. Rework affected fixtures to exercise the
production composition, then remove unused fallback markup and public controls.
Do not mechanically remove the machine's internal `SELECT_CONTEXT` event: route
handling still uses it. Preserve focused native worker tests and their independent
admission/drain assertions; removing an alternate UI is not removing that coverage.

### C03 — Give SDK build-asset knowledge one owner

**Confirmed, foundational.** Finance's [jazz-wasm.ts](../../tooling/jazz-wasm.ts),
Clipper's [jazz-wasm.ts](../../../clipper/apps/web/tooling/jazz-wasm.ts) and Local
First's [fixture asset configuration](../../../../packages/local-first/fixtures/test-app/jazz-vite.ts)
repeat SDK-relative WASM/package resolution. Both apps separately know the private
`dist/worker/jazz-broker-worker.js` path. Local First already owns
[worker-build.ts](../../../../packages/local-first/src/lib/backend/jazz/worker-build.ts).

Prefer a supported SDK asset export if this pinned version provides the required
contract. Otherwise put only resolution in one Node/build-only Local First
boundary, resolving from the consumer's installed SDK. Keep app asset filenames,
public environment prefixes and caching policy in their apps. Do not create a
large Vite plugin or import Node helpers into browser code. Preserve native Vite
resolution, one SDK/WASM identity and the qualified WebKit no-split setting.
Check both production bundles and the packed consumer after implementation.

### C04 — Reuse the native session integration in both apps

**Confirmed, highest-value runtime foundation.** Finance uses Local First's
[createJazzSessionRuntime](../../../../packages/local-first/src/lib/backend/jazz/session-runtime.ts).
Clipper's [account.ts](../../../clipper/apps/web/src/lib/backend/jazz/account.ts)
still independently binds startup, readiness, recovery and restoration, maps SDK
statuses, compares user/client/db identity, and creates binding tokens. Its host
also implements an acquisition/close path around the older startup owner.

Adapt Clipper's domain capabilities and provider actions to the existing native
session runtime/connection contract, extending that boundary narrowly only for a
demonstrated missing requirement. Native Jazz continues to own session state,
retry, account selection and client replacement. XState owns application admission,
financial/library drain and consumption of native observations. Retire old shared
adapters only after finding all public consumers; no universal SDK facade.

Preserve no-signup first use, deliberate sign-out, linked/existing/expired backend
identities, extension sign-in admission, recovery and offline restart. Keep each
app's existing storage key/backend: this is not a localStorage-to-IndexedDB
migration and must not strand Clipper's existing identities. Qualify the complete
session change once across both apps and Local First consumers.

### C05 — Replace private-child decisions and actor-tree subscriptions with reports

**Confirmed at review; completed in C05 below.** Clipper's [annotation machine](../../../clipper/apps/web/src/lib/annotations/machine.ts)
reads `children.recovery.getSnapshot()` while deciding preview eligibility;
[annotation recovery](../../../clipper/apps/web/src/lib/annotations/recovery.ts)
reads a draft child's pending state inside an `always` decision.
[host-observation.ts](../../../clipper/apps/web/src/lib/runtime/worker/host-observation.ts)
maintains a subscription map by enumerating the library's children and the
recovery owner's phrase child. These couple parents and rendering to private
actor topology.

Have each child expose the minimal typed readiness/pending/render report through
native invocation snapshots or explicit reports. Parents consume those facts in
their own transitions; subscribe only at the public boundary. Remove child-tree
scanning after all consumers use those reports. A selector projecting a documented
public view is not automatically a violation, and checking an owned child's
liveness before sending a secret is not the policy reconstruction being removed.
Preserve publication eligibility, draft recovery, image updates and shutdown.
Finish the shared session work before rewriting its host-observation plumbing.

### C06 — Reduce Finance's repeated feature coordination

**Completed with the classification owner and retained-owner dispositions below.**
[worker-forms.ts](../../src/lib/machines/runtime/worker-forms.ts) is 2,052 lines
and owns forms, bank sync/history, integrity, samples, attachments, transfers,
backup, restore and navigation. It repeats snapshot admission/projection for
name/avatar/workspace/category/tag forms, then enumerates their shutdown commands,
closed reports and parallel waiting regions. Its parent
[worker-application.ts](../../src/lib/machines/runtime/worker-application.ts)
adds another 1,990 lines of composition. Size alone is not a defect; repeated
ownership knowledge is the finding.

Review feature lifetimes first. Keep ordinary forms on the existing Local First
scoped-form machine. Group independently meaningful feature ownership under
native invoked charts so the application consumes one public feature report and
one real close result. Keep bank, restore and transfer settlement semantics in
their existing resource owners. Review route-owned versus workspace-owned forms
before changing draft lifetime. Do not merely move code into files, introduce a
generic supervisor, or hide destinations in dynamic machine factories. Simplify
the ownership contract before changing all its view consumers.

### C07 — Remove repeated view-state bookkeeping and duplicate decoding

**Confirmed at review; completed in C07 below.** Finance's [client.ts](../../src/lib/runtime/worker/client.ts)
lists nearly the same large nullable feature view in startup, failure, closed and
context-selection paths. Both `receiveView` and `receiveControl` parse every
reply with the same Zod union. Clipper's
[client.ts](../../../clipper/apps/web/src/lib/runtime/worker/client.ts) implements
its own observer Set, current-value replay and lazy subscription cleanup for a
Svelte-compatible library store.

Give each app one explicit empty/withdrawn view constructor and decode a message
once at its receiving boundary. Use Svelte's existing `readable`/`writable` store
subscription lifecycle for Clipper's render projection; preserve immediate
pending feedback and scope correlation. Share no Finance/Clipper domain DTO.
Keep runtime validation at trust boundaries and projection that strips SDK row
methods; do not remove internal parsing wholesale merely because types exist.
Do this after C02 and the affected C06 report contracts settle, to avoid editing
the same fields repeatedly. Preserve no stale data after failure or replacement.

### C08 — Use native Svelte actor subscriptions where they remove boilerplate

**Evaluated; selective adoption and retained bindings recorded below.** Local First's
[form controller](../../../../packages/local-first/src/lib/integrations/forms/controller.svelte.ts)
and [avatar selection binding](../../../../packages/local-first/src/lib/integrations/profile/avatar-selection.svelte.ts),
plus UI's [SwipeActions](../../../../packages/ui/src/lib/Components/SwipeActions.svelte),
manually bridge actor snapshots into Svelte state. Evaluate native `useSelector`
for read-only actor selection and store auto-subscription for render stores.

Retain explicit owners for starts, error handling, DOM listeners and graceful
shutdown. Do not replace financial roots with `useActorRef`'s immediate stop, add
a new generic actor hook, or convert every native Svelte effect into an actor.
UI pointer/focus/animation machines belong with the UI; simple details/dialog/
popover state already uses native elements and is not a new worker task. Keep
the shared component APIs and existing interaction/accessibility coverage.

### C09 — Reuse finite worker jobs only where it deletes meaningful duplication

**Confirmed overlap, selective extraction.** Clipper's existing
[browser-worker-job.ts](../../../clipper/apps/web/src/lib/machines/browser-worker-job.ts)
is used by image processing and extension extraction. Finance's
[provider transport](../../src/lib/integrations/simplefin-worker.ts) and
[image render leaf](../../src/lib/runtime/worker/image-render.ts) separately own
worker creation, message/error/abort handling and termination. This is the prior
R4 reuse candidate, not a newly discovered need for a transport framework.

Evaluate moving the existing finite-job primitive to Local First and adopting it
where the native resource lifetimes match. Reducing behavioral variants and app
drift is the primary benefit; total code size is a secondary cost, not a veto. Preserve Finance's provider
deadline, trace sanitization, consent and secret handling in Finance. Use the shared native job directly from an existing caller chart where possible;
do not preserve a duplicate worker lifecycle merely because its local leaf is
shorter. Keep only domain request/reply mapping in the app. Do not mix finite CPU/HTTP jobs with persistent Jazz/application
workers or use `terminate()` as a financial drain receipt. Clipper domain code
shared with its extension remains Clipper-owned, not Local First policy.

### C10 — Make qualification reuse the real boundary and matching build artifacts

**Confirmed maintenance cost; preserve isolation.** Clipper's
[browser account-store fixture](../../../clipper/apps/web/tests/browser-account-store.ts)
and worker fixture use the older unscoped store from `runtime/worker/account-store.ts`,
whereas production `serve-application.ts` uses `createScopedWorkerAccountStore`.
Where a test claims production behavior, use the actual adapter; retain genuinely
independent historical-store/upgrade tests. Remove obsolete fixture-only production
helpers after their remaining callers move.

Finance's [browser base config](../../tests/config/base.ts) builds the same E2E
configuration separately for application shards, authentication, permissions and
workspace jobs. After verifying their environment/fixture inputs match, build one
immutable artifact per commit/configuration and run separate preview servers and
disposable authorities in each job. Keep different feature-flag builds distinct.
Clipper's [browser runner](../../../clipper/tooling/test-browser.mjs) restarts its
server per spec deliberately because native backend ownership follows an authority;
do not replace that with one mutable global backend just to save startup time.

Batch source changes before relevant verification, fix collected failures, and
repeat passing suites only for a new change or unresolved concern. Keep native
offline restart, permission, real worker and package-consumer checks. Record SDK
limitations and patch removal criteria in the existing upgrade plan; don't add
speculative compatibility code or a new release-gating framework. Mark old
checkpoints historical and keep one current status entry rather than copying
another full backlog into the resource-decision document.

## Order and review boundaries

1. **Quick deletion batch:** C01, then C02. No dependency upgrade or storage move.
2. **Shared integration foundation:** C03, then C04. This is the first substantial
   runtime work I recommend; it prevents later cleanup from adopting two session
   contracts. C01/C02 do not block its design.
3. **Qualification infrastructure:** prepare C10's matching-fixture/build work
   once C02/C03 define the actual entry points. Keep it independent of runtime
   redesign and retain the existing suite coverage.
4. **Ownership cleanup:** C05 before changing Clipper's host observer; C06 before
   changing Finance's feature-view composition; C07 follows the affected reports.
   These are focused app slices, not one cross-app rewrite.
5. **Independent smaller reuse:** C08 can proceed per component. C09 proceeds
   only if the before/after example demonstrates less code and fewer lifecycles.

Approve a concrete ownership/API design before each runtime slice. Reuse public
native APIs first. Introduce no SDK patch, dependency, storage migration, generic
RPC bus or actor wrapper merely to complete this list. Remove an existing SDK
patch responsibility only after its exact supported upstream replacement is
verified in the current native/offline cases. Preserve serializable/local/global
durability distinctions, native row snapshots, stale-scope rejection, provider
consent and secrets, unresolved write custody, and real drain receipts.

The list is a maintenance backlog. It does not withdraw the worker integration's
passing qualification or establish a new production defect. Completion requires
evidence of deleted duplication and retained behavior, not just smaller files.

## Agent handoff

The documentation is on local branch `docs/native-library-cleanup-review` in
`/Users/matt/Projects/delightful-labs-finance-worker-inventory`. At the original handoff, the
specification and two linked status/note corrections were uncommitted. They were
preserved in `c505acea` with C01/C02; C03 is `302a5e18` and C04 is `8418c175`.
Preserve these commits and other agents' changes; inspect Git state before switching branches.
The baseline `main` was fetched for this review; check for newer commits before
implementation without resetting or overwriting local work.

Read the root and applicable app/library AGENTS.md files and the guidance above.
Begin with C01, then C02 as its own focused slice. Before C03/C04 or another
ownership/API redesign, show the smallest concrete proposal and discuss actual
uncertainty with the user. Use native APIs first and do not ask permission again
for a slice the user has already explicitly authorized.

Keep builds, dependency installations and generated output separate from the
user's running checkout. Preserve Finance's user servers on 5173/5174 and all
unidentified listeners, browser profiles, storage and credentials. Use Node
24.22.2 and pnpm 10.28.0. Do not generate/edit Paraglide catalogs, change storage
namespaces, add dependencies/patches, merge or deploy as incidental cleanup.
Finish each source batch before running its affected checks. Stop to discuss a
material design choice; do not turn a source review into an all-at-once rewrite.
Every progress report must include what remains.

## Integration design — C03/C04 approved and implemented

C03: extend the existing Node-only `backend/jazz/worker-build` export with
`resolveJazzWorkerAssets(consumerUrl: string | URL)`, returning the broker entry,
SDK-relative WASM entry and binary paths. Resolve `jazz-tools/package.json` from
`createRequire(consumerUrl)`, then resolve jazz-wasm from that SDK. Finance,
Clipper and shared fixtures keep their own Vite aliases/configuration, environment
prefixes and asset naming; only path resolution moves. Keep `jazzWorkerOptions`
and its qualified `codeSplitting: false` behavior. The pinned SDK exports
`jazz-tools/_worker/broker`, but its source explicitly says it is a dev-server
shim, not the production bundle entry. Do not silently substitute that shim for
the qualified production worker. Verify both production bundles, native WebKit
and packed-consumer SDK identity before claiming completion.

C04: construct Clipper's session through existing `createJazzSessionRuntime`
with its existing config/store/runtimeSources. Its bind callback creates Clipper
library capabilities from `{db, identityId, identityKind, binding, isCurrent,
recovery}`. Reuse the existing session-runtime actor/connection contract for
observations and identity mutation; keep Clipper library admission/drain and
provider sign-out in their domain owners. Native session close must complete
before scoped account-store/broker close. Keep web first-use `initial: 'device'`
and extension existing-account admission distinct; preserve every current store
key/backend. Retire startup/readiness/restoration adapters only after auditing
all consumers, including extension account/sign-in workers.

Material C04 question to settle before implementation: Clipper currently exposes
separate user/client/database tokens, adoption/release, logoutStatus and registry
helpers. Determine which consumers need distinct public facts versus the shared
runtime's single binding token; preserve real library retirement and provider
sign-out ordering rather than recreating its old session facade around the new
runtime. No storage move, new supervisor, actor wrapper or generic transport is
proposed. This proposal still requires user review before runtime work.


### C04 design approved after the consumer audit (implemented)

The three Clipper tokens are compared in `sameAccountBinding`; the additional
special case is `application-readiness.preparationReplaced`, which distinguishes
pending local-first preparation from identity/client/db replacement. A blind
field rename would lose that distinction. Proposed chart change: consume the
shared runtime's one binding generation and native `localFirst` observation;
keep domain/library admission withdrawn until native local readiness, and drain
old library ownership before adopting a different generation. Remove the old
SDK preparation/readiness/adoption façade only with the corresponding chart
branches, not by copying it around the shared runtime.

Provider/session order already has a supported integration: `OrderedSignOutInput`
accepts `SessionRuntimeChangeInput`, and `createSessionChangeMachine` handles its
native reports. Retain provider settlement and the existing post-provider session
observation, then pass the captured runtime scope/binding to the shared ordered
sign-out owner. No promise bridge or new shared wrapper is required. Restoration
uses the existing session-change invocation in the same way. Keep recovery
capabilities at the native session binding; Clipper owns library drain/admission,
provider actions, navigation and extension sign-in rules. Session runtime close
must finish before scoped account storage and broker release.

The user approved this runtime ownership/API slice separately from C03. The
implementation removes pending-preparation branches and consumes the native
single-generation report contract; its checks qualify replacement during
preparation, held-write/restore/sign-out interruption, provider refusal, expired
backend identity and extension existing-account admission. Preserve the current
storage key/backend and all independent native shutdown/identity/offline tests.


## C05 reviewed design and completed implementation

1. At the existing draft invocation, consume a scoped public draft report through
   native `onSnapshot`, retaining only pending/failure facts needed by recovery.
   The recovery chart's removal guard consumes those reports; it no longer reads
   `children.drafts` during an `always` decision. Keep pending admission adjacent
   to command dispatch so a queued report cannot briefly permit premature removal.
2. At the existing recovery invocation, publish the bounded recovery report
   (readiness, pending/failed and draft note IDs/records needed by its public view).
   Annotation preview guards consume that report with document/binding-generation
   checks, instead of reading the recovery child snapshot. Preserve A → B → A
   rejection, recovery visibility and publication eligibility while writes drain.
3. Library already uses native `onSnapshot` for images, reader experience,
   annotations and search. Verify those public root notifications; add the same
   native phrase-invocation notification at `worker-recovery-owner`. Then reduce
   `bindingObservation` to subscriptions to the three named public roots (library,
   tag form, recovery owner), deleting the dynamic subscription map, child-tree
   enumeration and phrase-child subscription. Public selectors may still project
   documented views of their own owned invocation; policy stays in its owner.

The user approved this design and its implementation/testing slice. The existing
invocation snapshots now supply those bounded reports. Recovery reports carry the
document and observation generation; OPEN/CLOSE withdraw the previous report.
The fixed invocation lifetime scopes reports to the admitted library capability.
Draft reports expose the highest admitted sequence alongside pending/failure;
removal requires that sequence to cover the last dispatched RETAIN and no issued
or queued draft. Draft terminal output updates the retained facts, and unexpected
child failure withdraws readiness. No new event bus, wrapper, dependency or SDK
contact point was introduced.

The held-write regression exposed a real join race: draft completion could let
the recovery root close while removal was still queued. The idle closure branch
now requires an empty removal queue. Native terminal output is consumed directly;
closure never treats child disappearance as completed removal. C04's application,
surface, session, scoped-store and broker close protocol is retained.

Deleted: three annotation policy reads of the recovery child's snapshot, the
recovery removal guard's draft-child read, the host's dynamic subscription map,
child enumeration, phrase-child subscription and reentrant resubscription loop.
The host subscribes once to library, tag form and recovery owner. Library's four
existing native invocation notifications for images/reader/annotations/search
remain; the recovery owner now publishes phrase-invocation changes the same way.
The production slice adds 38 net lines for bounded reports, correlation and the
drain correction while deleting 22 lines from host observation. This is a reduction
in private topology and subscription machinery, not a total source-line reduction;
no additional generalized abstraction was introduced.

Verification on November 19, Node 24.22.2 / pnpm 10.28.0:

- Existing Clipper Vitest suite: **1,009 tests / 155 files passed**, including two
  added native-Jazz cases: removal waits behind two held drafts through shutdown,
  and A → B → A recovery rejects obsolete readiness before preview admission.
- After final error-report withdrawal changes, the focused annotation/draft/
  preview suite passed **28/28**. Web `svelte-check --fail-on-warnings` reported
  **0 errors / 0 warnings**; changed-file Oxlint and formatting passed.
- Native browser annotation routes passed **4/4**, including Unicode notes,
  recovered oversized input after reload, explicit recovery and immediate pending.
- Native image cases passed **4/4**, including asynchronous completion/failure,
  route replacement, full offline browser restart and restored-client sync.
- Native account cases passed **22/22**, including phrase reveal/close, invalid
  restoration, retained identity, full offline restart, resumed capture and sync.
- Native worker suite passed **32/32**, including real A → B → A restoration,
  immediate/forced shutdown, acquired custody, native search failures and actual
  late reader surface receipts through open/detach/replacement timeouts. The
  browser runs total **62/62**; all test servers were disposed afterward.

Each browser spec used its own server/authority lifetime and disposable profiles;
checks finished before server generation. No user or other-agent server/data was
touched. `git fetch origin main` confirmed no commits beyond baseline `b69e6ad6`.
The sandbox initially denied the native unit listener; the approved rerun used
its disposable test authority. Existing rejected late UI/controller notifications
and schema-location notices did not fail checks. Finance/shared-package checks,
production/extension builds and unrelated suites were not repeated for these
Clipper-only source changes.

Remaining: C06–C10. No push, merge, publishing, migration or dependency change.

## C06 reviewed classification design and completed slice

The user approved classification-only implementation and testing by directing
continued work after the concrete proposal. Category/tag create/archive share one
`ManagementObservation`, one session/workspace binding and the same route reset
policy. At review, `worker-forms.ts` repeated four snapshot admission/projection
blocks, four observation identities, four shutdown sends, four closed events and
four waiting regions for this one feature. The outer application consumes only
the forms group's public report and close result.

1. Add one concrete classification chart with four statically invoked existing
   scoped-form machines. Its native parallel regions each reach a final state
   only from that form's real completion during shutdown. Native parallel
   completion joins those results; unexpected completion/error fails the owner.
   Delete the separate closed-event/waiting-region protocol from `worker-forms`.
2. Keep the existing session/workspace lifetime and route-change RESET behavior.
   Forward the same observation and existing form commands. Issued mutations keep
   their current Local First scoped-form resource owner and shutdown drain.
   Navigation does not recreate a pending form or replay a mutation.
3. Publish one classification report correlated to the current observation,
   containing the existing four DTO views, and one finite close result. The forms
   parent forwards one observation, one route-reset command and one shutdown,
   consumes that public report and waits for that close result. Keep the current
   worker wire DTO/client validation and rendered controls.

Review the total source difference before proceeding to profile/workspace or any
bank/transfer/restore grouping. The uncertainty is whether this concrete ownership
join removes enough repeated coordination to reduce total code after adding its
chart; moving the same four blocks into another file is insufficient. If it does
not, retain the current ownership and discuss the measured result. This proposal
adds no generic group factory/supervisor or shared framework API.

Qualification for this slice: existing Finance type checks; classification create/
archive, duplicate/read-only/reference refusal, route reset and scope replacement;
held mutation interrupted by workspace/session change or shutdown; native resource
drain. Bank/provider, transfers, backup and restore remain in their existing owners
until separate source-backed designs settle their different lifetimes.


### C06 classification implementation and evidence

- `classification-forms.ts` now composes four static invocations of the existing
  Local First scoped forms. Native parallel completion joins their actual terminal
  reports after shutdown admission ends. The accepting control region rejects
  unexpected completion from the four named children; invocation errors select
  its failed state. That control state does not exit sibling resource owners or
  acknowledge clean closure. The public report projects only coherent owned views
  for the current observation and reports failure explicitly.
- `worker-forms.ts` now consumes that one report and one finite close result.
  Removed its four copied view fields/four observation identities, four individual
  invocation/projection blocks, three redundant closed-event/waiting protocols
  and individual observation/reset/shutdown forwarding. Existing classification
  commands pass directly to the feature; no extra command envelope was retained.
  The canonical `classificationForm` enum names the fixed broadcast recipients.
- Scope and lifetime stay unchanged: session/workspace-bound forms survive route
  changes, which still issue RESET. Current observation identity gates both the
  feature report and its parent consumption, including A → B → A replacement.
  Issued writes retain their existing scoped-form owner and actual settlement.
  The worker wire DTO, trust-boundary validation, financial schemas, identities,
  data, provider consent and bank/transfer/backup/restore owners are unchanged.
- Measured production difference against `df0b9b6f`: `worker-forms.ts` removes
  **178 net lines**; the concrete composition adds **164 lines** beside the existing
  classification options. Total: **14 fewer production lines / 244 fewer bytes**,
  with no additional production file, generic group factory, supervisor, dependency
  or framework/SDK adaptation. This is a modest total reduction, not a reason to
  repeat the pattern for smaller or unrelated features.

Verification on November 19, Node 24.22.2 / pnpm 10.28.0:

- **105/105 affected unit tests passed** across classification forms, management
  policy and the worker application. Nine added owner cases cover all four command
  destinations/DTOs; duplicate/read-only/reference refusal; route reset and current
  A → B → A reports; held writes through route/workspace/session interruption and
  shutdown without replay; and unexpected child completion while a sibling write
  remains owned, without reporting clean closure.
- Finance `svelte-check --tsconfig ./tsconfig.json --fail-on-warnings` with
  `FINANCE_PREVIEW=true`: **0 errors / 0 warnings**. Both
  `tsc --project tests/tsconfig.json --noEmit` and the existing service-worker type
  check passed. Changed-file Prettier and `git diff --check` passed.
- **15/15 selected native worker browser cases passed**, five scenarios in each
  of Chromium, Firefox and WebKit: create/archive classifications and retain full
  history after offline process restart; route/deny scope and drain navigation;
  refuse offline restoration after a held archive and remount; drain a real UI
  archive before SDK close; and retain failure after malformed view while waiting
  for real native closure. The existing production components/fixture route
  adapter and genuine SDK/broker remain in use. The other 51 native cases were
  deliberately unselected, rather than rerun without an affected behavior.
- Native verification built once into a unique disposable `.svelte-kit` directory,
  used an ephemeral loopback listener and separate browser profiles, then disposed
  its server/artifacts. All checks finished before browser generation. No user or
  other-agent servers/data or Paraglide files were touched. No full production,
  shared-package or Clipper checks were repeated for this Finance-only slice.
- `git fetch origin main` still showed no commits newer than `b69e6ad6`. The prior
  specification/corrections and C01–C05 commits remain preserved on this branch.

### C06 retained-owner dispositions

The classification result is retained; further grouping is intentionally skipped.
The follow-up discussion selected keeping existing owners and moving to C07's
concrete deletions. This completes C06's reviewed scope without requiring every
feature to acquire another chart.

| Feature | Decision and source-backed reason |
| --- | --- |
| Profile name/avatar | Keep the existing two shared scoped forms and their profile observation. A new two-form group has no demonstrated total-code reduction from the four-form experiment. |
| Workspace rename | Keep its single existing shared scoped form and workspace observation. It already has one resource/policy owner; another owner would add a forwarding layer. |
| Bank/history | Keep separate existing invoked reports and shutdown results. Provider consent, unlocked credentials, sync settlement and history observation are distinct lifetimes. |
| Transfers | Keep the mutation owner, submission and edit workflow contracts. Issued transfer settlement and interactive form lifetimes must remain explicit. |
| Backup/restore | Keep the current public reports and real drain rules, including restore's existing busy/drain boundary. Grouping does not establish equivalent resource lifetimes. |

These retained form/policy implementations already come from Local First; they
are not two app-owned forks. The classification change reduces Finance's parent
coordination without changing that common implementation. No generalization of
the classification chart, generic supervisor or relocated copies of these blocks
is authorized by this disposition. Future changes require
a demonstrated reduction and a concrete ownership review. These retain decisions
reuse the implementation and verification already recorded; unchanged owners were
not retested solely to document that they remain unchanged.

## C07 completed deletion batch

The receiving paths were rechecked against current source. Finance has three
full empty-view lists (startup, failure, closure), not a surviving fourth
context-selection list; its obsolete public selection controls were removed in
C02. Two worker `message` listeners each decode the same reply union. Clipper's
render client has one manual observer Set, current-value replay and first/last
actor-subscription bookkeeping.

1. Finance uses one local `emptyFinanceView` constructor, explicitly retaining
   only session/selection/transaction scope from a prior view. Failure keeps its
   existing identity/restore-feedback semantics; closure clears identity. All
   feature views are withdrawn by the same constructor.
2. Finance uses one native Worker message listener and one reply decode. After
   transport failure, valid VIEW messages are still rejected; the listener remains
   until the actual CLOSED control receipt so native resources are not released
   early. Existing navigation, WebAuthn, image-editor and backup port validation
   remains at the receiving boundary.
3. Clipper uses Svelte's installed `writable` first/last subscriber lifecycle for
   the render projection. Starting observation refreshes from the current actor
   snapshot, including commands/receipts received while no subscriber existed.
   Each subscription remains independent; `getView` stays synchronous. The native
   client chart continues owning pending receipts, detach and real worker closure.

This adds no transport wrapper or shared domain DTO. Clipper already projects its
single optional library view through `projectRuntime`; no repeated full empty
RuntimeView list was found, so no unused constructor is added there. Its existing
single typed reply dispatch has no duplicate decoder to delete. Runtime payload
projection and trust-boundary schemas are retained.

Production difference against `ae973f70`: **74 fewer lines** (Finance 61; Clipper
13). Two focused Clipper component cases cover subscription replay across an
unobserved command/receipt interval and independent duplicate callbacks. Finance's
existing malformed-view native case now starts with visible populated data and
checks withdrawal, retained receiving scope, rejected late data and final closure.

Verification on November 19, Node 24.22.2 / pnpm 10.28.0:

- Finance and Clipper web Svelte checks: **0 errors / 0 warnings**. Finance test
  and service-worker type checks passed. Changed-file Prettier/Oxfmt, Clipper
  Oxlint and `git diff --check` passed.
- Clipper focused native-client unit tests: **6/6**. Svelte render-subscription
  component tests: **8/8**, including the two added replay/independence cases.
  Existing feedback replacement, A → B → A mounts, unmount ownership and pending
  handoff checks remain passing without a custom comparator or observer registry.
- Finance native worker cases: **18/18**, six scenarios in each of Chromium,
  Firefox and WebKit: scope/navigation replacement; phrase reveal/hide/detach;
  restored identity with offline transactions; held archive drain before SDK
  closure; populated-data withdrawal after malformed view and rejected late
  views; and complete offline process restart with app/auth/Jazz unreachable.
  The remaining 48 native cases were intentionally unselected.
- Clipper native worker suite: **32/32**, including account A → B → A with an
  attached surface, native search faults, resource custody, immediate/forced
  shutdown and actual late surface receipts. Native annotation routes: **4/4**,
  including pending feedback before delivery, Unicode edits/reload and explicit
  recovery of oversized authored input. Total native browser cases: **54/54**.
- Finance used one disposable native fixture build with isolated authorities/
  browser profiles and an ephemeral listener. Clipper suites ran sequentially
  within its project with separate disposable server/profile lifetimes; Finance
  ran independently in its own generated directory. All type checks finished
  before browser generation. All test listeners were disposed afterward.
- No catalogs, generated Paraglide output, identities/storage keys, SDK patches,
  dependencies or user/other-agent servers/data changed. `main` still has no
  commits newer than `b69e6ad6`. Existing schema-location/late-event diagnostics
  did not fail any case. Unrelated broad unit suites, extension and production
  builds were not repeated for these bounded client-adapter changes.

Remaining: C08–C10; no push, merge, deployment, migration or dependency change.


## C08 native subscription evaluation and retained bindings

The installed `@xstate/svelte@6.0.0-beta.0` implementation was inspected, not
assumed equivalent to an actor owner. `useSelector` wraps a native Svelte readable
store, refreshes from `getSnapshot()` at first subscription, subscribes only to
next snapshots and releases that subscription at last unsubscription. It neither
starts/drains the actor nor replaces its error observer.

| Binding | Decision | Source-backed reason |
| --- | --- | --- |
| Clipper library render projection | Adopt native Svelte store lifecycle, completed in C07 (`ca82e8ab`). | Deletes the observer Set, explicit replay and first/last subscription bookkeeping while preserving synchronous pending feedback and the existing native client resource owner. |
| Local First form controller | Retain explicit snapshot/error observation and `stopAfterShutdown`. | Its error observer refreshes the failed snapshot. `useSelector` only observes next snapshots, so retaining that error path would require another subscription/bridge rather than delete it. Financial shutdown must still drain. |
| Local First avatar selection | Retain the current small `.svelte.ts` rune bridge and component owner. | Selection/crop cleanup still requires explicit SHUTDOWN and stop. A selector store in this helper would also need a reactive store-to-rune bridge; no reduction is demonstrated. |
| UI SwipeActions | Retain the current three-line initial-snapshot/subscribe/unsubscribe bridge. | A native readable initializer/import does not materially reduce it. Pointer capture, ResizeObserver, chosen-event observation, DOM listeners, actor start/stop and focus/animation handling all retain their current owner. |

The retained bindings themselves live in the shared UI/Local First packages;
keeping them does not introduce divergent Finance and Clipper implementations.
Neither UI nor Local First currently declares `@xstate/svelte`; adding a package
integration solely to replace these tiny bridges would increase upgrade surfaces.
No dependency was added, no new actor hook was written and `useActorRef` was not
substituted for a drain protocol. The C07 store change is the qualifying reduction
and already passed its **8/8 render component**, **6/6 client unit** and **36/36
Clipper native browser** cases. Those passing checks were not repeated for this
read-only evaluation. Other component APIs and resource lifetimes are unchanged;
no runtime files or generated/catalog output changed in C08.

C08 is complete as a selective adoption/retain decision, not a claim that every
manual snapshot binding should be replaced. Remaining: C09–C10; no push, merge,
deployment, migration or dependency change.


## C09 revised shared-worker design (not implemented)

The user clarified that reducing drift between the two apps and reusing common
behavior take priority over net line savings. The proposed line-count-based skip
is withdrawn. The objective is one finite native-worker lifecycle implementation,
with app-specific payloads, consent, diagnostics and deadlines remaining in their
owners. No new framework, supervisor or actor-to-promise bridge is proposed.

Baseline: Clipper's finite `browser-worker-job.ts` is **202 lines / 5,913 bytes**,
Finance's `simplefin-worker.ts` is **83 lines / 2,650 bytes**, and its
`image-render.ts` is **42 lines / 1,465 bytes**. These counts are a review baseline,
not a reason to keep independent behavior. Clipper already shares its chart
between web images and extension extraction; Finance currently maintains its own
construction/message/error/abort/termination paths.

### First implementation batch: shared core and both apps' image consumers

1. Promote the existing Clipper `createBrowserWorkerJob` implementation and its
   typed input/result contract into Local First, exposed through one supported
   public entry such as `delightful-local-first/worker/browser-job`. Preserve
   selected worker construction/posting, decoder failure, abort, transferred
   buffers, elapsed timing, listener release and cleanup-failure blocking. The
   default clock uses native performance time at the owned effect boundary;
   no Clipper domain import moves into Local First.
2. Point Clipper's web image job and extension extraction job at that canonical
   export and remove their private production lifecycle implementation. Keep
   domain request/reply schemas and their existing 20s/15s deadline choices in
   Clipper. Shared lifecycle qualification belongs with the canonical core;
   app-specific integration fixtures remain app-owned.
3. Finance's existing `imageEditorMachine` directly invokes that same job chart
   for preview/apply rendering. `image-render.ts` retains only the request/worker
   URL and ImageData reply mapping, rather than another worker lifecycle. Do not
   hide the job behind the old promise API. CANCEL/SHUTDOWN must request native
   cancellation and wait for the job's release result before bitmap/canvas or
   parent completion. Preserve pending apply, preview replacement, failures and
   blocked cleanup; stopping an invocation is not a successful drain report.
4. Qualify the public package export and consumer XState identity, the canonical
   generated/unit lifecycle campaigns, both apps' image behavior, actual native
   cancellation/cleanup, Clipper extension extraction and Finance held-render
   interruption. Build/package without catalog generation; keep all output and
   profiles isolated from user servers/data.

### Provider integration: same lifecycle, separately reviewed caller change

Finance's provider transport is also intended to consume the shared lifecycle.
Its current `fetchAccounts` promise contract is called by the existing bank
operation's `fetchProvider` actor. Starting a job actor inside that promise would
be the prohibited child-actor promise bridge, so the invocation boundary must
move into an owned chart instead.

Review a concrete provider-fetch chart invoked by the existing operation's
`fetching` state. Keep its existing authorization before the request and after
its response. Finance continues owning demo-vs-real selection, URL validation,
the 75-second bootstrap/body deadline, cancellation-vs-timeout outcome, sanitized
provider stage/count traces and transient credentials. Its chart invokes the
same shared worker job and waits for native release before reporting completion
or interruption. Native worker-error prevention and invalid reply handling must
retain their present behavior. No secret may enter diagnostics or survive its
selected operation lifetime as part of this integration.

Settle that caller/drain contract before modifying provider code. Additional
consumer mapping is acceptable when it removes independently maintained worker
behavior. Local First's existing channel-oriented `createWorkerRequest` remains
separate: its identity/unknown-effect protocol and channel resource owner are not
these finite jobs. Persistent Jazz/application workers and financial write custody
also retain their existing real close protocols.

C09 remains open pending the shared implementation and verification, followed by
provider caller integration. C10 remains open. C01–C08 are complete; retained
shared bindings may be revisited if an actual cross-app fork is found.

## C10 concrete work sequence (not implemented)

Source recheck found the old unscoped store in two fixtures plus independent
historical tests. Production and the custody fixture already use the scoped
adapter. Keep this as two reviewed source batches:

1. **Actual adapter and fixture lifetime.** In the dedicated host driver/worker,
   use the existing scoped storage data/control channels and
   `createScopedWorkerAccountStore`, exactly as production `serve-application`
   does. Await SDK/session close, scoped store close and native storage/broker
   close before CLOSED; keep failure distinct from a clean receipt. The Window
   `browserAccountStore` helper must also use the existing scope host/store at
   its fixture boundary. Its caller `fixture-records.ts` owns a long-lived SDK
   seed replica, so establish an explicit normal-close owner there before changing
   it; do not invent an awaited beforeunload drain. Intentional abrupt-process
   cases must remain abrupt and must not report success from disposal. Preserve
   independent old-store Web Lock/extension-storage tests; remove or relocate a
   production helper only after its non-historical callers are gone.
2. **One matching Finance E2E artifact.** The general app shards and auth/
   permissions/workspace projects inherit `tests/config/base.ts` and its
   `FINANCE_PREVIEW=true`, `PUBLIC_DEBUG=true`, `vite.e2e.config.ts` build. Build
   that exact configuration once per commit in CI and have those jobs download
   the immutable artifact and run preview-only, with separate disposable
   authorities/profiles. Preserve the default local build-and-preview command.
   Do not reuse the check job's `ci-build` artifact: it is a different config.
   Exclude presentation (dev server), startup (different flags/authority URL),
   fake-data/debug/PWA flag builds and any other nonmatching configuration.
   Keep all existing browser selections/shards; no test coverage is removed.

Review the Window seed-replica lifetime as the material uncertainty in the first
batch. For build reuse, verify actual compiled environment inputs before
collapsing jobs. Clipper's per-spec authority/server restart remains intentional;
reuse an immutable build only across truly matching inputs, never a mutable
backend. Keep generated output separate from user servers/data and introduce no
new generic fixture/RPC/cache framework. Remaining: C09 shared implementation/provider integration and C10;
C01–C08 are complete.
