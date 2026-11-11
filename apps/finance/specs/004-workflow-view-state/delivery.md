# Incremental delivery: workflow and view state

Status: all eight delivery slices are implemented and automated verification passed.
The user authorized completion including tests while away; the combined review is
pending. Final evidence: 389 unit tests, 54 focused browser scenarios, application/
test/configuration type checks and formatting checks. No commits. See [review.md](review.md).

## Architectural direction

Follow `.specify/memory/constitution.md` and `.specify/memory/xstate.md`.
Reference: `feature/account-data-merge` at `7ab1a88`, especially
`account-merge/destination.ts`, `presentation.ts`, `preview.ts`, and its lifecycle document.
These illustrate explicit eligibility, typed views, child composition, and issued-effect settlement.

- Model states, observed facts, events, actor ownership, typed outcomes, and cleanup before effects. Sequential business decisions belong in guarded transitions or focused children; wrapping branching functions in `fromPromise` is insufficient.
- Keep machines in `src/lib/machines/`. Page/integration components bind Jazz subscriptions, dependencies, and actor lifecycle and compose pure presentation.
- Guards may use pure policy predicates. Keep transformations, validation, defensive invariants, platform disposal, and atomic transaction checks as functions. Do not make an actor for every predicate.
- Context holds facts, payloads, counters, actor references, and results, not duplicate lifecycle flags.
- Selectors project model choices into discriminated view variants; tags express shared capabilities and metadata may provide message descriptors. Selectors must not reclassify business outcomes. Presentation localizes and formats.
- Displayed capability and guarded event acceptance share a policy and receive current observations. A disabled callback outside the machine is insufficient.
- Keep generic form mechanics reusable; compose focused domain children instead of teaching one form machine every entity's rules.
- Keep simple disclosure/input local. Recovery phrases require identity-bound cleanup. Review dialog close-during-save semantics when touching form integration; dialog visibility alone does not require a machine.
- Supervise child errors and verify nested transitions reach view subscribers. Await asynchronous cleanup before stopping owners; do not infer cancelled writes from actor disposal.

## Proposed slices and progress

All slices below are delivered. The later completion batches and refinements were
explicitly authorized for execution/testing and await the combined review; earlier
approved review cycles remain recorded in the history below.

| Slice | Scope                                                                                                                                                                                                  | Requirements           | Model reviewed                                | Implementation reviewed                          | Verified |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------- | ------------------------------------------------ | -------- |
| 1     | Account archiving: readiness/access, per-account capability, scoped request, persistence result, teardown.                                                                                             | FR-001–007, FR-009     | Approved                                      | Approved                                         | Passed   |
| 2     | General forms refactor: shared machine/controller/view contract, domain-child composition, submission guards, typed feedback, reset/reopen/close and teardown semantics. See detailed subcycles below. | FR-002–006, FR-009–012 | Approved                                      | Approved                                         | Passed   |
| 3     | Account creation: existing access actor composed with shared create/write lifecycle.                                                                                                                   | FR-001–007, FR-009     | Approved                                      | Combined review pending                          | Passed   |
| 4     | Category and tag management: shared editing policy, protected/reference checks, create/archive outcomes.                                                                                               | FR-001–007, FR-009     | Execution authorized                          | Combined review pending                          | Passed   |
| 5     | Workspace rename and profile name/avatar editing.                                                                                                                                                      | FR-001–007, FR-009     | Rename approved; profile execution authorized | Rename approved; completion changes await review | Passed   |
| 6     | Transaction entry: prerequisites, account grants, exact scoped references and typed outcomes.                                                                                                          | FR-001–007, FR-009     | Execution authorized                          | Combined review pending                          | Passed   |
| 7     | Discriminated bank presentation and independent history; provider behavior retained.                                                                                                                   | FR-001–007, FR-009     | Execution authorized                          | Combined review pending                          | Passed   |
| 8     | Identity-bound recovery phrase lifecycle, confirmation and teardown cleanup.                                                                                                                           | FR-003–009             | Execution authorized                          | Combined review pending                          | Passed   |

## General forms work: slice 2

This is implementation work on the shared forms layer, not just documentation of
an integration contract. Use evidence from account archiving to keep the design
concrete. Review and verify each subcycle before beginning the next.

