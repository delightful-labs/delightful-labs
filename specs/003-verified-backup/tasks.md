# Verified backup implementation tasks

Implementation authorized 2026-11-03 after the user merged PR #15. Work proceeds on feature branches
and focused review cycles. No production deployment, commit or publication is implied. Tests are
added/run only after review approval of the implementation they cover.

## Current handoff (2026-11-04, after PRs #23–#25 merged)

The user authorized one PR for full comparison, activation, workflow coordination and performance
experiments, including tests. The notebook workflow now owns those phases in XState and reuses the
existing journal, operation lock and transaction/write actors. Expected restore failures remain
finite results. The complete retained-file/fresh-session path, exact-content comparison, interruption,
resume, unknown activation without replay and storage policies are qualified in
[the completion design](restore-completion-design.md). Performance observations and their limits
are in [the measurement report](notebook-performance.md).

The subsequent user-requested native event-routing review covers all 45 machine-bearing modules.
Nineteen implementation modules now use state-scoped native routing, with four added drain/precedence
regressions. All 1,097 functional cases pass locally. See [routing audit and evidence](native-event-routing-review.md).

T006/T012 are implemented for the notebook integration. T004 now has a bounded desktop measurement
baseline; actual consumer/platform performance qualification stays open pending T007 inventory.
Finance adoption (T007–T010) and the separate sign-in delivery work remain. No deployed data,
identity or storage configuration is changed. This branch is for PR review, not merge/deployment.

## Historical handoffs (superseded by the current status above)

**PR #23 coordinator and writer cleanup locally qualified.** The user authorized this cleanup and
its tests together. One `createRestoreMachine(native, destination)` now owns selected-step admission,
journal initialization/load and operation-lock drain/release; both dependencies are mandatory.
Preparation and attachment destinations are finite machines sharing the native transaction leaves.
The duplicated coordinators and unmerged specialization APIs are removed; planner synchronous work
no longer uses fake promise actors, and attachment observation routing uses ordered guards.
All **926 units (43 focused)** and **16 actual Jazz/Chromium cases**, package/consumer and static
checks pass. Added tests cover missing batch journals, unknown selected writes, identity denial and
unexpected identity-read failure. See [design, API migration and qualification](pr23-coordinator-cleanup.md).
This supersedes the following awaiting-review/runtime-pending notes for this local tree. No commit,
push or propagation to #24/#25; full comparison/activation and Finance adoption remain open.

**PR #23 attachment destination machine prepared for review.** Following the user's request,
createNotebookAttachmentWriter now returns a real finite statechart. Guards own scope/mapping,
identity, observed control and exact content decisions; SDK read/insert leaves do not select the
workflow. The shared write actor invokes this destination actor, forwards interruption and retains
journal/transaction/settlement/rollback/lock ownership. A borrowed tracked transaction port preserves
native custody; observations remain private and are cleared on completion, stop or owner error.
Native transaction leaves are reused directly rather than constructing a preparation writer.
See [actor design and review](restore-attachment-actor-review.md). Root/package/notebook/public
consumer static checks pass. No tests run, no commit/push and no stack propagation for this correction;
the prior 924-unit/14-browser cleanup evidence does not qualify this changed actor tree.

**PR #23 simplification locally qualified after review.** The ten-function forwarding file,
preparation write specialization, selector callbacks and attachment request wrapper are removed;
callers pass the selected step/options directly. The shared write chart has one local journal-update
predicate, and request claim admission stores one claim fact instead of a separate closure.
All 924 units (41 focused cases), 14 actual Jazz/Chromium cases and package/consumer/static checks
pass, including a new native second-claim/first-owner-resource test. See
[review findings and qualification](pr23-simplification-review.md). The duplicated preparation/batch
coordinator is documented as a separate candidate. Changes remain local and uncommitted; this
tests-only step did not publish or propagate the cleanup to #24/#25. Their previous passing totals
do not qualify this changed tree. Full comparison/activation remain open.

