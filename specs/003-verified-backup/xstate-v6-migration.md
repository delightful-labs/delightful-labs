# XState v6 compatibility and ownership specification

Status: proposed for review, 2026-11-09. Specification only.
Inventory baseline: DLF main `be40b8fd1e7e417ac447b45cd81437a407634675`.
This is a cross-cutting prerequisite for existing foundation and backup workflows;
it does not change the active feature or authorize backup adoption in Finance.

## Goal and boundaries

Migrate DLF's shared workflows to XState v6 while preserving behavior, native
resource ownership, public subpaths and consumer-specific policy injection.
Coordinate the library's actor-facing API with Finance and Clipper rather than
claiming a v6 library can be dropped into their existing v5 actor trees.

The coordinated migration includes DUI, DLF, Clipper and Finance.
local-first-ux-patterns is excluded. DUI PR #20 is merged and pins v6.0.0-beta.1.
Use that beta as the initial compatibility candidate; recheck published releases
before implementation and record the exact runtime and codemod versions selected.
Any change from the candidate needs a documented API/behavior delta review.

This work does not upgrade Jazz, change domain schemas or permissions, adopt a
new identity provider, deploy Finance, or implement Finance's worker split.
Worker compatibility is a required design boundary, with its adoption separately
specified and qualified in the consuming app.

## Current surface and migration units

DLF pins XState 5.33.2 in development dependencies and its optional peer contract.
It has no direct `@xstate/svelte` dependency. Jazz is pinned to alpha.59; DUI is a
vendored 0.0.25 archive. That archive version alone does not identify a v6 build.

The inventory finds 40 non-test TypeScript files under `src/lib/machines`, including
native adapters and custody helpers. Across production `src/lib` TypeScript,
35 files contain explicit `setup<...>` generics, 21 contain `fromPromise`,
10 contain `fromCallback`, 18 contain `stateIn`, and 9 contain `ActorLogic`.
These are textual file counts, not machine or codemod-success counts.

| Migration unit              | Representative public boundaries                                                                                               | Required preserved behavior                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms                       | `forms/readiness`, `forms/submission`, `forms/write`, `forms/workflow`, `forms/lifecycle`, `forms/svelte`                      | Scoped capability/observation reports, validation, exact submitted facts, interruption, local-save feedback and post-save completion                             |
| Identity/session            | `session/workflow`, `recovery/workflow`, `restoration/workflow`, `recovery/coordination`, `profile/workflow`, `profile/avatar` | One session owner per app lifetime, attachment generations, explicit restoration, resource drain, secret clearing and navigation retry without repeated mutation |
| Workspaces                  | `workspace/startup`, `workspace/initialization`, creation/journal and invitation subpaths                                      | Local readiness before optional work, provenance-aware bootstrap, operation identity, transaction custody and authoritative uncertainty reconciliation           |
| Backup/restore              | Export, inspection, envelope, restore and journal API/workflow subpaths                                                        | Bounded archive processing, exact attachment/plan identity, durable journal transitions, operation lock, cancellation and complete terminal results              |
| Host adapters and packaging | `backend/jazz/*`, integrations, package-consumer and test-app fixtures                                                         | Narrow SDK capabilities, browser/SSR separation, consumer-injected actor logic and packaged declaration compatibility                                            |

Inventory public exports from `package.json` again before implementation. Include
factory-returned logic, supplied `ActorLogic`/`ActorRef`/`Snapshot` contracts,
integration controllers, fixtures, and test harnesses in each unit's review.

## Required authoring model

1. Replace v5 setup generics/type shims with v6 schemas, retaining strict generic
   factory inference without casts, `any`, or broad untyped actor escapes.
   Use existing Zod schemas at validation boundaries; use `types<T>()` where the
   contract is type-only. Runtime schemas must not attempt to serialize native
   handles or add validation of private machine context without a requirement.
2. Use function transitions and immutable context patches. Preserve descriptive
   predicates and explicit chart decisions; removing guard arrays must not bury
   workflows inside helpers. Queue selected effects through `enq` and invoke
   async leaf logic when completion/failure affects the workflow.
