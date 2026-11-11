# Income and expense page cleanup

## Focused scope

Centralize transaction kind constants, collection paths and localized noun descriptors.
The transaction layout resolves its kind and presentation once, passing the heading
and list path into its children. The create integration uses the same descriptors
for its title and cancellation path. Retain existing query parameters, pagination,
workspace scoping and income/expense noun forms.

This is a pure synchronous presentation mapping: no async steps, acquired resources,
authorization decisions or actor changes. Existing query and actor ownership remains
in integration components. Localization still runs in Svelte components.

## Review checklist

- [x] Add shared kind/path constants and typed presentation configuration.
- [x] Adopt configuration in layout, workspace, list and create integration.
- [x] User implementation review.
- [x] After approval, add focused unit coverage for exact/nested income route matching
      and configuration; inspect/update `src/routes/finance.e2e.ts` and relevant
      transaction route navigation coverage before running relevant tests.

## Recommended later cycles

- Adopt kind/path constants in route entry points, edit fallback and save redirects.
- Express income-only inline check entry as an explicit presentation capability;
  preserve existing expense check references and machine-owned validation rules.
- Replace repeated handwritten kind unions with the shared TransactionKind type.
- Build the tag-name index once in the list instead of finding a tag for every link.
- Keep schema enum and migration changes separate from this presentation cleanup.

## Follow-up implementation review

Shared constants now cover create route entry points, the edit observation fallback,
and post-save navigation. The shared presentation mapping owns a paymentEntry mode:
inline for income, preserve for expense. Create/edit integrations pass this mode
into the pure form; the form no longer chooses controls from the transaction kind.
Existing expense payment/check references remain submitted through hidden fields.
This mode is presentation policy, not authorization or validation.

The machine-first gate classifies this change as synchronous mapping plus an
existing navigation leaf operation. No new workflow, actor, resource acquisition,
or lifecycle change is introduced. The completion callback still invokes only
navigation; save orchestration and its cancellation/failure handling are unchanged.
The existing expense comparison in dirty checking uses the shared constant and
retains its prior semantics.

- [x] Adopt constants in new routes, edit fallback and save navigation.
- [x] Pass explicit payment-entry presentation mode into the form.
- [x] Review follow-up implementation before adding or running its tests.
- [x] After approval, inspect transaction-entry unit fixtures/assertions and finance,
      transaction-check and transaction-navigation Playwright coverage for income
      controls, expense reference retention and workspace-scoped save redirects.

Shared-kind adoption elsewhere and the tag-index optimization remain later cycles.

## Shared kind type review

Replace the remaining handwritten production income/expense unions with TransactionKind
in sample controls, sample integration, independent persistence plans and bank import
values/context. This changes type annotations and type-only imports only. Schema-derived
kinds remain inferred from their canonical validation/schema definitions.

The machine-first gate introduces no operation to classify: actor implementations,
helper bodies, statecharts, resource ownership and runtime imports are unchanged.

- [x] Consolidate remaining handwritten production kind unions.
- [x] Review this type-only implementation.

Affected coverage is `sample-transactions.test.ts`,
`independent-transaction-persistence.test.ts`, bank-sync `import-transaction.test.ts`,
and the transaction workspace/edit Playwright suites. Their runtime contracts remain
unchanged; no tests are added or run in this review cycle.

The tag-name index optimization remains the next focused recommendation.

## Shared tag-name indexing review

TransactionView and the overview integration now use one pure transactionTagNames
helper. Build a tag-ID index once, accumulate an insertion-ordered Set of names for
each transaction, and return arrays through the existing read-only map contract.
This removes repeated tag scans and repeated array/Set reconstruction per link.
Retain original link order, name deduplication, archived tag names and omission of
missing or empty names. Jazz row IDs are unique within the subscribed tag table.

Machine-first classification: synchronous data transformation only. No workflow,
permissions, subscriptions or actor lifecycle changes; integrations retain query
ownership and presentation receives the existing map prop.

- [x] Share tag-name indexing between list and overview.
- [x] Review implementation before adding or running tests.
- [x] After approval, cover helper empty/missing/duplicate labels, order, multiple
      transactions and renamed labels; inspect transaction-workspace.e2e.ts,
      transaction-edit.e2e.ts and expense-overview.e2e.ts for affected tag fixtures
      and assertions before running relevant coverage.

## Approved verification results

- Focused unit run: 53 tests pass across transaction-kind, transaction-tags,
  transaction-entry, sample-transactions, independent-transaction-persistence,
  bank-sync/import-transaction and expense-overview.
- Focused browser run: all 29 tests pass using
  `pnpm exec playwright test --config playwright.transaction-cleanup.config.ts`.
  Coverage includes desktop/mobile income/expense creation and cancellation,
  workspace-scoped redirects, pagination, offline samples and edits, income check
  controls, expense check-reference retention, overview filters and archived tag
  labels/renaming in both consumers.
- `pnpm exec tsc --project tests/tsconfig.json --noEmit` passes.
- Prettier and `git diff --check` pass for the test/configuration changes.

The first browser attempts failed at initialization because Vite denied externally
resolved pnpm Jazz assets. Agent-only Vite configuration now explicitly allows the
resolved Jazz WASM and worker package directories. A new test's memo selector was
also corrected to the existing localized accessible name before the passing run.
The disposable agent server remains at http://127.0.0.1:5186.

