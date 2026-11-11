# Repository state-model review

> The authorized 2026-11-04 implementation below supersedes the historical review-only status and
> approval gates in this document. The user requested all remaining fixes and all tests together.
> The original findings remain as review history, not current qualification claims.

Reviewed the working tree based on `e978c35`, including the pending test app source
correction. Review only: no new implementation, runtime tests, commits, or pushes.

The criterion is the recursive machine-first gate in `.specify/memory/xstate.md`:
meaningful decisions, stages, and resource ownership belong in charts. Pure transforms,
predicates, atomic staging, and narrow native completion/disposal remain functions.

## Findings

Qualification completed for the authorized follow-up: 918 unit tests, 17 independent-reader
tests, 18 test app-export tests, 22 Jazz/Chromium restore tests, 10 private-creation tests,
and 65 Storybook browser tests passed (1,050 total). Formatting, lint, Svelte and TypeScript
checks, package validation, consumer checks/builds, and the Storybook build passed.
Backup synchronous stages use ordinary actions so constructing an unstarted actor cannot
claim resources or perform I/O. Expected missing-data paths enter admission/failure states;
guarded generic invocation assertions remain as type invariants. Recovery hosts must adopt
the new finite `restorationChildFailed` completion result. No commits or pushes were made.

## Authorized follow-up implementation (2026-11-04)

The user authorized all remaining fixes and their tests together. Preserve existing ownership,
settlement evidence and native cleanup receipts. Work through these changes as one reviewed set:

- Profile persistence: invoke a domain machine for scope admission -> one save -> finite result.
  Missing identity/profile stops unavailable before SDK issue. Observation/invalidation during save
  enters draining states; completion preserves the actual settlement rather than claiming rollback.
- Forms: admission guards precede child invocation; missing request, observation or validated values
  reaches a finite not-started failure. Missing blocked capability becomes availability failure.
  Outputs are total; failures after issue retain unknown settlement. Payload cleanup remains owned
  by existing terminal states; pure injected normalizers retain their documented contract.
- Workspace startup: capture admitted user and initialization provenance once, validate before
  invoking initialization/seed, and report failed/waiting without throwing from input/entry builders.
  Replacement and shutdown continue to drain existing children. Local readiness stays independent
  of optional seed success.
- Backup: synchronous claim/parse/prepare/build/clear operations execute as bounded machine actions
  with typed result admission and explicit failure transitions, rather than synthetic promise leaves.
  Stateful mode selection, eligibility, cleanup and interruption remain in the owning statechart.
  Crypto, SDK/file I/O and native custody receipts retain their external actor boundaries.

Qualify recovery finite failure/uncertainty, profile no-write admission and save draining, form
missing-prerequisite failure and cleanup, startup empty identity/replacement/seeding, backup duplicate
claims/release/parse failures/crypto cancellation, and restore write identity loss/observer failure
while staging. Run the complete unit and browser suites plus package/consumer/static checks.

### 1. Envelope preparation still contains operation routing (P2)

`src/lib/machines/backup/envelope.ts:39` defines a promise leaf that chooses sealing
versus opening, parses the appropriate input, optionally generates password metadata,
then chooses and prepares plaintext versus ciphertext. Only afterward does the chart
receive the selected mode. This is the clearest remaining example of procedural
workflow wrapped in an actor. The existing `preparing` state conceals meaningful
operation branches and header-generation work.

Expose the seal/open and protection choices in the chart. Keep bounded parsing,
decoding, and header construction as leaves; do not make every buffer assignment a
state. Preserve the current single owner, opaque payload storage, and native cleanup.
After implementation review, exercise the four modes, preparation failures, and the
existing cancellation/release coverage in `src/lib/backup/envelope.test.ts` and the
browser envelope suite. This is an architectural finding, not a demonstrated broken
archive or security claim.

### 2. Avatar selection and cropping form a component-owned workflow (P2)

`src/lib/components/profile/ProfileAvatarForm.svelte:39` holds saved, selected, and
pending files plus crop-open and validation-error flags. The binding callback at
line 93 validates, rejects/restores, or starts cropping; later callbacks accept or
discard the crop. Effects independently replace or reset those facts. These decisions
precede the existing submitted-image actor in `machines/identity/profile-avatar.ts`.

Give selection/validation/cropping/acceptance/reset one explicit owner and event
protocol. A small selection actor can own this lifetime without absorbing the save
operation or generic DUI dialog internals. Keep file validation a pure leaf and DOM
focus/presentation in Svelte. Check normal selection, invalid selection, crop cancel,
crop acceptance, removal versus draft clearing, and profile/reset changes after the
implementation is approved. No stale crop result was reproduced in this review.

### 3. Recovery child failure has no modeled cleanup outcome (P2)

Implementation review update (2026-11-04): replace the coordinator's intentional output throw
and queued `PROPAGATE_FAILURE` turn with a final `restorationChildFailed` state and public typed
result. The coordinator records whether it sent the child's `PREPARED` permit as a protocol fact.
An unexpected child failure before that permit reports `mutation: notStarted`; after the permit,
report `mutation: unknown`, because neither issue nor settlement can be inferred from a crash.
Normal restoration results retain their existing mutation evidence. The transition exits the
restoring scope and invalidates/releases the binding before final completion; clear the request
and never navigate or retry. Shutdown during an issued restoration still drains the child, and
an unexpected child failure takes precedence over ordinary closed completion.

