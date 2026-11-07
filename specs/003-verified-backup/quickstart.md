# Validation and recovery rehearsal guide

**Updated 2026-11-07.** The shared archive, inspector and complete test app reference are executable
and qualified. Finance capture/restore/UI are merged in PRs #54/#57. Actual-size/platform
qualification work (T004) is closed with the user's acceptance of the documented SDK slowdown and
intermittent failures; reopen investigation if they occur in production. T014's explicit
same-operation retry is implemented and locally qualified, pending publication and Finance's package
adoption. The deployed fake-data rehearsal (T010) passed on a
120-transaction graph; see the task ledger for evidence and its qualification boundary.
Use [the task ledger](tasks.md#current-handoff) for current work and
[the qualification boundary](spec.md#known-restore-limitations-and-remaining-implementation-gates)
for limitations. These fixture commands do not operate on production Finance.

## Repository qualification

From the DLF repository with its pinned Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm exec playwright install chromium
pnpm exec tsc --project fixtures/private-creation/tsconfig.json
pnpm exec vitest run --config fixtures/private-creation/vitest.config.ts
pnpm check:backup-restore
pnpm test:storybook
```

`verify` builds the public package, checks consumers, runs units, independent-reader and test app-export
cases, and builds Storybook. The native/browser commands add private-creation, restore and Storybook
cases. T014's validation passed 947 units and a full 71-case restore browser regression run, with
seven optional measurement cases skipped. The final focused run passed three permission-repair
cases through completion, including the added Chromium process restart case. The separate
Storybook/private-creation suites were not rerun for T014.
Jazz/Chromium fixtures create disposable local servers and browser contexts; the restore harness
binds to `0.0.0.0:6199` (browser URL `http://localhost:6199`) and Storybook uses
`127.0.0.1:6008`. Do not run tests against the user's app/origin or an auto-publishing production server.

The user authorized the implemented test app work and its tests together. Future implementation
still follows repository review gates unless separately authorized. For documentation-only edits,
`pnpm format:check` and link/status consistency checks are sufficient; formatting is not backup proof.

## Test app retained-file round trip

The fixture uses the real public export/envelope/journal/write APIs, an in-memory source actor and
an actual Jazz destination with storage policies. Its native suite exercises retained export →
network-disabled independent inspection → isolated restore → fresh-session exact comparison,
original source/file preservation, interruption/reload/resume and uncertain activation without replay.

`fixtures/test-app/restore-workflow.ts` exposes an unstarted
`createTestAppRestore({ db, retainDetached, mode, binding, databaseName, archive })` root and request.
The caller supplies an integrity-checked archive and owns session lifetime/detached transaction custody.
`new` initializes and journals one plan; `resume` requires the same operation/destination, retained
browser journal, reselected matching file/password and a fresh live generation. Await drain before
stopping actors or changing identity. Only finite `complete` reports verified activation.
See [the test app guide](../../fixtures/test-app/README.md) for the integration contract.

No full-restore CLI, generic backup dialog or Finance backup route is supplied by this fixture.
Ordinary discovery must exclude incomplete destinations. Server policy enforces owner/scope/phase;
trusted client actors own the exact-content comparison under quiescent single-user consistency.

## Independently inspect an actual retained file

After `pnpm package`:

```sh
pnpm backup:inspect ./retained-file.dlfbackup
```

The inspector performs no build or network access and needs no original app login. Encrypted files
require `--password-stdin` and the exact UTF-8 password through stdin; do not put passwords in command
arguments or logs. See [reader usage, exit codes and bounds](../../fixtures/backup-reader/README.md).
Generic integrity, recognized-profile validation and verified destination recovery are separate
outcomes. An unknown profile is not a recognized-profile success. Fixture tests explicitly register
the test app validator; archives cannot register or load executable validators.

## Optional desktop size experiments

```sh
pnpm measure:backup
pnpm measure:backup-records
```

Run after package/consumer compilation has finished, with no overlapping native restore harness on
port 6199. The three optional 1/4/8 MiB cases measure encrypted export/open/full restore, sampled heap,
renderer RSS and event-loop delay. They are separate from the normal functional command and have no
CI timing thresholds. See [measured results and limits](test-app-performance.md). T007's
[Finance inventory](finance-deployment-inventory.md) records 633 projected records, about 0.64 MiB
of comparison encoding and no reachable attachments. Later Finance measurements and their accepted
limits are in the task ledger; the desktop run does not qualify phones. T004 is closed for this delivery.

The opt-in record command runs three desktop 633-record/672,633-byte synthetic test app cases and
one Chrome 4× CPU stress case. The final implementation uses bounded note transactions; the earlier
single-record baseline took several minutes. Each case has a finite ten-minute runner deadline.
No Finance data is copied. Ordinary functional runs skip these diagnostics.

Use a unique label to preserve existing results (exclusive file creation). For independent repeated
observations, run this command sequentially with a new label each time; each invocation starts a
fresh disposable authority. Do not overlap builds or other browser measurements.

```sh
DLF_BACKUP_RECORD_MEASURE=1 DLF_BACKUP_REVIEW_LABEL=my-run-1 pnpm exec vitest run \
  --config fixtures/test-app/restore.vitest.config.ts \
  -t 'measures record workload 633, CPU 1x, run 1' --disableConsoleIntercept
```

For the throttled case use the filter `measures record workload 633, CPU 4x, run 1` and a distinct
label. Review-only diagnostics also accept `DLF_BACKUP_REVIEW_RECORDS=128` and
`DLF_BACKUP_REVIEW_TRACE=1`; traces aggregate actor lifetimes, not private data or exclusive CPU
time. The defaults are 633 records and no tracing. All restore entry points use bounded notes;
there is no alternate batching mode.
Raw files use `.svelte-kit/test-app-performance-review-<label>-records-633-cpu1-run1.json`.

The [current review](restore-simplification-review.md) and
[performance report](record-performance.md#simplification-review) document exact results, recovery
checks and memory/sampling limits. The earlier [worker experiment](journal-worker-design.md) is
retired: the package worker entrypoint, host and `DLF_BACKUP_JOURNAL_COMPARE` option no longer exist.
Historical worker/reuse measurements are preserved. Test app restores use one plan with fixed
saved version 2; resume rejects older/unknown versions without changing the journal or destination.

## Finance adoption and actual recovery rehearsal

1. **T007, complete:** [read-only deployed inventory](finance-deployment-inventory.md) verifies
   frontend/backend schema/policy identity, released graph, scoped sizes and observable pending-write
   state. This is historical evidence; this task does not refresh or access production data.
2. **T008/T009, implemented:** Finance PRs [#54](https://github.com/delightful-labs/delightful-finances/pull/54)
   and [#57](https://github.com/delightful-labs/delightful-finances/pull/57) provide the actual capture,
   isolated restore, UI and disposable-data evidence. T004 measurements/accepted limitations are recorded.
3. **T010, passed for the recorded fake graph:** use a deployed Finance preview with its own Jazz app and a fresh test identity. Populate
   fake data, retain the downloaded file, reopen independently, restore into a new workspace, compare
   all declared values/references/bytes after a fresh session and preserve the fake source. No previous
   grants, active bank links or seeded categories may appear implicitly.

Production workspace data, browser sessions and admin credentials are excluded from this task.
The earlier request to connect the user's production tab is withdrawn. Record safe revision/profile
identifiers, aggregate coverage and comparison outcomes without passwords or credentials. Preserve
the fake source and retained file. An application archive does not preserve the entire engine history
or account registry.

## Recovery limits and explicit retry follow-up

Same-browser/origin recovery requires retained IndexedDB and the same archive. Page reload and a
fresh session are qualified; browser-process crash, cleared journal, offline restart and cross-device
recovery are not full-restore guarantees. Never infer non-commit from a hidden/null/incomplete read.

T014 implements explicit retry after a confirmed remote rejection with a known transaction ID.
Invoke the same selected write again after repairing authority. The existing machine reconciles
remote content and checks current authority before journaling another attempt and issuing a write.
It keeps the same operation/mappings and the latest rejection evidence. Unknown outcomes do not
permit replay, and rejection does not trigger an automatic retry loop. The three new native browser
cases change only a disposable local server's insertion policy, then repair permission, resume
in the same session, after page reload and after graceful Chromium process restart, and complete the
same restore. Finance must adopt the updated package before using this behavior.
