# Expense overview

## Requirements

The overview displays a LayerChart pie chart of expense amounts by category and an
adjacent list reusing TransactionListItem. Both respect the active workspace and
selected accounts. Start/end calendar-date inputs include both boundary dates.
Last 7 days and Last 30 days set the range through today, including today; the
initial range is 30 days. Invalid or missing bounds display localized feedback.
Selecting a slice or its keyboard-accessible category button narrows the list;
selecting again or All categories clears it without changing the chart totals.
Date/currency/account/workspace changes clear category selection. Show category
amounts and the period total, include historical/uncategorized categories, and
separate currencies rather than adding unlike amounts. Zero amounts remain in the
list and legend but do not create slices. Use a cohesive categorical palette in OKLCH with shared perceptual lightness and
chroma, starting near the existing green and distributing additional hues by the
golden angle rather than cycling a fixed set of green/red shades. Use
localized labels, existing transaction links, and a stacked mobile layout.

## Design and machine-first gate

The overview page owns organization-scoped Jazz subscriptions and account filtering.
ExpenseOverview is pure presentation with props, local date/category/currency input
state and synchronous derived filtering/aggregation. No async workflow, resource
acquisition, writes, authorization decision, or new actor is introduced. Existing
QueryContent owns loading/error rendering and Jazz continues enforcing read access.
Use integer minor amounts for sums. Color identities are category-based within the
current workspace/account observations. Native legend buttons provide an equivalent
keyboard selection path for chart slices.

## Review checklist

- [x] Implement dependency, overview integration, chart, filters and reused list rows.
- [x] Add localized strings and align requirements/design in this note.
- [ ] Review implementation with user.
- [ ] After approval, add unit coverage for dates/category totals and Playwright
      coverage for presets, slice/legend filtering, scope changes, empty/invalid
      ranges, currencies and responsive presentation; run relevant checks.

Static checks do not establish browser behavior; automated tests await review.

## Segment resizing

ExpensePieChart composes LayerChart Chart/Group/Arc with Svelte Spring.
Date changes retain the chart and a stable category order; one vector of shared
angular boundaries interpolates between normalized category totals. Categories
absent from a period retain a zero-sized slice so they can shrink/grow. Spring is the approved animation; reduced motion updates instantly. Temporary
animation preview controls and alternate engines have been removed. This adds only local presentation motion, no actors or
async business workflow. Runtime verification remains pending implementation review.

## Pure presentation components

DateRangeFilter receives start/end values and change/preset callbacks. CategoryLegend
receives category amounts/colors, selection, currency, reset label, and callbacks.
TransactionItems receives transactions, category/tag names, and a transaction-link
callback, and composes the existing TransactionListItem. These components contain
no Jazz subscriptions or actors. ExpenseOverview retains synchronous aggregation
and local filter/selection state, composes these controls and ExpensePieChart, and
owns the responsive layout. The spring and stable category ordering are preserved.
This focused refactor awaits implementation review before automated coverage.

## Approved focused verification

The user approved testing after the pure-component refactor. Four component tests
pass in `expense-overview.test.ts`: inclusive initial dates and excluded outside
bounds, integer totals and currency separation, zero/empty/historical category
handling, and accessible legend selection. Two Playwright tests pass with
`playwright.expense-overview.config.ts` on disposable port 5182: presets/manual
ranges, category and slice selection/reset, currencies, invalid/empty ranges,
retained arc nodes with geometry changing across spring animation frames,
desktop/mobile layout and horizontal overflow, and reduced-motion interaction.
`tsc --project tests/tsconfig.json --noEmit` passes. Workspace replacement and
permission-loss scenarios remain outside this focused browser run.

## Shared localization conventions

The overview reuses plural nouns and generic labels from the localization memory.
“All categories” uses `labels.all_subjects` with `nouns.category`; the heading uses
`labels.subjects_by_subject` with expense/category nouns. The currency control reuses
`labels.currency`. Date bounds use `labels.start_subject` / `labels.end_subject` with
`nouns.date`. Date choices use `labels.last_week`, `labels.last_month`, and
`labels.custom`, retaining the inclusive 7- and 30-day preset ranges. The total uses
`labels.total_subject_amount`,
including the formatted amount inside the message rather than appending punctuation
and money in the template. Period headings and empty-state copy also interpolate the
expense noun. The chart explanation retains its context-specific message, and date
validation uses `errors.date_range_invalid`.
