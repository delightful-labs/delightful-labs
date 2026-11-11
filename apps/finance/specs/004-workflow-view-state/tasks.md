# Tasks: workflow and view state

Focused cycles only. Later slices remain tracked in delivery.md and receive
their detailed tasks after the preceding cycle is reviewed. No parallel tasks.

- [x] T001 Inspect account archiving, permissions, and persistence semantics; document first-slice model in account-archive.md and planning boundaries in plan.md.
- [x] T002 Obtain review of account-archive.md model and file scope; record review reference here. This gates effects.
- [x] T003 Implement the reviewed owner/operation machines and typed view contracts in src/lib/machines/account-archive.ts and account-archive-operation.ts.
- [x] T004 Integrate observations/lifecycle in src/routes/accounts/+page.svelte and typed presentation in AccountList.svelte; add required localized messages only. T003/T004 form one implementation review batch.
- [x] T005 Format changed files and present the exact implementation for review; record approval before adding/running tests.
- [x] T006 After T005 approval, add relevant machine and account-page Playwright coverage, then run only relevant checks and record results/limitations.
- [x] T007 Record slice status in delivery.md and show the verified cycle before starting general forms work.

## Evidence

T001: static inspection found archiveAccount uses db.update(...).wait({ tier:
local }) with no abort parameter; no tests added or run. Model review pending.

T002: user approved continuation after the model was presented. T003/T004:
implemented in the proposed five-file batch; implementation review pending.
Validation: `pnpm check` passed, including message generation, Svelte checking
(zero errors/warnings), and service-worker TypeScript checking. `git diff --check`
passed. Tests were neither added nor run; runtime verification remains gated on
implementation approval at T005.

## Approved verification

T005: user accepted the implementation after reviewing the flat terminal-state
choice ("ok. keep as is and continue"). Test additions/runs were authorized then.

T006/T007:

- `pnpm test:unit --run src/lib/machines/account-archive.test.ts`: 13 passed.
- `pnpm check`: passed; zero Svelte errors/warnings.
- `pnpm check:tests`: passed.
- Focused Playwright account-archive scenario: 1 passed (offline archive,
  unaffected second account, and local persistence after reload).
- Browser invocation: `pnpm exec playwright test --config .svelte-kit/account-archive.playwright.ts`.
  This ignored temporary config extends the committed account-archive config,
  allows this worktree's externally linked node_modules path, and uses port 5181.
  The standard committed config is `playwright.account-archive.config.ts` and uses
  the existing isolated in-memory Jazz setup. Normal local dependency installation
  does not require this worktree-specific Vite path workaround.
- Initial browser attempts encountered sandbox listener restrictions, linked-WASM
  serving restrictions, and an outdated test button label; the successful run
  followed resolution of those environment/fixture issues. No production changes
  were needed during verification.

Coverage limits: browser permission-change and teardown races are covered by
machine tests rather than a multi-user browser scenario. These checks do not
establish remote acceptance or cross-device synchronization; archive success is
local persistence. General forms work has not started; this cycle is ready for
review of its verification evidence.

## Shared forms model: slice 2a

- [x] T008 Inspect shared form machine/controller/components, representative consumers, and persistence/resource semantics; propose the model in forms.md. Maps FR-010–012.
- [x] T009 Review forms.md: approve ownership, close/reset/reopen policy, additive migration strategy, first adoption, and proposed slice 2b file scope. This gates shared-form effects.

T008 evidence: static inventory of account/category/tag forms, workspace/profile
editing, transaction entry, and avatar transformation; no application changes,
test additions/runs, or server startup. Model was subsequently approved by the user's continuation instruction.

T009: user approved continuation after the shared model was presented.

## Shared form ownership: slice 2b

