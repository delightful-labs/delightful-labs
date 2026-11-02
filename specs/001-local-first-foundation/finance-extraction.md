# Finish extracting existing Finance foundations

## Delivery decision

The user directed on 2026-11-02: finish extracting reusable behavior already implemented in Finance
so the next app can use it; implement features missing from Finance afterward. This changes delivery
order, not the full MVP requirements. Invitations, member administration and other new product
behavior must not gate the extraction milestone. On 2026-11-02 the user authorized completing all remaining extraction and verification in the
current PRs without another per-slice handoff. No full Finance rewrite or schema conversion is needed.

Audit baseline: library main ed96a79 and Finance main e04bdf4 after library PR #9 and Finance PR #44
merged. Both working branches are feat/finance-foundation-extraction. Later slice branches may be
created from newly merged main. The earlier slice plans describe their original baselines/history.

## What is already shared

Recovery phrase presentation/workflow, explicit restoration, session acquisition/attachment and
acquired-session readiness, workspace selection/drain protocol, private-creation transaction
ownership, selector and creation-dialog presentation, and finite naming persistence are implemented
and adopted in Finance. Do not rebuild these or call them remaining MVP work. Finance still binds
its application lifetime, local schemas, queries, permissions, navigation and financial resources.

## Extraction inventory and order

| Order | Existing Finance evidence                                                                                                                                                                | Shared responsibility to extract                                                                                                                                                  | What remains consumer-owned                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | contracts/form-contract.ts; machines/forms/scoped-form-{readiness,submission,write}.ts; scoped-form.ts; runtime/actor-lifecycle.ts; forms/forms.svelte.ts                                | Scoped operation/form protocols, validation and dirty/reset coordination, readiness/result delivery, issued-work interruption and drain; optional Svelte attachment               | Domain validation/policy, schemas, diagnostic sinks, routes, translated feedback and page composition                                                 |
| 2     | data.ts; routes using Jazz QuerySubscription/QuerySubscriptionOne; runtime/observations.ts; domain query definitions                                                                     | Modest typed mutation/observation boundaries with explicit local availability, revisioned facts, subscription disposal, local settlement and later rejection; named Jazz adapters | Native schema/query expressions and mapping, financial operations and permission rules; no portable schema/query compiler                             |
| 3     | machines/workspaces/workspace-initialization.ts and workspace-startup.ts; runtime/readiness.ts; schema/identity.ts provenance                                                            | First-workspace lifecycle, provenance decisions and initialization/replacement coordination behind supplied leaf capabilities                                                     | Deterministic app IDs, financial starter bundle, migrations, fake-data policy and server-specific integration                                         |
| 4     | machines/workspaces/workspace-creation.ts, workspace-creation-operation.ts, workspace-creation-journal.ts and workspace-creation-reconciliation.ts                                       | Remaining explicit-attempt ownership, durable journal lifetime and uncertain-write recovery, composed with the existing shared creation transaction                               | Finance-specific journal payload/schema migration, category reconciliation and application persistence mapping                                        |
| 5     | machines/identity/profile.ts and profile-avatar.ts; components/identity/ProfileNameForm.svelte, ProfileAvatarForm.svelte and Avatar.svelte; session-recovery.ts; runtime/jazz-session.ts | Existing reusable profile editing and remaining identity transition/lifecycle composition, using earlier shared form/data/session boundaries                                      | Profile storage mapping, app navigation and coordinated financial drains; generic image controls belong in DUI and require their own ownership review |
| 6     | Existing Finance test harnesses, package consumers and adopted subpaths                                                                                                                  | Reconcile documentation, audit remaining SDK dependencies, provide next-app integration recipes and qualify the extracted paths independently of Finance models                   | Hosting routes, PWA/update policy, app deployment and product-specific defaults                                                                       |

The complete remaining batch is implemented on these branches. Existing behavior is parameterized
behind typed inputs rather than replaced with a new framework. Finance remains a native Jazz
consumer; its schemas do not migrate to a portable model.

## Local-first invariants

