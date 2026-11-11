# Shared workspace creation dialog: Finance adoption review

Fresh branches: feat/workspace-creation-dialog from Finance main db774a4 and library main 2abd82f.
The shared dialog implementation and coverage were reviewed, then committed as library 9a95187.

## Focused change

WorkspaceCreationForm is a localized adapter over the shared dialog. WorkspaceCreation retains its
session observation and existing SUBMIT/RETRY/NEW callbacks. The caller still owns AppLink and its
workspace query parameter. No route, subscription, schema, Jazz read/write, transaction protocol,
recovery journal, shutdown protocol or runtime readiness gate changes.

The creation machine's public presentation helper selects content, capabilities, feedback descriptor,
priority and visible-feedback policy. The adapter translates that descriptor with existing Paraglide
calls; it does not classify outcomes. A draft revision counter increments on entry to editing and
is carried in the public view. It is draft identity, not mirrored lifecycle state: invalid results,
retries and locale updates keep the same revision. A genuinely fresh editing entry resets the draft.

Machine-first audit: this adds one synchronous counter assignment and a pure view projection. No
actor, async helper, invocation, transaction callback or acquired-resource path changes. Existing
operation/transaction children continue to own creation, reconciliation, cancellation, settlement
and resource draining. Closing the view never stops an attempt or implies rollback.

Static inspection identified Finance's explicit quiet-progress expectation. The library therefore
adds an optional feedback visibility input, defaulting to visible. Finance's public projection hides
only the duplicate visible working paragraph while retaining the mounted status announcement. This
small library refinement is uncommitted for review, with its targeted coverage pending approval.
The dialog uses text controls from the installed DUI contract and does not add new icons or styling.

## Package and local-first boundary

vendor/delightful-local-first-0.0.0-workspace-creation-dialog.tgz replaces the selector archive;
package.json and pnpm-lock.yaml reference only the new archive. SHA-256:
`c60024720a3213c5c327a796eef68f20c9430a83b35fa8e6ce4138eaf69ddc38`.
The archive contains 9a95187 plus the optional feedback visibility refinement. Unrelated lockfile
metadata changes from lock generation were removed. No dependency version upgrade is included.

No SDK call, session open, query or network preflight is introduced. The existing locally available
creation view drives the UI. Creation still completes under the established local-persistence owner;
missing or partial replicas do not acquire new bootstrap or repair authority. This presentation
adoption does not diagnose startup latency.

No catalog, localization configuration or generated file is changed or regenerated. Type checks
use a separate checkout at /tmp/finance-creation-review.f8m_j1et with its own node_modules and copied
existing localization output. Installation skips lifecycle scripts; raw SvelteKit sync/Svelte checks
avoid the Paraglide prehooks. No server is started and user browser/Jazz storage is untouched.

## Review and affected tests

Before execution, inspect workspace-creation.test.ts and runtime/readiness.test.ts for the expanded
view contract, then cover feedback classification and draft revision retention/reset at the machine
boundary. Add focused adapter SSR cases using the installed package. Inspect multiple-workspaces
modal tests and their shared creation helpers: retain quiet progress, mounted announcements,
cancelled draft retention, retry identity, completion reset and original AppLink routing. Existing
recovery/offline creation scenarios and the two production cold offline/stalled-connection cases
must still qualify the adopted composition after implementation approval.

The shared library's four SSR and eleven synthetic browser cases passed before this adoption.
They do not qualify Finance's persistence, and they predate the optional feedback visibility input.
Finance implementation tests and refinement tests await review; none were added or run in this batch.

## Static verification completed

Frozen isolated installation succeeds against the final archive. Source/Svelte checking reports zero
errors and warnings, and service-worker TypeScript checking passes. Library Svelte checking and
publint pass for the optional feedback input. Focused formatting and diff checks pass. The generated
localization tree is byte-identical between the original checkout and the isolated copy after
verification. No implementation tests were added or run for this adoption/refinement.

## Approved adoption coverage and draft-retention correction

After implementation approval, added nine public-projection classification cases, one machine case
covering invalid submission/retry/new-entry draft revisions, four adapter SSR cases and one browser
case for rejected draft retention and explicit fresh entry. All 66 affected machine/runtime/adapter
unit cases pass. The adapter helper now reads Svelte's body getter explicitly; spreading the render
result had discarded that getter and was a test-harness error.

The new real Finance invalid-draft browser case exposed a library defect: the draft reset effect
read view.draftRevision directly, so replacing the supplied view object reran the effect even with
the same revision. The dialog now derives the primitive revision before observing it. The synthetic
locale fixture also rebuilds its view to cover this host pattern. All 12 shared dialog browser cases
pass after correction, including quiet feedback. No deadlines or behavioral assertions were relaxed.

The storage-denial browser test's old p[aria-hidden] locator was updated to select the visible
paragraph and separately assert the alert message. The shared paragraph is visible and accessible;
requiring its former aria-hidden attribute was unrelated to the recovery scenario. Data isolation,
explicit retry, retained journal identity and no duplicate creation expectations remain unchanged.
The full focused Finance browser rerun and cold production checks are recorded below on completion.

## Completed adoption qualification

All 66 focused Finance unit cases pass against the corrected final archive. All 23 affected browser
scenarios pass, including the new rejected-draft case, quiet progress, mounted announcements,
storage-denial recovery, duplicate-name isolation, permission denial, workspace selection during
creation and identity replacement. Source/Svelte and browser-test types pass. Focused formatting
and diff checks pass.

The production startup suite passes all seven cases, including the two required full-browser-exit
cases: offline and an open connection that never answers. Both create/save/reload a workspace,
explicitly select it and retain that selection across another reload. The suite also passes its
existing live-permission, local account archive, negotiated stalled-connection, later rejection and
cold bank-history checks. No deadlines were increased and no persistence assertion was removed.

The generated localization tree remains byte-identical after browser and production verification.
The verification-only compiler-hook filter and temporary Vite/Playwright configs are confined to
the isolated checkout. The agent development server was stopped before production build; the
runner-owned preview has exited. The user's environment and data were untouched.

The library's four SSR and twelve dialog browser cases pass; source/Svelte types, lint, package
validation and public consumer checks pass. The final archive hash is the one recorded above. This
qualifies the composition adoption, not the reported startup-latency cause. Finance adoption,
coverage and shared refinements remain uncommitted; no push, PR or deployment occurred in this turn.