- [x] T010 Add props-only contracts in src/lib/form-contract.ts and the submission child in src/lib/machines/scoped-form-submission.ts, composing supplied domain operation logic with validation and explicit settlement.
- [x] T011 Add the owner and supervised availability integration in src/lib/machines/scoped-form.ts, plus additive createScopedFormController in src/lib/forms.svelte.ts. Keep legacy exports/consumers unchanged.
- [x] T012 Format the four-file implementation and run static checking; present for implementation review.
- [x] T013 Obtain approval of the exact slice 2b implementation before adding/running its tests.
- [x] T014 After T013, add focused machine/controller coverage for revisions, direct-event submission guards, reset/reopen, validation/operation cancellation, scope changes, child failures, and teardown. Record actual results and remaining browser integration limits.
- [x] T015 Show verified 2b evidence before beginning shared presentation slice 2c.

T010–T012: implemented the reviewed four-file batch. `pnpm check` passed with
zero Svelte errors/warnings, including generated messages and service-worker
TypeScript checking. No tests added/run, no server started, and no consumers
migrated in this cycle. Static checking does not establish runtime correctness
or successful domain composition; the first production adoption remains slice 2d.

The owner supervises snapshot projection in an availability wrapper, guards
reports by observation revision/scope, and explicitly models awaiting/current
readiness. Submission and owner both preserve interruption priority across queued
completions; the child retains validation and domain-operation invocations until
settlement. Context payload cleanup uses terminal entries rather than relying on
actor stopping or machine-root exit. Controller reset emits a draft revision;
actual field rebuilding belongs to presentation adoption in 2c.

## Approved slice 2b verification

T013: user explicitly approved the exact four-file implementation: "I approve. continue".

T014/T015: added `src/lib/machines/scoped-form.test.ts`,
`src/lib/machines/scoped-form-submission.test.ts`, shared typed test fixtures in
`src/lib/machines/scoped-form.fixture.ts`, and `src/lib/forms.test.ts`.
No production code changes were needed.

- `pnpm test:unit --run src/lib/forms.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/form.test.ts`: 32 passed (27 new, five legacy regressions).
- `pnpm check`: passed; zero Svelte errors/warnings, including service-worker TypeScript checking.
- Focused Prettier checks and `git diff --check`: passed.

Coverage includes capability/direct-event agreement, stale observation revisions
and mismatched scopes, duplicate/reset/reopen guards, child-driven view updates,
void success, validation issues versus unexpected errors, validation settlement
before cancellation/shutdown, operation error supervision, committed/rejected
settlement after permission loss, scope replacement away and back, availability
projection failure/retry, interruption priority, and terminal payload cleanup.
Controller adapter coverage checks synchronous observation refresh, FormData
Files/repeated fields, native event prevention, and unmount shutdown without
prematurely aborting issued work.

Controller tests compile the server adapter and explicitly invoke mocked Svelte
mount hooks. They do not verify client reactive effects, actual DOM field rebuilds,
framework hook ordering, or dialog close/reopen rendering. No Playwright test or
server was started because this additive API has no production consumer yet.
Those browser integration limits remain assigned to presentation/adoption slices
2c/2d and the later modal adoption; 2b passing does not establish them.

The initial application check found ten missing-export errors from an installed
`delightful-ui` pointing to the older caret-position archive. The repository's
package.json/lockfile already select the typography-primitives archive. Offline
pnpm installation declined module-directory replacement without a TTY; restored
only that exact vendored archive and its local dependency links in ignored
node_modules, then reran successfully. No tracked dependency changes.

Slice 2b verification evidence is presented for review before starting 2c.

## Shared presentation: slice 2c

- [x] T016 Review the approved forms.md presentation model and concrete five-file scope; accept 2b verification via the user's "continue" instruction.
- [x] T017 Add a props-only shared rendering contract and a narrow legacy view projection in src/lib/form-contract.ts and src/lib/machines/form.ts; bind it in src/lib/forms.svelte.ts without changing legacy machine transitions.
- [x] T018 Update FormContent.svelte and FormModal.svelte to consume typed content/activity/capabilities, rebuild scoped fields by accepted draft revision, and distinguish busy Close from workflow cancellation. Keep legacy snippets and call sites compatible.
- [x] T019 Format and statically check the five-file implementation, then present it for review.
- [x] T020 Obtain approval of the exact 2c implementation before adding/running tests.
- [x] T021 After T020, verify legacy projection and shared presentation, including field disabling, accepted/rejected reset, void success, and modal close/reopen behavior. Record browser limits separately from later domain adoption.
- [x] T022 Show verified 2c evidence before beginning workspace rename adoption (2d).

