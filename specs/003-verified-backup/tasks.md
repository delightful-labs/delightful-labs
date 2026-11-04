# Verified backup implementation tasks

Implementation authorized 2026-11-03 after the user merged PR #15. Work proceeds on feature branches
and focused review cycles. No production deployment, commit or publication is implied. Tests are
added/run only after review approval of the implementation they cover.

## Current handoff (2026-11-03)

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
- [ ] T004 — **Functional verification complete; large-file memory/latency qualification remains.**
      After T003 approval, verify vectors/interoperability, corruption/wrong-password handling,
      bounds and resource release. 52 envelope cases, fixed external v1 vector, independent Node
      crypto interop and Chromium public-package encryption/opening pass. Measure peak memory and
      large-file responsiveness against actual consumer sizes before broader limits/platform claims.
      See [envelope verification evidence](envelope-design.md).

## Independent reading and lifecycle

- [x] T005 — **Implemented and locally verified after user authorization to proceed.** Implement the independent file inspector, with generic integrity distinguished from
      recognized-profile/domain validation. See [inspector design](inspector-design.md) and the headless tool under `fixtures/backup-reader`. 30 inspector unit cases and 11 separate-process reader cases pass, including disabled common network APIs/no app credentials, profile outcomes, bounds, signals and cleanup. Included in normal CI checks; no Finance validator or restore proof is claimed.
- [ ] T006 — **In progress: capture/export and pure journal codec qualified; browser journal owner/store reviewed with focused Chromium checks; restore coordinator/writers remain unimplemented.** Implement shared export/restore actor protocols and a small
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
- [ ] T012 — **Started: pure record/codec verified; browser owner/CAS store prepared for review; native storage/restart remains unqualified.** When implementing the concrete restore-operation journal in T006/T009, define its
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
