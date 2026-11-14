# Shared workspace contracts for Clipper and Finance

Research baseline: monorepo `f1c22d47`, 2026-11-14. This is a proposed design,
not an approved implementation or a claim of native SDK qualification.

Local First should own workspace lifecycle for every app. Clipper should silently
initialize and select one private workspace, with its existing library as the
content root. Finance should retain its exposed workspace interactions and
financial policies. Shared lifecycle does not require shared database schemas,
membership roles, or a cross-app workspace service.

## Existing contracts and concrete gaps

Paths below are relative to the monorepo root.

| Responsibility | Existing source | Proposed treatment |
| --- | --- | --- |
| Initialization discovery and bootstrap | `packages/local-first/src/lib/machines/workspaces/initialization.ts` | Extend admission evidence for fresh local bootstrap; preserve conservative behavior for existing identities. |
| Session-bound initialization and optional seed ownership | `packages/local-first/src/lib/machines/workspaces/startup.ts` | Generalize Finance-shaped names and expose initialized workspace provenance in reports. Keep seed independent of foreground readiness. |
| Headless selection, access changes, invalidation and drain requests | `packages/local-first/src/lib/contracts/workspace-selection.ts` and `machines/workspaces/selection.ts` | Reuse existing public `workspace/contracts` and `workspace/workflow`. No new selector machine. |
| Atomic creation and local durability | `packages/local-first/src/lib/contracts/workspace-creation.ts` and `machines/workspaces/creation-transaction.ts` | Reuse typed transaction ownership and receipt custody; apps supply checks and writes. |
| Durable explicit creation and reconciliation | Public `workspace/journal`, `workspace/creation-operation`, `workspace/creation-persistence`, `workspace/creation-owner` | Available for explicit operations; do not make Clipper adopt a visible creation flow or a second intake journal. |
| Replacement of fixed-scope selection actors | `apps/finance/src/lib/machines/runtime/workspace-selection-attachment.ts` | Candidate shared extraction after contract review, with no routing or domain resource ownership. |
| Access observation | `apps/finance/src/lib/machines/runtime/workspace-selection-observation.ts` | Keep membership and route projection app-owned. Share observation vocabulary, not Finance's membership interpretation. |
| Resource drain | `apps/finance/src/lib/machines/runtime/workspace-selection-drain.ts` | Keep financial transfer/resource composition in Finance. Clipper supplies its own resource drain. |

The initializer returns both identity and workspace IDs, but startup's public
ready report includes only `profileId`. Its seed input and ready projection use
`organizationId`, and consumers must provide a seed actor even when none is
needed. These are specific API issues rather than reasons to replace the existing
workflow graph.

Selection already admits a target from matching request and `access: 'allowed'`.
Its directory can be loading or unavailable; directory contents do not authorize
access. Clipper can use this contract without fetching a complete workspace list
or rendering a selector. Names are presentation metadata, not selection authority.

## Proposed initialization contract

Separate three facts:

1. Session identity: the current account/client/database binding and attachment
   generation.
2. Initialization provenance: which workspace was created by the initial app
   bootstrap and which durable initialization intent produced it.
3. Selected workspace access: current local evidence that the target can be used.

Provenance identifies an initial target; it does not prove that the target still
exists, remains accessible, or is the current user selection. Finance's
`profiles.initialWorkspaceId` already explicitly has this provenance-only meaning.

Proposed initialization inputs add a discriminated bootstrap admission fact:
`freshLocalIdentity`, `existingIdentity`, or `unknown`, bound to the exact session
attachment. `freshLocalIdentity` requires evidence from the identity provisioning
owner; neither `signedIn: false`, a local identity issuer, a ready session, nor an
empty local query is sufficient evidence. These are proposed concepts, not
existing SDK fields.

The current shared session contracts report acquisition/status, not fresh identity
creation provenance. The installed Jazz `dist/session/state.d.ts` likewise exposes
`pending: 'createLocalFirst'` only as a transient operation and
`createLocalFirst(): Promise<void>`; its ready snapshot has no creation receipt.
The account manager's `createLocalFirst()` returns a handle, but choosing that
lower-level integration would require ownership and durability review rather
than assuming it can replace the current session owner. Compare supported
alternatives: own explicit local identity creation and retain its result through
DLF, or use a canonical app root that can be safely ensured for an existing
identity. Do not infer creation from a transient pending observation or introduce
a dependency patch to manufacture a signal.

The canonical-root alternative is particularly relevant to Clipper: it currently
uses `libraryId === account.id` and upserts the same immutable root. That makes
repeated root creation converge on one ID. It does not by itself generalize to a
multi-record bootstrap containing membership/provenance, prove safe SDK conflict
semantics, or authorize creation of a new arbitrary workspace after restoration.

| Observed case | Proposed behavior |
| --- | --- |
| Existing local provenance and usable target | Select locally; no remote preflight. |
| Known usable local target but provenance incomplete | Keep target usable; resolve provenance separately. Do not let optional repair gate ordinary work. |
| Fresh local identity with trusted creation evidence | Prepare one stable intent; create the minimal private root atomically and await local durability; select offline. |
| Existing or restored identity with missing local provenance | Resolve from authority or trusted existing root evidence; remain unavailable if needed facts are absent offline. Do not create a replacement workspace from absence. |
| Duplicate or conflicting initialization records | Return a typed conflict/unavailable outcome; no arbitrary first-row selection or automatic overwrite. |
| Unknown commit settlement | Retain exact intent/receipt; reconcile before retry, with no blind replay. |

The current initializer requires authority discovery when local provenance is
missing and returns `authorityUnavailable` when no server is configured. Extend
that decision deliberately; do not weaken it globally to satisfy Clipper.

