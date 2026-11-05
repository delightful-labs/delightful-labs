# Notebook backup consumer

This disposable nonfinancial consumer exercises the public backup contracts without Jazz, identity
credentials, UI or financial models. After implementation review, local tests qualify notebook
export and independent inspection of real retained files. Restore and its durable journal remain
unimplemented; no full export/restore round-trip or Finance readiness is claimed.

`profile.ts` is a trusted exact `dlf-notebook` v1 registration for the existing inspector. Its validator
must receive a generically validated payload; it does not hash attachments or grant permissions.
`dataset.ts` supplies a notebook and three notes: shared notebook/attachment relationships, archived
content, combining Unicode, line breaks, embedded NUL, an empty body and four binary attachment bytes.
The source codec preserves these contents exactly; a later round-trip must prove destination fidelity.

`source.ts` supplies leaf adapters for the fixture-owned state machine under `machines/source.ts`.
The chart owns available/leased state, binding invalidation and current-owner release. Payloads stay
in private capsules; there is no application class or parallel lease flag. `createNotebookSource()`
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

Build and run the notebook/public-package verification:

```sh
pnpm package
pnpm check:backup-notebook
```

This compiles the fixture and its Node tests into ignored `.svelte-kit/backup-notebook/` output, then
runs 18 cases. Two export actual plaintext/password files, independently inspect them in separate
processes with common network APIs disabled and only PATH in the environment, compare exact records,
relationships, archived content and attachment bytes, and verify original source/file preservation.
The remaining cases check lease exclusion/binding/limits, exact profile allowlists and public cleanup-machine recovery after failed lease release, binding invalidation, startup/stop behavior, failed-write preservation and opaque source snapshots. The trusted
notebook validator is registered by test code, never loaded from archive contents.

`pnpm check:consumer` includes these cases and builds the browser fixture. Three Chromium cases under
`tests/storybook/backup-export.spec.ts` verify real downloads (saved bytes equal produced bytes),
native envelope/profile opening and late-lease invalidation. They are included in the normal browser
suite. The normal package-consumer TypeScript check covers the notebook implementation through its
entrypoint; Node test types are checked by the notebook project. Root unit/source checks do not depend
on prebuilt package output.

