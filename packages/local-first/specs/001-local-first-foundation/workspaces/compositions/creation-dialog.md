# Workspace creation dialog: first review

Branches: feat/workspace-creation-dialog from merged library main 2abd82f and Finance main
db774a4. The selector PRs are merged. This review changes one library component, its public
presentation contract and the existing workspace export. Finance adoption follows separately.

## Ownership and machine-first gate

The creation workflow already belongs to Finance's workspace creation machine and transaction
children. This change adds no asynchronous operation, actor, resource acquisition, persistence,
authorization, permission inference or readiness decision. The host selects all presentation
capabilities, activity, content, retained attempt name and feedback priority. The dialog renders
that projection; it does not inspect an actor snapshot, database object or creation outcome.

The only local state is disclosure, a name draft and DOM focus references. A host-provided draft
revision resets the draft when the workflow requests a fresh entry. Scope changes close the
dialog and clear the draft; unavailable presentation closes it. Changing localized text does
not reset disclosure/draft or restart work. Opening a completed creation requests the host's NEW
command, matching Finance's existing behavior. Submit/retry/create-another callbacks remain
requests to the existing owner, which must recheck validity and access.

Dismissal through buttons, Escape, backdrop or unmount releases only the dialog. It does not cancel
an operation, erase its durable journal, imply rollback or stop the host actor. Creation may finish
while the dialog is closed; retry must retain the same attempt identity under the existing owner.
Scope invalidation and teardown remain the integration owner's drain protocol, not a view effect.

## Presentation boundary

Compose installed DUI Dialog, Button, InputText and ScreenReaderText. The installed library DUI
snapshot does not export ButtonContent; do not assume the newer Finance export exists here.
No DUI upgrade or replacement primitive is part of this review. Use native form submission,
required name validation, unique instance IDs, mounted status/alert regions, meaningful focus on
completion/error/editing transitions and trigger focus restoration. Close controls are at the bottom.
Only internal grid/flex spacing uses existing DUI tokens; no theme/reset or decorative style.

All text comes from the caller. The host supplies already localized feedback and its machine-owned
priority; the component does not classify domain statuses. No catalog, Paraglide generation or
configuration change is needed. A completion snippet lets Finance retain its AppLink and route/query
construction rather than requiring a router or a callback pretending to be a link.

No SDK import, session acquisition, query, remote check or network effect is introduced. The dialog
is usable entirely from a locally supplied view and callbacks. It does not diagnose startup latency.

## Review and subsequent coverage

Implementation is ready for review before tests are added or run. After approval, cover SSR and
public package declarations, name submission/native validation, unknown/unavailable presentation,
pending dismissal/reopen, completion, retry, create-another/draft resets, scope replacement,
multiple instances, locale updates, native Escape/backdrop, keyboard focus and narrow viewport bounds.
Synthetic Storybook hosts must demonstrate host-applied results without real Jazz data.

Finance adoption will replace only its creation presentation, project the existing machine view at
the owning boundary, reuse existing Paraglide strings and retain the existing actor/query/route
owners. Its current status-to-text mapping must move into the machine's public descriptor rather
than introducing another component-local domain-status map. Review that implementation before
adding/running its affected workspace, recovery and cold offline/stalled-server scenarios.

## Approved component qualification

The user approved continuation after implementation review. Four SSR cases pass: native closed
markup/required field association without effect callbacks, unavailable trigger, isolated caller
localization and retained-attempt failure feedback. Eleven browser cases pass against a synthetic
host: native required validation and Enter submission, cancel/Escape and trigger focus, pending
close/reopen and background completion, retry identity, locale-preserved draft and field ID, scope
replacement, unavailable closure, independent instances, backdrop/unmount, narrow viewport bounds,
and reopening completion through a fresh host draft. The host's message interface simulates only
external observations; tests interact with the real native modal and controls.

Source TypeScript and Svelte checks pass with zero Svelte warnings/errors. Oxlint, diff checks,
package/publint, declaration imports and a Vite consumer build of the public Svelte export pass.
Storybook builds without catalog generation; no catalog, configuration or generated localization
changes were made. Browser verification used test-owned port 6016; its runner-owned preview exits
when the checks finish. No Finance server, browser profile or Jazz data was touched.

No production correction was needed during these checks. Coverage does not yet qualify the Finance
adapter or its durable creation workflow: Finance adoption is the next separate implementation
review, with the existing local-first transaction and navigation owners retained. Nothing in this
slice is committed or published yet.

## Finance adoption refinement for review

Finance's existing workspace browser contract explicitly keeps working feedback announced without
an extra visible paragraph. Add optional feedback.visible (default true) to the pure view contract;
false suppresses only the duplicate paragraph, never either mounted announcement region. Finance's
own public projection supplies false for working. No actor, effect, localization or default story
behavior changes. The optional input and actual Finance adapter await review and focused coverage;
the earlier qualification predates this refinement. Library 9a95187 is committed; this refinement is
not included in that commit or the earlier passing browser result.

## Approved adoption regression coverage

The user approved the Finance adaptation and the optional quiet-feedback input. Twelve shared
browser cases pass, including quiet progress that stays in the mounted status region while omitting
its duplicate paragraph. The synthetic locale host now rebuilds its supplied view as Finance does.
Finance's new rejected-draft case found that observing view.draftRevision directly reran the reset
when the view object changed. The component now observes a derived primitive revision, so an equal
revision preserves the draft across new view objects. All twelve shared cases pass with this fix.
The corrected archive is tracked in Finance with hash and host qualification in its adoption plan.
The initial dialog commit remains 9a95187; these review-approved refinements are still uncommitted.

## Finance qualification complete

All 66 focused Finance machine/runtime/adapter unit cases and all 23 workspace/identity browser
scenarios pass against the corrected archive. Seven production startup scenarios pass, including
full-browser-exit creation/selection/reload while offline and with an unanswered remote connection.
Finance's generated localization tree remains byte-identical. Source/Svelte/browser types,
formatting and diff checks pass. No runtime owner, transaction protocol or startup network gate
was added. The Finance adoption plan records the archive hash and detailed validation.

Library validation includes four SSR cases, twelve shared-dialog browser cases, source/Svelte
checking, lint, package/publint and public consumer verification. The final fixes and Finance
adoption are uncommitted; nothing was pushed or published during this qualification.