- [x] **2a — Model the shared contract:** inventory `form.ts`, `forms.svelte.ts`, `FormContent.svelte`, `FormModal.svelte`, and representative consumers. Define shared events, observed capabilities, domain-child ownership, typed view/results, reset/reopen behavior, and error boundaries. Map FR-010–012 to the model. Approved model: [forms.md](forms.md).
- [x] **2b — Implement machine/controller ownership:** move submission policy out of controller-only `disabled || busy` checks and into guarded event acceptance. Forward current observations; define scope replacement, cancellation, and issued-effect settlement explicitly. Keep DOM/FormData adaptation in integration and pure input validation reusable. Four-file implementation approved; 27 new unit/adapter tests plus five legacy regressions and application type checks passed. Browser integration limits remain for 2c/2d.
- [x] **2c — Implement shared presentation:** give form components typed feedback/capabilities instead of requiring repeated `matches('error') || matches('invalid')`, raw-error interpretation, or independent busy/disabled policy. Preserve field issues, localization, accessibility, and simple local dialog visibility; explicitly define close-during-save behavior. Five-file implementation approved; 35 relevant unit/adapter tests and four focused browser scenarios passed. Domain adoption remains for 2d and later slices.
- [x] **2d — Adopt in one representative form:** demonstrate composition with domain authorization/preparation/persistence children and accurate outcomes. Move business branches out of its save callback while retaining atomic write-time invariants. Verify child transitions reach the view. Concrete workspace rename model and six-file scope are prepared in [workspace-rename.md](workspace-rename.md); the revised shared-lifecycle model/implementation and edit-mode refinements are approved; 76 relevant unit tests and nine browser scenarios passed.

Each checkbox represents a focused review cycle with model review, implementation
review, and approved unit/Playwright verification recorded separately. Split again
if a proposed file set grows beyond the repository's review limit. Later slices
adopt this shared contract incrementally; do not migrate all consumers at once.

## Coverage of the original review

| Suggestion                                                          | Tracked work                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| Form readiness and authorization in focused machines                | Slices 1, 3–6; shared composition in 2a/2d           |
| Typed views instead of unrelated booleans                           | 2c and slice 7; applied in subsequent consumers      |
| One policy for displayed actions and accepted events                | 2b and domain adoption in slices 1, 3–6              |
| Explicit transaction prerequisites and blocked reasons              | Slice 6                                              |
| Generic form mechanics composed with domain workflows               | 2a, 2b, 2d; FR-010–012                               |
| Scope changes, cancellation, and issued writes as explicit outcomes | 2b/2c and every affected domain slice                |
| Recovery phrase lifecycle and cleanup                               | Slice 8                                              |
| Selectors project decisions without making new ones                 | Architectural direction; model review for each slice |

## First cycle proposal: account archiving

Candidate files: `src/routes/accounts/+page.svelte`, `src/lib/components/AccountList.svelte`,
a focused account-archive machine, and a matching type module only if needed.
Inspect current query/access contracts and actual persistence cancellation guarantees before finalizing.
Do not broadly rewrite account creation, shared forms, or data adapters in this cycle.

Proposed outline, subject to model review:

```text
observing -> loading | unavailable | ready
ready -> authorizing request -> persisting -> succeeded | failed
authorization -> denied | scopeChanged
scope replacement / cancel / shutdown -> settle issued work -> terminal cleanup
```

The reviewed chart must define whether readiness and active work need separate
child ownership, how capabilities update, what issued writes can cancel, and how
old completions are isolated. This outline is not an approved statechart or proof
that persistence is abortable.

## Review protocol and evidence

1. Record exact file scope and map affected requirements/acceptance scenarios.
2. Show statechart, events, context facts, actor tree, results, and teardown for review before effects.
3. Implement only the focused cycle, format related files, and present implementation for review. Record approval with a conversation reference or user-provided identifier.
4. After implementation approval, add meaningful unit and Playwright coverage and run relevant checks. Cover view/action agreement, scope changes, late events, issued-write settlement, and cleanup where applicable.
5. Record actual commands/results and limitations. Mark verified only after relevant coverage passes, then begin the next approved cycle.

A detailed `tasks.md` follows reviewed design. This roadmap tracks pending work
without implying implementation approval. No application code, tests, branch,
commit, schema migration, server, or provider operation is part of this documentation cycle.

