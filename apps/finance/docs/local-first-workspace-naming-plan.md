# Shared workspace naming: Finance adoption review

Branches feat/workspace-naming start at Finance main d98ef4c and library main 85233b1.
The shared operation and its nineteen approved unit cases are committed as library e108d9c.
This focused implementation changes the existing settings route, its policy, the data leaf adapter
and one invoked persistence adapter. The settings UI, strings, schema and currency domain stay put.

## Ownership and machine-first audit

The current scoped-form owner still validates the full settings schema, refreshes current local
observations, checks exact scope/revisions and invokes the owner/admin availability policy before
persistence. It remains the only role/eligibility owner. Its new persistence adapter invokes the
shared operation through a fixed child actor; it never starts an actor manually or bridges it with
a promise. The shared operation's assessment capability simply acknowledges that the parent already
authorized this invocation; it does not introduce a second policy or claim to grant storage access.

The active sequence is existing form validation -> fresh local readiness/scope checks -> invoked
Finance persistence adapter -> shared name validation -> issue update -> explicit local wait ->
finite result mapping. The request carries requestId, scopeRevision and the original identity/client/
workspace scope. There are no continuing child reports to correlate; the invocation owns the result.
Parent scope/permission observations keep their existing invalidation/drain behavior.

CANCEL, INVALIDATE and SHUTDOWN are forwarded to the shared child without stopping it. The existing
form owner waits for finite settlement, preserving local persistence or uncertainty across scope
loss/cancellation. The adapter maps naming invalidated to the existing scopeChanged result and
preserves cancelled/closed outcomes. Unexpected child errors report unknown settlement, with no
automatic retry. Generic scoped-form machinery and its cleanup protocol are unchanged.

Recursive leaf audit: workspaceNamingWrites.issueRename repeats the existing pure schema invariant,
then issues one db.update containing both name and defaultCurrency. Its receipt stays in a plain
{write} envelope. persistLocal calls only wait({tier:'local'}) and maps its return value to void.
No query, branching read/check/write workflow, transaction callback, rollback or extra commit is
hidden in either adapter. The replaced renameWorkspace helper is not retained as a parallel path.
Jazz remains responsible for storage enforcement and later rejection; this operation cannot certify
fresh remote access or roll back an already-issued write.

## Local-first package boundary

No additional query, subscription, session open, network preflight or remote/global wait is added.
The existing local observation and role policy still decides ordinary settings usability. An empty
or partial replica does not trigger workspace creation, permission restoration or provenance repair.
Name and currency remain one atomic update; no shared currency API or Finance schema is introduced.
No page template, presentation component, localized wording, catalog or configuration is changed.

The new vendor archive replaces the superseded creation-dialog archive. Manifest and lockfile refer
only to vendor/delightful-local-first-0.0.0-workspace-naming.tgz, SHA-256:
`df3e7ebe8d0cca385bd337ad5eae8794df69dfa8fd08723bbdec6e9f4f30c9fd`.
No unrelated lock metadata or dependency version change is included.

## Implementation review and affected verification

After approval, update workspace-rename.fixture.ts to supply issueRename and persistLocal separately
while preserving its existing issued-write/settlement gates and assertions. Update data.test.ts for
the new leaf factory: issue must update both fields exactly once and must not wait; persistence must
wait explicitly for local durability on the same receipt. The old helper import is intentionally
pending that approved fixture update. Add focused persistence-child cases for pre-issue interruption,
issued interruption/unknown failure, outcome mapping, scope identity and child failure handling.

Inspect workspace-rename.test.ts, generic scoped-form interruption tests, the @workspace-rename
browser scenarios and their helpers before execution. Preserve trimmed/invalid/pristine drafts,
unchanged submission prevention, currency-only saves, unauthorized/unavailable scopes, local retry
behavior, issued work after permission loss, and scope replacement while persistence is pending.
Qualify real local saves after cold offline and unanswered-connection restarts; expand those existing
scenarios only where their implementation does not already cover settings changes. Do not broaden
or repeat the full application suite merely to discover obvious fixture interface drift.

No adoption tests or test fixture edits are included before review. Source-only Svelte checking
uses a temporary tsconfig excluding tests/fixtures whose interface updates await approval; this is
not a claim that the full source-and-test check passes. Checks run in the separate disposable checkout
/tmp/finance-naming-review.nwtrjnko with its own node_modules and existing generated localization.
Installation skips lifecycle scripts. Raw sync/check commands avoid Paraglide generation, and no
server is started or user's Jazz/browser data modified. Static results are recorded below.

## Static review result

Frozen isolated installation succeeds. Production-source Svelte checking reports zero errors and
warnings with the explicit temporary test/fixture exclusions above; service-worker TypeScript
checking passes. Focused Prettier and diff checks pass. Generated localization content is identical
between the original and isolated checkouts. No Finance adoption tests were added or run, no server
was started and no Finance changes were committed or published in this review cycle.

## Approved Finance qualification

The user approved continuation after implementation review. Updated the rename fixture to separate
issueRename from persistLocal while retaining the same settlement gate. Existing policy/form tests
now wait for actual persistence invocation before exercising issued-work interruption, rather than
assuming the parent's writing state means the nested child has already issued. Data tests assert
one combined normalized name/currency update, no implicit wait during issue, an explicit local wait
on the receipt and rejection of invalid settings before any update.

All 80 affected unit cases pass across data, rename policy, shared form-write and the nine new
persistence-child cases. The new cases cover fixed request/scope correlation, currency retention,
early interruption without issue, draining issued work, unknown failure and shutdown precedence.
One test fixture was corrected to supply values before actor initialization, matching the fixed
invocation contract. No production correction was required.

All five focused browser scenarios pass: owner validation/rename/reload, admin access, member/viewer
restrictions and shared edit-form offline persistence/currency defaults. Both strengthened production
cold cases pass: after full browser/worker exit with an unanswered remote or offline, the app creates
and selects a workspace, saves name and currency together, exits every client again and reopens the
retained profile with both settings and selection intact. The settings currency locator is scoped
to its native form, since the app shell also contains a separately mounted currency field.
No assertion was weakened and no deadline was increased.

Full source-and-test Svelte checking now passes with zero errors/warnings without the initial review
exclusions. Browser-test and service-worker TypeScript checks pass. Focused formatting and diff
checks pass. Verification uses only the disposable checkout and temporary Vite runners retaining
runtime plugins while omitting Paraglide compiler writer hooks. Existing generated localization is
byte-identical after all checks. No user server, browser profile or Jazz data was modified.

The agent server was stopped before the production build; the runner-owned preview has exited.
The final locator-only rerun reused the unchanged production build. Finance adoption and coverage
remain uncommitted; no branch was pushed, PR opened or deployment performed in this turn. These
checks qualify this naming boundary, not the original startup latency report or every MVP feature.
