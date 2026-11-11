# Test app backup consumer

This disposable nonfinancial consumer validates portable archive contents and complete isolated Jazz
restore. Its known input is constructed by `dataset.ts`; the destination uses actual Jazz storage
and policies. The app is called **test app**; notebooks and notes are sample record types.

`profile.ts` validates the exact `dlf-test-app` v1 graph after generic payload validation. The dataset
includes shared relationships, archived content, combining Unicode, line breaks, embedded NUL,
an empty body and four binary attachment bytes. No credentials or grants are represented.

The former in-memory capture source and lease simulator are removed. Restore fixtures seal known
payloads directly with the public envelope request/machine. They do not simulate source locking or
claim native capture coverage. `archive.test.ts` retains protected/unprotected files, inspects them
in separate processes with network APIs disabled, checks exact records/relationships/bytes and
validates the domain profile. Restore's retained-file round-trip also verifies unchanged input/file.

Actual export qualification lives in `fixtures/native-capture/` and `src/lib/backend/jazz/backup.test.ts`.
It uses real independent Jazz sessions and persistent Chromium storage. The sole export workflow
is `createJazzArchiveExportMachine` at `backup/export/workflow`, with a native request prepared
through `backend/jazz/backup`. There is no generic source/lease export API or retry-cleanup machine.

Build and run archive/profile verification:

```sh
pnpm package
pnpm check:test-app
```

This compiles the test app into ignored `.svelte-kit/test-app/` output and runs retained-file/profile
cases. `pnpm check:consumer` includes these cases and builds public-package browser journal fixtures.
Use `pnpm check:native-backup` for the actual native capture probes and browser downloads.

## Complete restore

`restore-workflow.ts` provides `createTestAppRestore({ db, retainDetached, mode, binding,
databaseName, archive })`, returning an unstarted root actor and its single-use request. The
archive is already integrity-checked; the root validates the exact test app profile. `new`
initializes the journal namespace, plans once and invokes preparation plus all pending mapped
attachment/notebook/note writes. `resume` requires the same operation/destination, retained browser
journal and reselected archive; it reconstructs the same mappings and verifies the intent.
Use a fresh binding generation after reload. Resume never allocates another destination.

The root freshly reads the complete graph, compares all records and exact attachment bytes, saves
the comparison with CAS, then invokes activation through the shared write/transaction owner.
Activation rechecks the graph in its transaction before changing the destination to `active`.
Only `complete` means comparison and activation completed; `incomplete`, `conflict` and
`unavailable` preserve recovery facts. `activeTestAppDestinations(ownerId)` excludes incomplete
work. Consumer discovery must use this gate.

Jazz policies allow only the owner to transition `incomplete` to `active` with unchanged destination
provenance. Domain rows remain immutable and further inserts are denied after activation. The
permission boundary enforces owner, scope and phase, while the trusted restore actor owns the
archive-content comparison. It is not a server-side assertion that arbitrary owner-authored clients
performed verification. Capture/restore assumes quiescent single-user data, as declared in the file.

Send `CANCEL`, `SHUTDOWN`, or scoped `INVALIDATE` and await the finite output before stopping the
root/session. Request `release()` while active requests cancellation and retains the file until
the current child drains. Identity loss is latched across the whole root, including A → B → A.
The host supplies `retainDetached` for unexpected owner-stop custody, as with the other writers.
Unknown issued activation is not replayed: a fresh exact active-graph match plus retained required
local-persistence evidence may complete its checkpoint. Otherwise recovery stays incomplete.

```sh
pnpm package
pnpm check:test-app
pnpm check:backup-restore
pnpm measure:backup # optional desktop memory/latency experiment
pnpm measure:backup-records # optional 633-record experiment based on T007 aggregate sizes
```

See [completion design and evidence](../../specs/003-verified-backup/restore-completion-design.md)
and [binary performance measurements](../../specs/003-verified-backup/test-app-performance.md).
The [record workload investigation](../../specs/003-verified-backup/record-performance.md) uses
synthetic data matching T007's count and comparison-encoding byte target. The broader
[simplification review](../../specs/003-verified-backup/restore-simplification-review.md) replaces
per-note transactions with groups of at most 32 notes targeting 64 KiB canonical content (one larger
valid note stays a singleton). Root and attachment dependencies remain singleton writes. The existing
transaction owner still enforces authority, rollback, local/remote settlement and full comparison.
Partial group presence is conflict and never authorizes subset replay.

Every restore entry point uses the same bounded note groups. There is no batching option or
mutable plan-version selector. The saved plan has fixed version 2; resume accepts only that version
and checks the exact retained intent/mappings before writes. Older/unknown plans return unavailable
without changing the journal or destination. The archive profile/wire format is unchanged.

The optional benchmarks retain phase delays, heap/RSS, writes and final journal size. Use
`DLF_BACKUP_REVIEW_LABEL=<unique-label>` to avoid overwriting earlier artifacts; see the
[measurement commands](../../specs/003-verified-backup/quickstart.md#optional-desktop-size-experiments).
The original 4× case timed out at ten minutes; final bounded-transaction results are recorded
separately. The unsuccessful journal worker and retained JSON caches are removed, with their
historical [worker design/results](../../specs/003-verified-backup/journal-worker-design.md) preserved.
There is no current worker host, worker package export or journal execution option.

Functional qualification covers retained export/independent network-disabled inspection, isolated
restore, fresh-session comparison, original preservation, conflicts, reload/resume, uncertain writes
without replay, rollback, cancellation/draining and actual policies. Browser-process crashes, cleared
journal, offline restart and cross-browser recovery remain outside the qualified restore boundary.
T007 inventory is complete; actual Finance integration and supported-platform qualification remain
T008–T010 and T004. Desktop/throttled test app measurements do not qualify phones or Finance recovery.

The [native event-routing review](../../specs/003-verified-backup/native-event-routing-review.md)
records the repository-wide follow-up: invoking states deliver controls with XState actions, while
native read leaves drain under their owner's interruption state.

Earlier bounded-slice notes and test totals are preserved in [implementation history](history.md).
The active remaining work is in [the task ledger](../../specs/003-verified-backup/tasks.md#current-handoff).

Validation after renaming: 948 unit tests, 69 native Jazz/Chromium restore tests, 28 affected
browser tests, and the reader/export/consumer checks pass. The 633-record diagnostic also
completes through the renamed command.

The app was renamed from notebook to test app. Historical measurement artifacts retain their
original `notebook-performance-*` filenames; new diagnostics write `test-app-performance-*`.
