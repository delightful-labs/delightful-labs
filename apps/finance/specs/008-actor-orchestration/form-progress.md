# Scoped form submission progress reports

Status: implementation reviewed and scoped runtime verification passed.

## State and communication model

The existing form → submission → operation ownership and cleanup lifetimes stay in place.
Submission owns validation and operation progress. It publishes `FORM_SUBMISSION_PROGRESS` with
request ID, captured scope revision and `validating`/`operating` when entering the corresponding
compound state. A typed recipient supplied at invocation binds messages to that form instance.
Standalone submissions can omit the progress recipient and still use finite invocation output.
Reports contain no values, observations, results or child snapshots.

The form's normal pending state contains `awaitingProgress`, `validating` and `operating` substates.
Only pending accepts progress, and only when both request ID and scope revision match its current
request and current scope revision. Cancellation, invalidation and closing remain sibling states
outside pending and therefore cannot be downgraded by a progress report. The parent derives
presentation from its own states, rather than storing a lifecycle flag or inspecting child tags.

```text
form.active (one retained submission invocation)
├── pending
│   ├── awaitingProgress
│   ├── validating  ← matching validating report
│   └── operating   ← matching operating report
├── cancelling
├── invalidated
└── closing
```

Finite results continue through the existing `onDone`/`onError` transitions. Scope replacement
increments the existing scope revision, including A → B → A; new requests use monotonically
increasing IDs. Old progress cannot revive completed work, target a later request or appear in a
replacement scope. Report recipient references are released with other submission payloads on
terminal cleanup. The parent no longer stores or subscribes to complete submission snapshots.

## Machine-first gate and scope

This change adds a leaf message action at existing validation/operation entry boundaries. It adds
no promise actor, I/O, resource, business branch or asynchronous workflow. Existing validation,
operation and completion invocations and their cancellation/error/cleanup paths are retained.
The hidden transaction persistence and avatar preparation workflows identified in the form audit
remain explicit later slices; this change does not claim to fix those resource boundaries.

Production scope is `form-contract.ts`, `scoped-form-submission.ts`, and `scoped-form.ts`.
Readiness adapters, domain options, write effects, completion effects, integrations and presentation
components remain outside this slice. Review the implementation before adding/running unit or
Playwright tests. Relevant verification should capture real public reports, reject stale request
IDs/revisions, check interruption priority and actual settlement, and verify parent subscriptions
render validation/operation progress without relying on copied child snapshots.

## Implementation review

The three production files implement this protocol. Recursive source review confirmed that the
new publication action only constructs/sends the report, and the new parent transitions only
select progress presentation. No lifecycle context flags or copied child snapshots remain at this
boundary. The child still owns async validation → operation → outcome classification and terminal
payload cleanup; resource-owning operation invocations are retained across interruption states.
Existing domain helpers and their known nested-workflow findings remain recorded in the audit.

No tests were added or run before review. Approved verification then passed without production
fixes:

- 71 unit tests across six files, including 17 new progress-contract tests. A real typed recipient
  captures submission messages and checks that only request ID, scope revision and progress cross
  the boundary. Parent subscription tests observe validation → operation → idle without any copied
  submission snapshot. Coverage includes stale request IDs/revisions, later requests, A → B → A,
  progress after completion, cancellation/invalidation/shutdown during validation and operation,
  actual settlement, payload release, write failures, completion retry and controller unmount.
- The unit fixture now waits for public operating activity. Its old operation-start spy depended
  on incidental child snapshot notifications and timed out after the snapshot subscription was
  removed. Updating that test assumption restored all six suites; production behavior was retained.
- All seven current-checkout form browser scenarios passed across targeted runs: shared form reset
  and access, modal dismissal/reopen with pending work, scope replacement, actual account creation,
  offline workspace rename/reload, and two new gated validation/progress/cleanup checks. The two
  full-app tests needed startup readiness waits matched to the existing 30-second allowance. The
  workspace test also needed explicit workspace selection and locators excluding hidden creation
  fields and unrelated announcement regions, matching current workspace management behavior.
- `pnpm check` passed with zero errors/warnings. `pnpm check:tests`, focused Prettier and
  `git diff --check` passed. Static checks are distinct from the runtime evidence above.

Reproducible unit command:

```sh
pnpm exec vitest run src/lib/machines/scoped-form-progress.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/scoped-form-write.test.ts src/lib/machines/scoped-form-completion.test.ts src/lib/forms.test.ts
```

The default Playwright configuration also discovers a hidden `.delta/worktrees` checkout. An
initial run was interrupted when that duplication was found; only current-checkout scenarios are
counted above. Use an anchored absolute file-path filter (replace the checkout prefix locally):

```sh
pnpm exec playwright test --config playwright.config.ts '^/Users/matthewjamesderocher/Projects/delightful-finances/tests/form-presentation.e2e.ts$' --workers=1
```

The first filtered run passed five scenarios; the account and offline-workspace checks passed on
focused reruns after their setup/locator corrections. This is scoped verification, not a single
all-green full application/PWA run. Browser progress uses a test-only validation gate with the
actual shared controller and form components; application checks use disposable in-memory Jazz.
No new production route, persistence behavior, styling or automatic retry was introduced.
Readiness, transaction persistence and avatar preparation remain separate unimplemented slices.
