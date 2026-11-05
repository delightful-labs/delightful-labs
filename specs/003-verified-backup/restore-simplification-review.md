# Backup/restore simplification review

2026-11-05. The user requested a fresh review of the complete implementation and explicitly
authorized implementation and all necessary tests while away. That authorization supersedes the
per-change implementation/test review gate for this investigation. Commits, deployment and live
Finance mutation remain outside this work.

## Review scope and approach

Review capture/export, envelope/inspection, archive schemas/encoding, planning, journal schemas/
codec/storage, restore coordination, destination reads/writes, settlement, comparison and cleanup.
Use real Jazz/IndexedDB for behavioral qualification. Diagnose complete operation costs and
scaling rather than treating the previous short journal CPU sample as the whole explanation.
Preserve the existing benchmark artifacts and use separately named measurements.

Initial source findings to measure:

- The byte-budget and string schemas allocate a new UTF-8 array for each key/string, repeatedly.
  Counting bytes does not require materializing encoded arrays. Encoding actual output still does.
- Test app graph remapping searches all mappings and repeatedly canonicalizes the same identity
  tuples. Batch projection then searches projected arrays again. Indexing those immutable inputs
  can replace nested scans without a new cache/lifecycle or changing the projection.
- Every selected write rebuilds a proposed initial journal from the complete intent, acquires a
  lock and loads the journal again. Its recovery/admission role must be distinguished from work
  already guaranteed by a known immutable plan and CAS.
- On accepted remote settlement, the write machine saves a remote receipt, then immediately saves
  the same receipt as a completed checkpoint in a second transaction. Atomic receipt+completion
  may preserve the same evidence with fewer transitions/writes. Rejection, missing required local
  persistence, interruption, unknown commit and uncertain remote acceptance must remain distinct.
- The fixture chooses one transaction per record despite the shared plan supporting mapping
  groups. Determine how much cost is due to that consumer choice versus library processing.

Diagnostic drivers may aggregate actor IDs/lifetimes and codec call/allocation counts using only
synthetic input. Never log journal/archive contents, bindings, passwords or credentials. Timings of
nested actors overlap and must not be added as exclusive CPU time. Use smaller record counts for
diagnosis, then the original 633-record workload for qualification and a throttled check if useful.

## Ownership/invariants for possible changes

Byte length and projection indices are synchronous pure operations, not workflow owners. Keep
UTF-8 replacement behavior identical to TextEncoder, independently retain well-formed-string
validation, all aggregate/actual-wire bounds, stable ordering and exact output bytes.

If settlement saves are consolidated, the existing write chart still owns custody. After native
local/remote observation, select either a fully settled completion candidate or an incomplete/
rejected receipt candidate, then perform the existing atomic journal CAS. Do not advance in-memory
progress or release custody before that CAS succeeds. Read interruption from the owner, preserve
observed transaction identity and rejected facts, and leave unknown effects unreplayed.

No worker, additional global registry, partial untrusted decoding, larger bound or hidden retry is
assumed necessary. Evaluate the failed experiments for removal after measuring simpler changes.

## Bounded note transactions

The 128-record complete-operation trace is 19.55 seconds: note remote reads consume 7.64 seconds,
journal transactions 4.37 seconds, remote settlement 3.84 seconds and transactional note reads
1.65 seconds (nested actor totals overlap). This confirms that avoiding per-row transactions and
queries matters in addition to codec cost; retain all remote/transactional authority and content
checks rather than treating local absence as global absence.

Use the existing note-destination statechart for a bounded set of notes, not a new workflow.
One batch has at most 32 notes and targets at most 64 KiB of canonical projected content; a single
larger valid note remains a singleton under the existing archive limits. Attachments and the root
retain their dependency order and singleton writes. Read the exact selected IDs, verify every
parent/reference/scope and exact full set/content, then stage all selected notes synchronously in
the same borrowed Jazz transaction. Partial or mismatched presence is conflict, never permission
to replay a subset. The existing shared custody/journal/settlement machine governs the transaction.