Machine output must be total and sanitized, with no raw child error, phrase or credential. Hosts
must route `restorationChildFailed` through `invoke.onDone` to their failure/uncertainty handling;
the coordinator no longer deliberately triggers `invoke.onError`. Keep `onError` for genuinely
unexpected coordinator crashes. This public-protocol change requires consumer review before
adoption. Existing unit assertions expecting parent-error propagation need revision after
implementation approval; cover crashes before/after permit, cleanup before completion, shutdown,
cleared sensitive references, and unchanged ordinary success/rejection. The user subsequently
authorized the tests; all six coordinator cases pass with the revised finite-result protocol.

`src/lib/machines/identity/session-recovery.ts:201` handles an unexpected restoration
child error by throwing from an action. The coordinator therefore errors instead of
entering a failure/cleanup state. Binding invalidation is currently in `restoring.exit`
at line 151, which must not be relied on as crash cleanup. The result contract only
represents `notStarted` or `settled` mutation, so simply returning `restoreFailed`
would risk inventing settlement evidence.

Design the unexpected-child-failure transition and binding custody explicitly before
changing code. Decide whether the public protocol needs an unknown mutation outcome
or an explicit failure handoff to the host. Preserve the documented host responsibility
for issued SDK work; do not add automatic restore retry or claim rollback. Validate
child failure before and after mutation issue, binding disposal, and shutdown only
after implementation review. This does not claim a reproduced credential leak.

### 4. Transaction acquisition has an abrupt-stop ownership gap (P2, contract boundary)

`src/lib/machines/workspaces/creation-transaction.ts:30` and
`src/lib/machines/workspaces/invitation-authority.ts:68` acquire transactions through
promise actors. The acquired handle first enters owner context in `onDone` (creation
line 116; invitation line 334). If an ancestor stops or crashes during acquisition,
the native acquisition can finish after its output is discarded, with no retained
handle or late-result rollback owner in these implementations. Handles already in
context also lack a separate abrupt-teardown custodian.

Normal `CANCEL` and `SHUTDOWN` are already modeled and wait for acquisition before
rollback. Existing tests cover those paths; they must not be described as broken.
This finding concerns abrupt teardown, not ordinary dialog cancellation. Native
journal owners already use callback scopes to retain and dispose late handles.

Confirm the supported host lifetime and native transaction disposal contract before
implementing a bounded resource owner. A host-owned transaction may require a retained
handoff rather than detached rollback, especially after commit issue. Do not add a
general supervisor, retry framework, or rollback a possibly committed write. One
deferred-acquisition stop scenario per factory would be an appropriate initial
qualification after approval. No actual SDK lock leak was reproduced here.

## Deliberately excluded from cleanup

- Form validation error normalization is explicitly pure, and
  `machines/forms/submission.test.ts:215` deliberately verifies that a throwing
  normalizer reaches its supervising owner. Its small result transform is not itself
  hidden orchestration. Changing that failure policy requires a separate reason.
- Payload and journal schemas, parsers, encoders, referential checks, successor
  predicates, profile validators, and selector projections are bounded transforms.
  Their branches and loops do not require actors.
- Export native-call receipts, lease borrowing, failed cleanup custody, and late-result
  disposal are resource-boundary mechanics. Capture, handoff retry, drain, release,
  and explicit cleanup attempts already have chart owners. Do not remove these native
  finalizers merely to eliminate imperative syntax.
- Workspace initialization/startup, creation owner/operation/persistence, naming,
  selection, invitation redemption, forms editing/submission/write/readiness, session
  acquisition/startup/readiness, profile saving, and restoration already expose their
  meaningful stages. File size alone is not a refactor criterion.
- Recovery phrase encoding and Jazz restoration/data adapters delegate individual SDK
  operations or synchronous observations. Host root startup and subscriptions are
  integration duties, not manually started child workflows.
- Simple modal visibility, focus, input drafts, and avatar object-URL disposal can
  remain local. The avatar-selection finding is about its multi-step command protocol.
- CLI argument/output handling, synthetic Storybook controls, test ordering, package
  consumer assertions, build configuration, and inherited Spec Kit shell commands do
  not need application statecharts.

## Coverage and limits

Repository code inventory: 207 files across TypeScript, JavaScript, MJS, Svelte, shell,
and Python suffixes: 98 non-test library files, 42 non-test fixture files, 8 stories,
47 test files, 6 configuration code files, and 6 inherited Spec Kit scripts. Excludes
dependencies, vendored packages, generated Paraglide code, build output, and Git data.

The review traced the runtime machine families, their backend/helper/native boundaries,
the test app source, reader I/O, and component workflow ownership. Contracts and pure
code were classified separately. Tests, consumer harnesses, stories, and tooling were
screened for orchestration and consulted for intended behavior; this was not an
assertion-by-assertion test audit or a shell-tooling correctness/security audit. Inventory
and text searches alone are not evidence of runtime correctness.

The pending test app correction now models write validation/commit/rejection and read
capture/return/rejection as states. Its runtime qualification still awaits implementation
review. This review does not qualify the rewritten backup restore-journal native owner,
replace pending regression checks, or establish that every injected consumer capability
is a leaf. No new runtime tests were added or run.

Suggested sequence: review and qualify the pending test app change, then address
envelope preparation as one bounded slice. Discuss avatar ownership and the two failure/
teardown contracts before undertaking those changes. These findings do not authorize
implementing all four at once.
