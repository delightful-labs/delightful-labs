# Finish extracting existing Finance foundations

## Delivery decision

The user directed on 2026-11-02: finish extracting reusable behavior already implemented in Finance
so the next app can use it; implement features missing from Finance afterward. This changes delivery
order, not the full MVP requirements. Invitations, member administration and other new product
behavior must not gate the extraction milestone. Each implementation still follows focused review,
then approved coverage and Finance adoption. No full Finance rewrite or schema conversion is needed.

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

Rows are responsibility groups, not single giant implementation batches. Design contracts/statecharts
first, inspect every leaf recursively, present small changes, then update fixtures and run only
relevant checks after approval. Move working behavior rather than replacing it with a speculative
framework. A generic wrapper that merely relocates SDK calls does not complete a boundary.

The next implementation slice is the shared scoped-operation/form contract and its readiness
ownership design. Finance's generic form machinery is a real dependency of naming, profile and
ordinary data writes. Its feedback currently imports Finance Paraglide messages, so extraction must
use caller-supplied descriptors/messages rather than copying catalogs or introducing a global locale.
Actor shutdown is part of that ownership design, not an excuse to move all lifecycle code at once.

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

## Current review boundary

This audit updates delivery scope and the public contract inventory only. No implementation, test,
localization, SDK dependency or Finance source changes are included. Do not interpret the inventory
as evidence that these extractions are already implemented or that existing SDK access is portable.