See [qualification evidence](../../specs/003-verified-backup/lifecycle-design.md#export-qualification)
for full counts and limitations. Restore/write owners and a concrete versioned Zod journal (T012)
are the subsequent implementation slice.

## Restore preparation — qualified bounded slice

`restore.ts` adds a separate unstarted notebook preparation machine and a single-use request:
`prepareNotebookRestore({ mode: 'new' | 'resume', binding, databaseName, archive })`. The archive is
an existing immutable integrity-checked resource; this request takes ownership and validates its
exact notebook profile before destination work. Start the host-owned root with `{ request }` input.
`mode: 'new'` allocates mappings once. `mode: 'resume'` discovers the original mappings from the
existing browser journal, reconstructs the complete expected intent from the selected checked file,
and compares it again under exclusive operation ownership. Retain the original operation/destination
reference; a fresh live generation is required after reload. The host explicitly initializes its
journal namespace using the existing journal workflow before starting a new restore.

`restore-schema.ts` declares a disposable Jazz app and policies; `restore-writer.ts` supplies single
SDK leaves to the shared preparation actor. Inject `createNotebookPreparationWriter(db,
retainDetached)` into `createNotebookRestorePreparationMachine`. The host owns the persistent Jazz
session/schema setup and the detached-native-receipt recipient; no listener, schema deployment,
credentials or browser session is created implicitly by these factories. The transaction owner
journals issuance before its effect, stages only an incomplete owner-bound control row, and records
local persistence separately from remote acceptance. Web Locks is required; unavailable ownership
blocks writes. Ordinary notebook discovery uses the active-only query.

For teardown, send CANCEL/SHUTDOWN or a scoped INVALIDATE and await completion before stopping.
`request.release()` is the abrupt reference-revocation fallback, not a drain acknowledgement. Keep
the host/session alive for detached native receipts. Remote null, uncertain writes and missing
required local evidence remain incomplete; neither replacement destinations nor automatic retries
are provided. A `prepared` result still has no restored notes/attachment bytes and cannot activate.

Qualification after implementation review passes: 19 focused machine cases, eight real Jazz/Chromium
preparation cases and the existing journal browser regressions. First-write admission checks the
current bound session identity; real server policy enforces ownership and incomplete-only creation.
Local persistence and remote acceptance are observed and journaled separately. Same-browser reload
recovers the same mappings and reconciles remotely matching contents without another write.
`pnpm check:backup-restore` runs the disposable browser suite on localhost:6199 and is included in CI.
The suite owns and shuts down its browser, Vite host and disposable Jazz authority. It also verifies
wrong-file/identity refusal, cross-tab exclusion, malformed metadata preservation, and real server
rejection of forged ownership and premature activation.

Qualification found/fixed incompatible Web Locks options and a parent cancellation guard that stopped
the active destination child before its drained result. Browser-process crash, offline restore,
notes/attachment writing and full-content verification remain outside this evidence. See the
[preparation qualification](../../specs/003-verified-backup/restore-preparation-design.md#preparation-qualification--completed).

## One attachment batch — implementation review

`createNotebookAttachmentRestore` in `restore-attachment-writer.ts` creates an unstarted root and a
single-use request from `{ db, retainDetached, binding, databaseName, archive }`. The archive is a
new immutable integrity-checked resource for the original file; ownership transfers to the request.
Start the returned actor and await its finite output through XState. The host continues to own the
SDK session and detached native receipts. The function does not initialize storage, create a
replacement operation or start any child manually.

The resume-only root rebuilds the entire expected intent, requires completed preparation, selects
only the current attachment batch and rechecks the journal under exclusive operation ownership.
A stale selection stops incomplete. The concrete writer inserts native bytes plus metadata in one
transaction and compares actual returned bytes on reconciliation. `batchWritten` means one step
was checkpointed; `noAttachmentStep` means this root cannot execute the current step. Neither result
activates a destination or establishes a full restore.

The common write owner and notebook planner are extracted from preparation for reuse. Consequently,
the preceding preparation qualification is evidence for commit `bba5f49`, not this revised actor tree.
This new slice awaits implementation review before tests. Static compilation/package checks do not
prove runtime byte, checkpoint or cancellation behavior. The isolated SDK probes informed the design
but do not qualify this implementation. See the
[review notes](../../specs/003-verified-backup/restore-attachment-design.md#implementation-prepared-for-review).

Send CANCEL/SHUTDOWN/scoped INVALIDATE and await completion before stopping. Pre-write SDK reads can
delay graceful cancellation until their actual settlement; the owner keeps expected bytes until
that drain. `request.release()` is abrupt reference revocation, not cancellation of issued native
I/O. Unknown issued attempts still do not replay. Note/title writers, final full graph/relationship/
byte comparison, activation and Finance adoption remain unimplemented.

### Attachment qualification (2026-11-04)

After user-authorized implementation review, 914 units (31 focused write-owner cases) and 13 actual
Jazz/Chromium preparation/attachment cases pass, along with package/consumer and static checks.
This supersedes the pending-review status above. Actual attachment tests cover exact bytes, empty
and 1 MiB contents, Unicode filenames, conflicting bytes with matching declared digest, reload
without replay and reconciliation of an uncertain attachment preserving its original attempt.
See [qualification and material limits](../../specs/003-verified-backup/restore-attachment-design.md#attachment-qualification--completed-2026-11-04).
The destination remains incomplete; notebook/note writing, full comparison and activation are open.

## One notebook-root batch — stacked implementation review

`restore-notebook-writer.ts` exposes `createNotebookRootRestore({ db, retainDetached, binding,
databaseName, archive })`, returning an unstarted actor and its private single-use request. Open and
integrity-check the same backup again; use the same operation/destination and current live binding.
The finite root requires the exact retained intent and current `record/notebook` batch, writes at the
existing mapping, and stops after one step. It preserves the exact title and links the new immutable
row to the owner/operation-bound incomplete control. Run the attachment continuation first when the
plan has pending attachments; neither factory skips another step or selects another destination.

`restore-continuation.ts` owns the shared admission/planning/current-step/projection/batch lifecycle.
The attachment entry points and result vocabulary remain available. `restore-step-data.ts` holds
common pure predicates; SDK reads and mutation leaves remain in their concrete adapters. The new
notebook schema, policies, shared continuation and title recovery await qualification after review.
Earlier passing totals qualify PR #23 rather than this working tree. No new implementation tests
were added or run. Notes, full comparison and activation remain open. See
[design and review](../../specs/003-verified-backup/restore-notebook-design.md).

### Notebook-root qualification (2026-11-04)

Following implementation review and user authorization, all 22 real Jazz/Chromium cases pass:
13 preparation/attachment regressions and nine notebook-root cases. They cover exact empty and
Unicode/control-character titles, mapped identity and prefix/reload, step admission, actual-title
conflict, uncertain-write recovery without replay, native-stage cancellation/invalidation drain and
rollback, plus server-enforced owner/control scope and immutable rows. All 914 units and
package/consumer/static checks pass. This supersedes the pending-qualification status above.

A staged rollback still leaves its issued marker unresolved; later continuation remains incomplete
rather than replaying. One-step completion does not reverify previously completed steps, restore
notes/relationships, compare the full graph or activate the destination. See
[evidence and limits](../../specs/003-verified-backup/restore-notebook-design.md#notebook-root-qualification--completed-2026-11-04).

## One mapped note — locally qualified

`createNotebookNoteRestore` in `restore-note-writer.ts` accepts the same bound host capabilities,
checked archive and recovery metadata as the notebook-root factory, returning an unstarted actor
and request. It requires the exact retained plan's current `record/note` step and scoped mapped
parents, writes one note, and stops. Invoke again explicitly to process the next note. It preserves
exact body/archive status, shared attachment IDs and explicit null attachments. No IDs are allocated.
The underlying finite continuation/write actors own decisions, intent, transaction and separate
settlement; expected content remains private and is cleared through their resource protocol.

The additive note table has actual control/notebook/attachment relations. Server insertion policy
checks same destination/owner/operation for all required parents, including the null attachment path;
updates/deletes remain denied. Observations read one bounded filtered include query and compare
actual fields and relationship IDs. Parent scope/presence is not fresh full parent-content comparison.

After the user's explicit combined implementation/test authorization, all 30 real Jazz/Chromium
cases and 914 units pass, plus package/consumer/static checks. This includes the earlier 22
regressions, note prefix/fields/null/shared relationships, conflicts, reload/uncertain reconciliation,
staged-write interruption/rollback and actual relationship-policy denials. See
[design, qualification and limits](../../specs/003-verified-backup/restore-note-design.md).
The last note can reach comparing; it does not complete comparison or activate the destination.
Full fresh comparison and activation remain open. No Finance or production restore claim is made.

### Update after PR #23 merged

The notebook destination now invokes the shared live-identity admission/staging actor through
the consolidated restore API. Continuation claim/projection and planner capsule mutations are
synchronous machine actions, with finite failures. Request release drains its owner before
clearing private content. All 37 restore-browser cases and 918 units pass, plus the package,
consumer, private-creation and Storybook checks. Current evidence and limits are recorded in
[the updated design](../../specs/003-verified-backup/restore-notebook-design.md#post-merge-machine-review-2026-11-04).

### Note update after PR #23 merged

The note destination now uses the consolidated restore API and shared live-identity
admission/staging actor. Explicit guards admit expected content, control, parents and exact
note fields/reference IDs; bounded observations stay private. The continuation inherits the
parent's synchronous capsule actions and drain-before-clear release protocol. All 51 actual
restore-browser cases and 918 units pass, plus package/consumer/static checks, 65 Storybook
cases and 10 private-creation cases. Updated evidence and limits are in
[the note design](../../specs/003-verified-backup/restore-note-design.md#post-merge-machine-review-2026-11-04).
