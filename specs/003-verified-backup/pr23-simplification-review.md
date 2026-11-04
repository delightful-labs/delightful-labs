# PR #23 simplification review

> Later qualification: the user authorized the follow-up cleanup and tests together. The consolidated
> actor tree passes 926 units and 16 actual Jazz/Chromium cases. The required destination actor,
> shared coordinator and renamed API supersede the historical pending/default-path notes below.
> See [current cleanup and qualification](pr23-coordinator-cleanup.md). Changes remain uncommitted.

Review base: main at PR #22, PR #23 head `062d6fc`. Scope includes all changed library machines,
contracts/journal discovery, notebook planning/request/writers/schema, qualification harness and
public package/CI wiring. The user requested removal of thin wrappers and a broader reuse review.
The user subsequently approved runtime qualification with “continue with tests”; the completed
evidence below supersedes historical pending-test notes. No new asynchronous workflow is introduced.

## Findings and disposition

1. **Remove the preparation-record forwarding layer.** All ten functions only supply the plan's
   preparation descriptor to an existing generic function. None has production callers; only issue
   and observe are used by tests. Delete the file and have those callers pass record and step directly.
   No deprecated aliases or replacement wrapper module is warranted for unmerged internal code.
2. **Remove write-machine specialization and selector callbacks.** The preparation factory only
   fixes a selector and success label. The generic machine then invokes a selector function during
   initialization although its parent already knows the step. Delete that factory, name the shared
   file restore-write-step, and pass the actual descriptor as actor input. Keep the meaningful public
   preparation/batch coordinators; do not add factory aliases to preserve unused internal names.
3. **Remove the attachment request specialization.** It only spreads options and sets resume.
   The bound attachment host factory and test host can call prepareNotebookRestore with resume
   explicitly. Keep the actual resource-owning root and bound unstarted host factory.
4. **Simplify single-use request admission.** An available-data variable plus a stored claim closure
   exists solely to implement a boolean claim. Store the claim fact with the private capsule and
   perform the check directly in claimNotebookRestore. This is capability admission, not a second
   workflow or a change to resource disposal/drain.
5. **Reuse the repeated journal-write success predicate.** The write actor repeats updated-or-existing
   plus record-present checks in five checkpoints. Give that actual domain predicate one definition;
   keep each checkpoint, transition and native operation explicit. It is not a forwarding shim.
6. **Further candidate: preparation/batch coordinator duplication.** Validation, lock ownership,
   load, drain, release and write-result handling are substantially duplicated. The material
   differences are missing-journal intent creation for preparation and exact-current-batch admission
   for continuation. Consolidation should use one concrete coordinator chart with explicit guarded
   admission paths and selected step input, not partial-application factories or configurable
   arbitrary state fragments. This would change public coordinator contracts and deserves its own
   bounded implementation review; it is recorded here rather than hidden in the wrapper deletion.
7. **Keep genuine boundaries.** SDK leaf adapters, the journal request/output resource owner,
   current-binding predicates, parent/attachment content comparison, canonical plan projection,
   operation-lock machine and transaction custodian each enforce behavior/lifetime absent from
   their callees. Type-only public API facades deliberately restrict package exports. Deleting
   those as if they were forwarding functions would lose useful ownership or public boundaries.

## Invariants and validation plan

No state/action acquires workflow decisions from this cleanup. States continue to own journal CAS,
intent-before-effects, transaction acquisition/staging/commit/rollback, separate settlement, lock
release acknowledgement, cancellation/drain and unknown outcomes. Explicit step input is selected
only after existing coordinator admission; there is no new replay, destination replacement or
acceptance inference. Representation and journal wire formats remain unchanged.

Existing test imports/construction must mechanically follow the removed internal symbols for strict
compilation; no assertions or new test behavior are added before review, and no tests run. Static
validation covers root TypeScript, package/strict Publint, consumer/notebook declarations, lint,
formatting and whitespace. After review re-run the 41 focused cases, full units and native browser
qualification, then propagate the accepted cleanup through #24/#25. Earlier passing counts do not
qualify this changed tree. Full comparison/activation and Finance adoption remain outside scope.

## Static validation — completed

Root Svelte/strict TypeScript, package build/strict Publint, public consumer TypeScript against rebuilt
declarations, notebook TypeScript, Oxlint, Oxfmt and whitespace checks pass. Searches find no remaining
source/fixture callers of the deleted symbols or old shared-machine filename. No implementation tests
were run, no assertions added, no server started, and nothing committed/pushed. Historical design
notes retain the names used at their qualification points; they are not current imports.

## Cleanup qualification — completed (2026-11-04)

All **924 unit tests** pass, including the **41 focused preparation/write/lock cases** using the
generic record functions and explicit selected-step input directly. All **14 real Jazz/Chromium
cases** pass against the rebuilt public package, native IndexedDB/Web Locks and concrete Jazz
adapter/policies. This includes the previous 13 cases plus a new single-use request admission case:
while the first actor is held at actual authority admission, a second claim returns unavailable
without a write or clearing the first actor's resources. After releasing the gate, the first actor
completes preparation with one actual accepted commit and the expected incomplete control row.

The first unit run exposed the new predicate being imported from a module replaced by the journal
actor stub. Kept the predicate local to its five uses in the shared write chart; there is no extra
module export or mock behavior for it. Focused and full suites pass after that correction. No
acceptance/replay, transaction, journal-wire or destination-policy behavior was changed.

Package/strict Publint, public consumer compilation/imports/builds/runtime checks (17 independent
reader and 18 notebook export tests), notebook and root Svelte/strict TypeScript, lint, formatting
and whitespace checks pass. The disposable browser, Vite host at http://127.0.0.1:6199/restore.html,
Jazz authority and per-test contexts were closed by teardown.

The cleanup remains local and uncommitted on PR #23's branch. No commit/push or propagation to
#24/#25 was performed in this tests-only step. This qualification does not establish their updated
tree behavior, full comparison/activation, Finance completeness or production restore safety.
The duplicated coordinator finding remains a separate proposed cleanup, not implemented here.
