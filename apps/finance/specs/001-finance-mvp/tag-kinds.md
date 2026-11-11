# Tag kinds and duplicate-name implementation design

Status: required storage kind and removal of legacy permission compatibility reviewed and verified. Previous compatibility verification is historical.

## Behavior

New tags require `kind: 'expense' | 'income'`, whether created in settings or
inline with a transaction. Their optional category must belong to the same
organization and kind. Active tag names are unique within organization + kind,
using the same `normalizedName` helper as accounts and categories. A tag may
share its name with a category or with a tag of the other kind.

Settings must expose the kind selector and distinguish same-name income and
expense tags in the list. Changing kind filters category choices and clears a
selected category that no longer matches. The machine independently rejects an
incompatible submitted category.

## Required-kind alpha policy

The user approved requiring `kind` in the storage schema and removing untyped-tag
compatibility. Every stored tag must have an explicit expense/income kind, with
no default. New tags and assignments must enforce same-workspace and matching-kind
references at the Jazz permission boundary, including direct SDK writes.

The earlier nullable-column compatibility policy and proposed legacy assignment/
splitting migration are superseded. Alpha data is disposable; preserving or
inferring old untyped tags is not part of this design. Changing the source schema
does not reset an existing database. No data reset, remote deployment, or rewrite
of migration history is performed in this focused implementation.

Before applying the stricter schema to an existing environment, its schema/data
transition must be handled explicitly. The old additive migration and snapshots
remain historical artifacts, not the required-kind definition for a fresh store.

Tag updates retain role authorization, same-workspace/category-kind checks, and
immutable workspace/kind. There is no null-kind update exception. Archived typed
tags and their historical assignments remain readable/removable under existing
permissions; new assignments require an active typed tag of the transaction kind.

## Ownership and state model

The existing scoped form owner retains reset, close, cancellation, scope change,
and issued-write settlement behavior. No new lifecycle flags or custom actor
bridges are needed.

Management integration owns current tag/category subscriptions. Its assessment
intent includes submitted tag name, kind and optional category ID. The management
machine first applies existing readiness and authorization guards, then rejects
an unavailable or mismatched category, then takes a `duplicateName` guarded
transition or becomes ready. Presentation renders the typed outcome and preserves
form values.

Transaction integration observes current active tags for its organization and
kind. The transaction machine checks account/category authorization first, then
assesses each submitted normalized tag name. Exactly one matching active tag is
reused; no matching active tag means inline creation; multiple matching active
tags produce an explicit ambiguous-name outcome. Other-kind tags are not candidates. Archived names may be reused by a new active tag. Reusing a tag
does not change its category.

The database transaction retains a narrow compare/write check against current
organization + kind + normalized name, and inserts new tags with transaction kind
and category. It must not silently choose an arbitrary duplicate or assign a tag
of another kind. Changes between assessment and commit must fail safely. These
local checks do not guarantee uniqueness across disconnected replicas.

## File scope

The coordinated implementation touches schema/tags.ts,
validation/tags.ts, management-contract.ts, machines/management.ts,
components/TagForm.svelte, components/TagList.svelte, settings/tags/+page.svelte,
transaction-entry-contract.ts, machines/transaction-entry.ts,
components/TransactionEntry.svelte, data.ts, and localization as needed. Reuse
existing name normalization and form feedback. Adjust the canonical spec, plan,
and task status to record the accepted compatibility policy.

No existing data has been rewritten or deployed as part of this batch. Schema
migration generation must follow the repository's Jazz workflow, with generated
artifacts reviewed separately if they significantly enlarge the batch.

## Verification after implementation review

Unit coverage must include settings guards for same/other kind, organization,
case/whitespace, archived names, mismatched categories, and stale observations.
Transaction coverage must exercise single-tag reuse, inline creation, ambiguous
names, archived-name reuse, and kind/category persistence. Browser coverage must
exercise both income and expense settings and transaction entry, retained form
values after duplicate feedback, and retained history for archived typed tags. Direct SDK coverage must reject
missing/null kinds, mismatched category kinds/workspaces, mismatched assignment
kinds/workspaces, and changes to immutable kinds/workspaces. Accept valid expense
and income tags with optional matching categories. Update existing fixtures to
provide required kinds and replace the historical untyped-tag tests. Do not add or run tests before implementation review.

## Historical compatibility implementation review notes

Settings guard duplicate active names and mismatched category kinds. Transaction
entry has an explicit `checkingTags` state and `ambiguousTagName` outcome; a single
matching tag is reused by the atomic writer, and an absent active name creates a
new typed tag. Archived names can be reused. Historical displays and link IDs
remain unchanged. The local Jazz migration was generated and reviewed: it adds
nullable `tags.kind` with a null default, preserving all old rows and associations.
The migration and snapshot are prepared locally and have not been deployed.

After implementation approval, canonical validation and persistence expectations
were updated, including archived-name reuse. All 136 focused unit tests and all
three isolated browser scenarios pass, along with application/service-worker and
browser-test type checks and focused formatting/whitespace checks. Browser
verification required fixture/locator corrections and no production changes.
See tasks.md for historical coverage and limits. Existing-tag reassignment/splitting
is superseded by the required-kind alpha policy above. Remote schema deployment
is not part of this implementation.

## Required-kind verification

After user approval, 177 focused tests pass across SDK permissions, canonical tag
validation, management, transaction readiness and create/edit persistence. The
12 direct permission tests also pass in isolation against the SDK test authority.
Missing/null storage kinds reject SDK inserts and null-kind updates; valid typed
tags remain accepted. Category kind/workspace mismatches, tag workspace/kind
changes, and cross-kind/workspace assignments reject. Archived typed tags retain
historical links and permit removal while rejecting new assignments.

Three focused permission browser scenarios pass on disposable in-memory Jazz at
port 5180, and the updated typed-tag selection/inline-creation/archived-history UI
scenario passes on disposable port 5184. The UI fixture now uses archived expense
history and current income routes and post-save navigation assertions. Older
workspace-test tag fixtures now specify their category kind (or explicit expense
kind when uncategorized); browser-test type checking covers those fixture changes,
but the full workspace browser suite was not rerun. Application/service-worker
and browser-test type checks, focused formatting and whitespace checks pass.
No existing data was flushed, no schema was deployed, and no commit was made.