## Slice 1 verification

See [tasks.md](tasks.md#approved-verification) for commands, environment workarounds,
and coverage limits. Thirteen machine tests, one offline/reload browser scenario,
application/test type checks, and focused formatting checks passed. No application
changes were needed during the approved test cycle. Review this evidence before
starting slice 2a (general forms model).

## Slice 2a review

The shared contract is proposed in [forms.md](forms.md). It defines additive
migration, domain availability/operation composition, guarded events, typed
presentation, draft revisions, close-versus-cancel semantics, and settlement of
issued effects. Workspace rename is proposed for 2d and is not repeated in slice 5. Completing 2a means the model is written; the model-review column for slice 2
is approved by user continuation. Slice 2b adds a scoped API beside the legacy path; production consumers remain unchanged.

## Slice 2b verification

The user explicitly approved implementation with "I approve. continue". Focused
verification passed: 27 new tests cover owner/submission transitions, interruption
and issued-effect settlement, payload cleanup, and controller adapters; five legacy
form regressions also passed. Application checking passed with zero errors/warnings.
No production implementation changes were needed. An older installed UI package
was restored to the exact archive already selected by the committed lockfile;
no tracked dependency files changed.

See [tasks.md](tasks.md#approved-slice-2b-verification) for commands and limits.
Controller tests exercise the compiled server adapter with explicit mount hooks;
client reactive effects, DOM reset/rebuilds, and actual modal behavior still require
the scheduled browser adoption checks. No server or Playwright run was needed in
this additive cycle. Review this evidence before beginning slice 2c.

## Slice 2c verification

The user approved continuation after reviewing the implementation and manual
preview. Thirty-five relevant unit/adapter tests, four browser scenarios,
application/test type checks, and focused formatting/diff checks passed. No
production code changes were needed. See [tasks.md](tasks.md#approved-slice-2c-verification)
for commands, fixture setup corrections and limits.

The browser harness exercises the real scoped controller/shared components with
controlled operation actors; a real account-modal regression also passed through
the legacy adapter. These results establish shared presentation behavior, not
new domain authorization or Jazz settlement guarantees. Review this evidence
before workspace rename adoption (2d).

## Slice 2d and shared edit-mode verification

The user approved the implementation and refinements with "continue". Seventy-six
unit tests and nine focused browser scenarios passed, along with application/test
and configuration type checks plus focused formatting/diff checks. No production
fixes were needed during verification. See [tasks.md](tasks.md#approved-slice-2d-verification-including-shared-edit-mode)
for commands, test-only corrections and coverage limits.

Workspace rename is the first production consumer of the scoped owner/submission
and reusable single-write base. It opts into edit mode; creation retains its
existing behavior, and stable submit labels apply across existing form components.
Domain permission/navigation races are covered by controlled machines, while real
browser scenarios cover local offline save/reload and owner/admin/member/viewer
access. Other domain forms still need their separate adoption cycles. Review this
verified cycle before starting the account-creation slice.

## Slice 3a: account creation audit/model

The prior verified cycle was accepted through user continuation. The concrete
[account-creation model](account-creation.md) proposes reusing the existing access
actor through a revision-aware readiness adapter and composing the shared create
owner/submission/single-write base. It records first-account self-unmount, opaque
modal scope keys, blocked-form inspection and the six-file implementation scope.
Review this model before effects; no application changes or tests were made in
this documentation cycle.

Slice 3a implementation is now prepared for review in the approved six-file
scope. It reuses the existing access policy and shared create/write lifecycle.
Static application checks pass. Focused runtime verification remains pending
implementation approval; no tests were added or run in this cycle.

## Authorized combined completion

All remaining slices and their tests are complete under the user's explicit
combined-review authorization. `remaining-work.md` records the model and actual
integration corrections; `review.md` maps the implementation to review routes.
The final generic refinements (request assessment projection, controlled input,
success reset and immutable observation snapshots) are included in that review.

Final browser runs: workflow completion 37; bank/readiness 7; shared forms 5;
workspace rename access 4; account archive 1. All passed, totaling 54 scenarios.
Final unit run: 389 passed in 28 files. Static/type/format checks passed.
See tasks.md for exact commands, intermediate corrections and coverage limits.
This is automated verification, not a claim that the pending user review occurred.
