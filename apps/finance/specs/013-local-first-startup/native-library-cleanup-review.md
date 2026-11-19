# Native-library cleanup specification

Status: C01 and C02 complete; C03/C04 proposed for design review. Complete
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

1. Reduce repeated code and the number of version-sensitive integration points
   across Finance, Clipper, Local First and UI. Prefer deletion, existing public
   APIs and existing package boundaries before creating another abstraction.
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

C01 and C02 are complete; C03–C10 remain open. The source evidence and constraints for each
task follow this checklist. Update this status and its evidence after each slice;
do not mark an item complete merely because code moved to a smaller file.

- [x] **C01:** Remove confirmed unused migration event aliases and their now-unused
      imports; existing source/test type checks pass without assertions or wider types.
- [x] **C02:** Fixtures use the real Finance composition; obsolete fallback UI and
      fixture-only public controls are removed while native worker coverage remains.
- [ ] **C03:** Both apps and shared fixtures consume one SDK asset-resolution
      boundary; consumer SDK identity, production assets and WebKit behavior remain valid.
- [ ] **C04:** Clipper and Finance reuse the native session integration; linked,
      restored, expired, signed-out and offline identities retain their behavior/data.
- [ ] **C05:** The identified child-dependent policy decisions consume explicit
      reports; host rendering no longer enumerates private child actor trees.
- [ ] **C06:** Reviewed feature owners remove repeated coordination, expose public
      reports/close results, and preserve draft, interruption and settlement semantics.
- [ ] **C07:** Each receiving path decodes once; repeated view reset/subscription
      bookkeeping is reduced with no stale data or lost immediate pending feedback.
- [ ] **C08:** Where native Svelte/XState bindings reduce code, adopt them without
      changing DOM resource ownership, error handling or graceful shutdown.
- [ ] **C09:** Record a before/after decision for finite worker reuse. Adopt shared
      code only where it reduces total code/lifecycle variants; document justified skips.
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

Remaining: review the concrete C03/C04 proposal below before implementation;
C03–C10 remain open. No shared integration runtime change has begun. The native
fixture's routing adapter intentionally does not qualify SvelteKit's router itself;
existing SvelteKit browser suites remain its acceptance boundary.

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

**Confirmed.** Clipper's [annotation machine](../../../clipper/apps/web/src/lib/annotations/machine.ts)
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

**Confirmed duplication; grouping design needs review.**
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

**Confirmed.** Finance's [client.ts](../../src/lib/runtime/worker/client.ts)
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

**Confirmed opportunity, lower priority.** Local First's
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
where total code and lifecycle variants shrink. Preserve Finance's provider
deadline, trace sanitization, consent and secret handling in Finance. A small
native image leaf may remain simpler than an actor adapter; do not force it onto
the abstraction. Do not mix finite CPU/HTTP jobs with persistent Jazz/application
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
`/Users/matt/Projects/delightful-labs-finance-worker-inventory`. At handoff, the
specification and two linked status/note corrections are uncommitted. Preserve
them and other agents' changes; inspect Git state before switching branches.
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

## Concrete next-slice proposal — C03/C04 (not implemented)

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
