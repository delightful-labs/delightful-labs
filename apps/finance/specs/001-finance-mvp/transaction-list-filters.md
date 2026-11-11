# Transaction list filters and search

## Requirements

Expense and income lists support inclusive start/end dates, the overview's Last 7
days and Last 30 days presets, category, currency and text search. Initially all
dates, categories and currencies are included. Show the currency filter only when
the account-scoped list contains more than one currency. Empty date bounds are
open-ended; reversed bounds show the existing date-range error. Search ignores case and extra
whitespace and requires every word to occur across description, memo, category
name or tag names. All controls combine, within the existing workspace and account
scope. Filter before grouping, daily totals and pagination; changes reset page 1.
Filters live in URL query parameters so pagination and reloads retain them.

## Design

TransactionView retains Jazz subscriptions and URL binding. TransactionListFilters
is pure presentation and reuses DateRangeFilter. The synchronous filter helper
has no persistence, authorization, asynchronous workflow or acquired resources;
the machine-first gate does not require a statechart for this transformation.
Transfer-pair lists and the overview remain outside this focused implementation.

## Review and verification

- [x] Implement filtering, controls and expense/income integration.
- [x] Approve search localization: `actions.search_subject`, “Search {subject}”.
- [x] Review implementation before adding or running tests.
- [x] After approval, add filter-helper unit tests for boundaries, combined filters,
      whitespace/case, multiple search terms and missing optional text.
- [x] Inspect `tests/features/transaction-list.e2e.ts` and update
      `tests/transaction-workspace.e2e.ts` for filters, presets, pagination reset,
      daily totals, retained URL state and mobile controls.

Five filter-helper unit tests and eight Playwright tests pass. Four new browser
cases cover expense/income filters at desktop/mobile sizes, combined text fields,
dates/category/currency, filtered totals, presets, invalid ranges, empty results,
pagination reset/retention, reload retention and mobile overflow. Four existing
regressions cover empty lists, account/workspace changes, historical category/tag
names, currency totals and drawer pagination through selection/creation/reload.
Browser verification uses the disposable agent server at port 5186.
Svelte checking reports zero errors and warnings; test TypeScript checking,
Prettier checking and `git diff --check` pass.
Browser coverage uses real-clock relative dates and USD/TZS accounts,
matching the current account schema. Category and currency controls use the shared
`actions.filter_subject` message so their names distinguish them from editor fields.
SvelteKit shallow URL observations use `page.shallow?.url ?? page.url` so filtering
and pagination update immediately after a shallow query change.

## DUI control correction

The search field now uses DUI InputText with type search; category and currency
use DUI Select. DateRangeFilter already uses DUI InputDate and Button. The
fieldset resets its native border, margin, padding and minimum inline size; legend
padding is also reset. Accessible control names and callbacks remain the same.
After user approval, eight unit tests pass, including three component cases for
zero, one and multiple currencies. All four expense/income filter browser cases
pass at desktop/mobile sizes using the DUI controls, including single-currency
filter absence, multiple-currency visibility, the fieldset border/spacing reset
and mobile overflow assertions. Svelte checking reports zero errors and warnings;
test TypeScript, formatting and diff checks pass. The earlier four existing list
and drawer regression results above precede this presentation correction.

## Composable radio date choices

Implemented follow-up: use the merged DUI RadioGroup and RadioItem for Last 7 Days,
Last 30 Days, and a custom date range in the shared DateRangeFilter. Only the
custom choice reveals the existing start/end inputs. Presets retain inclusive
calendar-date calculations and the current callbacks; custom selection prefills
the active bounds without changing the effective range. Empty bounds continue to
mean unrestricted transaction dates. The overview keeps its initial 30-day range.

Keep the selected choice in sync with externally supplied bounds and retain an
explicit custom choice while editing, even when the bounds match a preset. This
is local input/disclosure state in the pure DateRangeFilter; it introduces no
async workflow, actor, Jazz subscription, authorization decision, or persistence.
The existing URL and overview session storage continue owning the actual bounds.

Use the packed DUI snapshot from merged UI PR #14 and remove the superseded
archive. The date choices now use `labels.last_week` (“Last week”),
`labels.last_month` (“Last month”), and `labels.custom` (“Custom”). The previous
custom and counted-day messages, including their unused day noun, have been removed.
Paraglide regeneration is authorized; other labels reuse existing messages.

Review checklist:

- [x] Create an isolated Finance worktree and feature branch.
- [x] Update the vendored DUI dependency and its lockfile peer reference.
- [x] Approve the custom-option localization and Paraglide regeneration.
- [x] Implement the shared radio choices and conditional date fields.
- [x] Review implementation before adding or running tests.
- [x] After approval, update the filter rendering/overview rendering cases and
      transaction-workspace/expense-overview browser scenarios for radio roles,
      conditional fields, preset dates, custom edits, retained bounds, and mobile
      layout; run only the relevant checks.

Implementation review: DateRangeFilter alone composes the three radio items and
conditionally renders the existing date inputs. Its derived choice recognizes
both presets from the supplied bounds; local snapshots retain the observed and
requested custom bounds while the parent propagates input changes. This keeps
the fields mounted and focused, including when edited dates match a preset. Selecting
custom only opens the inputs; it does not change the date range or reset other
filters. Preset callbacks and custom input callbacks retain their existing owners.
No actors or actor helpers changed. The user approved implementation and testing.

Affected coverage inspected and updated after approval:

- `src/lib/components/filters/transaction-list-filters.test.ts`: add radio and
  custom-field disclosure assertions alongside the existing currency coverage.
- `src/lib/components/reports/expense-overview.test.ts`: the default 30-day range
  now appears as a checked radio rather than date-input values; retain boundary
  filtering and financial-total assertions.
- `tests/transaction-workspace.e2e.ts`: replace preset button locators with radio
  locators, assert range state through the URL while fields are hidden, select
  custom before editing bounds, and cover desktop/mobile disclosure and reload.
- `tests/expense-overview.e2e.ts`: update preset roles, open custom fields before
  manual edits, and verify restored preset selection and retained actual dates.
- `src/lib/filters/transaction-list-filters.test.ts`: pure filtering logic is
  unchanged; inspect it as a related boundary-regression check after approval.

Static validation passes: Paraglide generation, application/Svelte checks (zero
errors or warnings), service-worker TypeScript checks, production build, focused
source/catalog/package formatting, and diff whitespace checks. The isolated
in-memory review server is running at `http://127.0.0.1:5192`.

Approved verification passes: 20 unit tests in the date-range controls, transaction
filter controls, expense overview, and pure transaction-filter suites; seven
Chromium browser scenarios cover three overview flows plus desktop/mobile expense
and income list filtering. Coverage includes preset selection and keyboard
navigation, hidden/revealed date fields, custom focus retention when dates match
a preset, inclusive range results, URL reload, overview navigation persistence,
invalid/empty ranges, category/currency interactions, and mobile overflow.
Test TypeScript checks, E2E scope audit, focused formatting and whitespace checks
also pass.

The browser checks caught and verified a custom-input remount/focus bug during
URL-bound date propagation. The disclosure now recognizes both the current and
just-requested custom bounds, keeping the active field mounted during updates.
Unit/static preparation also replaces SvelteKit's generated Jazz connection
settings; the isolated agent was refreshed after those checks before the final
browser run. The user's development server and data were not changed.
