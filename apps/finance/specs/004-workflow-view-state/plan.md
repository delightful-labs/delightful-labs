# Implementation Plan: Explicit workflow and view state

Status: implementation and focused verification complete across all slices.
User-authorized combined review is pending. Final evidence: 389 unit tests and
54 browser scenarios passed, plus application/test/configuration type checks.
The sections below retain the incremental history; current scope and review maps
are in remaining-work.md and review.md.

## Scope and technical context

Implement [spec.md](spec.md) one focused review cycle at a time, in the order tracked
by [delivery.md](delivery.md). First delivery is account archiving only. Existing
TypeScript, Svelte 5, Jazz, XState 5, and Paraglide tooling applies. No schema or
permission-policy changes are proposed.

## Constitution check

Preserve local-first writes, organization permissions, localized accessible UI,
and unstyled presentation. No switch statements, casts, or any. Machines own
business decisions; integrations bind observations and dependencies and compose
pure components. Model review precedes effects; implementation review precedes
test additions/runs. Do not start another slice before current work is reviewed.
No commit or development server is needed for this design cycle.

## First slice design

See [account-archive.md](account-archive.md) for the proposed actor tree,
statechart, event/result contracts, write semantics, and focused file scope.

Keep shared forms unchanged until slice 2. Do not mechanically reuse the generic
form actor for an operation whose authorization and cancellation it cannot model.
Subsequent slice plans are added after this pattern is reviewed and verified.

## Verification strategy

After implementation review, add focused machine coverage for observation
readiness, scoped access, duplicate requests, stale events, cancellation/shutdown,
and settlement of issued writes. Add relevant account-page Playwright coverage
for visible actions and results. Run only relevant checks; type checks alone do
not prove lifecycle or persistence correctness. Record actual commands/results
in tasks.md and delivery.md rather than claiming validation from this plan.

## Shared forms design (slice 2a)

See [forms.md](forms.md) for the consumer inventory, proposed actor composition,
event/view contracts, lifecycle policy, and additive migration path.
FR-010 maps to guarded submission/reset/lifecycle, FR-011 to supplied domain
availability/operation machines, and FR-012 to props-only typed views.

Slice 2b proposes four implementation files: new scoped owner/submission machine
modules, a props-only form contract module, and additive integration in
forms.svelte.ts. The four concrete paths are recorded in forms.md and tasks.md; implementation is approved and focused verification passed (see tasks.md for coverage limits). Slice 2c handles shared
presentation compatibility; slice 2d adopts workspace rename as the first domain
consumer and satisfies that portion of slice 5. Account creation is the first
modal adoption in its own later cycle. Existing exports remain until their
consumers migrate; no broad replacement of legacy callbacks is planned.

## Shared presentation implementation (slice 2c)

The five-file scope and compatibility limits are recorded in forms.md and tasks.md.
Both shared components consume props-only presentation choices; the legacy adapter
projects its old actor without changing its transitions or persistence guarantees.
Native fields are disabled by the view and keyed by accepted scoped draft revision.
Modal close preserves active work and uses the existing Close label while busy.
Review the exact implementation before adding/running tests; no production domain
consumer is migrated until 2d or its later dedicated slice.

## Shared presentation verification (slice 2c)

Implementation approval and actual commands/results are recorded in tasks.md.
Thirty-five relevant unit/adapter tests and four browser scenarios passed,
including a real legacy account-modal regression and deterministic scoped reset,
capability, close/reopen, scope replacement and void-success presentation checks.
No production changes were required during verification. The scoped harness does
not establish domain authorization or Jazz persistence guarantees for 2d or later
modal adoption. Show this evidence before beginning the next focused cycle.

## Workspace rename domain design (slice 2d-a)

See [workspace-rename.md](workspace-rename.md) for the inspected SDK guarantees,
readiness/operation statecharts, ownership, observation freshness, typed results,
cleanup, presentation boundaries and proposed six-file implementation scope.
This concrete domain review precedes effects; implementation review and approved
unit/browser verification remain separate subsequent cycles. The existing SDK
permission policy and rename persistence helper remain unchanged.

Shared reuse clarification: the first domain adoption adds a reusable single-write
operation base (`scoped-form-write.ts`), not a workspace-specific copy of generic
preparation/interruption/settlement states. Workspace-specific actors supply
readiness/authorization and the rename action. Existing shared submission,
validation, capabilities, reset/reopen and view mechanics remain the foundation.
See the responsibility table and revised six-file scope in workspace-rename.md.

## Workspace rename implementation review (slice 2d-b)

The six-file implementation is prepared: a generic scoped-form-write base,
workspace-specific props/observation contracts and readiness policy, scoped page
integration, pure WorkspaceNameForm and localized outcome messages. The domain
reuses its readiness chart for displayed capability and pre-write authorization;
it does not duplicate generic write settlement. The existing scoped owner and
submission remain the form foundation. See workspace-rename.md and tasks.md for
exact guarantees and review/verification gates.

The pending implementation review also includes the user's shared create/edit
mode and stable-submit-label refinements. The common owner gates editing on a
pure comparison to current observed saved values and keeps fields editable while
unchanged; creation has no new prerequisite. Workspace rename is the initial
edit-mode consumer. forms.md and tasks.md record the expanded related scope and
remaining approval/verification requirements.

## Workspace adoption and shared edit-mode verification

Approved focused verification passed: 76 unit/adapter tests, five shared/real-form
browser scenarios and four owner/admin/member/viewer rename scenarios. Application,
test and final configuration type checks passed. No production fixes were required.
See tasks.md for exact commands, test-only setup corrections and coverage limits.
This completes reviewed general forms cycles 2a–2d; review this evidence before
the next domain adoption. Legacy profile/category/tag/transaction consumers still
migrate in their own planned cycles.

## Account creation design (slice 3a)

See [account-creation.md](account-creation.md) for the audit, readiness adapter
chart, reuse of accountCreationAccessMachine, revision/scope protocol, shared
create-mode operation, first-account unmount guarantee and six-file scope.
The model preserves owner/admin SDK policy and the existing createAccount helper.
Its explicit modal choice permits blocked inspection without permitting submission.
Concrete model review precedes implementation effects; exact implementation review
and focused verification remain separate gates.

Slice 3a implementation is now prepared for review in the approved six-file
scope. It reuses the existing access policy and shared create/write lifecycle.
Static application checks pass. Focused runtime verification remains pending
implementation approval; no tests were added or run in this cycle.