T016: user accepted the prior verification and authorized continuation: "continue".
The five implementation paths were shown before edits; the approved forms.md
model supplies the behavior policy. No new workflow machine or domain migration.

T017/T018: shared components now require only FormPresentation and preserve the
specific caller's view type in their snippets. ScopedFormView satisfies this
contract directly. Legacy FormView retains its snapshot/busy/disabled/issues
fields through selectLegacyFormView, and gains a rendering-only projection.
It deliberately reports no persistence settlement or new authorization guarantee.

FormContent keys only the fields subtree by draftRevision and uses an unstyled
native disabled fieldset to apply fieldsEditable consistently. Scoped accepted
reset/reopen/scope replacement can rebuild native controls; rejected reset does
not change the key. Legacy revision remains undefined so its native reset and
parent component state are not implicitly remounted. Parent-owned local state
such as avatar selection/payment disclosures still needs explicit adoption.

FormModal consumes the typed content choice (including void success), submit/open
capabilities, and activity. Closing uses existing localized Close while busy,
preserves mounted draft controls, and emits no cancellation/reset. Scope changes
still close and key-replace the modal's contents. Scoped callers omit the legacy
disabled prop and use canOpen, so busy reopening is supported by the owner. Existing
legacy callers retain their explicit disabled-trigger behavior until migration.

No tests added/run or development server started for this unapproved implementation.

T019: `pnpm check` passed with zero Svelte errors/warnings, including generated
messages and service-worker TypeScript checking. Focused Prettier checks and
`git diff --check` passed. These static checks do not establish runtime or browser
correctness. The exact five-file implementation is presented for review; T020
remains pending. No tests were added or run for slice 2c.

## Approved slice 2c verification

T020: following the implementation review and manual-preview dependency-cache
fix, the user instructed "continue". This approved the exact shared presentation
implementation for focused verification.

T021/T022: added three legacy adapter unit tests, the test-only scoped harness
under `src/lib/testing/form-presentation/`, four focused browser scenarios in
`tests/form-presentation.e2e.ts`, and `playwright.form-presentation.config.ts`.
No production implementation changes were needed during verification.

- `pnpm test:unit --run src/lib/machines/form-presentation.test.ts src/lib/machines/form.test.ts src/lib/forms.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts`: 35 passed (three new adapter tests and 32 relevant regressions).
- `pnpm check`: passed; zero Svelte errors/warnings, including the source-directory Svelte harness and service-worker TypeScript checking.
- `pnpm check:tests`: passed.
- `pnpm exec playwright test --config playwright.form-presentation.config.ts`: four passed, using the existing isolated in-memory Jazz configuration on port 5180.
- Focused Prettier checks and `git diff --check`: passed.

Browser checks cover reactive access observations, disabled fieldsets/submit,
accepted native reset rebuilding fields, rejected reset retaining the same busy
field node/value/revision, child-driven activity/aria-busy updates, Escape and
backdrop draft preservation, busy Close/reopen retaining one operation without
cancellation, void success presentation, fresh successful reopen, and scope
replacement closing/resetting a modal. A real account-modal regression covers
legacy validation, draft dismissal, local save feedback and fresh reopen.

The deterministic scoped harness supplies controlled observation and persistence
actors; it uses the real scoped controller and shared components. Its operations
are synthetic and do not establish domain authorization or real Jazz write
settlement for a migrated scoped consumer. Workspace rename adoption (2d) and
the later modal domain adoption still require their own coverage. Parent-owned
avatar/payment disclosure state and domain teardown races remain in their planned
adoption slices; no broader domain migration is implied by these passing checks.

Initial browser attempts exposed fixture setup issues only: SvelteKit did not
serve a standalone tests-directory HTML entry, and its Vite allowlist excluded
that directory's modules. Playwright now supplies a test-only document and loads
the harness from the existing allowed source directory. No production route or
broader filesystem allowlist was added. Browser checks ran after unit/type checks.
Slice 2c verification is presented for review before beginning 2d.

