# Test app backup consumer

This disposable nonfinancial consumer exercises export/inspection and a complete isolated Jazz
restore. The source is an in-memory test app actor; the restore destination uses actual Jazz
storage and policies. It is a reusable integration example, not Finance adoption.
The app is called **test app**; notebooks and notes are only its sample record types.

`profile.ts` is a trusted exact `dlf-test-app` v1 registration for the existing inspector. Its validator
must receive a generically validated payload; it does not hash attachments or grant permissions.
`dataset.ts` supplies a notebook and three notes: shared notebook/attachment relationships, archived
content, combining Unicode, line breaks, embedded NUL, an empty body and four binary attachment bytes.
The retained-file round-trip checks exact destination fidelity and preserves the source.

`source.ts` supplies leaf adapters for the fixture-owned state machine under `machines/source.ts`.
The chart owns available/leased state, binding invalidation and current-owner release. Payloads stay
in private capsules; there is no application class or parallel lease flag. `createTestAppSource()`
returns an unstarted root as `source.actor`; the host must start it before use and stop it after
all exports have drained. Early/stopped source work is rejected, not queued for later execution.
All fixture writers are synchronous, and an exclusive lease
blocks `replace()` while capture owns the source. `checkAuthority`, acquisition, drain, read and
consistency checks each perform one bounded leaf step. The shared invoked capture machine sequences
them and releases the lease before protection/handoff. This is an in-memory model; it provides no
persisted journal, cross-instance locking, remote confirmation or Jazz consistency guarantees.

`export.ts` creates an **unstarted export** root actor and request, and explicitly starts the
independent in-memory source root. It returns `source.actor` for host disposal after export drain;
the source lifetime spans later writes and exports. The application supplies a full
binding, protection choice and one file-handoff capability. Start the returned actor and observe its
tags/output through normal XState APIs. The handoff receives a borrowed copy-only file handle and the
original binding; it must check current authority immediately before its one dispatch effect and
respect the signal. It owns any byte copies it takes. Return `dispatched`, `rejected` or `unknown`;
dispatch means only that effect was observed, never that the user retained/validated a file.

On `handoffRetry`, send `RETRY_HANDOFF` with the exact original binding to retry only dispatch, using
the same completed bytes. Rejected attempts cannot erase an earlier unknown dispatch. A request is
single-use and cannot restart capture after completion or invalidation. A new export needs a new
operation ID and request. Metadata including identity/workspace/operation IDs is private recovery
context, never telemetry.

On access/session change, immediately send scoped `INVALIDATE` with the original binding and update
the source's observed binding. Increment generation for every binding replacement, including
A → B → A. For graceful teardown, send `CANCEL` or `SHUTDOWN` and await actor completion before
stopping. Cancellation drains already issued calls; native crypto and dispatched files cannot be
undone. Call request `release()` as abrupt-stop cleanup, then stop; stopping alone is insufficient.
If the result is `captureCleanupFailed`, retain the request and explicitly retry cleanup with
the caller-owned `createArchiveExportCleanupMachine()` from `backup/export/workflow`, passing
`{ request }` as actor input and awaiting its `cleaned` or safe failure result. A subsequent cleanup
actor retries only lease release; it never repeats capture or handoff. The abrupt `release()` fallback alone
does not provide a graceful drain acknowledgement.

Build and run the test app/public-package verification:

```sh
pnpm package
pnpm check:test-app
```

This compiles the fixture and its Node tests into ignored `.svelte-kit/test-app/` output, then
runs 18 cases. Two export actual plaintext/password files, independently inspect them in separate
processes with common network APIs disabled and only PATH in the environment, compare exact records,
relationships, archived content and attachment bytes, and verify original source/file preservation.
The remaining cases check lease exclusion/binding/limits, exact profile allowlists and public cleanup-machine recovery after failed lease release, binding invalidation, startup/stop behavior, failed-write preservation and opaque source snapshots. The trusted
test app validator is registered by test code, never loaded from archive contents.

`pnpm check:consumer` includes these cases and builds the browser fixture. Three Chromium cases under
`tests/storybook/backup-export.spec.ts` verify real downloads (saved bytes equal produced bytes),
native envelope/profile opening and late-lease invalidation. They are included in the normal browser
suite. The normal package-consumer TypeScript check covers the test app implementation through its
entrypoint; Node test types are checked by the test app project. Root unit/source checks do not depend
on prebuilt package output.

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
