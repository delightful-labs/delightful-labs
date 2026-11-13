# Finance worker migration: foundation-first tasks

Status: recorded migration backlog after code research on `main` at `eb0f615f`
(2026-11-13), incorporated by [spec.md](spec.md#application-worker-migration-handoff).
All W-series tasks are unstarted; detailed implementation designs remain subject
to their review gates.
This is a planning artifact, not an activation or production release. Read the
[research and source evidence](worker-migration-research.md), existing
[ownership specification](xstate-v6-migration.md), and
[PR #67 dispositions](../../../../specs/002-monorepo-agent-guidance/finance-worker-pr67-review.md).
Existing implementation-review gates apply when implementation begins.

The [Local First/Clipper reuse review](worker-foundation-reuse.md) owns the
extraction details: reuse the library's existing workflows directly; move native
close, scoped storage/broker, reusable custody and disposable-worker mechanisms
from Clipper into Local First before Finance adopts them. Update Clipper to the
same shared implementation, preserving app-specific policy and namespaces.

## Instructions for the next agent

1. Read workspace/Finance and affected Local First/Clipper guidance, then the
   spec handoff, source research and reuse specification. Work in the maintained
   monorepo, not the former source repositories.
2. Verify current remote default-branch `main` and record the actual baseline.
   This research started at `eb0f615f` in the separate
   `research/finance-worker-foundations` worktree; refresh code findings if the
   baseline changes. Preserve unrelated work and user servers/storage.
3. Start with the first incomplete task whose dependencies are met. W01 is the
   first implementation-preparation task. R1–R4 are extraction work within the
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

- [ ] **W01 — Inventory ownership and parity.** Record current SDK/root/subscription
  owners, intended owners, native capabilities and every reachable feature/route.
  Include shared shell data, profile, account ordering, banks, transfers,
  attachments, backup/restore, identity recovery and developer tools. Establish
  reproducible production-build, browser and performance baselines; reconcile
  intended main-branch CI selection. Complete when the inventory names an owner,
  scope, lifetime and acceptance flow for every domain responsibility.
- [ ] **W02 — Prove a worker-safe production import graph.** Depends on W01.
  Add an inactive minimal application-worker entry and identify non-Svelte SDK
  and Local First exports. Build the actual worker with the production toolchain;
  verify no provider/Svelte UI imports enter it and trace emitted JS/Wasm assets.
  This probe does not activate the AccountStore or open a second SDK session.
- [ ] **W03 — Design native custody and reconcile salvage.** Depends on W01.
  Compare current Finance account-store/legacy charts, Local First request/channel/
  drain contracts, and PR #67's custody/lease changes. Record keep/adapt/leave
  decisions. Specify native lease owner, exact acquisition identity, permitted
  storage writes, close admission, lock order, and receipts after worker loss.
  Cover primary and earlier-key cleanup. Keep domain choices in the worker.
- [ ] **W04 — Implement crash-safe native custody.** Depends on W03.
  Put reusable native lease/admission and receipt ownership in Local First,
  adapting both consumers; reconcile Clipper's same-realm custody keeper (R3)
  rather than treating it as proof of whole-worker crash safety.
  Bind each write to an admitted current lease; prevent queued old writes from
  executing after native release/reacquisition. Retain custody until native
  settlement or actual host closure. Verify competing tabs, worker termination,
  cancellation during acquisition, stale lease replay, failed close, and late
  receipts in native browsers. Timeouts are not release evidence.
- [ ] **W05 — Bind the AccountStore and storage/broker lifecycle.** Depends on
  W02 and W04. Adapt existing Finance bridge/owner/facade to qualified custody
  and shared lifecycle contracts. Extract Clipper's native close control (R1),
  scoped storage and Jazz broker adapters (R2) into Local First, update Clipper,
  then connect Finance through supported exports; remove replaced transports.
  R1/R2 can be prepared during W04, while full AccountStore activation waits
  for its custody qualification. Preserve storage keys, legacy behavior and SDK
  transform semantics. Admission closes before draining; independent close
  receipts survive data-channel failure. Verify uncertain writes and cleanup.
- [ ] **W06 — Qualify a single worker SDK/session owner.** Depends on W05.
  Integrate the current patched SDK with the retained acquisition lifetime and
  Finance configuration. Prove existing identity/namespace reuse, persistent
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
  paths as one qualified ownership handoff. Preserve origin/configuration/storage,
  prepare rollback and verify old/new-tab coexistence without concurrent SDK
  owners in a single application tree. Remove superseded paths after acceptance,
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