## Remaining UI kind constants review

Adopt INCOME/EXPENSE in category/tag forms and lists, sample controls, and starter
category values. Option/default/reset values, label branches and persisted defaults
retain the same strings. Tag kind input stays a string because the shared Select
binds string values. Preserve the unassigned-tag fallback and current noun forms.

This focused cycle touches six implementation files. It introduces no async work,
statechart changes, authorization decisions or message changes. Schema/validation,
permission and bank-import literal adoption remain separate follow-up work.

- [x] Replace UI/default income and expense literals with existing constants.
- [x] Review this implementation before adding or running its tests.
- [x] After approval, inspect management and workspace-creation unit coverage plus
      creation-modals, duplicate-names and transaction-workspace browser tests for
      category/tag selections, resets, starter kinds and sample action names.

## Complete domain constant adoption review

The user explicitly authorized the larger batch covering all suggested domain
constants. Keep the previously reviewed page configuration and adopt domain-scoped
values across the remaining production callers:

| Domain              | Canonical values                                  |
| ------------------- | ------------------------------------------------- |
| Transaction kind    | Existing INCOME / EXPENSE                         |
| Payment method      | PAYMENT_METHOD: CASH, CHECK, TRANSFER, ELECTRONIC |
| Transaction source  | TRANSACTION_SOURCE: MANUAL, SIMPLEFIN             |
| Organization role   | ORGANIZATION_ROLE: OWNER, ADMIN, MEMBER, VIEWER   |
| Account access mode | ACCOUNT_ACCESS: ALL, SELECTED                     |
| Account kind        | ACCOUNT_KIND: CASH, BANK, CARD                    |

New constant modules are dependency-free frozen records with derived union types;
account cash and payment cash have distinct owners. Schema/validation enums retain
value order, optionality, null handling and defaults. Account schema already derives
its kind values from canonical account validation, which now uses ACCOUNT_KIND.
Permission expressions, import assignments, UI option values, navigation links and
save/source comparisons use the shared values. No schema deployment or migration
is needed or performed. Existing historical migrations/snapshots retain literals.

Keep unrelated strings local: XState state/actor names, property paths, SDK method
names, HTTP redirect modes, archive/filter sentinels, translation keys and stable
SimpleFIN cryptographic/identity namespaces. They are different contracts even when
their spelling matches a domain value. Test fixtures retain independent literals
until their approved test review.

### Machine-first gate and implementation audit

This batch replaces literal operands and matching type aliases only; no new async
operation, acquired resource, workflow decision or actor protocol is introduced.
The existing save/check settlement, transaction rollback, authorization, cancellation,
replacement and shutdown paths remain owned by their current machines. All changed
actor bodies and helpers were compared after expanding constants and aliases back
to their original literals. The only guard expression adjustment is workspace
integrity's owner/admin membership check: use `some` equality rather than `includes`
to accept the wider observed role union without a cast. Its accepted roles and
missing-membership behavior are identical. The overview URL template now interpolates
the existing expense path constant. No hidden orchestration was added.

### Review and verification

- [x] Adopt every suggested domain constant group and remaining production callers.
- [x] Preserve enum order, permissions and actor behavior in static diff review.
- [x] Compile localization and pass `pnpm check` with zero errors/warnings.
- [x] Review this complete implementation before adding or running its tests.
- [x] After approval, inspect validation account/category/tag/identity/transaction
      unit suites; permissions, check-reference and organization-permissions suites;
      workspace creation/integrity/rename, account creation, bank import, transaction
      entry/save and independent persistence suites. Keep independent literal
      expectations that verify persisted contracts.
- [x] After approval, inspect the transaction cleanup browser suites plus creation
      modals, permissions and bank-sync scenarios before selecting relevant runs.

The earlier 53-unit/29-browser result applies to the preceding committed change,
not this larger adoption batch. No tests have been added or run for this batch.

## Domain adoption test review

The user approved verification of the complete adoption. Existing unit fixtures and
browser assertions use independent literal values for persisted contracts and
expected authorization outcomes. Inspection found no contract drift requiring
fixture changes. Retain those literal expectations rather than importing the
constants under test or adding assertions that merely mirror each constant record.

The focused unit run covers 29 suites (460 passing tests): account/category/tag/
identity/transaction validation, permissions and Check references, organization
permissions, starter workspace data, workspace creation/integrity/rename, account
creation/access, management, transaction entry/save/persistence, bank imports,
sample transactions and transaction page configuration. Test TypeScript checking
also passes.

The cleanup Playwright configuration now includes creation modals, duplicate-name
rules, permissions and bank sync alongside its original transaction and overview
suites. All scenarios reuse the isolated port 5186 server. The initial browser
attempt stopped on app startup because unit tooling had regenerated shared
SvelteKit environment files with an empty Jazz URL. Restarting only the known
agent server restored the runtime configuration before the subsequent run.

Final browser result: all 74 scenarios pass (4.4 minutes), including all seven
selected browser suites. No production corrections or test assertion changes were
needed. Formatting and `git diff --check` pass. The disposable agent server remains
available at http://127.0.0.1:5186. These results apply to the complete domain
constant adoption, superseding its earlier pending-verification status.