## Workspace rename domain model: slice 2d-a

- [x] T023 Inspect workspace subscriptions, rename validation/helper, authoritative Jazz permissions and actor binding lifecycle; document the concrete domain statechart, result guarantees and six-file scope in workspace-rename.md.
- [x] T024 Obtain review of workspace-rename.md before implementing domain effects. Shared form approval alone does not establish the concrete domain implementation.

T023: the user accepted 2c verification and requested continuation. Inspection
confirmed owner/admin SDK organization-update permissions, a local wait with no
abort API, and page-only policy/save branching. The proposed model composes one
readiness assessment in availability and operation authorization, binds requests
to identity/workspace/database, and retains issued writes through settlement.
No application code changed and no tests were added/run in this model cycle.
Detailed implementation tasks follow review of T024; the six proposed paths are
recorded in workspace-rename.md.

T024 model refinement: the user clarified that forms must share base form machines
and add special actors only for their unique actions. Revised workspace-rename.md
to replace the proposed workspace-specific operation lifecycle with reusable
`scoped-form-write.ts`. Workspace-specific actors own readiness/authorization and
the rename action; shared bases own preparation orchestration, interruption,
cleanup and issued-write settlement. The implementation scope remains six files.
No implementation or test changes were made for this refinement.

T024 approval: after reviewing the proposed model and clarifying that forms share
base machines with only domain-specific actors/actions, the user instructed
"continue". The revised six-file model was authorized before implementation.

## Shared write base and workspace adoption: slice 2d-b

- [x] T025 Implement reusable single-write lifecycle in src/lib/machines/scoped-form-write.ts, composing the supplied readiness actor and focused write adapter, with explicit freshness/scope, denial/unavailability, interruption and settlement states.
- [x] T026 Add workspace contracts/policy composition, wire the page to the scoped controller, and render typed readiness/results in WorkspaceNameForm.svelte; add only required localized messages. T025/T026 form one six-file implementation review batch.
- [x] T027 Format and statically check the exact implementation, then present it for review.
- [x] T028 Obtain approval of the exact 2d-b implementation before adding/running tests.
- [x] T029 After T028, add/run focused shared-write/domain tests and workspace Playwright coverage for access, validation, scope/freshness, offline local persistence, issued-write settlement, child failures and teardown.
- [x] T030 Show verified 2d evidence before starting the next form adoption.

T025/T026 implementation: one generic shared write base handles refreshing,
request scope, supervised policy projection, write invocation, interruption
priority, actual settlement and terminal payload cleanup. Its focused write
callback runs in a promise actor and contains no business workflow. The existing
shared owner/submission continue owning validation, duplicate protection,
capabilities, reset/reopen and parent lifecycle.

Workspace code supplies a resource-free policy chart, pure scope identity
functions, the existing name schema and a single rename update. The same chart
is used for availability and pre-write authorization. There is no workspace-specific
write-settlement machine. SDK permissions and renameWorkspace remain unchanged.
Rejected waits conservatively yield unknown settlement; they do not claim that
an optimistic local update was rolled back.

The page binds observations and dependencies; the presentation receives name,
WorkspaceRenameView and callbacks without actor/controller imports. Loading,
read-only, missing workspace, read failure, session/binding unavailability,
validation, local success and interrupted/uncertain outcomes are localized.
No tests added/run for this implementation; runtime verification awaits T028.

T027: `pnpm check` passed with zero Svelte errors/warnings, including generated
messages and service-worker TypeScript checking. Focused Prettier checks and
`git diff --check` passed. Static checking does not establish runtime correctness.
The exact six-file implementation is presented for review before T028/T029.
The existing local preview is restarted after generated-environment checks for
manual review; automated unit/Playwright verification has not started.

## Requested review refinements: shared form mode and stable labels

The user requested unchanged edits disable Save, all submit labels stay stable,
and create/edit behavior be configured on the shared machine. This steers the
pending 2d implementation review; T028 remains pending for the revised result.
The eleven-file related refinement scope was explained before editing. See forms.md
for the common mode model and exact paths; no new domain consumer was migrated.

