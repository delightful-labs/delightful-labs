# T004 — record workload performance investigation

**2026-11-05.** This experiment extends the approved test app benchmark with a synthetic workload
based on the [T007 inventory](finance-deployment-inventory.md): 633 records, 672,633 bytes of
comparison encoding and no reachable transaction attachments. It exercises existing export,
envelope, journaled restore, actual Jazz settlement, full content comparison and activation against
disposable local storage. It does not read, export or modify the deployed Finance workspace.

The baseline/reuse/worker sections below are historical. The later
[simplification review](#simplification-review) records the current code and results.

T004 remains open. The Finance profile, capture protocol and isolated restore are not implemented,
so these measurements cannot qualify their domain graph, final archive size or production latency.

## Baseline method and ownership

macOS 26.6.2, Apple M4 Pro, 24 GiB RAM, 12 logical processors, Node 25.2.1, pnpm 10.22.0,
Chromium 148.0.7778.96, Jazz 2.0.0-alpha.59 and XState 5.33.2. Source base is merged
`93cd1c7`; the opt-in measurement extension is the accompanying review diff. Password protection
uses the existing 600,000-iteration PBKDF2/AES-GCM envelope.

```sh
pnpm install --frozen-lockfile
pnpm package
pnpm exec tsc --noEmit --project fixtures/test-app/tsconfig.json
pnpm measure:backup-records
```

These commands now run the final bounded-transaction implementation; they do not reproduce the
retired baseline source. Use a unique review label as shown below to preserve existing artifacts.

The opt-in cases use one notebook and 632 notes, without attachments. Synthetic text includes
Unicode and line breaks, with deterministic ASCII padding to exactly 672,633 UTF-8 JSON bytes.
Each note has a notebook reference, text, archived flag and null attachment. The real Finance
projection has different record types, field widths and relationships; this is neither its profile
nor a worst-case CPU bound. The target matches the inventory's aggregate comparison-encoding size,
not an estimated Finance archive. The resulting encrypted test app file is 897,082 bytes.

The diagnostic driver constructs the fixture before timing, then invokes the already-qualified
XState export, envelope-open and complete-restore owners. Those actors retain their existing
claim, interruption, journal, transaction and settlement protocols. The driver owns the disposable
browser context, source/request lifetimes, retained file copy, journal removal, timers and CDP
instrumentation. It introduces no replacement application workflow or production behavior.

In the original baseline there were three unthrottled iterations in fresh browser contexts and one Chrome 4× CPU-throttling
stress case. The test runner owns the temporary Jazz authority and Vite server on port 6199 and
closes them after the cohort. The authority retains prior isolated destinations between browser
contexts, so these are ordered observations rather than independent identical-backend repetitions.
The upward duration drift does not prove a particular scaling law or regression. Each completed baseline
restore issued 635 destination writes: preparation,
633 records and activation. The benchmark imposes no CI latency threshold; each record measurement
has a finite 600-second test-runner deadline.

Memory uses the same approximate sampling as the [binary baseline](test-app-performance.md):
CDP JS heap every 25 ms and summed renderer RSS every 100 ms, including fixture construction.
RSS covers two Chromium renderer processes and can double-count shared pages; it excludes the
browser process, test runner and local authority. Sampling can miss short peaks and does not prove
a memory leak. A 16 ms timer records scheduling delays, including GC and host scheduling. A 20 ms
yield flushes each phase's delayed callbacks before the label changes; phase duration excludes
these observation gaps. Timings include instrumentation overhead and local disposable I/O.

Chrome's 4× CPU emulation is a diagnostic stress setting, not a phone, low-memory device, slower
disk or network model. No mobile, Firefox, Safari, maximum-aggregate or 50,000-record claim follows.
The new cases are skipped by ordinary functional runs unless `DLF_BACKUP_RECORD_MEASURE=1` is set.
`DLF_BACKUP_RECORD_TIMEOUT_MS` may shorten the diagnostic deadline to 1,000–600,000 ms for teardown
probes; the normal command defaults to 600,000 ms. This does not change a production workflow limit.

## Results

Measurements are retained in ignored `.svelte-kit/notebook-performance-records-633-cpu*-run*.json`.

| Run                  | Export | Open  | Restore through activation | Largest timer delay | Sampled JS heap peak | Sampled renderer RSS peak | Outcome    |
| -------------------- | ------ | ----- | -------------------------- | ------------------- | -------------------- | ------------------------- | ---------- |
| Desktop 1            | 237 ms | 82 ms | 322.9 s                    | 197 ms              | 139.6 MiB            | 1184.6 MiB                | `complete` |
| Desktop 2            | 234 ms | 85 ms | 387.9 s                    | 208 ms              | 133.8 MiB            | 1223.7 MiB                | `complete` |
| Desktop 3 (profiled) | 253 ms | 88 ms | 439.3 s                    | 185 ms              | 145.4 MiB            | 1127.8 MiB                | `complete` |

The three completed observations retained a 248,098-byte final journal and each issued 635 writes.
Export-phase timer delays were 169–181 ms; open-phase delays were 12–26 ms; restore-phase delays
were 185–208 ms. These are sampled observations with instrumentation, not product latency budgets.
The 4× CPU experiment **did not complete before its 600,000 ms runner deadline**. The last
15-second console observation reported **475 issued writes**, compared with 635 for a complete
restore. Issuance is not acceptance or a completed-record count. Its final phase/peak metrics were
not retained, so no completed throttled latency or peak-memory result is claimed. The optional
command exited nonzero: three cases passed, one timed out, and 63 unrelated cases were skipped.

The initial timeout also exposed an unhandled CDP heap-sample rejection when the context closed.
The sampler now consumes expected closure rejections, tracks/drains in-flight reads before detach,
and preserves unexpected sampling failures as run failures. Interrupted-run metadata is retained
separately with the configured deadline in its filename; no completed metrics file is fabricated.
Progress uses direct stdout so an operator need not attach a debugger to see issued-write counts.
The original three full-restore measurements precede this instrumentation-cleanup revision; their
production workflow, workload and timing boundaries are unchanged.

## Bounded CPU sample

A separate 10.07-second CDP CPU sample during the third unthrottled restore observed 24 issued
writes, from 36 to 60, with no detached writer receipts. The profile is retained outside Git at
`.svelte-kit/record-workload-restore.cpuprofile`. The third iteration includes this extra diagnostic
overhead; it is not a clean controlled comparison against the first two iterations.

Classifying samples by their call-stack paths and weighting by sample time deltas found about
35.4% under shared restore-journal code, 14.2% in garbage collection, 41.0% idle, 2.3% under Jazz and
the remainder in other work. These percentages include idle sampled time; they are not CPU-core
utilization. Native encoding/stringification/allocation frames occur under journal validation and
successor comparison. The hot-path attribution is diagnostic evidence, not proof of a particular
optimization's benefit. Temporary Node debugger inspection was confined to the owned test process
and was closed after sampling.

Source inspection is consistent with this sample: journal load/update, successor checks and intent
matching repeatedly parse, validate, encode or compare the retained plan and growing checkpoint.
The test app also uses one batch per record. Counts and byte size alone do not characterize these
costs. No validation, CAS check, exact comparison or durability requirement was relaxed to obtain
the measurement.

## Immutable reuse comparison

After review and approval of the [immutable journal reuse candidate](journal-reuse-design.md),
run only the first unthrottled case in a new test invocation with a fresh disposable authority:

```sh
DLF_BACKUP_RECORD_MEASURE=1 pnpm exec vitest run \
  --config fixtures/test-app/restore.vitest.config.ts \
  -t 'measures record workload 633, CPU 1x, run 1' --disableConsoleIntercept
```

The new run returns `complete` after exact content comparison and activation. Record count (633),
payload JSON bytes (672,633), attachments (zero), encrypted file bytes (897,082), issued writes (635)
and final journal bytes (248,098) match baseline run 1. It uses the same host, browser and 1× CPU
configuration, with no overlapping native restore harness, CPU profiler or Storybook test run.
The driver includes the previously documented timeout-cleanup/progress correction. This is one
before/after observation, not a repeated statistical experiment or a whole-suite qualification.

| Metric                     | Before: baseline desktop 1 | After: immutable reuse |
| -------------------------- | -------------------------- | ---------------------- |
| Export                     | 236.6 ms                   | 234.4 ms               |
| Open                       | 82.0 ms                    | 82.5 ms                |
| Restore through activation | 322,939.0 ms               | 313,935.6 ms           |
| Largest timer delay        | 197.4 ms                   | 198.2 ms               |
| Restore-phase timer delay  | 197.4 ms                   | 198.2 ms               |
| Sampled JS heap peak       | 139.6 MiB                  | 161.5 MiB              |
| Sampled renderer RSS peak  | 1184.6 MiB                 | 1334.4 MiB             |

The single observed restore duration is 2.8% lower, while sampled JS heap is 15.7% higher and
renderer RSS 12.6% higher. Export/open phase delays are 171.2/26.9 ms after the change. Timing and
memory variation prevent attributing a reproducible speedup or regression from one pair. The
candidate leaves the multi-minute duration and roughly 198 ms stalls intact; these results do not
establish a convincing net performance benefit or support a responsiveness claim. The retained JSON
cache adds representation size, while fresh bytes/new checkpoints still require full validation.
No post-change CPU profile or 4× stress measurement was taken, so neither a CPU attribution nor a
resolved stress timeout is claimed.

Before running, all three baseline JSON files were copied byte-for-byte into ignored
`.svelte-kit/journal-reuse/before-records-633-run{1,2,3}.json`. The new result is preserved separately
at `.svelte-kit/journal-reuse/after-records-633-run1.json`; the ordinary run-1 path was restored to
its pre-change bytes so the baseline table's artifact references remain accurate. The after run
has 11,332 heap samples, 3,104 RSS samples and two sampled renderer processes. These artifacts contain
synthetic measurements, not production Finance data.

## Journal worker comparison

After implementation approval, the [journal worker experiment](journal-worker-design.md) passes
focused functional checks, then measures the same first 633-record case in two sequential test
invocations, each with a fresh disposable authority. The reuse candidate stays enabled in both.
No profiling, other native test harness or build runs overlap these measurements.

The following commands describe the retired experiment; the comparison option no longer exists.

```sh
DLF_BACKUP_RECORD_MEASURE=1 DLF_BACKUP_JOURNAL_COMPARE=main pnpm exec vitest run \
  --config fixtures/test-app/restore.vitest.config.ts \
  -t 'measures record workload 633, CPU 1x, run 1' --disableConsoleIntercept
DLF_BACKUP_RECORD_MEASURE=1 DLF_BACKUP_JOURNAL_COMPARE=worker pnpm exec vitest run \
  --config fixtures/test-app/restore.vitest.config.ts \
  -t 'measures record workload 633, CPU 1x, run 1' --disableConsoleIntercept
```

Both return `complete` after exact content comparison and activation. Record count, payload/file
bytes, attachment count, 635 issued writes and 248,098 final journal bytes match the earlier workload.
Both use Chromium 148.0.7778.96, CPU 1× and the host described above. The main run has zero dedicated
journal workers; worker mode has one, kept alive across every journal step. Jazz, archive processing,
planning, request/reply validation and destination writes remain on the page.

| Metric                           | Current main-thread control | Journal worker |
| -------------------------------- | --------------------------- | -------------- |
| Export                           | 234.2 ms                    | 255.7 ms       |
| Open                             | 80.8 ms                     | 85.1 ms        |
| Restore through activation       | 323,959.3 ms                | 395,630.8 ms   |
| Largest restore timer delay      | 212.1 ms                    | 201.6 ms       |
| Restore timer delays >50 ms      | 5                           | 21             |
| Restore timer delays >100 ms     | 4                           | 4              |
| Restore delays >50 ms per minute | 0.93                        | 3.18           |
| Sampled page JS heap peak        | 175.5 MiB                   | 150.9 MiB      |
| Sampled renderer RSS peak        | 1218.2 MiB                  | 1256.9 MiB     |

The worker restore is **22.1% longer** in this pair. Its largest delay is about 5% lower, but more
medium delays occur even after normalizing by duration. Positive timer excess sums are 42,896.6 ms
and 68,137.7 ms across 18,832/22,398 restore callbacks. These sum positive scheduling delays, not
CPU time or exact time during which a UI was blocked. Phase-attributed export/open delays are
170.9/27.0 ms for main and 181.0/14.3 ms for worker. The largest overall delay equals the restore
maximum in each run. One observation per mode does not establish statistical repeatability or a
general regression; it supplies no convincing net performance benefit for this worker placement.

Worker startup is 28 ms and shutdown is 30.5 ms, recorded separately from restore duration. All
3,178 journal requests receive replies; IPC round trips sum to 135,070.5 ms with a maximum of
122.2 ms. Those intervals include worker execution, native storage, copies, messaging and scheduling;
they exclude page request preparation and final reply validation and are not a CPU profile or an
attribution of the entire slowdown. No validation or durability check was removed to obtain a result.

Page heap sampling excludes worker heap, so its observed 14.0% reduction is not a total-memory
improvement. Summed renderer RSS is 3.2% higher with the worker. Both sample two renderer processes,
selected after worker READY; dedicated-worker allocations may reside in those processes. Sampling
starts after worker startup and before fixture construction, so worker startup peaks are excluded.
The usual sample-rate, shared-page double-counting and whole-system exclusions still apply. The
main/worker runs retain 12,060/14,730 heap samples and 3,215/3,928 RSS samples, respectively.

Raw files are ignored `.svelte-kit/notebook-performance-journal-main-records-633-cpu1-run1.json`
and `.svelte-kit/notebook-performance-journal-worker-records-633-cpu1-run1.json`. Comparison output
uses exclusive creation; earlier baseline/reuse files remain byte-for-byte unchanged. The added
timer/IPC diagnostics are shared by this new pair where applicable; earlier tables retain their
original instrumentation. No 4× stress, mobile, other-browser or new CPU profile was run.

The worker and retained JSON caches were subsequently removed during the broader review. These
negative measurements and their raw artifacts remain preserved; they do not describe the current
bounded-transaction code.

## Simplification review

The user authorized a broader implementation review and all necessary tests. The
[review/design](restore-simplification-review.md) covers the complete capture/envelope/archive/
journal/restore path. The decisive change is bounded consumer note transactions using the existing
shared journal/custody/settlement owner. One group has at most 32 notes and targets 64 KiB canonical
content; a larger valid note stays a singleton. Root/attachment order, exact set/content/reference
checks, transaction rollback, local/remote requirements and full final comparison remain enforced.
All restores now use the faster plan with fixed saved version 2. A user-requested follow-up removed
the v1 compatibility path; older/unknown journals are rejected without destination writes.

Two pure simplifications accompany batching: count UTF-8 bytes without allocating arrays, and index
immutable mapping/projection inputs instead of repeatedly canonicalizing/searching them. The worker,
IPC layers and retained serialized JSON caches are removed. Two private weak sets recognize only
codec-produced deeply frozen values; foreign inputs/bytes and new checkpoints retain complete
validation. No archive/profile/wire bound changes, weaker authority check or automatic retry is used.

A 128-record ablation isolates the direction of improvement (nested actor wall times overlap):

| Variant                           | Restore     | Issued writes | Journal operations | Journal actor wall time |
| --------------------------------- | ----------- | ------------- | ------------------ | ----------------------- |
| Initial single-record trace       | 19,545.4 ms | 130           | 653                | 4,366.9 ms              |
| UTF-8/indexed single-record trace | 14,668.7 ms | 130           | 653                | 1,312.2 ms              |
| Bounded-note trace                | 1,176.1 ms  | 7             | 38                 | 110.4 ms                |

The initial trace also attributes 7,639.2 ms to note remote reads, 3,835.6 ms to remote settlement
and 1,650.1 ms to transactional note reads. These are synthetic actor lifetimes, not exclusive CPU.
Those ablations preceded final removal of worker/cache code and are not the final qualification.
Their single-record mode is historical and is no longer available in the diagnostic.
Raw files are ignored `.svelte-kit/notebook-performance-review-{before-trace,utf8-indexed-single,
bounded-trace}-records-128-cpu1-run1.json` (the brace notation describes three actual filenames).

The codec-only diagnostic separately preserves `journal-cost-{before,utf8,final}.json` under
`.svelte-kit/restore-review/`. Across 20 operations on a 633-mapping singleton plan, create/foreign
parse/decode go from 382,700 TextEncoder calls each to 20 (one output encode per operation), with
identical 145,068-byte wire length. Final elapsed times are 37.4/47.5/55.3 ms versus 77.4/92.0/96.3 ms
before byte-count changes. Known encodes now cost 3.8 ms for 20 instead of 1.1 ms with retained JSON;
that small cost is accepted to remove serialized caches. These are one-process diagnostics, not
product benchmarks or isolated attribution of every change.

### Final record measurements

Run sequentially, with fresh disposable authorities and no overlapping browser/build workload:

```sh
DLF_BACKUP_RECORD_MEASURE=1 DLF_BACKUP_REVIEW_LABEL=final-633-1 pnpm exec vitest run \
  --config fixtures/test-app/restore.vitest.config.ts \
  -t 'measures record workload 633, CPU 1x, run 1' --disableConsoleIntercept
```

Repeat with labels `final-633-2` and `final-633-3`; each is a separate invocation of run 1, not
ordered destinations on one authority. For the stress case use label `final-633-cpu4` and filter
`measures record workload 633, CPU 4x, run 1`. Metrics use exclusive creation at
`.svelte-kit/notebook-performance-review-<label>-records-633-cpu<rate>-run1.json`.
All original baseline/reuse/worker artifacts remain unchanged.

| Run             | Export   | Open     | Restore through activation | Restore max delay | Overall max delay | Page heap peak | Renderer RSS peak |
| --------------- | -------- | -------- | -------------------------- | ----------------- | ----------------- | -------------- | ----------------- |
| Fresh desktop 1 | 106.5 ms | 69.7 ms  | 4,667.6 ms                 | 33.1 ms           | 45.2 ms           | 61.4 MiB       | 921.5 MiB         |
| Fresh desktop 2 | 105.2 ms | 71.9 ms  | 4,740.4 ms                 | 33.6 ms           | 43.4 ms           | 56.8 MiB       | 925.3 MiB         |
| Fresh desktop 3 | 104.1 ms | 69.2 ms  | 4,632.5 ms                 | 34.7 ms           | 42.9 ms           | 57.3 MiB       | 921.3 MiB         |
| Chrome CPU 4×   | 320.7 ms | 175.9 ms | 7,595.5 ms                 | 169.5 ms          | 223.6 ms          | 58.9 MiB       | 847.9 MiB         |

All return `complete` after real local persistence, remote acceptance, full graph comparison and
activation, with the same 633 records, 672,633 payload JSON bytes, zero attachments and 897,082-byte
encrypted file as the baseline. Each issues **23 writes**, retains **21 data batches** and a
**78,730-byte journal**, using plan v2 and no dedicated worker. The original plan v1 issued 635
writes and retained a 248,098-byte journal. Grouping/checkpoint identity intentionally differs;
archive data and exact final comparison do not.

The observed desktop range is about 68–70× faster than baseline desktop 1 (322,939 ms), roughly
98.5% shorter. The three repeats establish this observed range, not statistical confidence or a
universal bound. No desktop restore callback exceeds 50 or 100 ms. The 4× run has 10 over 50 ms and
one over 100 ms, and export delays reach 223.6 ms. It completes where the old 4× case timed out at
600 seconds; it still does not establish phone responsiveness. The last formatting/lint cleanup
rewrites the equivalent non-ASCII regex range; exhaustive UTF-16 tests verify equivalent behavior.
Memory remains sampled page heap/summed two-renderer RSS, not exact whole-system memory. These
shorter runs also have fewer samples and may miss peaks; do not infer a memory leak or precise
percentage memory saving.

After the user-requested removal of the v1 compatibility path and all batching options, one
fresh-authority confirmation completes in **4,789 ms**, with the same 23 writes, 21 data batches,
78,730-byte journal and exact archive/destination contents. Maximum restore delay is 35.7 ms with
zero callbacks above 50 ms. Raw file:
`.svelte-kit/notebook-performance-review-single-plan-only-records-633-cpu1-run1.json`.
This is a separate follow-up observation; the three-run table above remains unchanged.

### Binary compatibility and remaining limits

A separately labeled `DLF_BACKUP_MEASURE=1 DLF_BACKUP_REVIEW_LABEL=final-binary` run with filter
`measures encrypted` completes all original 1/4/8 MiB encrypted attachment cases. Fresh contexts
share one authority in that invocation. Raw paths are
`.svelte-kit/notebook-performance-review-final-binary-{1,4,8}.json`.

| Attachment | Export   | Open     | Restore    | Largest delay | Page heap peak | Renderer RSS peak |
| ---------- | -------- | -------- | ---------- | ------------- | -------------- | ----------------- |
| 1 MiB      | 156.0 ms | 115.2 ms | 1,120.9 ms | 83.1 ms       | 64.4 MiB       | 834.1 MiB         |
| 4 MiB      | 475.3 ms | 328.5 ms | 2,047.9 ms | 344.8 ms      | 155.3 MiB      | 1173.2 MiB        |
| 8 MiB      | 896.4 ms | 607.1 ms | 3,346.0 ms | 688.7 ms      | 249.5 MiB      | 1272.7 MiB        |

All use five writes and plan v2, with exact shared attachment bytes/references preserved. This is
functional compatibility, not a resolved large-file responsiveness claim. The 8 MiB export delay
is still substantial; limits are unchanged. A bounded binary/archive processing design would be a
separate concern from the retired journal worker.

T004 remains open for actual Finance profile/capture/interaction (T008), isolated domain restore
(T009), supported platforms and maximum aggregate sizes. T010 still requires independently opening
an actual retained deployed backup and exact fresh-session recovery while preserving the original.
The synthetic test app does not provide that evidence, even when count/size targets match T007.
No production Finance code, schema, credentials or deployed data changed.

## Final validation

The [simplification review](restore-simplification-review.md#qualification) records final functional
and static checks, including the unrelated avatar browser failure from the broad regression run.
Historical baseline/reuse/worker test counts belong to their corresponding revisions. All completed
record and binary measurements above pass exact restore/comparison/activation; the historical
600-second stress timeout remains recorded rather than overwritten. No commit or deployment made.

Naming follow-up: this example consumer is now **test app**, under `fixtures/test-app`.
Historical raw artifacts retain the original `notebook-performance-*` filenames; current
diagnostics write `test-app-performance-*`. Historical measurements remain as recorded; the sample record types and coverage are preserved.
