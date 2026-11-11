# Shared icon and label button content

## Requirements and design

Use the reviewed DUI ButtonContent component for the category and tag list Archive
buttons. Both use the existing folder-minus archive icon and localized Archive
label, with spacing owned by DUI. CategoryList replaces its adjacent icon/text;
TagList gains the same icon (its current implementation was text-only).

Preserve row-specific accessible names, archive callbacks, disabled conditions,
filters and feedback. This is pure presentation with existing inputs and labels;
no schema, persistence, subscriptions, statechart or async workflow changes are
needed. Loading remains optional; this slice does not introduce row progress.

## Review and verification

- [x] Adopt ButtonContent in CategoryList and TagList.
- [x] User reviewed the implementation and authorized committing both repositories.
- [ ] After approval, add SSR assertions for category/tag archive accessible names,
      icon decoration, disabled permissions and hidden ineligible actions.
- [ ] Browser archive behavior and gap/bounds checks remain deferred at the user's
      request; inspect category/tag scenarios in `tests/` before execution.

## Remaining button adoption — reviewed; verification pending

- [x] AccountActionsDialog: use shared archive icon/text spacing and a spinner
      while archiveAction is archiving. Preserve the existing localized archiving
      label and disabled conditions; expose aria-busy.
- [x] BankSync: use shared spacing for Discover accounts; show a spinner and
      aria-busy from the existing bank busy projection, matching Sync now.
- [x] FormModal: replace add/save/close/cancel wrappers with ButtonContent and
      remove their duplicate local CSS. Submit uses the existing non-idle form
      activity for its spinner/aria-busy; labels and close callbacks stay intact.
- [x] AppDrawerAccounts: Add Account uses ButtonContent, retaining its existing
      1.25rem icon size through the already-registered DUI size property.

This four-component slice remains pure presentation. Existing machine projections
own progress and terminal outcomes; there are no new actors, async helpers,
resource lifetimes, lifecycle flags, schema changes or persistence changes. The
machine-first gate requires no new workflow for rendering those existing facts.

- [x] User reviewed the implementation and authorized committing both repositories.
- [ ] After approval, inspect/update `src/lib/account-actions-dialog.test.ts` for
      available/archiving/disabled archive output. Add targeted SSR coverage for
      busy discovery and submit controls where feasible; retain close labels.
- [ ] Browser checks remain deferred: account archive/access scenarios,
      `tests/bank-sync.e2e.ts`, `tests/creation-modals.e2e.ts`,
      `tests/form-presentation.e2e.ts`, `tests/navigation.e2e.ts`, and
      `tests/account-order.e2e.ts` are affected consumer surfaces.

AppNavigationLink and FloatingActionLink are links rather than buttons. Drawer
disclosure icons and icon-only controls do not have the same label-content need.
Keep those out of this adoption cycle.

## Shared SVG scaling correction

Refresh the vendored package with ButtonContent's viewBox normalization and SVG
slot sizing correction. TDesign's source `view-box` spelling is invalid; DUI now
uses its Icon component to supply a valid 24-unit viewBox, consistent with
AppIcon, so paths scale into the slot. Icon accepts imported SVG components and
owns shared sizing, contain-style aspect ratio, block display and accessibility.
ButtonContent sets no viewBox; Icon provides the 24-unit default centrally.
This fixes all adopted buttons at their shared rendering boundary. Review before
new tests; browser geometry checks remain deferred.

The same DUI branch now includes the closed typed-properties branch's registrations
without merging its history: 188 component properties live in 25 owning component
styles and 30 shared properties remain in theme.css. Original registration
descriptors are preserved, each name has one owner, and ButtonContent retains its
three new registrations. Refresh the vendored package to keep Finance aligned
with this source; review the registration change before tests.

The user approved committing the complete implementation. Type/formatting checks
pass; updating affected consumer unit coverage and running it remains outstanding.
Browser verification remains explicitly deferred. No PR has been opened yet.