- [x] T031 Add shared create/edit startup configuration and CHANGE observations; guard edit submission against the observed baseline without disabling pristine fields. Keep create mode as the default.
- [x] T032 Wire workspace rename to edit mode and shared input observation; keep modal/workspace/profile/avatar/transaction submit labels stable while preserving busy disabling and accessibility.
- [x] T033 Format/type-check the refined implementation and present it together with the pending 2d batch for approval. Do not add/run tests before approval.

Edit mode requires initialValues and valuesEqual; create mode requires neither.
The shared owner keeps raw draft data only for editing. Direct SUBMIT checks its
actual values against the current saved baseline, and view.canSubmit probes the
same guard with the observed draft. fieldsEditable probes CHANGE independently.
Workspace comparison uses trimmed names; resetting, changing scope or shutting
down clears tracked drafts. The modal savingLabel prop remains accepted for
compatibility, but submit labels no longer render a saving variant.

The revised tests must cover pristine edits remaining editable, changed/reverted
values, unchanged direct SUBMIT, reset/scope/baseline updates, create-mode regression
and stable labels while pending. Existing browser fixture assertions expecting
"Saving draft" will need updating after implementation approval; no tests were
added, changed or run for this unapproved refinement.

T033: `pnpm check` passed with zero Svelte errors/warnings, including generated
messages and service-worker TypeScript checking. Focused Prettier and
`git diff --check` passed. The revised create/edit mode and stable-label
implementation is presented for review; T028 approval remains pending.
No tests were added, changed or run for this refinement.

## Approved slice 2d verification, including shared edit mode

T028: the user instructed "continue" after reviewing the shared create/edit mode,
stable submit labels and workspace rename implementation. This approved the
revised implementation and its focused tests.

T029/T030: added workspace policy/edit-mode tests and shared single-write tests,
with a typed fixture; updated the shared presentation browser suite and relevant
workspace expectations; added playwright.workspace-rename.config.ts to select
only rename access scenarios using an owned isolated server. Six related test/
configuration files changed. No production fixes were needed during verification.

- `pnpm test:unit --run src/lib/machines/workspace-rename.test.ts src/lib/machines/scoped-form-write.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/form.test.ts src/lib/machines/form-presentation.test.ts src/lib/forms.test.ts`: 76 passed (41 new, 35 relevant regressions).
- `pnpm check`: passed; zero Svelte errors/warnings, including service-worker TypeScript checking.
- `pnpm check:tests`: passed.
- `pnpm exec tsc --project tsconfig.json --noEmit`: passed after the final test-server configuration adjustment.
- `pnpm exec playwright test --config playwright.form-presentation.config.ts`: five passed.
- `pnpm exec playwright test --config playwright.workspace-rename.config.ts`: four passed (owner/admin/member/viewer).
- Focused Prettier checks and `git diff --check`: passed.

Unit coverage includes all domain blocked reasons and direct-event denial,
owner/admin eligibility, pristine fields remaining editable, changed/reverted and
trimmed-name comparisons, reset/scope/shutdown draft cleanup, changed saved
baselines, create-mode regression, direct-submit validation/correction, fresh
permission checks before effect issue, and permission loss during an issued write.
The shared base tests cover observation/projection failure, stale refresh reports,
pre-write cancellation/invalidation/shutdown, unavailable versus denied outcomes,
issued-write settlement, unknown outcome after rejection, interruption priority,
replacement binding and terminal payload cleanup.

Browser coverage retains the four shared/legacy presentation regressions, with
stable modal submit labels while an operation is deliberately pending. The new
real workspace scenario verifies changed/reverted/whitespace states, correction,
offline local persistence, unchanged Save after success/reload, and subsequent
editing. The focused existing workspace suite verifies owner rename/validation/
reload, shared-admin rename, and member/viewer read-only UI plus authoritative
SDK rejection of forbidden writes. Return-to-own-workspace expectations now
require editable fields and disabled Save until changed.