3. Preserve sequential assignment semantics. Completion branches must inspect
   output facts directly rather than assume a patch in that transition has
   already applied. Explicitly review effect/notification ordering.
4. Resolve invoked actor logic directly and replace removed forwarding APIs with
   typed recipient references owned by the active state. Reject stale scope and
   generation reports, including A → B → A rebinding. Never accept a missing
   recipient as successful shutdown or durable completion.
5. Preserve machine-first ownership, no application classes/inheritance, no
   `switch`, presentation separation and existing localization boundaries.

DUI's pilot showed that a clean codemod manual-site report does not establish
type correctness: generated emitted schemas and action-source signatures needed
manual correction. DLF's generic factories require particular attention.

## Concrete runtime hazards requiring design review

- **Final-state actions:** `machines/workspaces/creation-transaction.ts` currently
  assigns cancelled/closed outcomes in final-state entry actions. Audit every
  final state's actions, invokes, transitions and output. Move required work to
  a preceding transition or meaningful completion state and preserve result
  selection before terminal output; v6 final states are inert.
- **Parallel transitions:** forms, workspace journal/creation/invitations,
  naming and profile-avatar use parallel states. Document each region's owner,
  exit set, cancellation precedence and drain join. Review sibling resets and
  same-event observations rather than mechanically preserving target strings.
- **Completed children and IDs:** audit child lookup, forwarding, completion
  output and state-ID targets. Do not depend on completed children remaining in
  the parent's child record or old suffixed lifecycle event names.
- **Frozen context:** classify context contents as immutable workflow facts or
  opaque native resources. `transaction-custody.ts` mutates a plain receipt holder;
  `identity/session-acquisition.ts` retains a WeakSet and request/session facts.
  Trace where these reach context and qualify development freezing. Do not
  disable freezing globally or mutate snapshots to retain the old implementation.
  Private resource bookkeeping may remain in an adapter with explicit ownership;
  lifecycle and decision facts still belong in the chart.
- **Custody on failure:** retain late acquisition, issued native calls and commit
  receipts through cancellation and unexpected actor failure. The current helper
  observes owner errors because v5 could orphan children after a thrown transition.
  Requalify that path on v6 before removing the workaround. A stopped actor or
  callback disposal alone does not prove rollback, local persistence or remote acceptance.
- **Single-use actors and effect errors:** create fresh roots on reattachment;
  review queued functions returning promises and all rejection paths. No issued
  write may become an automatic retry because the owner stopped receiving output.
- **Persistence:** distinguish XState snapshots from DLF's archive and restore
  journal formats. Inventory actual snapshot-restoration consumers before deciding
  a compatibility strategy. Preserve existing durable journal schemas, encryption
  boundaries and secret-exclusion guarantees; do not persist actor trees containing
  native receipts or credentials as a migration shortcut.

## Package and consumer rollout

The completed package must declare the selected exact v6 peer and development
version. Keep XState optional for consumers of independent subpaths only if
packaged import checks confirm that those paths remain usable without XState.
Do not widen the peer range to v5/v6 unless both are actually supported and tested.

Build an identifiable DLF artifact from the reviewed v6 commit. Existing Finance
and Clipper root checkouts consume `delightful-local-first-aaf718d-logger.tgz` and
v5.33.2-compatible dependencies; those archives remain historical v5 consumers.
Coordinate adoption by complete connected actor graphs. A temporary side-by-side
package alias may support independent roots, but must not cross-invoke v5/v6
logic or exchange live actor references between them without verified support.
Update Finance's `@xstate/svelte` compatibility in Finance's own spec.

DLF's current APIs also require detached transaction custody that older consumer
archives predate. Preserve the signatures and host obligations documented in
[transaction custody](../../docs/transaction-custody.md); list those adoption
changes separately from v6 API changes. Qualify Finance and Clipper adapters
against the actual rebuilt archive before claiming upgrade readiness.

## Worker compatibility and Clipper reference

The app owns the Window/worker boundary. UI interaction, focus, navigation and
presentation remain UI-owned. Realm-independent DLF workflow factories can run
under the worker's session/domain owner with injected capabilities. Native
session/DB/transaction handles and live actor refs stay in their owning realm;
cross-realm communication uses validated bounded messages and projected views,
with request identity, binding generation and stale-result rejection.