**PR #23 operation-lock correction locally qualified after review.** `operationLock` is now an
explicit acquisition/held/release/failure machine with a minimal Web Locks bridge. Preparation and
batch coordinators drain work, explicitly release and await native settlement before returning.
All 924 units (41 focused cases), 13 actual Jazz/Chromium cases, package/consumer and static checks
pass. See [design and qualification](restore-lock-design.md). The browser harness correction from
PR #24 is backported without weakening byte assertions. Propagation to #24 is now qualified by
22 native browser cases; propagation to #25 passes all 30 browser cases and all 924 units. No PR merge is authorized.

**Next stacked slice: one mapped note and relationships locally qualified.** The user explicitly
authorized implementation and tests together while away. On `feat/notebook-restore-note` (stacked
on the updated PR #24), the concrete note writer reuses existing actors and stable mappings,
preserves exact body/archive status, and links the mapped notebook and shared/nullable attachment.
All 30 actual Jazz/Chromium cases pass (22 prior plus eight note cases), along with 924 units and
package/consumer/static checks. See [design, evidence and limits](restore-note-design.md).
One explicit invocation writes one note; the final batch reaches comparing and remains incomplete.
Fresh full-graph/relationship/attachment-byte comparison and activation are next, not implemented.
Parent PR #24's bounded large-file harness correction is independently green in GitHub CI. No merge
is authorized. The normal review-before-tests rule remains for later slices unless overridden again.

**PR #24 stacked on PR #23: one notebook-root batch locally qualified.** After implementation
review, the user authorized qualification. All 22 actual Jazz/Chromium cases pass (13 prior regressions
and nine notebook-root cases), alongside the 924-unit shared suite and package/consumer/static checks. Exact title,
mapped IDs/prefix/reload, no step skipping, conflict, uncertain-write reconciliation, staged-write
drain/rollback and actual notebook policy denials are covered. See
[qualification and limits](restore-notebook-design.md#notebook-root-qualification--completed-2026-11-04).
Destinations remain incomplete. Note writers, fresh full comparison and activation remain open.
The user authorized this stacked PR; no merge is authorized.

**Current T006 slice locally qualified: one attachment batch.** Following implementation review,
the user authorized qualification. All 914 units (31 focused write-owner cases), 13 real Jazz/Chromium
preparation/attachment cases, package/consumer and static checks pass. The attachment root writes one
file with durable intent, separate local/remote evidence, exact-byte conflict detection and same-browser
uncertain-write reconciliation without replay. Destinations remain incomplete. See
[qualification and limits](restore-attachment-design.md#attachment-qualification--completed-2026-11-04).
Notebook/note writers, fresh full comparison and activation remain open. The user subsequently
authorized committing and pushing this qualified slice for pull-request review.

**Preparation committed; next slice proposed.** The user authorized the local preparation commit
`bba5f49` (`feat(backup): qualify isolated notebook restore preparation`). Nothing was pushed.
The [next bounded attachment design](restore-attachment-design.md) proposes advancing one existing
attachment batch with actual bytes and the retained journal prefix. The user subsequently authorized implementation, now awaiting review above. At the user’s request, [isolated actual-SDK research](attachment-research.md)
now passes 14 disposable Chromium cases, informing scalar-byte storage and bounded include reads.
Those probes are not attachment-restore implementation tests. Data writers,
full comparison, activation and Finance adoption remain incomplete.

**New active T006 slice: notebook restore preparation.** PR #22 is merged; work continues on
`feat/notebook-restore-preparation` from `08f4c38`. The user approved beginning the bounded design.
See [preparation design and implementation review](restore-preparation-design.md). Shared preparation
coordination, a write-owner contract, scoped journal discovery and the concrete notebook Jazz control
row/writer are implemented and locally qualified after review. All 902 unit cases pass, including
19 focused preparation cases; eight real Jazz/Chromium cases and all 14 existing native journal
browser regressions pass. The user approved owner-bound first-write admission; server acceptance
remains separately observed. The earlier permission-advice blocker is resolved, and cancellation now
retains the active child's drained result. See the
[completed preparation qualification](restore-preparation-design.md#preparation-qualification--completed).
Note/attachment
writes, fresh full-content comparison and activation remain unimplemented; T006/T012 stay open.
Later qualification entries below supersede historical awaiting-review notes only for their covered
behavior. No unrelated cleanup, Finance adoption, commit or publication is included.

**Current correction awaiting review: notebook finite operations.** Following the user's review,
REPLACE/READ now have explicit validation/capture and success/failure states with named single-leaf
actions. State-specific rejection handlers replace root defaults; the source adapter projects an
acceptingCommands tag. Synchronous capture/writer contracts and opaque payloads remain intact.
See [review notes](implementation-notes.md#notebook-finite-operation-correction--awaiting-implementation-review-2026-11-04).
Static checks pass; no new tests added/run before implementation approval. These changes are
uncommitted/unpushed. Earlier runtime totals below do not qualify this correction.

**Current qualified correction: remaining error/SDK wrappers.** The user continued the final code
cleanup. Payload error factory/guard replaces its subclass; subscription factories return native
SDK instances rather than extending SDK classes. Callers, declarations and examples are migrated.
All 321 distinct focused unit cases, 18 notebook/package cases, 11 reader cases, four Chromium cases,
package/strict Publint, Svelte consumer bundling and static checks pass. See
[qualification](implementation-notes.md#final-wrapper-cleanup-qualification-2026-11-04).
No application-owned class declarations remain in src/fixtures. The original audit's code cleanup
is addressed; restore-journal validation and full regression/PR checks still remain. These wrapper
changes are uncommitted; workspace journal correction was committed as 75bee3a. No push/merge.

**Current qualified correction: older workspace journal native disposal.** Notebook cleanup
committed locally as 8e5efe0 at the user's request. The journal now has a fixed invoked database
owner and transaction disposal that retains/clears handles across stop and late native delivery.
Policy and input/result contracts are unchanged; typed native reports are included in the event
union. All 213 workspace unit cases and nine Chromium journal cases pass, with four new stop probes.
Package/strict Publint and static/declaration/lint/format checks pass. See
[qualification](../001-local-first-foundation/cleanup-review.md#workspace-journal-disposal-qualification-2026-11-04).
This workspace journal correction is now committed as 75bee3a; no push/merge. Inert error/SDK wrapper cleanup is qualified above;
the backup restore-journal correction still requires separate review/qualification.

**Current qualified correction: notebook source ownership.** Export/capture correction committed
locally as 77b008f at the user's request. The user authorized this next cleanup including tests.
NotebookSource is removed; the fixture source chart owns initialization, availability, lease
invalidation, writer exclusion and current-owner release. Four new cases plus existing checks pass:
18 notebook/package cases, 144 focused backup units, 11 reader cases and four Chromium cases.
Static/declaration/lint/format checks pass. See
[qualification](lifecycle-design.md#notebook-source-correction-qualification-2026-11-04).
This fixture cleanup is now committed locally as 8e5efe0; no push/merge. Older workspace
journal native disposal is qualified above. Restore-journal correction review/qualification remains separate.

**Current qualified correction: export/capture ownership and explicit cleanup recovery.** The user
continued from implementation review. All 144 focused envelope/inspection/export unit cases,
14 notebook/package integration cases, 11 reader cases and four Chromium cases pass. Added four
cleanup protocol units and one built-public-package case proving cleanup restores writer access
without replaying export. Static/package checks pass; no production fixes were needed. See
[qualification](lifecycle-design.md#export-ownership-correction-qualification-after-implementation-review).
The explicit cleanup factory replaces request.retryCleanup() as approved. Notebook source ownership
is the next review slice. These export/capture changes are now committed locally as 77b008f; prior corrections are in f50a97c.
No push/merge. Journal corrections remain separately unqualified.

**Current qualified correction: inspection ownership.** The user continued from implementation
review. The chart now owns read/header/password routing, envelope drain, profile decisions and
report transfer. All 140 focused envelope/inspection/export unit cases (including six added
inspection cases), 11 independent reader cases, 13 notebook/package integration cases and four
Chromium cases pass; static/package checks pass. No production fixes were needed in qualification.
See [qualification](inspector-design.md#ownership-correction-qualification-after-implementation-review).
No commit/publication. Export/capture is the next owner rewrite. The journal correction still
awaits its own review/qualification; these focused results do not qualify it.

**Current qualified correction: envelope ownership.** The user continued from implementation
review. Chart-owned verification, attachment iteration, crypto/drain and output transfer replace the
envelope class owner. Runtime checks found/fixed repeated revocation; release is idempotent using
the existing input reference. All 134 focused envelope/inspection/export unit cases, 13 notebook/
package integration cases, standalone public envelope consumer and four Chromium cases pass.
Static checks pass. See [qualification](envelope-design.md#ownership-correction-qualification-after-implementation-review).
No commit/publication. Inspection is now qualified above; export/capture and the
remaining audited owners follow it. The journal correction still awaits its own review/qualification;
historical full-suite totals below do not qualify that correction.

Archive/inspector implementation is complete through T005, except T004's large-file measurements.
The cleanup interruption is complete: PR #19 merged the implementation; [PR #20](https://github.com/delightful-labs/delightful-local-first/pull/20)
adds regression qualification and two reproduced retry/IndexedDB cancellation fixes. Its implementation
head `82cc5e4` passed GitHub CI, including unit, package/consumer and browser checks. PR #20 merged
on 2026-11-03 as `afc92fd`. See the
[cleanup evidence](../001-local-first-foundation/cleanup-review.md#regression-qualification-completed).

**Current implementation task: T006.** Shared capture/export and the notebook profile/source are
implemented and locally verified after the user authorized continuing from implementation review.
PR #21 merged on 2026-11-03 as `04f3203`; all final-commit GitHub CI checks passed for `06362cf`.
See the [lifecycle design and qualification evidence](lifecycle-design.md#export-qualification).
Public export subpaths are `backup/export` and `backup/export/workflow`. New verification includes
51 export unit cases, 13 notebook/public-package cases (with independent retained-file inspection)
and three Chromium cases. Tests are included in normal unit, consumer and browser checks.

**Current slice: restore journal identity/model (T012 foundation), reviewed and locally verified.**
The [journal design and codec evidence](restore-journal-design.md#codec-qualification) record the
strict Zod model/inferred types and bounded pure codec on
`feat/backup-restore-journal`. All 87 new journal unit cases, the built public Node consumer and one
new Chromium case pass; the qualified pure-codec totals are 815 unit tests and 46 Chromium cases.
Those results do not qualify the new native owner/store implementation below. T012 remains incomplete.

**Current reviewed slice: browser journal resource owner/concrete store.** The
[native ownership design](browser-journal-design.md) records same-browser recovery, IndexedDB-only
atomic transactions and focused qualification: 89 journal unit cases and five Chromium cases.
Redundant locks, alternative storage interfaces and cleanup-retry API were removed in review.
No destination restore writes are implemented. Page reload is qualified; browser-process crash and
actual Jazz restore are not. The new attempt/completion representation is locally qualified below.

**Current completed review/test slice: focused journal attempt/completion representation.** The user
authorized this slice after [real-code research](research.md#restore-limitation-investigation--2026-11-03)
and [persistent-browser recovery probes](research.md#persistent-jazz-write-recovery-investigation--2026-11-03).
The [design](restore-journal-design.md#focused-attemptcompletion-change--implementation-review-2026-11-03)
adds a bounded most-recent rejection summary, a guarded new transaction attempt after a confirmed
remote rejection, and completion by exact remote content match with unchanged transaction evidence.
Intent, mappings and storage ownership remain unchanged. Unknown access/outcomes stay unresolved.
After implementation review, the user authorized tests. Added 16 focused unit cases and one native
Chromium case; all 833 unit tests (32 files, including 105 journal cases) and all 51 Chromium cases
(including six journal cases) pass. Package/strict Publint, public consumer checks, Svelte/TypeScript,
lint and formatting pass. No production fixes were needed. The
[qualification evidence](restore-journal-design.md#attemptcompletion-qualification--completed-2026-11-03)
distinguishes journal validation from the unbuilt destination comparison and writer integration.
Restore coordinator/destination writers remain paused. The user authorized committing and publishing
this reviewed journal slice as a PR targeting `main`; merge requires separate authorization.
**Current correction awaiting review: machine-first browser journal ownership.** The user rejected
application-owned classes and the parallel lifecycle hidden in `BrowserJournalOperation`. The
[corrected ownership design](browser-journal-design.md#machine-first-ownership-correction--implementation-design)
now puts read/write decisions, native settlement, interruption, cleanup and final classification in
the journal machine. The native callback only performs native commands and bridges events; prepared
inputs/results are inert opaque references. Journal error subclasses are replaced with factories
and type guards. No new retry/restore behavior is included. Earlier green tests/CI describe the
previous owner, not this rewrite. Existing test imports/state paths were adapted; no implementation
tests were added or run before review. The correction is uncommitted/unpublished.

**Broader source audit completed; additional ownership corrections remain.** The
[cross-slice audit](implementation-notes.md#cross-slice-machine-ownership-audit) records hidden
lifecycles in envelope, inspection and export owners, notebook fixture lease coordination, an
older workspace-journal abrupt-stop resource concern, and the remaining helper/error/SDK classes.
It distinguishes those findings from pure functions and native leaves that do not need machines.
Review/correct one owner at a time; do not treat earlier passing tests as architecture approval.
The audit itself adds no production changes or tests. Restore coordinator/destination work remains
paused while these ownership findings are addressed.

Read the [workflow contract](contracts/workflow.md) and lifecycle ownership
notes. Isolated destination and content round-trip remain unimplemented.
Present each implementation slice before its tests. No additional general cleanup is required. Finance
inventory/adoption (T007–T010), T004 large-file measurements and sign-in delivery remain outstanding.
No deployed data or identity/storage configuration changed. The journal PR contains only this
reviewed implementation, qualification and limitation documentation; no deployment or merge is authorized.

## Archive core

- [x] T001 — Implement and present the pure bounded payload codec for review. **Implemented and presented; user authorized proceeding to review/tests on 2026-11-03.** Includes internal Zod schemas/inferred types, exact values, strict JSON, limits, graph closure, attachment
      encoding/size checks, detached frozen results, and the public `./backup/archive` subpath.
- [x] T002 — After the user authorized verification, add/run meaningful malformed-input, exact-value,
      graph, canonical encoding, immutability, reduced-limit and package-consumer checks. 82 archive
      cases pass; all 556 repository unit tests, strict package validation, standalone Node import
      and browser consumer build pass. Review additionally fixed unsafe/fractional JSON metadata
      rounding before numeric conversion. See [implementation notes](implementation-notes.md).
- [x] T003 — **Implemented; the user authorized review and tests on 2026-11-03.** Design resource ownership/statecharts and implement the envelope/crypto slice: strict
      envelope validation, independent password derivation, authenticated encryption, actual payload
      and attachment digests, and releasable immutable integrity-checked resources. See [envelope design/review notes](envelope-design.md). Present for review; profile validation and restore authority remain separate.
- [ ] T004 — **Functional verification and 1/4/8 MiB desktop measurements complete; actual consumer/platform performance qualification remains.** See [measured latency, memory and responsiveness](notebook-performance.md).
      After T003 approval, verify vectors/interoperability, corruption/wrong-password handling,
      bounds and resource release. 52 envelope cases, fixed external v1 vector, independent Node
      crypto interop and Chromium public-package encryption/opening pass. Measure peak memory and
      large-file responsiveness against actual consumer sizes before broader limits/platform claims.
      See [envelope verification evidence](envelope-design.md).

## Independent reading and lifecycle

- [x] T005 — **Implemented and locally verified after user authorization to proceed.** Implement the independent file inspector, with generic integrity distinguished from
      recognized-profile/domain validation. See [inspector design](inspector-design.md) and the headless tool under `fixtures/backup-reader`. 30 inspector unit cases and 11 separate-process reader cases pass, including disabled common network APIs/no app credentials, profile outcomes, bounds, signals and cleanup. Included in normal CI checks; no Finance validator or restore proof is claimed.
- [x] T006 — **Implemented and qualified for the notebook integration: complete export/inspection/restore, fresh graph comparison, activation, reload/resume and conservative uncertain-activation recovery.** See [completion evidence](restore-completion-design.md). Implement shared export/restore actor protocols and a small
      nonfinancial notebook profile. Use the existing archive/envelope/inspection resources and
      focused workflow boundaries; keep domain capture, authority and destination operations
      consumer-owned. Model generation/operation binding, resource ownership, cancellation/drain,
      explicit local versus remote settlement, and unknown-write recovery before effects. Include
      relationships and a byte attachment so the profile demonstrates exact-content round-trip
      behavior rather than only counts. Coordinate T012 for any concrete persisted restore journal;
      do not reuse workspace creation unchanged as a restore protocol. Present for review, then
      verify export → independently inspect → isolated restore/content comparison, interruption and
      resume, stale binding rejection, and uncertain writes without duplicate replay. Notebook
      qualification does not establish Finance completeness or production restore safety.

## Finance adoption

- [ ] T007 — Establish current deployed frontend/backend revision and explicit released-data inventory
      read-only. Measure required sizes; no source data or schema mutations.
- [ ] T008 — Implement Finance capture/profile against existing alpha.59, including owner authority,
      quiescent/drained capture, remote/local comparison, archives and complete attachment contents.
      Review, then qualify the actual integration on disposable data.
- [ ] T009 — Design/review and implement Finance’s additive incomplete-restore isolation, policy lane,
      durable journal, mappings, inert provenance, phased domain writes and activation. Review, then
      qualify actual policies, restart and uncertain outcomes before proposing live deployment.
- [ ] T010 — Demonstrate real deployed file retention, independent validation, isolated full restore,
      fresh-session content comparison and original preservation before identity/storage changes.

T001/T003 split plan delivery item 1 into reviewable structural and cryptographic work. T001 must
not be described as an encrypted archive, verified backup, source-completeness proof or restore.

## Zod follow-ups from repository review

These are scoped follow-ups recorded at the user’s request, not a requirement to replace every
runtime guard or to finish unrelated refactors before backup work continues.

- [x] T011 — **Implemented in PR #19; three adapter cases and the built public-subpath check pass.** Add an optional Zod-to-`FormIssue` adapter for the shared form boundary. Preserve the
      existing `parseAsync` and injected `validationIssues` contracts so consumers may use other
      validators. Map issue paths/codes without copying input values or automatically exposing raw
      Zod messages; localization stays consumer-owned. Review the implementation before tests.
- [x] T012 — **Implemented and exercised through notebook restore completion: versioned Zod journal, retained mappings, CAS progress, fresh comparison and activation receipts/reconciliation.** Consumer-specific Finance integration remains T009. When implementing the concrete restore-operation journal in T006/T009, define its
      persisted record/version schema with Zod and infer its types. Validate unknown stored data
      before reuse; reject malformed/unsupported records without resetting storage, inventing a new
      operation or replaying unknown writes. Reuse existing schema-injection boundaries; do not
      require generic workspace journal callers to adopt Zod. Coordinate the generic/Finance-owned
      fields without moving financial models into DLF.
- [x] T013 — **Reviewed: retain the simple draft checks; conversion does not improve clarity.** See [cleanup review](../001-local-first-foundation/cleanup-review.md#profile-draft-review-t013). Review the profile form’s handwritten draft-shape checks for a small reusable Zod
      schema only if it improves clarity. Keep dirty-state comparison distinct from submission
      validation; preserve name normalization and upload/remove semantics. Do not apply submission
      transformations or reject partially edited drafts merely to compute whether a form changed.
      If conversion offers no clear benefit, record that finding and retain the simple checks.

Sign-in configuration and external-input follow-up belongs to
[the sign-in delivery TODOs](../002-shared-delightful-sign-in/delivery.md#zod-validation-todos).
Keep generation/account-binding comparisons and other straightforward state-machine guards as
ordinary code. No broad validation rewrite is authorized by this list.

## State-model review cleanup status

- [x] Envelope preparation: chart-owned branches; focused and Chromium qualification recorded.
- [x] Avatar selection: explicit owner; unit and actual DUI/Chromium binding checks recorded.
- [x] Recovery child failure: cleanup precedes preserved parent error protocol; coordinator tests pass.
- [x] Transaction teardown custody: required host handoff with native receipts; stop/crash and real
      Jazz transaction checks pass. Consumer migration is documented in docs/transaction-custody.md.

These statuses concern the reviewed cleanup, not completion of backup restore/journal qualification.

Reader/journal follow-up qualification: the stream lifecycle passes 17 Node checks, and the rebuilt
journal public package passes 14 distinct Chromium cases, including the synchronous upgrade handshake
and existing native CAS/reload regressions. These results supersede earlier unqualified-browser-store
notes for the covered behavior. The current completion handoff above supersedes their historical
T006/T012 status; Finance qualification remains T009. Details are in implementation-notes.md.