- Existing local records and locally known authorization keep ordinary work usable without a remote
  response. Optional seeding, provenance repair and reconciliation do not gate unrelated local work.
- Unknown, failed, loading and confirmed empty observations stay distinct. Copy observed row fields
  at the integration boundary where Jazz mutates records in place; preserve opaque binding identity.
- An empty/partial replica never proves a new identity or permits automatic bootstrap/restoration.
  Retain any explicit authoritative discovery needed for provenance without adding it to startup's
  locally usable path. Do not replace all remote tiers mechanically.
- Keep local durability, remote acceptance, later rejection and unknown settlement separate. Preserve
  operation identity; do not retry uncertain writes automatically or claim cancellation rolled back
  an issued update. Drain before stopping owners or replacing bindings.
- Preserve one atomic settings/bundle write where Finance relies on it. Do not introduce competing
  sessions, subscriptions, selection owners or startup effects while old/new modules coexist.
- Keep existing strings, CSS and control composition unless a specific reviewed extraction needs a
  change. Catalog/config/generated localization edits or regeneration require explicit permission.

## Extraction milestone acceptance

For each row, record implemented exports, actual Finance adoption, retained app integration, relevant
unit/backend/browser evidence and remaining SDK calls. Completion requires an evidence-backed audit
of all listed reusable responsibilities, not just marking a document checklist. If a candidate is
app-specific, record the concrete reason it remains in Finance rather than adding it to the library.

The next app must be able to establish/resume identity, recover it, manage local workspace
initialization/creation/selection/naming, use existing profile editing where needed, and build typed
scoped forms/read/write observations without importing Finance code. Supply an integration recipe
and a small domain-free package fixture using its own record/policy shape. This fixture is extraction
verification; it does not require building a new product or finishing the full independent MVP demo.

Qualify adopted paths with focused unit/package/backend checks and real Finance interactions. Changes
to startup/data/persistence must include cold offline and open-but-unanswered-connection checks with
retained storage. Locally acknowledged writes must survive closing every client and reopening.
No user's dev environment or storage may be reset. Preserve tests for existing financial behavior
at each affected boundary; broad suite execution needs a concrete shared-impact justification.

No universal promise that all records are downloaded, fresh remote authorization, background
acquisition engine, binary storage subsystem or second backend is introduced by this milestone.

## Later phase: features not implemented in Finance

After the extraction milestone, return to invitations, acceptance/rejection/expiry, member and role
administration, any other unimplemented workspace-access behavior, the full independent MVP consumer
and remaining release qualification. Existing role/grant enforcement is extraction evidence; it is
not proof that invitation or administration workflows already exist. Finance is not required to gain
these product features before another app can consume the extracted foundations.

## Implemented extraction audit

| Inventory group         | Public exports and Finance adoption                                                                                                                                                                                                                                                                                               | Consumer-owned remainder and reason                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms and shutdown      | `forms/contracts`, `readiness`, `submission`, `write`, `workflow`, `policy`, `svelte`, `lifecycle`, `feedback`; Finance's existing factories now delegate to these graphs. `forms/content`, `feedback-view`, `modal` replace duplicated presentation.                                                                             | Finance Zod validation and Paraglide callbacks, field snippets/icons and diagnostics are injected. No validator, catalog or global theme is imposed.                                                                                               |
| Data                    | `data/observations` supplies row snapshots and a revisioned loading/failed/available contract. `backend/jazz/data` supplies typed subscriptions with explicit LocalFirst default, issue receipts and local settlement. Production Finance foreground subscriptions adopt this path; naming adopts the receipt/settlement helpers. | Native query/schema expressions and financial writes stay in their application integration. This is a named v1 SDK boundary, not a portable query compiler or all-record acquisition engine.                                                       |
| Initialization          | `workspace/initialization`, `workspace/startup`, `workspace/startup-contracts`; Finance supplies native discovery/preparation, bootstrap transaction and seed actors.                                                                                                                                                             | Deterministic IDs, financial starter categories, permissions, sample-data policy and legacy schema migration remain Finance-specific. Readiness does not await optional seeding.                                                                   |
| Creation/recovery       | `workspace/journal`, `creation-owner`, `creation-operation`, `creation-persistence` compose existing `workspace/creation/workflow`; Finance binds its payload parser and native reconciliation/transaction.                                                                                                                       | Complete organization/member/system-category matching and native staging map Finance's exact schema. Journal database name/store/version and payload remain unchanged. App projections map their attempt into the existing shared creation dialog. |
| Profile/identity        | `profile/contracts`, `workflow`, `avatar`, `name-view`, `avatar-form`, `avatar-view`; `recovery/coordination`; `backend/jazz/startup`. Finance delegates profile policy/resource ownership, restoration coordination and retained session acquisition.                                                                            | Host-owned navigation/draining, image processing/cropper and native profile persistence are supplied capabilities. Generic image tooling belongs in DUI/platform integration.                                                                      |
| Independent consumption | `docs/next-app.md`, built public type/import/Svelte consumer fixtures, domain-free initialization/profile/observation coverage and existing domain-free form/selection/naming/creation fixtures.                                                                                                                                  | No Finance imports, financial schema, catalogs or credentials are required to consume the library. Invitations/member administration remain the later phase above.                                                                                 |

