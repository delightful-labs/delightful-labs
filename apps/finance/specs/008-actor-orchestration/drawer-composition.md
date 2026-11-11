# Drawer presentation composition

## Sidebar link typography

Use the shared mono font token (`--dui-font-family`, falling back to Source Code
Pro and monospace) in AppNavigationLink. This applies consistently to primary,
account-management and settings links on mobile and desktop. No interaction or
workflow changes are needed. Implementation reviewed and approved for commit;
formatting checks pass. No new tests are needed for this font-only adjustment.

## Requirements and plan

Break the large AppDrawer into focused components composed as children in AppShell,
retaining navigation order, drawer behavior, account filtering/ordering, small balance
text, workspace selection, sync controls, status and existing styling/localization.

- AppDrawer owns the drawer container, binding, shared theme and children/footer slots.
- AppDrawerNavigation owns primary links and renders child sections before login.
- AppDrawerAccounts owns account disclosure, filter/balance/order presentation and the
  existing account-creation snippet.
- AppDrawerSettings owns the settings disclosure and workspace selector presentation.
- AppDrawerStatus owns the sync/status presentation and existing PWA integration.
- AppShell composes these components through children and the footer snippet.

These are focused presentation responsibilities with explicit data/callback props.
Jazz subscriptions, authorization decisions, actor lifetimes and browser effects remain
with their existing owners. The machine-first gate finds no new workflow, async actor,
resource, business decision or interruption path. Existing messages are reused unchanged;
styles move with their markup. No new visual design is introduced.

## Mobile sync correction

The drawer's Sync now action must preserve the open mobile drawer while starting
the existing bank sync workflow. Only navigation actions dismiss it. Remove the
navigation callback from AppDrawerStatus and its AppShell binding; no actor,
async workflow, localization, or persistence changes are needed.

- [x] Remove sync-triggered drawer dismissal.
- [x] User review of the implementation; approved unit verification, with e2e deferred.
- [x] Existing viewport and bank-sync supervisor unit suites pass (22 tests).
- [ ] After approval, extend the bank-sync browser coverage to click the drawer
      action at a mobile viewport and verify it remains open while sync starts;
      retain navigation dismissal coverage in `tests/navigation.e2e.ts`.

Interactive drawer behavior has no unit coverage in the current Node test setup;
the mobile click regression remains pending deferred browser verification.

## Bank sync button progress

Use DUI ButtonContent in the drawer and bank-page Sync now buttons, replacing the
icon with the same-size spinner while the existing bank activity is working.
Keep the localized label stable and expose aria-busy on the button. Disabled
permissions/offline states alone must not show loading. BankSyncIntegration
projects existing activity into a readonly loading getter; the bank-page control
uses its existing busy projection. No machine states, actors, async operations,
Jazz subscriptions or persistence behavior change. The machine-first gate finds
only presentation of an existing state; no new workflow or resource ownership.

- [x] Refresh the vendored DUI package and adopt both sync buttons.
- [x] User reviewed the sync integration and authorized committing both repositories.
- [ ] After review, assess relevant bank supervisor unit assertions; browser
      checks for stable button bounds, loading, cancellation/error reset and
      mobile drawer preservation remain deferred at the user's request.

## Review and verification

- [x] Implement the six-file presentation composition refactor.
- [x] User implementation review before adding or running tests.
- [x] After approval, inspect navigation, account-order, multiple-workspaces and PWA
      browser coverage; update fixtures if needed, then run relevant checks for
      desktop/mobile drawer behavior, filtering, balance display, order controls,
      workspace selection, account creation and sync/status rendering.

## Approved verification

Implementation approved for testing. All 52 session browser checks pass, including
navigation at 390/768/769/1280px, mobile dismissal/focus/overflow, preserved disclosures,
workspace-aware links, account ordering, account creation and shared modal behavior.
Sidebar balance scenarios also verify workspace isolation and online/offline status
rendering on mobile and desktop. The four strengthened category/sidebar cases pass
on focused rerun. No production fixes were needed. PWA service-worker update behavior
was not rerun: its integration is unchanged and is disabled in the development server.
Type checks, fixture types, formatting and whitespace checks pass.
