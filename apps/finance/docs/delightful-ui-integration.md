# Delightful UI integration trial

The Finance integration uses a packed local Delightful UI 0.0.24 archive in `vendor/`, consumed through a relative file dependency. It is a snapshot of the library source at packing time, not a published release or a live link. Repack explicitly to trial later library changes. Keep only the archive referenced by `package.json` and `pnpm-lock.yaml`; remove superseded DUI archives in the same change. Git history retains previous snapshots. Historical archive names below describe earlier integrations and are not current dependencies. Svelte must satisfy the library's ^5.57.2 peer requirement.

The full global theme is imported once in the root layout. Its default light colors, typography, control styles and focus treatment are approved for this trial. The existing responsive shell remains the application layout. Shared forms use grid/flex gap for layout spacing: 0.5rem between fields and 1rem between field, action and feedback groups. Use gap rather than padding or margin for spacing between sibling controls; padding remains appropriate inside controls. Empty groups are hidden and feedback paragraph margins are reset so they do not add incidental spacing. Buttons use the library defaults and explicit native types.

## Finance presentation extraction — complete (2026-11-03)

The agreed extraction batch is merged in both repositories:

| Shared presentation                            | DUI PR                                                          | Finance adoption PR                                                   |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| NavigationLink, NavigationGroup, DrawerSection | [#9](https://github.com/delightful-labs/delightful-ui/pull/9)   | [#47](https://github.com/delightful-labs/delightful-finances/pull/47) |
| LoadingContent                                 | [#10](https://github.com/delightful-labs/delightful-ui/pull/10) | [#48](https://github.com/delightful-labs/delightful-finances/pull/48) |
| LinkedListRow                                  | [#11](https://github.com/delightful-labs/delightful-ui/pull/11) | [#49](https://github.com/delightful-labs/delightful-finances/pull/49) |
| FloatingActionLink, FloatingActionButton       | [#12](https://github.com/delightful-labs/delightful-ui/pull/12) | [#50](https://github.com/delightful-labs/delightful-finances/pull/50) |

DUI owns generic presentation and native control behavior. Finance retains routing/query
resolution, selected-route policy, localization, financial formatting, data and workflow state.
Floating actions are separate native link and button components with native attributes and
children; their shared presentation frame is private. No combined Omit/never link/button API
is part of the accepted interface.

The user closed this extraction batch. SplitRow, selectable legends, and photo-cropper/image-editor
extraction are not planned tasks. Keep them in Finance and reconsider only when another app has
a concrete need. The earlier app-specific candidate the user chose to skip remains excluded.
This completion does not close unrelated historical review or accessibility-verification work.

## Integrated controls

Account, category, workspace and transaction forms use InputText, Select, InputDate, Textarea and Button where applicable. Login uses Textarea and Button. Account recovery now uses the packed Delightful Local First composition, backed by the same DUI controls and host Jazz session. Backdrop dismissal, Close, and Escape clear the phrase; there is no saved-phrase checkbox. See [recovery adoption](local-first-recovery-adoption.md). Sidebar workspace/account filters use Select and Checkbox; account archiving uses Button. Query loading and startup use LoadingSpinner with translated labels. Query loading keeps its visible message and one status announcement.

Native field names, IDs, validation, FormData collection and the shared Form/XState workflow are retained. Amounts remain decimal text parsed by Finance into integer minor units. Dates remain date-only strings. Payment-method attachment forwarding initializes conditional check fields when the select mounts; native callbacks update them when it changes. Initial/reset defaults use defaultValue without parent bindings; workspace naming retains its reactive value prop so external name updates remain visible. No Jazz, permission, persistence or domain-schema changes are part of this trial.

The trial started from committed Finance HEAD, excluding uncommitted business-logic work. Before merging, retain the concurrently committed category settings route, navigation and business behavior from main; CategoryForm is already migrated. New components authored by the business-logic agent are outside this UI trial.

## Original component proposals

These proposals were recorded during the first trial. The second adoption batch below now implements the corresponding library primitives at selected call sites. Finance-specific parsing, permissions and translated text stay in the application.

### Currency entry

TransactionForm needs decimal input mode, a currency label, a pattern and reliable native submission/reset behavior. A currency-entry composition could standardize presentation and device/custom keyboard selection while keeping decimal drafts and integer-money conversion application-owned. InputNumber would change the value contract and is not used. NumberKeypad already exists; wiring its editing/focus workflow is deferred.

### Field feedback

Form exposes Zod issues, but individual fields currently have only aggregate validation feedback. A reusable field help/error interface could provide linked descriptions and invalid states across InputText, Select, InputDate and Textarea. TagInput already has an analogous help/error API. Any future adapter must map issues in Finance without making the library depend on Zod or XState.

### Status feedback

QueryContent and forms repeatedly render loading, success and error messages. A StatusMessage primitive could standardize visible messages, optional spinner and status/alert semantics without duplicate live announcements. LoadingSpinner alone hides its status text, so QueryContent composes a visible paragraph with an aria-hidden spinner today.

### Tables

AccountList and TransactionList use semantic native tables. A small DataTable presentation component or shared table tokens could provide responsive overflow, caption/header styling and row actions. Jazz querying, sorting, currency formatting and archive permissions remain caller responsibilities. No table behavior is introduced in this pass.

### Navigation

AppShell combines native links, workspace selection and account checkbox filters. Shared navigation/layout primitives or tokens could improve consistent spacing and selected-link presentation. Routing and workspace state remain application-owned; do not replace navigation links with action buttons.

## Review and validation

Validation passed: library packaging/publint, Finance production build, Svelte/application/service-worker static checks (zero errors or warnings), changed-file Prettier checks and git diff whitespace checks. After user review, 89 focused unit tests and all 27 integration browser scenarios passed, including native FormData/reset defaults, reactive category choices, income check-field visibility, decimal/date preservation, workspace filters, recovery/restore, archive permissions and modal dismissal. The modal regression covers Close, Escape, backdrop and confirmed completion, content removal, checkbox reset, clicks inside and focus return. Use `pnpm exec playwright test --config tests/config/playwright.integration.config.ts` with the isolated dev server on port 5180. The category Select is keyed by default category ID to handle workspace query updates; ordinary category-list updates preserve explicit selections. Run static/build checks before browser checks, because generated-manifest updates reload active pages.

## Second component adoption — reviewed and verified

This review batch starts from committed Finance main at 08e219b in the separate feat/ui-components-round-two worktree. Refresh the local package snapshot from Delightful UI c9423b0 without publishing a release. Adopt StatusMessage in query/form/list feedback; FieldFeedback and InputCurrency in transaction entry; Table in account listing; Navigation and Drawer in the shell; InputImage in avatar upload. Preserve Jazz, permissions, form actors, validation and persistence. The grouped transaction list remains a date-grouped list rather than being converted into a table.

The shell uses inline space-reserving navigation on wide screens and modal overlay navigation at or below 48rem. Toggles expose expanded/control relationships; inline navigation remains open on link selection, while overlay selection dismisses it. Native dialog supplies modal focus/background behavior. Mode changes close the drawer; users can reopen it with the persistent toggle. Field errors use translated Finance messages with caller-owned issue mapping and aria-describedby/aria-invalid; raw Zod messages are not shown. Avatar selection preview/removal belongs to InputImage, while saved-avatar removal remains the existing application action.

Implementation review uses package validation, application/service-worker checks, build and formatting. After user approval, 110 focused unit tests and eight browser scenarios pass. Library component test results do not establish Finance integration coverage.

The updated archive is `vendor/delightful-ui-0.0.24-sidebar-height.tgz`, built from UI commit `c9423b0` plus the approved LoadingScreen and Drawer refinements; only this file dependency changes in the lockfile. The original archive is available in Git history for the first trial's provenance. No registry release is needed for this local review.

Verification: packaging/publint, application/service-worker checks (zero errors/warnings), changed-file formatting and whitespace checks pass. The production build compiles client/server code but fails at prerendering: `/transactions/[id]` is marked prerenderable by the existing root layout and has no crawlable entry. This branch leaves the routing/PWA configuration unchanged; resolve the dynamic-route build policy separately. The isolated review server is http://127.0.0.1:5181. After implementation review, 110 unit tests and eight Chromium browser cases pass for money/transaction/form/avatar behavior, recovery dismissal, avatar upload/replace/remove, account table creation, workspace navigation, expense/income submission, stable sidebar geometry, full-height internal scrolling, compact controls, mobile Escape/backdrop dismissal and focus return. Browser-test type checks pass. Use FINANCE_INTEGRATION_URL=http://127.0.0.1:5181 with the integration configuration for this worktree.

### Remaining consumer opportunities

StatusMessage can replace aggregate feedback in additional settings/authentication forms in later focused batches. FieldFeedback is adopted first in transaction entry; other forms still need caller-owned translated issue mapping before adopting it. A future field composition could group a control with its linked help/error without repeating IDs, but it should preserve uncontrolled FormData and native attributes. Responsive Drawer policy remains caller-owned; the repeated breakpoint/initial-open behavior may inform a later shell composition after this consumer trial. Popover and NumberKeypad are available but are not added without a corresponding interaction need. The date-grouped transaction list deliberately retains its current list semantics.

The Jazz startup fallback uses the new LoadingScreen composition for loading/error feedback, centered vertically and horizontally with a single visible message. Its translated startup message is “Loading your finances…”. Workspace preparation retains its own single message; errors retain actionable retry text. Removed unused startup/workspace descriptions and the separate error heading, and simplified the database message keys. The decorative spinner adds no repeated hidden text.

Sidebar presentation revision: the external Open navigation button is hidden while open; the Drawer has one compact × close button with a translated accessible label. Its navigation heading is visually hidden while retaining the accessible name. Drawer retains its inert visual panel through exit motion so closing reverses opening; reduced-motion preferences skip transitions. Inline focus restoration waits for the external trigger to be revealed. This revision was visually approved and covered by the focused sidebar browser scenarios.

Sidebar height/layout revision: the Open navigation control now lives in a persistent main-content toolbar. While the drawer is open, the toolbar is invisible/inert but retains its geometry, eliminating vertical jumps. The drawer spans the viewport height (sticky inline, fixed overlay), with its body scrolling beneath a stationary close control. This refinement was visually approved; the focused sidebar browser scenarios pass.

## Current local package (2026-10-15)

Finance uses `vendor/delightful-ui-0.0.24-navigation-compact-status.tgz`, built from DUI’s `main` at `756bdbb`. That commit is pushed to GitHub and includes TopNavigation, the inline Drawer, and compact StatusMessage support.

The archive was built with `pnpm package` and `pnpm pack`. Finance keeps using a local file dependency.

Finance and DUI static checks pass with no errors or warnings. DUI packaging, 15 focused unit tests, and eight Drawer browser tests pass. The Drawer tests now match its current API; those test changes are still uncommitted and do not affect the package.

## Typography and spacing migration (review pending)

Finance now consumes `vendor/delightful-ui-0.0.24-typography-primitives.tgz`, packaged from local DUI commit `b21ee28`. The library still declares version 0.0.24; the archive name distinguishes this snapshot. Built in an isolated temporary directory with `svelte-package`, validated with `publint`, and packed with pnpm.

The first review batch adopts Heading/Text in PageHeader and the profile forms, InputAvatar for profile file selection, and canonical spacing tokens in PageContent/FormContent. InputAvatar receives localized upload/remove labels. The saved-avatar image remains native because DUI exports an upload control, not a standalone display Avatar. Keep page/form layout CSS; use DUI spacing tokens for gaps rather than custom values. Remaining screens and shell typography/spacing need subsequent review batches. Tests are deferred until implementation approval.

The expense/income list batch uses PageContent in TransactionView and TransactionList. SplitRow shares the wrapping baseline-aligned layout for day headings/totals and transaction categories/amounts. List entries and metadata use DUI Text, day headings use Heading, and list/item spacing uses DUI tokens instead of custom margins. Shared Message feedback also uses Text with its existing role. Implementation review and runtime checks are pending.

Migration validation after approval: all 319 unit tests pass. All 21 selected browser scenarios pass across focused runs, including profile/avatar persistence, offline operations, recovery, owner authorization, transaction grouping/filtering/workspace changes, locale formatting, responsive navigation, and sidebar status/layout. Updated avatar submit-button assertions, memo assertions independent of paragraph tags, current Add Account labels, stable-position geometry checks instead of a fixed 16px gap, and the profile authorization test's secondary browser base URL. Browser-test TypeScript checks pass. Browser tests used an isolated in-memory Jazz server at port 5180 because the existing server failed startup; the isolated server was stopped after validation.

## Native CSS and composition cleanup (review pending)

Finance consumes `vendor/delightful-ui-0.0.24-typography-button.tgz`, packed
from the local Delightful UI feature branch, retaining version 0.0.24. Only this
latest archive created during the cleanup is retained. It contains:

- A public Drawer panel end-border token, replacing Finance's private panel selector.
- Details' optional `content` snippet, replacing its default padded body while
  keeping an absolute-positioning/overflow frame library-owned. Normal children
  retain the default presentation. Custom content takes precedence over children.
- StatusMessage spinner sizing inherited from its root/compact presentation.

Finance owns its sidebar disclosure grid through content snippets and its sized
transaction caret through the existing `caret(open)` snippet. The four
layout-specific Details tokens were removed. Consumer CSS does not select private
Drawer/Details classes. AppLink consumers own scoped native anchors via its render
snippet; navigation icon styling lives in AppIcon's shared variant. Global CSS is
limited to five native blocks for imported SVGs, composed shell roots,
snippet-rendered form buttons and browser-owned view-transition pseudo-elements.

The simple selector cleanup also uses local legend/button/amount selectors,
native transaction-content visibility, simpler BankSync alignment and fewer
sidebar wrappers. Typography and Button also use the shared styling described below.

See [CSS styling boundaries](css-styling.md) and the
[composition audit](composition-opportunities.md) for conventions and other
opportunities. Other replacement APIs were not added without a concrete consumer.

Library packaging/publint, application/library static checks, formatting and
whitespace checks pass. Current Details content-snippet behavior validation awaits
implementation review, including default/custom disclosure, keyboard toggling,
absolute placement and Finance navigation/grouping. Earlier snapshots were tested
during development; those results do not validate this final API change.

No new permanent style tests remain. The only retained test change replaces the
removed icon CSS-class locator with a semantic text/SVG locator. Existing behavior
coverage remains available. Both repositories remain uncommitted on feature branches.

## DUI feedback and control snippets (review pending)

The cumulative archive adds LoadingScreen `feedback()`, StatusMessage `message()`,
Stepper `stepLabel(step)` and Drawer `closeControl(close, label)`. Existing Finance
call sites keep their defaults. Custom feedback owns its announcements; richer
status text retains the library live region; custom step labels retain status
semantics; custom close controls use library dismissal/focus behavior while owning
their markup and sizing. The README documents fallback precedence and examples.
Package/static checks precede review; focused behavior tests follow approval.
No appearance tests or speculative Finance composition APIs were added.

## Typography and Button selectors — reviewed and verified

Text and Heading share a typed font-token lookup and each retain one scoped base
rule. Their public size overrides, caller inline styles, heading defaults and
data attributes remain supported. Omitted alignment inherits computed parent
alignment; private prop variables are reset per element to avoid nested leakage.
Button variants configure private color values for common hover rules. Native
fieldset-disabled state, ARIA-disabled handling, flat active behavior, focus,
reduced motion and forced colors retain explicit rules. The new snapshot replaces
the preceding cumulative archive; earlier changes are already committed/pushed.
Library packaging/static checks, browser-test TypeScript, formatting and whitespace
checks pass. After implementation review, all 13 existing semantic unit tests,
five Button browser scenarios and 11 focused Finance browser scenarios pass. The
stale `flat` story identifier was corrected to `flat-secondary`.

Temporary before/after inspection covered 69 component pairs and 258 observations
across light/dark themes, default sizes/alignment, public and inline overrides,
nested alignment, and Button normal/hover/active states including native,
ARIA and fieldset disabling. No differences were observed. Those temporary
fixtures were removed; no new permanent appearance tests remain.

## Shared sidebar adoption — implementation review

The `feat/shared-sidebar-navigation` branch adopts DUI's merged sidebar primitives. The archive is
`vendor/delightful-ui-e7de8c0-sidebar.tgz`; its packaged library source matches DUI main at `e7de8c0`
(PR #9). It replaces the previous component-properties archive without publishing a release.

`AppNavigationLink` delegates icon/label layout and selected presentation to `NavigationLink`, while
Finance retains pathname matching, query-preserving URL resolution, and navigation callbacks.
`AppDrawerContentSection` delegates spacing to `DrawerSection`. Accounts and Settings use
`NavigationGroup`, retaining their Finance controls, labels, data bindings, and nested navigation.
The Accounts filter region uses the existing translated account noun as its accessible label rather
than referencing a consumer-owned disclosure-summary ID. No catalog entries or generated localization
files change.

Validation after implementation approval: DUI packaging/publint passes; Finance application and
service-worker checks report zero errors/warnings, test TypeScript checks pass, and the production
build passes using `FINANCE_PREVIEW=true` with an unreachable test Jazz URL. All 36 focused account
balance and workspace navigation unit tests pass. The 11 focused browser scenarios across
`tests/navigation.e2e.ts`, `tests/features/navigation.e2e.ts`, and `tests/sidebar-balances.e2e.ts`
pass against the disposable in-memory Jazz agent server at `http://127.0.0.1:5186` (10 on the initial
run, with the remaining scenario passing after correcting its new keyboard expectation and waiting for visible disclosure content under reduced motion). The fresh
single-workspace selector is intentionally disabled, so Tab skips it and focuses Workspaces.
Coverage retains exact current-page semantics, query/workspace preservation, disclosure keyboard
operation, mobile dismissal/focus, account selection, balance updates/reload, and workspace switching.
Changed-file formatting and whitespace checks pass. The lockfile changes only the DUI archive and
the DLF peer reference to it. Existing localization files were generated with user approval; no
catalogs or localization configuration changed.

CI follow-up: the full navigation scope exposed two legacy selectors outside the initial focused
files: the Accounts summary icon is now a sibling of its label, and section layout uses DUI's
`drawer-section` class. Update those selectors in creation-modal and UI-integration coverage while
retaining the alignment, padding, and footer bounds assertions. All 14 canonical `@navigation`
browser scenarios pass on the disposable agent server; test TypeScript and whitespace checks pass.

## Shared loading content adoption

The `refactor/shared-loading-content` branch replaces Finance's LoadingContent implementation with
an adapter to DUI's public LoadingContent export. QueryContent and JazzStartup keep their existing
props and ownership: Finance interprets query/startup state and supplies translated text; DUI owns
the retained content, inert/accessibility state, and overlay presentation. Standalone startup/error
usage still renders LoadingScreen, including its caller-provided sizing style. With children,
loading=false removes the overlay and exposes the same mounted controls. The component does not
move focus; starting work from a focused descendant remains a caller focus-management decision.

The archive is `vendor/delightful-ui-0.0.25-loading-content.tgz`, packed from DUI commit
`d98dce6` ([DUI PR #10](https://github.com/delightful-labs/delightful-ui/pull/10)). It replaces the sidebar archive and retains its shared
navigation components. Only the DUI archive and DLF's resolved DUI peer reference change in the
lockfile; no registry release is involved.

Validation after implementation approval passes: DUI Svelte checking, packaging/publint,
changed-file ESLint, and Storybook build; Finance Svelte/application/service-worker checking,
test TypeScript checks, and production build. DUI has 15 passing focused rendering tests and
three passing Chromium scenarios covering keyboard exclusion/release, repeated draft/DOM retention,
content geometry, and standalone loading/error semantics. Finance has five passing LoadingContent/
QueryContent rendering tests and four passing browser scenarios covering retained loading content,
category controls/creation, startup storage-failure retry, and workspace loading feedback. Finance
browser checks use the disposable in-memory Jazz agent server at `http://127.0.0.1:5186`.

DUI PR #10 and Finance PR #48 are merged. No registry release is required. Existing
localization generation was authorized; no catalogs or localization configuration changed.

## Shared linked list row adoption

The `refactor/shared-linked-list-row` branch replaces the former transaction row adapter's local presentation
with DUI LinkedListRow. Finance retains its existing `href`, translated destination label, content,
and amount snippet. AppLink resolves query-preserving URLs before passing them to DUI. Transaction
and transfer consumers remain unchanged, including their domain formatting and labels.

DUI renders a native list item with one anchor covering the row, main content, optional trailing
metadata, and a decorative chevron. The whole-row native anchor replaces the local stretched-link
pseudo-element and hidden label. Children and trailing snippets must be non-interactive; the current
Finance consumers supply only text/formatting. The `transaction-link` class remains on the anchor
for existing Finance integration coverage. No domain or workflow state changes.

The archive is `vendor/delightful-ui-0.0.25-linked-list-row.tgz`, packed from DUI commit
`da5f6af` on `feat/linked-list-row`. It replaces the loading-content archive and retains its shared loading
and sidebar components. The lockfile changes only this DUI archive and DLF's resolved DUI peer.

Validation after implementation approval passes: DUI Svelte checks (zero errors/warnings),
package/publint, ESLint/formatting, Storybook build, three rendering tests, and four Chromium
scenarios. The browser checks cover one tab stop per row, whole-row activation, native middle-click,
and narrow long-content layout.

Finance Svelte/application/service-worker checks (zero errors/warnings), production build, test
TypeScript checks, E2E scope audit, and formatting/whitespace checks pass. Eight focused rendering
checks cover the Finance adapter/query inheritance and expense overview. Five browser scenarios pass
against the refreshed disposable in-memory Jazz agent at `http://127.0.0.1:5186`: transaction pagination,
transaction Enter activation/history, desktop and mobile transfer text activation, and transfer
pagination/filter selection. Existing financial formatting and scope assertions remain intact.
The new archive's library files match DUI's packaged output; no registry release is involved.

DUI PR #11 and Finance PR #49 are merged. No localization catalogs or configuration changed.

## Shared floating action adoption

Finance's FloatingActionLink delegates presentation to DUI FloatingActionLink and supplies an Icon
child. Finance retains its href/label interface, translated labels, AppLink URL/query resolution,
and floating-action-link hook. It passes its label as native aria-label and title attributes.
Transaction and transfer callers remain unchanged.

DUI exports separate FloatingActionLink and FloatingActionButton components using native
HTMLAnchorAttributes and HTMLButtonAttributes directly. Children supply content; callers supply
accessible names and titles. Buttons default to type=button and support native disabled and form
attributes. A private FloatingActionFrame shares bottom-sticky circular styling. There is no
combined link/button union or custom Omit/never prop manipulation.

The archive is `vendor/delightful-ui-0.0.25-floating-action.tgz`, packed from DUI commit `5d66d8e`
([DUI PR #12](https://github.com/delightful-labs/delightful-ui/pull/12)). It retains the existing
shared components. DUI is based on merged PR #11; Finance is based on merged PR #49.
No registry release is involved.

Validation passes: DUI Svelte checks, ESLint/formatting, package/publint, Storybook build,
six rendering tests, and six Chromium scenarios covering keyboard/new-tab behavior, disabled
controls, form validation/submission, accessible names, and narrow scrolling layout.

Finance application/service-worker checks, production build, test TypeScript checks, four adapter
rendering tests, and eight focused browser scenarios pass. The browser scenarios cover empty
expense/income links, keyboard activation, desktop/mobile expense/income creation, desktop/mobile
transfer navigation, and transfer pagination/filter behavior against the disposable in-memory agent.

DUI PR #12 and Finance PR #50 are merged.
No localization catalogs or configuration changed.

## Composable radio date filter adoption — verified locally

The isolated feat/radio-date-filter worktree uses
`vendor/delightful-ui-0.0.25-radio-items.tgz`, packed from DUI source matching merged
commit `dfa5380` (PR #14). It replaces the floating-action archive and retains all
previously adopted controls. Package/lockfile updates are limited to this snapshot
and the resolved DUI peer used by Delightful Local First.

DateRangeFilter composes RadioGroup and RadioItem for the two existing
relative presets plus a custom-range disclosure. Transaction lists and the
overview retain their own filtering, date calculations, URL/session state and
callbacks. See the focused requirements and review checklist in
[transaction list filters](../specs/001-finance-mvp/transaction-list-filters.md#composable-radio-date-choices).

Date choices use `labels.last_week`, `labels.last_month`, and `labels.custom`
for Last week, Last month, and Custom. The superseded messages and unused day noun
have been removed. Custom selection shows the existing date inputs and preserves
the current bounds; presets hide the fields. The transaction-list all-date default
and overview 30-day default remain intact. This is synchronous presentation state
in one shared component. No actors, Jazz data, routing, or filter persistence
contracts change. Implementation and focused coverage were approved.

Paraglide generation, application/service-worker checks, production build,
focused formatting and diff checks pass. Review preview: `http://127.0.0.1:5192`
using the isolated worktree's disposable in-memory Jazz server.

Validation passes: 20 focused unit tests and seven Chromium scenarios across the
overview and desktop/mobile expense/income filters. The browser coverage includes
keyboard presets, conditional custom fields, focus retention during URL updates,
prefilled/current bounds, reload/navigation persistence, invalid and empty ranges,
filter combinations and narrow layouts. Application/service-worker checks,
production build, test TypeScript, E2E scope audit, focused formatting and diff
checks pass. Implementation was developed in the isolated feat/radio-date-filter worktree.

## Component-based links and local transaction rows

AppLink now accepts a `component` prop, defaulting to Anchor. It resolves the
query-preserving destination before forwarding `href`, children, native anchor
attributes, and component-specific props. Navigation and floating action links
use that API. Pagination uses it only for navigable items; disabled and ellipsis
items continue to render through PaginationItem without links.

TransactionRowLayout and DUI LinkedListRow have been removed. Finance owns native
list-item markup for transactions and transfers. Transaction rows use one stretched
native link with a descriptive translated accessible name; transfer rows retain
their own descriptions, posting dates, currencies, and query-preserving links.

The vendored snapshot is `vendor/delightful-ui-0.0.25-without-linked-list-row.tgz`.
It includes the LinkedListRow removal and Text word-wrapping change while retaining
RadioGroup, RadioItem, SwipeActions, SkipLink, and SkipButton from DUI main. The superseded radio-items
archive is removed; the package version remains 0.0.25 and no registry release is
required.
