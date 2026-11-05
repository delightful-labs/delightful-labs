# Validation and recovery rehearsal guide

**Updated 2026-11-05.** The shared archive, inspector and complete notebook reference are executable
and qualified. Finance capture/restore and an actual deployed-data rehearsal remain unimplemented.
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

`verify` builds the public package, checks consumers, runs 927 units, 17 independent-reader cases
and 18 notebook-export cases, and builds Storybook. The native/browser commands add 10 private-creation,
60 restore and 65 Storybook cases, for 1,097 functional cases. Jazz/Chromium fixtures create disposable
local servers and browser contexts; the restore harness uses `127.0.0.1:6199` and Storybook uses
`127.0.0.1:6008`. Do not run tests against the user's app/origin or an auto-publishing production server.

The user authorized the implemented notebook work and its tests together. Future implementation
still follows repository review gates unless separately authorized. For documentation-only edits,
`pnpm format:check` and link/status consistency checks are sufficient; formatting is not backup proof.

## Notebook retained-file round trip

The fixture uses the real public export/envelope/journal/write APIs, an in-memory source actor and
an actual Jazz destination with storage policies. Its native suite exercises retained export →
network-disabled independent inspection → isolated restore → fresh-session exact comparison,
original source/file preservation, interruption/reload/resume and uncertain activation without replay.

`fixtures/backup-notebook/restore-workflow.ts` exposes an unstarted
`createNotebookRestore({ db, retainDetached, mode, binding, databaseName, archive })` root and request.
The caller supplies an integrity-checked archive and owns session lifetime/detached transaction custody.
`new` initializes and journals one plan; `resume` requires the same operation/destination, retained
browser journal, reselected matching file/password and a fresh live generation. Await drain before
stopping actors or changing identity. Only finite `complete` reports verified activation.
See [the notebook guide](../../fixtures/backup-notebook/README.md) for the integration contract.

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
the notebook validator; archives cannot register or load executable validators.

## Optional desktop size experiments

```sh
pnpm measure:backup
pnpm measure:backup-records
```

Run after package/consumer compilation has finished, with no overlapping native restore harness on
port 6199. The three optional 1/4/8 MiB cases measure encrypted export/open/full restore, sampled heap,
renderer RSS and event-loop delay. They are separate from the normal functional command and have no
CI timing thresholds. See [measured results and limits](notebook-performance.md). T007's
[Finance inventory](finance-deployment-inventory.md) records 633 projected records, about 0.64 MiB
of comparison encoding and no reachable attachments. Actual profile/envelope size and platform
responsiveness still need T008/T004 qualification; the desktop run does not qualify phones.

The opt-in record command runs three desktop 633-record/672,633-byte synthetic notebook cases and
one Chrome 4× CPU stress case. The final implementation uses bounded note transactions; the earlier
single-record baseline took several minutes. Each case has a finite ten-minute runner deadline.
No Finance data is copied. Ordinary functional runs skip these diagnostics.

Use a unique label to preserve existing results (exclusive file creation). For independent repeated
observations, run this command sequentially with a new label each time; each invocation starts a
fresh disposable authority. Do not overlap builds or other browser measurements.

```sh
DLF_BACKUP_RECORD_MEASURE=1 DLF_BACKUP_REVIEW_LABEL=my-run-1 pnpm exec vitest run \
  --config fixtures/backup-notebook/restore.vitest.config.ts \
  -t 'measures record workload 633, CPU 1x, run 1' --disableConsoleIntercept
```

For the throttled case use the filter `measures record workload 633, CPU 4x, run 1` and a distinct
label. Review-only diagnostics also accept `DLF_BACKUP_REVIEW_RECORDS=128`,
`DLF_BACKUP_REVIEW_BATCHING=single-record` and `DLF_BACKUP_REVIEW_TRACE=1`; traces aggregate actor
lifetimes, not private data or exclusive CPU time. The defaults are 633 records, bounded notes and
no tracing. These switches affect the disposable diagnostic, not existing retained recovery plans.
Raw files use `.svelte-kit/notebook-performance-review-<label>-records-633-cpu1-run1.json`.

The [current review](restore-simplification-review.md) and
[performance report](record-performance.md#simplification-review) document exact results, recovery
checks and memory/sampling limits. The earlier [worker experiment](journal-worker-design.md) is
retired: the package worker entrypoint, host and `DLF_BACKUP_JOURNAL_COMPARE` option no longer exist.
Historical worker/reuse measurements are preserved. New complete notebook restores use plan v2;
resume honors the retained v1/v2 version and never rebatches an issued plan.

## Finance adoption and actual recovery rehearsal

1. **T007, complete:** [read-only deployed inventory](finance-deployment-inventory.md) verifies
   frontend/backend schema/policy identity, released graph, scoped sizes and observable pending-write
   state. Repeat if source/deployment/device changes before adoption; source schemas alone are insufficient.
2. **T008:** qualify an allowlisted profile and owner-authorized quiescent/drained capture against
   alpha.59, including local/remote comparison and exact complete bytes. Use disposable data first.
3. **T009:** qualify the additive isolation/policy lane and consumer interaction. Exercise complete
   restore, scope loss, uncertain writes, explicit confirmed-rejection retry where supported, cached
   clients and restart. Direct routes and backend operations must exclude incomplete destinations.
4. **T010:** retain the actual deployed file, reopen it independently, restore into a new isolated
   destination, compare all declared values/references/bytes in a fresh session and preserve the
   original. No previous grants, active bank links or seeded categories may appear implicitly.

Complete [Finance adoption requirements](contracts/finance-adoption.md) before touching real data.
Record safe revision/profile identifiers, aggregate coverage and comparison outcomes without private
records, passwords or credentials. Keep the original workspace and file before later identity/storage
changes. An application archive does not preserve the entire engine history or account registry.

## Recovery limits and explicit retry follow-up

Same-browser/origin recovery requires retained IndexedDB and the same archive. Page reload and a
fresh session are qualified; browser-process crash, cleared journal, offline restart and cross-device
recovery are not full-restore guarantees. Never infer non-commit from a hidden/null/incomplete read.

T014 tracks the accepted explicit retry after a confirmed remote rejection and repaired authority.
The journal representation exists; the current writer leaves rejection/uncertainty incomplete and
issues no replacement attempt. Keep the same operation/mappings and bounded rejection evidence when
that integration is implemented. No generic automatic retry or repair engine is required.