### Statechart and SDK audit

The extracted graphs retain readiness assessment and revision correlation; validation/operation
interruption drains before cleanup; write settlement distinguishes not-started, local, confirmed and
unknown outcomes. Initialization reads local provenance first and only discovers authority when
provenance is insufficient. Startup reports ready independently of optional seeding. Creation owns
validation → preparation → durable journal → local reconciliation → persistence → journal cleanup;
its transaction child owns commit/rollback/settlement. The journal owns IndexedDB open/acquire/read/
stage/transaction completion/close. Profile owns image processing/byte validation/write/resource
cleanup. Restoration coordinates validation, host drain, restoration and navigation facts. Supplied
async capabilities remain leaf obligations, recursively reviewed at the consumer boundary.

Shared machine/contracts/presentation modules contain no native Jazz imports. SDK access is named
under `backend/jazz/*`; native schema/query building is intentionally consumer-owned for v1.
Finance's direct SDK imports retained in foundation-adjacent code are native storage transaction
adapters, schema-bound reconciliation and legacy attribution repair, explicit authority reads,
getDb/session context binding and type-only signatures. `workspace-integrity*` specifically repairs
Finance's historical profile/member attribution using its owner/admin/account-access policy;
`workspace-navigation` and runtime readiness bind app URLs and selected ledger/bank resources. These
are app integrations, not prerequisites for another app to consume the extracted workflows.

### Verification

Qualified on 2026-11-02 in isolated Finance storage/checkouts:

- Library: 331 unit tests in 19 files pass; the final registry fixture refinement also passes its
  focused two tests. Strict TypeScript/Svelte checks, lint, formatting, public declarations, publint,
  built public consumer types/ESM execution/Svelte bundle and static Storybook build pass.
- Finance: 1,761 unit tests in 126 files pass against the extracted workflows. After adding retained
  registry ownership, its five Finance binding tests pass against the final vendored artifact.
  Final source and test types pass with zero Svelte diagnostics.
- Finance browser: all 16 focused form/profile/recovery/naming checks pass. Workspace coverage
  exercises 73 scenarios: 72 passed initially; one account-form scenario exposed a helper returning
  before async selection completed. The helper now awaits requested URL and selected value; the
  unchanged account scenario passes with tracing. No timeout increase or assertion removal.
- Final production artifact: both cold full-client-exit scenarios pass, offline and with an open
  remote connection that never answers. Existing local data remains usable; locally acknowledged
  saves, combined name/currency settings and selected workspace survive closing all clients and
  reopening again. Ordinary use has no remote preflight.
- Finance generated localization is byte-identical across original and isolated checkouts. No
  catalog/config/generated localization edits or regeneration. The final vendored package excludes
  tests, its lockfile integrity matches, and superseded library archives are removed.

This completes extraction of the existing reusable Finance responsibilities listed above. The next
phase is the product behavior not implemented in Finance, rather than more extraction prerequisites.