Coverage boundaries: delayed real-write permission/navigation races remain
machine-controlled tests; the real browser update is deliberately fast. The
existing shared controller teardown tests also remain relevant. Separate delayed
profile/avatar/transaction browser fixtures were not added for the simple stable
label changes. Those domain forms retain legacy controllers until their planned
adoptions; only workspace rename currently opts into the shared edit mode. No
remote-acceptance claim is inferred from the local offline save result.

Initial test setup corrections: parent snapshots do not report every descendant
write-start transition, so the fixture now observes the write spy directly;
TypeScript required an explicit create-mode literal in the fixture. Initial
browser access checks retained old enabled-Save expectations for unchanged
content; these were updated. A retry briefly reused a shutting-down test server;
the dedicated rename config now owns a fresh isolated server. Successful results
above followed these test-only corrections. Unit/type checks preceded browser
runs; the manual preview is restored afterward.

Shared forms slice 2 (2a–2d) is now verified for its reviewed scope. This evidence
is presented for review before the next domain adoption; the overall feature
still has the remaining surfaces listed in delivery.md.

## Account creation model: slice 3a

- [x] T034 Accept the prior verification through user continuation; audit AccountCreation, AccountForm, existing access actor, persistence/SDK policy and first-account lifecycle. Propose the six-file model in account-creation.md.
- [x] T035 Obtain review of account-creation.md, including reuse of the existing access actor, scope/revision adapter, opaque modal scope keys and blocked-form inspection, before implementation effects.

T034: user instructed "continue" after 76 unit tests/nine browser scenarios were
presented. Inspection confirmed an existing owner/admin policy actor worth reusing,
legacy controller/save branching, a non-abortable local insert, and empty-account
views that can unmount creation on its own optimistic insert. The proposal composes
the existing actor through an adapter and uses the verified shared create-mode
owner/submission/single-write lifecycle. No application changes or tests in this
model cycle; implementation tasks follow T035 review.

- [x] T036 Implement the approved six-file account-creation adoption; format affected files and check application types. Present for implementation review.
- [x] T037 After implementation approval, add and run focused account readiness/composition and browser coverage described in account-creation.md.

T035–T036: user continuation approved the concrete model. AccountCreation now
binds observations/effect to one scoped create owner; AccountForm is props-only.
The revision-aware adapter invokes the existing owner/admin policy actor and the
operation composes the shared single-write base. Policy initialization accepts
optional revisioned input (existing OBSERVE/no-input usage remains supported),
avoiding a startup send race. Older capability revisions remain older while the
replacement child assesses. Modal scope accepts opaque keys; blocked inspection,
stable Add labels and localized conservative settlement messages follow the model.

`pnpm check` passed with zero Svelte errors/warnings and service-worker types.
Prettier applied only to the six implementation files. No tests added or run;
this is static validation, not runtime evidence. T037 awaits implementation review.

## Authorized completion while user is away

User: "can you finish this Xstate work including tests? I will review it all
together when I'm back". This authorizes implementation and test work across the
remaining slices without intermediate review pauses. See remaining-work.md for
statecharts, file batches and verification plan. No commit is authorized.

- [x] T038 Complete category management policy, shared form adoption and archive outcomes; verify.
- [x] T039 Complete tag management policy, shared form adoption and archive outcomes; verify.
- [x] T040 Complete profile name/avatar edit-mode adoption and ownership; verify.
- [x] T041 Complete transaction readiness/access/reference assessment and scoped create form; verify.
- [x] T042 Complete discriminated bank presentation with independent history; verify.
- [x] T043 Complete identity-bound recovery phrase lifecycle/cleanup; verify.
- [x] T044 Run relevant integration/regression checks, reconcile spec/task evidence and restore preview for combined review.

## Completion verification: shared and domain units

The latest user authorization replaces the earlier per-slice approval/test pauses.
All model/file batches are recorded in remaining-work.md. Implementation and
model review are pending the combined review; execution/testing were authorized.

Final unit command:

