# Finance worker migration: foundation-first tasks

Status: recorded migration backlog after code research on `main` at `eb0f615f`
(2026-11-13), incorporated by [spec.md](spec.md#application-worker-migration-handoff).
W01 inventory/baseline and W02's inactive build proof are complete against
`670fb720`. W02's approved qualification passed type/build checks, 35 focused
unit tests and 19 production browser cases. The user selected a worker-accessible
IndexedDB AccountStore in Local First on 2026-11-13. W03's storage choice is
resolved; the user explicitly excluded all migration/old-version compatibility
code. W03 and W04's shared-store foundation are complete. W04 qualification
passed 1,111 unit tests and 60 native cases across Chromium/Firefox/WebKit.
W01–W04 are merged in [PR #29](https://github.com/delightful-labs/delightful-labs/pull/29)
at main `1b6287d6`. The W05 branch is fast-forwarded to that merge with its local
implementation preserved; the merge tree is identical to the qualified PR head.
It was subsequently refreshed to main `ea460e9d` (Clipper layout/UI changes),
with a frozen install and peer-link check. Earlier qualification counts retain
their `1b6287d6` baseline. Clipper qualification has also passed against the
refresh: 869 unit tests, 17 component cases, 32 worker cases, 12 packaged
extension cases and eight production offline cases. See the transport evidence
for commands and separate baselines.
Hosted foundation, Clipper and Finance qualification all passed on that PR.
Finance's first application-2 run failed the existing image-editor filename
assertion (`undefined` instead of `receipt.png`). The original three image-editor
cases passed locally unchanged, and one retry of the failed CI job passed.
This records a transient failure; it does not establish its cause or a code fix.
W05's R1/R2 extractions and Finance F1/F2 binding slices passed approved
qualification. Actual SDK/native-capability integration and app storage adoption
remain pending. The [SDK binding decision](worker-sdk-binding-decision.md) selects
separate exact grants through existing callbacks, with no new Jazz patch.
W06–W21 implementation remains unstarted.
Detailed implementation designs remain subject to their review gates.
This is a planning artifact, not an activation or production release. Read the
[research and source evidence](worker-migration-research.md), existing
[ownership specification](xstate-v6-migration.md), and
[PR #67 dispositions](../../../../specs/002-monorepo-agent-guidance/finance-worker-pr67-review.md).
Existing implementation-review gates apply when implementation begins.

The [Local First/Clipper reuse review](worker-foundation-reuse.md) owns the
extraction details: reuse the library's existing workflows directly; move native
close, broker, applicable receipt custody and disposable-worker mechanisms
from Clipper into Local First before Finance adopts them. Add the missing
IndexedDB AccountStore there; retire the permanent Window account-storage bridge. Update Clipper to the
same shared implementation, preserving app-specific policy and namespaces.

## Instructions for the next agent

1. Read workspace/Finance and affected Local First/Clipper guidance, then the
   spec handoff, source research and reuse specification. Work in the maintained
   monorepo, not the former source repositories.
2. Verify current remote default-branch `main` and record the actual baseline.
   This research started at `eb0f615f` in the separate
   `research/finance-worker-foundations` worktree; refresh code findings if the
   baseline changes. Preserve unrelated work and user servers/storage.
3. Start with the first incomplete task whose dependencies are met. Read the
   [W01 inventory](worker-ownership-inventory.md) and [baseline](worker-baseline.md)
   before W02/W03 design. R1–R4 are extraction work within the
   W-series, not another copy of the backlog or already available library APIs.
4. Model and review the selected ownership/state/API change, implement a bounded
   slice, then perform checks under the applicable review authorization. Existing
   approvals recorded for old startup/import sessions are not blanket approvals
   for this work. Keep deployment/commit/merge gates explicit.
5. Mark tasks complete only with actual acceptance evidence: source revision,
   affected package/app, commands/results, browser/native scenarios and limitations.
   Update this checklist and the implementation checkpoint together. Shared
   extractions must identify both Clipper adoption and Finance adoption; landing
   an unused library copy is not completion.

The main spec links here; this file is the single completion checklist for
W01–W21. Source research and R1–R4 explain the work without duplicating task state.

Every task needs its own reviewed ownership/state design, focused implementation
and appropriate checks. Large feature rows below must be split into bounded
review cycles. Tests accompany each slice after the applicable implementation
approval; integration and lifecycle qualification are not deferred to the end.
No XState reconversion, library reimport or new Jazz patch is assumed necessary.

## A. Establish the baseline and prove the resource boundary

- [x] **W01 — Inventory ownership and parity.** Record current SDK/root/subscription
  owners, intended owners, native capabilities and every reachable feature/route.
  Include shared shell data, profile, account ordering, banks, transfers,
  attachments, backup/restore, identity recovery and developer tools. Establish
  reproducible production-build, browser and performance baselines; reconcile
  intended main-branch CI selection. Complete when the inventory names an owner,
  scope, lifetime and acceptance flow for every domain responsibility.
  Completed 2026-11-13 at `670fb720`: the
  [inventory](worker-ownership-inventory.md) covers all 18 page files, parent
  layouts, shared domain/native owners and server endpoints; the
  [baseline](worker-baseline.md) records frozen install/link/type/build checks,
  1,940 passing unit tests, 16 passing production PWA cases and the existing
  521-transaction export/restore/performance case. The
  [result summary](worker-baseline-results.json) retains exact commands/timings,
  the rejected initial PWA setup and dev diagnostic limitations. CI PR #23 is
  merged and the authorized Vercel production-branch corrections are verified.
  W01 changed no runtime/test implementation; W02 evidence follows below.
- [x] **W02 — Prove a worker-safe production import graph.** Depends on W01.
  Add an inactive minimal application-worker entry and identify non-Svelte SDK
  and Local First exports. Build the actual worker with the production toolchain;
  verify no provider/Svelte UI imports enter it and trace emitted JS/Wasm assets.
  This probe does not activate the AccountStore or open a second SDK session.
  The user approved the build-only approach. The
  [W02 implementation/design record](worker-bundle-design.md) describes the
  inactive entry, shared production configuration, strict type/build commands,
  resolved/rendered graph and emitted JS/Wasm evidence. The proof and normal
  application build/check pass; the probe is absent from normal client output.
  Completed 2026-11-13 after explicit implementation/test approval: 35 focused
  unit tests (eight new real-build guard scenarios), all 19 production browser
  cases (16 existing PWA/offline plus three actual emitted provider-module
  scenarios), application/service-worker/proof/test types and production build
  pass. The design record retains exact commands, outputs and limits; no new
  session, persistent storage owner or production probe activation is included.
- [x] **W03 — Design IndexedDB account storage and reconcile salvage.**
  Depends on W01. The user selected IndexedDB and then explicitly excluded all
  migration/old-version compatibility code on 2026-11-13. The
  [revised design](worker-native-custody-design.md) owns transaction/admission/
  receipt/close behavior and keep/adapt/leave decisions across Finance, Clipper,
  Local First and PR #67. Build no import, legacy fallback, dual writes, source
  cleanup, migration markers or old-tab/reload coordination. Existing legacy
  values are ignored, not actively deleted. This scoped instruction supersedes
  earlier requirements to preserve localStorage identities or mixed-version
  account-store compatibility. Ordinary atomicity/failure/close guarantees remain.
- [x] **W04 — Implement the shared transactional IndexedDB AccountStore.**
  Depends on W03's reviewed ownership contract. Put the adapter/native resource
  owner and supported SDK integration in Local First. Perform read, synchronous
  SDK transform and replacement within one active read/write transaction; only
  transaction completion acknowledges an update. Request strict durability,
  bound active/queued work and retain actual completion/abort receipts through
  cancellation, owner failure, version changes and close. Reuse compatible
  existing native IDB/custody contracts; do not copy a workspace journal or
  remote-lock framework. Qualify concurrent real workers/tabs, request success
  followed by abort, worker termination, interrupted close and cold reopen.
  Validate packed public consumers and the SDK AccountStore interface. Actual
  Finance/Clipper adoption is W05; W04 cannot depend on its dependent W05.
  Completed 2026-11-13 after concrete implementation/test approval: full library/
  test types, 53 unit files / 1,111 tests, 60 native cases (20 per engine), packed
  public-consumer types/build, packaging/strict publint and changed-source lint/
  formatting pass. The [verification record](worker-account-store-verification.md)
  retains commands, failed setup/oracle attempts, limits and the real stored-
  undefined bug found/fixed by a cursor read. The new reproducible native command
  runs in library verify and CI. No app startup hookup or migration code was added.
- [ ] **W05 — Integrate the AccountStore and broker lifecycle.** Depends on
  W02 and W04. Bind the shared IDB store into Finance using stable app/profile
  configuration and the existing single SDK/session owner. On 2026-11-13 the
  user approved Finance-first sequencing: Clipper's remaining store/runtime
  conversion is a separate follow-up, not a prerequisite of W05/W06. No
  localStorage selection import, fallback, dual write, legacy cleanup, migration
  marker or old-version compatibility work is in scope. A missing IDB record
  follows ordinary SDK first-use behavior; native failures remain failures.
  Extract Clipper's native close control (R1) and SDK broker/generation adapter
  (remaining R2) into Local First, qualify Clipper then Finance adoption, and
  preserve exact capability admission. Generation storage is a separate SDK
  mechanism; do not silently migrate it with account selection. Remove replaced
  permanent account storage/lock channels after qualification. Preserve unknown
  outcomes, actual native drain and SDK transform semantics without replay.
  First slice: R1's native close transport now has a public Local First
  `worker/host-close` export; Clipper's former implementation re-exports it.
  See the [ownership and review boundary](../../../../packages/local-first/docs/worker-host-close.md).
  R1's approved qualification passed 1,120 library tests, 88 Clipper runtime
  tests, 32 real worker/browser cases and packed-consumer types/native/build
  checks. R2 moves the broker transport to `backend/jazz/worker-broker`, with
  mandatory app-supplied capability admission and a small Clipper policy adapter.
  See its [contract and review boundary](../../../../packages/local-first/docs/jazz-worker-broker.md).
  R2's approved qualification passed 1,144 library tests, 869 Clipper unit/native
  tests plus 14 component cases, all 32 actual worker cases and all 12 packaged
  extension cases, packed public-consumer types/native/module-worker builds and
  production app builds. All eight production offline cases also pass, including
  full stopped-server browser restarts with retained local edits and reconnect.
  Neither extraction changes app account storage.
  Continue Finance's exact broker binding and worker-owned store configuration
  next. The first bounded Finance slice is recorded in
  [worker-finance-binding.md](worker-finance-binding.md). It remains inactive in
  normal application startup; W06 owns actual SDK/session qualification. The
  concrete store factory, exact broker adapter and extended import proof pass
  app/worker types and builds. After the user's test approval, all 1,984 Finance
  unit tests, 69 focused host cases and nine native cases across three engines
  pass, along with all 19 production PWA/provider-worker cases. The native
  command and failure-artifact retention are wired into the existing PWA CI job.
  The [SDK binding decision](worker-sdk-binding-decision.md) selects separate
  grants through the existing callbacks with no new Jazz patch. After the user's
  2026-11-14 approval, F2 passes 2,006 unit tests, 90 focused host cases, all
  12 real-build proof cases and nine native cases across three engines. The
  combined adapter is removed after separate-grant qualification; the fixtures
  and proof consume the replacement. Callback routing and owned SDK/session
  integration remain pending. No private SDK algorithm was copied or admission
  widened to bypass it.
  F3 now exposes the existing broker channel for child invocation so a grant
  owner can supervise it without starting roots inside acquisition I/O. This
  shared API refactor is qualified after 2026-11-14 approval: 1,160 library
  tests, three packed public consumers, 2,006 Finance tests and 12 native cases,
  plus all Clipper unit/component/worker/extension/offline regressions. The
  [grant-owner design](worker-grant-owner-design.md) records concrete APIs,
  commands/results, two initial browser failures and successful reruns, aggregate
  bounds, duplicate/late acquisition and SDK-before-grant shutdown. The actual
  bounded grant population, private acquisition transport and SDK/session
  integration remain pending; W05 is not complete.
  Clipper's still-Window-owned hidden capture SDK and its IDB adoption are
  deferred together. No temporary UI-only-thread exception was approved.
  Source inspection confirmed the extension sign-in worker and hidden offscreen
  runtime currently share the native SDK selection. Adopt the shared IDB binding
  in both together, retaining SDK/session shutdown before store closure. Do not
  switch only the sign-in worker and leave capture on the old default store.
  Until that separate follow-up, retain Clipper's existing account-storage path;
  remove Finance's superseded inactive transport after its replacement qualifies.
- [ ] **W06 — Qualify a single worker SDK/session owner.** Depends on W05.
  Integrate the current patched SDK with the retained acquisition lifetime and
  Finance configuration. Prove IDB identity/binding reuse after creation, persistent
  replica access, offline writes, full browser/worker exit and cold reopen,
  multiple tabs, broker generation failure and native resource release.
  Do not reset existing storage or claim persistence from matching names alone.

Milestone A: a production-buildable, crash-safe worker runtime that preserves
identity and storage. No production UI handoff is implied.

## B. Establish the application and UI contracts

- [ ] **W07 — Define runtime connection and bounded views.** Depends on W02/W03;
  real-runtime qualification depends on W06. Define versioned commands,
  projections, subscription attach/detach, operation receipts and host capability
  requests. Bind runtime/attachment generations, identity/workspace scope and
  request IDs. Bound bytes, collections and pending work; specify cancellation,
  overload, stale A → B → A results and duplicate handling. Add a UI connection
  that exposes views/commands, not actor or database handles. Preserve exact
  money/date representation. Do not transport arbitrary queries or raw errors.
  The user confirmed the worker-backed client direction on 2026-11-14; the
  [client-boundary decision](spec.md#finance-runtime-client-boundary) is part of
  this task. Expose bounded feature views through the native Svelte store
  contract: synchronous current value on subscription and explicit unsubscribe.
  Give runtime failure/unavailability a typed view outcome. Replacement must
  invalidate old identity/workspace data and command capabilities immediately;
  generation checks must reject stale A → B → A reports and intents.
  UI subscription disposal releases observation, while the application owner
  retains SDK/session lifetime and actual financial-effect settlement. Keep
  component-owned UI actors separate from this domain-client boundary.
  Qualify initial subscription to an already-ready runtime, multiple observers,
  detach/resubscribe, replacement, failure and late commands/results through the
  actual worker transport. W07 remains incomplete until implementation and these
  acceptance checks pass.
- [ ] **W08 — Implement shutdown/replacement and uncertain-outcome ownership.**
  Depends on W06/W07. Model layout detach, runtime close, account/environment
  replacement, host failure and worker crash separately. Retain/reconcile issued
  effects, invalidate capabilities, drain descendants, clear transients and
  close actual resources before safe-close acknowledgement. No blind replay.
  Wire sanitized bounded diagnostics using the existing projection.
- [ ] **W09 — Add worker-owned query observation.** Depends on W06/W07.
  Implement reusable non-Svelte observation at the Local First Jazz boundary,
  drawing on Clipper's direct SDK bindings without extracting domain queries.
  Use non-Svelte SDK subscriptions with owned lifetimes and failure reports;
  preserve LocalFirst foreground behavior and explicit authority-tier operations.
  Copy live rows at immutable actor boundaries, bound views, reject stale results
  and dispose on scope replacement. Expose only reusable mechanisms in Local
  First; Finance retains queries and permission policy.
- [ ] **W10 — Split form transport from DOM and localization.** Depends on W07.
  Evolve Local First's existing workflow/integration boundary rather than add
  an app-local replacement for its scoped form machine.
  Keep FormData extraction, native inputs, focus and presentation in Window.
  Keep validation, eligibility, draft/workflow authority, submissions and result
  selection in worker actors. Replace callback-bearing feedback labels in wire
  views with selected serializable descriptors; retain Finance's current wording
  and reactive locale. Specify draft revisions, out-of-order input, reset,
  navigation acknowledgement, cancellation and late completion. Qualify shared
  API changes with existing consumers; don't create another form workflow.
- [ ] **W11 — Prove native capability and private submission adapters.** Depends
  on W07/W08. Specify and prototype navigation/WebAuthn/file/canvas boundaries
  and a bounded private one-use submission channel for secret/file payloads.
  Recreate opaque WeakMap-backed handles in their receiving realm. Verify
  rejected/late/duplicate submissions, scope replacement, cancellation, port
  loss and cleanup without logging secrets. Qualify clone/transfer behavior and
  supported processing primitives before dependent feature migration.
  Separately extract Clipper's generic disposable-worker job (R4) into Local
  First and update Clipper's image-job caller before Finance's finite-job
  adoption; this extraction need not wait for all private submission adapters.

Milestone B: actual SDK-backed observations, cloneable application/form views,
safe commands and explicit native boundaries. UI does not reconstruct access or
workflow decisions from worker internals.

## C. Move shared application flows, then bounded features

- [ ] **W12 — Move session/workspace/access coordination.** Depends on W08/W09
  and required W11 capabilities. Move restoration/bootstrap, selected-workspace
  ownership, membership/grant observation and scoped resource drains. Replace
  live actor/context bindings with W07 views/commands. Preserve locally known
  usability, denied/partial knowledge and immediate invalidation on access loss.
- [ ] **W13 — Move shell data, balances and preference coordination.** Depends
  on W12. Replace WorkspaceBootstrap's data/query/aggregation responsibilities
  with worker projections. Preserve exact balances, workspace navigation and
  account-order edit/done/move and persisted preference behavior. Keep disclosure,
  responsive layout, route observation and native storage primitives in Window.
- [ ] **W14 — Prove the first read-only vertical slice.** Depends on W13.
  Render existing accounts presentation from the worker's list projection in an
  isolated migration preview. Verify no page SDK/query owner, bounded output,
  subscription disposal, permission loss and workspace switching.
- [ ] **W15 — Prove the first financial-write vertical slice.** Depends on W10,
  W12 and W14. Move manual transaction creation without attachments first.
  Exercise validation → authorization → write → local settlement → result →
  navigation, plus cancellation, access replacement and unknown outcomes.
  Prove offline save and cold restart; keep transaction resources in one realm.
- [ ] **W16 — Migrate ordinary domain features in dependency order.** Depends
  on W15. Split into focused slices: account creation/settings/order/archive and
  grants; category/tag management; transaction pagination/filtering/details/editing;
  transfers/linking/unlinking and integrity operations; profile and identity
  settings. Use W10/W11 where required. Preserve selected-account permissions,
  transaction-time invariants, money semantics and atomic operations. Verify each
  route against W01; do not hide unported routes behind a ready startup shell.
- [ ] **W17 — Migrate images and attachments.** Depends on W11/W15 and affected
  W16 flows. Move processing/validation/upload/replacement/removal coordination,
  retaining required native display/picking surfaces in Window. Verify actual
  Pica/canvas/bitmap compatibility, transfer ownership, cancellation, resource
  release, partial attachment failure and profile-avatar flows.
- [ ] **W18 — Migrate provider setup, discovery, sync and history.** Depends on
  W11/W12/W15 and needed account flows in W16. Add validated provider-worker
  request admission and explicit endpoint binding. Preserve one-use setup-token
  PRF preflight, explicit per-operation passkey verification, encrypted storage,
  scoped transient secrets, import idempotency, settlement and log retention.
  Keep the disposable HTTP worker initially. Prove no startup/reconnect/timer
  transaction fetch or implicit retry; include mixed/partial discovery results.
  Reuse R4 for finite worker lifecycle only, preserving provider secrets outside
  inspectable job context and keeping consent/domain decisions in Finance.
- [ ] **W19 — Migrate backup, restore and workspace administration.** Depends on
  W11/W12 and relevant file/account flows. Recreate one-use submissions inside
  worker ownership; move archive read/validation/crypto/planning and persistence
  there. Preserve legacy fixtures, restore journals, interrupted recovery,
  workspace creation/rename and identity-merge behavior. Qualify large archives,
  cancellation, unknown writes and protected file/password cleanup.

Milestone C: every inventory feature has a worker-owned domain path and existing
UI behavior. These rows can be prepared independently after their prerequisites,
but remain separate bounded review cycles.

## D. Qualify and activate the complete application

- [ ] **W20 — Complete parity, packaging and performance qualification.** Depends
  on W16–W19. Exercise the actual built application across supported engines,
  identity/workspace replacement, revocation, multi-tab contention, worker/host
  failure, offline writes and cold browser restart. Verify nested worker/Wasm
  precaching, offline deep links and consented PWA updates. Include developer
  tools and sanitized inspection. Audit Window imports/execution for remaining
  domain work. Compare startup, large lists, balance updates, import and archive
  processing to W01, including message/clone cost and responsiveness. Record
  unsupported paths explicitly; no arbitrary improvement target is invented.
- [ ] **W21 — Activate, accept and remove obsolete ownership.** Depends on W20
  and release authorization. Replace the Window SDK provider and old integration
  paths as one qualified ownership handoff. Preserve origin/configuration and
  logical IDB identity/data; apply the explicit no-migration scope and verify
  supported current-version tab coexistence without concurrent SDK owners in a
  single application tree. Remove superseded paths after acceptance,
  and update specification/checkpoint/task records to the final implementation.

## Rollout constraint

Foundation changes may land inactive. Incomplete application flows are developed
in an isolated preview configuration with exactly one SDK/session owner. Keep
the complete existing production app until the worker path has parity; do not
publish a partial shell or use a second Window SDK to support unmigrated screens.
If earlier production slices are desired, first review a concrete single-owner
compatibility design and prove that it preserves every reachable existing flow.

W02 and W03 can proceed independently after W01. W07/W10 design can advance
while native custody is qualified; activation waits for W06. W17–W19 branch only
after their shared prerequisites. The first implementation step is W01's concrete
inventory/baseline, followed by the bounded W02 bundle proof and W03 custody
design; it is not a wholesale restart or merge of PR #67.