Observed Clipper reference: worktree `jazz-cleanup-verify` at
`9a30b73960dd6a5e5a055cdc00e7ea4e47d96d86`, especially
`apps/web/src/lib/runtime/worker/{application.worker,host-machine,protocol,account-store,storage-channel,broker-channel}.ts`
and `apps/web/tests/worker/host.spec.ts`. It contains the application-worker split,
not just the earlier article-processing worker. This is inspected source and
existing test intent, not a fresh qualification run or proof that this commit is
the final accepted deployment reference. Select and record the accepted reference
before worker adoption.

Its configured Jazz alpha.60 patch supplies `browserWorkerHost` broker opening
and generation storage, worker runtime detection and configuration handling.
The same patch also includes backend auth/origin changes unrelated to this
migration; do not copy that entire patch into Finance as an undifferentiated fix.
The retained alpha.59 patch is not the configured alpha.60 runtime patch.

Its DLF patch exposes `recovery/view` and corrects a generated declaration name;
it does not implement a generic worker runtime. Consider promoting that pure-view
subpath into DLF source when required by the reviewed consumer composition.
Do not copy Clipper's library, article, reader or tag protocols into DLF.

Reusable broker/storage lifecycle support needs its own bounded capability design
and Jazz-version qualification before promotion. Window-only storage and
SharedWorker construction require an owned host channel; a matching account or
DB name does not prove both realms share persistent storage. Require identity
reuse, local writes, offline restart visibility, multi-tab behavior, disconnect,
drain-before-termination and recovery checks in Finance's worker acceptance plan.
Preserve existing SDK limitations until the exact patched runtime disproves them.

## Implementation sequence and acceptance gates

1. Record selected versions and complete the public-contract/consumer matrix.
   Capture v5 behavior for each migration unit before running the codemod;
   include inputs, representative events, actor outputs and controlled failures.
2. Pilot one leaf and one generic composed factory before bulk conversion.
   Review dry-run output and manual sites; record unsupported generic patterns.
   Migrate a connected dependency unit at a time, retaining a buildable consumer
   boundary rather than arbitrarily mixing actor versions within a unit.
3. For each unit, record state/resource ownership and changed runtime semantics.
   Reconcile v5-specific `.specify/memory/xstate.md` examples and affected public
   docs with v6 only when that implementation lands. Preserve architectural
   requirements; do not globally replace API names in historical evidence.
4. Present implementation for review before adding/running its implementation
   tests, per repository policy. After approval, run relevant branch, cancellation,
   stale-generation, terminal-output, late-acquisition, custody and unknown-write
   tests. Supplement codemod replay with real native adapter and browser checks.
5. Complete formatting/lint/type/package checks, packaged consumer imports and
   declarations, relevant backup-reader/test-app checks and Storybook/browser
   flows. The `check:consumer` script includes runtime tests, so honor the same
   test approval gate. Record platform/SDK versions and coverage limits.
6. Verify the actual DLF archive in coordinated Clipper and Finance adoption
   changes. Do not mark consumer adoption, Jazz patch qualification, or worker
   performance complete from DLF's unit results alone.

Success means preserved public behavior and native ownership, sound inferred
consumer types, resolved codemod findings, compatible declared peers and qualified
package boundaries. Intentional behavior/API differences require explicit spec
decisions and consumer migration notes. Restore the previous library archive,
runtime/peer pins and lockfile together for rollback; unresolved native writes
still need their existing recovery owner. Do not change durable formats merely
to make rollback easier.

## Sources

- [Official migration guide and runtime behavior changes](https://stately.ai/docs/xstate/v6/xstate-v5-to-v6)
- DUI's merged `docs/xstate-v6-migration.md` and PR #20 implementation evidence.
- DLF public exports, machine sources, [next-app integration](../../docs/next-app.md),
  [transaction custody](../../docs/transaction-custody.md), and active backup contracts.

This review changes documentation only. No runtime packages, generated files,
consumer archives, active-feature selection or unrelated sign-in drafts are changed.