```sh
pnpm test:unit --run src/lib/observations.test.ts src/lib/machines/account-creation.test.ts src/lib/machines/account-creation-access.test.ts src/lib/machines/management.test.ts src/lib/machines/profile.test.ts src/lib/machines/profile-avatar.test.ts src/lib/machines/transaction-entry.test.ts src/lib/machines/recovery-phrase.test.ts src/lib/machines/scoped-form-write.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/workspace-rename.test.ts src/lib/machines/bank-sync src/lib/machines/account-archive.test.ts src/lib/machines/form.test.ts src/lib/machines/form-presentation.test.ts src/lib/validation src/lib/forms.test.ts
```

389 passed in 28 files. This includes domain blocked reasons, exact request
references and fresh permission checks, raw-file success cleanup, legacy/shared
form regressions, bank lifecycle/history/view regressions and canonical validation.
Recovery tests use synthetic values and cover confirmation gating, failure/retry,
hide, identity/binding replacement, shutdown and discarded late reveals.

`pnpm check` passed (zero Svelte errors/warnings and service-worker types),
`pnpm check:tests` passed and `pnpm exec tsc --project tsconfig.json --noEmit`
passed. Changed files use repository Prettier formatting; diff whitespace checks
pass. Unit/type generation finishes before browser servers start.

Corrections made during browser verification:

- Controlled avatar input reports actual selection via a callback. Shared
  resetOnSuccess releases draft Files and rebuilds native controls while retaining
  success feedback. Scalar derived revisions prevent ordinary actor views from
  resetting a new file selection or payment disclosure.
- Jazz merges query rows/arrays in place. Observation adapters now copy row fields
  inside integration effects before untracked actor delivery. This fixed first
  account readiness offline and makes same-row permission changes observable.
- Transaction fields now mount after readiness so native Select defaults initialize
  with loaded options. The owner remains mounted through unavailable/settling
  states, with typed feedback outside the fields.
- Existing browser selectors were updated to current app labels and Manage accounts
  navigation. Success-modal tests now Close/reopen instead of pressing a submit
  button on a success panel. Read-only creation dialogs are inspectable but their
  fields/submit remain disabled; SDK rejection checks remain.
- The rejected transaction-tag scenario expects both generic failure and honest
  unknown settlement feedback, and still checks that the actual transaction left
  no partial rows before explicit correction/retry.

Focused interim runs passed all account, category, tag, profile and recovery
scenarios. The final full workflow and remaining bank/shared/archive regressions
are recorded separately below once complete. Real Jazz permission checks and
local offline/reload writes are browser-covered; deliberately delayed permission/
shutdown races remain controlled machine tests. No claim of remote acceptance,
physical-device passkey compatibility or interrupted-write rollback is made.

## Final workflow browser verification

`pnpm exec playwright test --config playwright.workflow-completion.config.ts --max-failures=1`:
**37 passed** in the final uninterrupted run. The config owns a fresh isolated
in-memory Jazz server at port 5180; recovery-containing scenarios disable traces,
screenshots and video. No live provider credentials or user preview database is used.

Coverage includes account cash/bank/card validation/reopen/scope, offline first
account readiness and reload, admin creation plus live same-row role revocation,
member/viewer blocked inspection and SDK denial; category/tag creation, history,
counts, protected categories, all roles and offline archives; expense/income and
check details, defaults/override/reset/workspace references, tag atomic failure/
correction and offline creation; own-profile editing/offline attribution, dirty
name behavior, avatar size/type/decode/retry/resources/offline handling; and
recovery phrase confirmation plus Close/Escape/backdrop/reopen clearing.

Initial failures/interrupted runs were corrected as described above. The final
37-pass run followed all implementation and assertion corrections. The final
unknown-settlement assertion also checks actual absence of partial transaction
rows and successful explicit retry. Remaining regression suites are recorded next.

`pnpm exec playwright test --config playwright.bank-sync.config.ts`: **7 passed**.
Covers offline setup/connected views, no reconnect-triggered provider operation,
explicit passkey setup/discovery/mapping/sync, idempotent imports and history,
provider failure/retry, rejected relay destinations, lock startup failure, late
passkey cancellation and application startup recovery. Provider and passkey
adapters are synthetic browser fixtures; physical-device compatibility remains
outside this behavior-preserving presentation work.

## Final regression evidence