Initialization results should distinguish initialized provenance, unavailable
evidence, conflict, failure and uncertain settlement. Startup should forward a
bounded result containing `identityId` and `initialWorkspaceId`, rather than
collapsing every non-ready initialization outcome into a generic failure.
Selection/access remain separate public reports.

## Headless target resolution

For Clipper v1, the target resolver uses its persisted initial workspace reference
or validated canonical root. It submits a normal `SELECT` request to the existing
selection machine. It never chooses the first directory entry, creates another
workspace because a read is empty, or treats a prior selected ID as access proof.

Finance keeps URL/user selection and its existing membership-backed access
projection. Both consumers use the same lease lifecycle. A shared target resolver
is warranted only if both apps need the same precedence rules; a generic routing
framework is unnecessary.

Clipper's library can initially be the workspace root, avoiding a second table
with the same lifetime and cardinality. Most content already carries `libraryId`.
Make account ID and selected library/workspace ID separate integration inputs even
if existing canonical data retains equal values. A future need for multiple
libraries inside one workspace would justify an additional relationship then.

## Access and lease contract

Reuse `WorkspaceSelectionObservation`: scope, request, observation generation,
directory status and target-specific access. Clipper's initial access evidence
can be private-root ownership/compatibility; Finance's remains membership and
financial policy. No shared role enum or mandatory membership table is needed.

Reuse `WorkspaceLease`: binding/attachment scope, workspace request and activation
epoch. It is a local capability correlation token, not backend authorization.
Native identity objects stay in the worker; worker transports need their existing
validated serializable correlation fields rather than cloning object tokens.

The selected-resource owner must bind record queries, mutation admission, capture,
images, search, notes and reader operations to that lease. Invalidate new admission
immediately when identity/client/database or access changes. Correlate returned
results and commit eligibility with the admitted scope. An A to B to A transition
must reject the first A's late reports.

On invalidation, the app drains issued writes and owned resources, then returns
the exact `DRAINED` or `DRAIN_FAILED` receipt. A timeout, actor stop, or transport
closure is not proof of settlement. The selection actor owns selection decisions;
it does not dispose domain resources itself. Shared extraction must preserve that
division and retain unknown outcomes through shutdown.

## Clipper adoption boundaries

`apps/clipper/apps/web/src/lib/backend/jazz/account.ts` currently performs root
read/ensure and constructs library records using `account.id`. Split session
binding from workspace resource binding. Construct records only for the admitted
workspace lease; remove the account-ID inference from `currentLibraryRecords`
and other direct record construction paths.

`apps/clipper/apps/web/src/lib/backend/jazz/permissions.ts` permits library
creation/update only with `id === session.user`, owner equal to the user, and
bootstrap version `1`. Independent workspace IDs therefore require reviewed
storage policy changes. Preserve private ownership and same-workspace parent
checks across every child table. Shared lifecycle is not permission to introduce
sharing, invitations, member roles, or weaker authorization.

The extension uses the same account binding with an extension-specific library
factory. It must resolve the same workspace after confirmed restoration. Keep its
existing requirement for explicit sign-in; silently provisioning the web app's
local identity must not become extension authentication.

Audit cache/search namespaces, draft storage, background work, direct reader URL
loads and operation reconciliation for account-only keys. Preserve document URLs
where IDs resolve safely within the selected scope; do not add workspace routes
merely because the underlying model now supports them.

## Decisions and risks before implementation

- Cross-app workspace identity: default proposal is app-scoped workspaces with a
  common lifecycle. A single shared Finance/Clipper organization would require
  explicit cross-app identity, membership, storage and deletion semantics.
- Existing data: Clipper's application plan already treats development data as
  disposable and excludes historical schema migrations. Apply that accepted scope
  when choosing the final schema; do not introduce migration machinery by default.
  Preserving existing canonical IDs may still simplify the model. No data reset
  is authorized. The Finance worker project's separate migration exclusion does
  not establish Clipper policy.
- Offline bootstrap: reliable fresh-identity evidence or qualified canonical-root
  convergence is the main unresolved technical prerequisite.
- Multi-tab/web-extension concurrency: stable IDs alone do not establish atomic
  invariant enforcement. Qualify actual transaction/conflict behavior for the
  selected bootstrap bundle.
- Access revocation: observed access loss invalidates local leases immediately;
  offline cached data cannot promise instantaneous knowledge of remote revocation.
- API compatibility: change supported public exports and all consumers together;
  preserve Finance behavior rather than silently substituting Clipper defaults.
- Avoid duplicate extraction work: coordinate with Finance's worker foundation
  plan; do not copy its account store, transport, transaction custody, or runtime
  host into a new workspace subsystem.

## Proposed implementation sequence and acceptance

1. Resolve bootstrap admission against installed SDK APIs and decide existing-data
   treatment. Model initialization states and persistence ownership before code.
2. Extend DLF startup/initialization contracts with neutral provenance reporting
   and the selected safe bootstrap admission. Keep Finance's authority behavior
   unchanged unless separately justified.
3. Extract only the domain-free selection attachment lifecycle if both consumers
   need it. Reuse the existing selection/lease/transaction exports directly.
4. Adopt hidden workspace binding in Clipper web and extension, including policies
   and all record construction paths. No workspace selector is required.
5. Consolidate any newly demonstrated common behavior back into DLF, retaining
   Finance's schemas, routes, access projection and financial drains.

After implementation review, acceptance should cover a fresh offline launch;
offline cold reopen; restored identity with an empty replica; local data usable
while remote provenance is unresolved; concurrent first creation; partial and
unknown writes; access loss and A to B to A late results; worker termination;
web/extension convergence; and denied cross-workspace child references. Qualify
library exports and packed consumers, both production worker bundles, and actual
backend/native storage behavior. Source inspection alone does not establish
these runtime guarantees.