All entry points now use only bounded note transactions, at the user's explicit request after PR
review. The mutable `data.planVersion`, batching option, alternate defaults, diagnostic batching
switch and legacy single-note accessor are removed. The serialized plan has fixed version 2 so
older/unknown formats can be rejected before any write; there is no compatibility implementation
or migration. Resume retains exact mappings and checks the complete current intent. Unsupported
journals and their incomplete destinations are left untouched. The archive profile/wire format and
shared resource/transaction/settlement statecharts are unchanged.

## Final disposition

The review retained the existing shared statecharts and conservative write/recovery semantics.
The whole-operation evidence favored fewer consumer transactions over another journal execution
layer. Do not consolidate receipt/completion saves in this change: after bounded grouping their
cost is small, and separate retained facts keep interruption/rejection/unknown-commit behavior
explicit. Journal locking, fresh admission, CAS and settlement remain necessary; local absence is
not permission to replay. The native backend/policy boundary and archive limits stay intact.

| Area reviewed                      | Decision and implementation                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture/export/inspection/envelope | Preserve ownership, lease/drain, integrity/profile separation and native crypto. Large-file synchronous encoding/validation remains a separate limitation.                                                                                                  |
| Archive and journal bounds/schemas | Use [allocation-free byte counting](../../src/lib/backup/utf8.ts) in budget/schema/canonical-output counts. Actual serialization still encodes and checks complete wire length. Well-formed UTF-16 validation remains independent.                          |
| Journal codec/storage/successors   | Remove the private codec split and JSON/comparison caches. Keep two weak sets for this codec's detached frozen outputs, complete foreign/byte admission and fresh output bytes. Keep exact intent/record comparisons, receipt evidence, CAS and durability. |
| Shared restore/write/custody       | Keep existing states and transaction lifetime. Remove the worker capability propagation/IPC branch entirely. No new orchestration, replay rule or authority shortcut.                                                                                       |
| Test app planning/remapping        | Index immutable tuples/projected rows instead of nested scans; preserve exact fast-plan canonical bytes and dependency order.                                                                                                                               |
| Test app note destination          | Use the existing chart for up to 32 notes targeting 64 KiB canonical content, with exact selected-ID queries, full group/parent/scope matching and synchronous staging in one borrowed transaction.                                                         |
| Comparison/activation/cleanup      | Preserve complete fresh graph/attachment comparison, transactional activation gate and local/remote observations; clear the private note array through existing resource ownership.                                                                         |
| Recovery compatibility             | Use the same fast plan everywhere with a fixed saved version 2. Reject older/unknown saved formats before writes; no batching selector or legacy continuation mode.                                                                                         |

The former journal worker, protocol/server/host, package export and dedicated tests are removed.
Its historical design/results and the unsuccessful serialized-cache results remain in
[journal-worker-design.md](journal-worker-design.md) and [journal-reuse-design.md](journal-reuse-design.md).
A local ignored source snapshot was saved during review before removal; it contains in-progress
batch changes and is not the exact original benchmark revision. No serialized buffers/strings are
retained by the remaining codec identity recognition. No worker heap is excluded from a current
worker comparison because the final implementation starts no dedicated worker.

## Performance result