- `pnpm exec playwright test --config playwright.form-presentation.config.ts`: **5 passed** (shared reset/capability, stable labels, dismissal/reopen, scope isolation, actual account creation and workspace edit/offline behavior).
- `pnpm exec playwright test --config playwright.workspace-rename.config.ts`: **4 passed** (owner/admin/member/viewer UI and SDK access).
- `pnpm exec playwright test --config playwright.account-archive.config.ts`: **1 passed** (local offline archive, other-account preservation and reload).

Together with workflow completion (37) and bank/readiness (7), **54 browser
scenarios passed in the final successful runs**. No application changes followed
these runs; subsequent work only reconciles documentation and restores preview.
The normal Vite preview is restored at http://127.0.0.1:5173 for combined review.
No commits, deployments, dependency changes or schema changes were made.
No implementation extension hooks are configured (.specify/extensions.yml absent).

T044 completed: restored the regular preview at http://127.0.0.1:5173 after all
checks, forced Vite dependency refresh, and confirmed HTTP 200 for /account,
/settings/categories and /expenses/new. Final documentation links model, changes,
verification and combined-review status. All task checkboxes are complete; user
review remains pending by their instruction. Changes remain uncommitted.

## Follow-up reuse cleanup (user-authorized batch)

The prior final evidence describes the pre-cleanup implementation. The user's
"Do all these" instruction authorizes all seven proposed simplifications together.
This batch changes composition, type inference and presentation reuse; existing
domain policy, actor ownership and settlement statecharts are retained.

- [x] T045 Implement all seven reuse/simplification items; map the resulting
      changes in review.md and remove obsolete legacy-only tests with their machine.
- [x] T046 After user review of T045, add any needed focused regression coverage
      and run the relevant scoped form, domain form, management and bank unit/browser
      checks. Earlier passing counts do not establish runtime verification of T045.

Static verification for T045 passed:

- `pnpm check`: zero Svelte errors/warnings; service-worker types passed.
- `pnpm check:tests`: browser-test types passed; no test execution.
- `pnpm exec tsc --project tsconfig.json --noEmit`: application/configuration/unit-test types passed.
- Repository Prettier formatting and `git diff --check` passed for the changed files.

The user's subsequent "run tests" instruction approved cleanup verification.
Existing regression coverage exercises the refactored compositions and consumers;
no additional tests were necessary for these behavior-preserving changes.

T046 verification passed:

- Relevant unit command: `pnpm test:unit --run src/lib/observations.test.ts src/lib/machines/account-creation.test.ts src/lib/machines/account-creation-access.test.ts src/lib/machines/management.test.ts src/lib/machines/profile.test.ts src/lib/machines/profile-avatar.test.ts src/lib/machines/transaction-entry.test.ts src/lib/machines/recovery-phrase.test.ts src/lib/machines/scoped-form-write.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/workspace-rename.test.ts src/lib/machines/bank-sync src/lib/machines/account-archive.test.ts src/lib/validation src/lib/forms.test.ts`: **381 tests in 26 files passed**.
- Workflow completion browser configuration: **37 passed**.
- Bank/readiness browser configuration: **7 passed**.
- Shared form presentation browser configuration: **5 passed**.
- Workspace rename browser configuration: **4 passed**.
- Account archive browser configuration: **1 passed**.

The **54 browser scenarios** ran sequentially after unit tests against a dedicated
in-memory Jazz server on http://127.0.0.1:5181. Temporary root-level configuration
wrappers imported each existing `playwright.<suite>.config.ts`, omitted its
`webServer`, and overrode only `use.baseURL` to that server. Commands used
`pnpm exec playwright test --config .xstate-cleanup-<suite>.config.ts --max-failures=1`.
The server command was `pnpm exec vite dev --config vite.e2e.config.ts --host 127.0.0.1 --port 5181 --strictPort`.
Sandbox listener/localhost restrictions required elevated local execution; the
initial sandboxed browser attempt was interrupted and rerun successfully. No
application regression failed. The temporary wrappers were removed and the
isolated server stopped afterward. Existing servers on 5173/5180 were retained.
Changes are uncommitted.
