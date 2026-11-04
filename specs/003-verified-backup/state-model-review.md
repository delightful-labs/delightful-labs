# Repository state-model review

Reviewed the working tree based on `e978c35`, including the pending notebook source
correction. Review only: no new implementation, runtime tests, commits, or pushes.

The criterion is the recursive machine-first gate in `.specify/memory/xstate.md`:
meaningful decisions, stages, and resource ownership belong in charts. Pure transforms,
predicates, atomic staging, and narrow native completion/disposal remain functions.

## Findings

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
the notebook source, reader I/O, and component workflow ownership. Contracts and pure
code were classified separately. Tests, consumer harnesses, stories, and tooling were
screened for orchestration and consulted for intended behavior; this was not an
assertion-by-assertion test audit or a shell-tooling correctness/security audit. Inventory
and text searches alone are not evidence of runtime correctness.

The pending notebook correction now models write validation/commit/rejection and read
capture/return/rejection as states. Its runtime qualification still awaits implementation
review. This review does not qualify the rewritten backup restore-journal native owner,
replace pending regression checks, or establish that every injected consumer capability
is a leaf. No new runtime tests were added or run.

Suggested sequence: review and qualify the pending notebook change, then address
envelope preparation as one bounded slice. Discuss avatar ownership and the two failure/
teardown contracts before undertaking those changes. These findings do not authorize
implementing all four at once.