The [full record report](record-performance.md#simplification-review) preserves raw paths, ablations,
commands, sampling limits and historical negative experiments. With the worker and serialized
caches removed, three fresh-authority 633-record runs complete in **4.63–4.74 seconds**, versus
**322.94 seconds** for baseline desktop 1. This is an observed roughly **68–70× improvement**, not a
universal timing guarantee. The workload still has 633 records, 672,633 payload JSON bytes, zero
attachments and an 897,082-byte encrypted file, and completes exact comparison and activation.
Writes fall from **635 to 23**; the final journal falls from **248,098 to 78,730 bytes**. No desktop
restore callback exceeds 50 ms; maximum observed restore delay is **34.7 ms** across the three runs.

Chrome CPU 4× completes in **7.60 seconds**, versus the old ten-minute timeout. It still has a
169.5 ms restore delay and 223.6 ms export delay; throttling does not qualify phones. All original
1/4/8 MiB encrypted binary cases also complete correctly, but the 8 MiB case still has a **688.7 ms**
overall delay and substantial memory use. No maximum-aggregate, mobile or cross-browser guarantee
is established. T004 remains open for those boundaries and actual Finance profile/restore work.

## Qualification

The user's current instruction authorizes implementation and these tests without another review
pause. All runs use synthetic/disposable storage; the existing Finance browser and credentials
are untouched.

- **948 unit cases pass**, including the full existing backup/journal/envelope/restore suites,
  immutable-output trust/mutation/proxy/byte-ownership cases, exhaustive native UTF-8 equivalence
  for every UTF-16 code unit and mixed surrogate inputs, and six fixed-plan/batch-bound cases.
- **69 native Jazz/Chromium restore cases pass in one complete invocation**, with seven opt-in
  measurements skipped. Follow-up cases exercise the sole grouped policy, rejection of saved
  versions 1 and 3 without writes,
  cancellation before comparison, remotely accepted uncertainty without replay, staging failure
  rollback, cancellation/drain during staging, partial-presence conflict, and multiple groups with
  three distinct attachments plus null references. Reload preserves exact data and issues no
  duplicate writes. The current log is `.svelte-kit/restore-review/single-plan-native.log`.
- **17 independent-reader and 18 test app-export cases pass**, plus the complete package-consumer
  type/runtime/bundle checks. This includes strict network-disabled independent inspection and
  original data/file preservation. Current log: `single-plan-consumer.log` under the same ignored
  review folder.
- **65 of 66 Storybook Chromium cases pass**. All backup/export/envelope/journal cases pass.
  A final focused run against the rebuilt package passes all **19 backup browser cases**
  (`final-backup-browser.log`), after the equivalent regex lint correction.
  The broad run and an isolated repeat both fail the unchanged avatar-selection test when selecting
  the same file after Escape: the second crop dialog never appears. No avatar implementation/test
  was changed to conceal this unrelated failure. Logs: `final-storybook-browser.log` and
  `final-avatar-rerun.log`. This is not an all-green full browser suite claim.
- Strict source/fixture/consumer TypeScript, Svelte checking (zero errors/warnings), package
  generation/public-package lint, Storybook build, repository lint, changed-file formatting,
  documentation links and diff whitespace checks pass. An initial lint issue in the ASCII detector
  was corrected with an equivalent non-ASCII range and the exhaustive UTF-8 cases pass again.
- Three independent desktop record measurements, one 4× CPU stress measurement and all three
  binary measurements complete successfully. No other browser/build workload overlaps those
  timings. The performance report preserves exact results and limitations.

No commit, publication, schema change, production mutation or live backup recovery is performed.
T007 inventory remains complete; T008 Finance capture/profile, T009 isolated domain restore and
T010 actual retained-file recovery remain separate work. Nothing is needed from the user to
complete this local investigation. It does not claim completion of those consumer adoption tasks.

The post-review CI correction makes root unit tests resolve test app package imports from source,
so they pass before packaging even with `dist` absent. The complete GitHub CI and title checks
passed on `d7b5317`. The subsequent user-requested single-plan simplification reruns all 948 units,
69 native restore cases, consumer/static checks and one 633-record measurement. This follow-up
removes compatibility implementation rather than adding another plan mode.

The single-plan follow-up measurement completes the same 633-record workload in **4,789 ms**,
with 23 writes, 21 data batches, a 78,730-byte journal and a 35.7 ms maximum restore delay
(no restore callbacks above 50 ms). The separately preserved raw artifact is
`.svelte-kit/notebook-performance-review-single-plan-only-records-633-cpu1-run1.json`.
It confirms the same fast grouping with the compatibility selector removed; it does not replace
the earlier three-run range or broaden platform/consumer qualification.
