# T006 test app restore preparation — implementation slice

> Historical slice/research record. The complete test app workflow, fresh comparison and activation
> are now implemented in PR #26. Use [the current task ledger](tasks.md#current-handoff) and
> [completion evidence](restore-completion-design.md) for present status; bounded single-step
> descriptions and dated test totals below describe their original scope.

> Current API: the unmerged preparation/batch specializations described historically below were
> replaced by `createRestoreMachine(native, destination)` at `backup/restore/workflow`, contracts at
> `backup/restore`, with explicit `writeId` input. Both concrete destination writers are machines.
> See [consolidated cleanup and passing qualification](pr23-coordinator-cleanup.md).

This slice follows merged PR #22 (`08f4c38`, including `b519d68`) on
`feat/notebook-restore-preparation`. Implementation and qualification are authorized. The
[current completed qualification](#preparation-qualification--completed) supersedes historical review
and authority-admission blockers recorded below. Later journal/schema and reader qualification supersedes historical awaiting-review notes
for those covered operations. It does not establish destination restore qualification.

## Bounded scope

Implement one isolated Jazz destination control row, not note/attachment writes or activation.
The test app host receives an existing immutable integrity-checked archive and either new allocation
or the allocation retained in its journal intent. It validates the exact test app profile and derives
the full expected immutable intent anew. No file password or decrypted contents enter the journal.
All mappings, batch identities and digests are fixed before effects. The host supplies the existing
same-browser journal namespace; this workflow does not silently initialize missing storage.

## Owners and finite states

Test app preparation owner:

- validate checked profile -> construct mapped graph/control/activation projections -> hash plan
  components -> invoke shared preparation -> release checked archive -> finite result.
- The checked archive is transferred to this owner. It never reloads file bytes.

Shared preparation owner:

- acquire one same-origin Web Lock for application/environment/identity/operation; no queued takeover
- load exact expected journal -> missing: create intent; matching: inspect progress
- preparation pending: invoke preparation write owner; later progress: report already prepared
- release lock -> report prepared/incomplete/conflict/unavailable/interrupted.

Preparation write owner:

- remote reconciliation -> conflict / exact match / missing-or-hidden
- an issued attempt never becomes eligible merely because a read returned null
- fresh notIssued + missing-or-hidden -> current authority -> durable issued marker
- acquire transaction -> read transaction row -> eligibility -> stage insert -> commit
- obtain transaction ID -> observe local persistence -> durable local checkpoint
- observe remote acceptance -> durable settlement checkpoint -> complete preparation checkpoint
- remote exact match + separately observed required local persistence -> content-match completion
- cancellation before commit: drain current leaf then rollback; after commit: retain actual evidence
  and checkpoint before finishing; cancellation during global observation stops observation only
- a generic error after intent issuance remains unresolved; no automatic retry or replacement IDs.

Transaction reads and insert share the acquired transaction. Server policy checks ownership at the
write boundary. The native adapters do one SDK operation each. The shared transaction custodian
hands late/unknown native calls to the host on abrupt stop; it does not claim rollback on stop.

Each journal request is a fixed invoked child with native transaction settlement before release.
The operation lock spans all journal requests and destination work, rather than locking only CAS.
Unexpected child errors have finite failure paths. Live invalidation is scoped by complete binding
including generation; it immediately blocks later effects while issued calls drain.

## Future continuation

Test app plan v1 partitions mappings into deterministic one-record/one-attachment steps. Preparation
owns only the destination control row. Test app/note graph relationships are inserted only after
prerequisite destination records exist; no policy-dependent cycle is split. Data writers, fresh
full graph/relationship/byte comparison and activation remain unimplemented. A future resumed
activation must recompare actual data; journal comparison metadata alone is insufficient.

## Deliberate limitations

Same browser/origin, retained IndexedDB and same identity only. No cross-device discovery, absent-write
reissue, automatic rejected-attempt retry, process-crash claim or generalized retry engine. Null can
mean policy-hidden. A crash between issued checkpoint and backend call may remain unresolved. Remote
match without required local-persistence evidence stays incomplete; a local read is not invented as
a persistence receipt. Global observation can be interrupted without claiming the SDK write was
cancelled. Web Locks availability is required for this browser slice. Test app schema/policies are
disposable qualification assets, not a Finance policy lane or production restore safety proof.

## Implementation review boundary

Implemented shared factories under `backup/restore/preparation/workflow`, with contracts under
`backup/restore/preparation`. `createRestorePreparationMachine(writer)` accepts trusted complete
intent metadata; the test app root is the concrete archive-validation/plan owner. The same workflow
subpath exposes the finite journal-step child for test app recovery discovery. These factories are
unstarted; the application invokes them or starts its own root.

`fixtures/test-app/restore.ts` privately owns the transferred checked archive and canonical
projections. Pure projection functions map exact source tuples to fixed destination IDs. Explicit
hashing states derive graph, preparation, each deterministic batch, activation and full plan digests.
The control row binds the original payload and mapped graph digest; hashing the plan inside its own
preparation contents would be circular. No source membership or credentials enter destination data.

The browser journal now supports `discover`: validate the stored codec and complete live binding,
then return metadata without requiring the not-yet-reconstructed expected intent. Discovery cannot
write, initialize or repair the namespace. The test app root takes only its mappings, reconstructs
all expected intent fields from the checked archive, then the shared owner acquires the operation
lock and loads again with full intent comparison before any effect. Missing/malformed discovery
never falls back to new allocation. The host supplies the existing operation reference (including
destination ID); operation listing/discovery UI is outside this headless slice.

The write actor separates commit, transaction-ID observation, local persistence, durable local
checkpoint, global observation, durable global checkpoint and preparation completion. Unknown local
wait errors remain unobserved. Only the installed SDK rejection type correlated to that transaction
ID supplies remote rejection evidence. Cancellation during global observation stops observing, not
the SDK's write. Native receipts transfer through the existing required host custodian on unresolved
completion or abrupt stop. The host must retain them within the original session and must not close
that session while issued native mutation calls remain outstanding.

`restore-schema.ts` and `restore-writer.ts` are consumer-owned disposable Jazz assets. Inserts are
owner-bound and incomplete-only; updates/deletes are denied in this slice. Ordinary discovery uses
the active-only query; no data tables, active test app route or activation mutation is implemented.
This is not evidence for Finance's incomplete-data isolation or protection from legacy clients.

Review the entire changed actor tree before runtime qualification. Relevant later checks are
journal discovery scope/malformed/missing cases; preparation happy path and retained local/remote
facts; issued-but-uncheckpointed remote match; null/unknown/conflict without replay; exclusive owner;
transaction cancellation/drain/host custody; resume with wrong file/mappings; and package/browser
integration with actual disposable Jazz. No tests may be added/run before implementation approval.

### Static validation before implementation review

Package build/strict Publint, root Svelte/TypeScript, test app TypeScript, public-consumer declaration
compilation, Oxlint, Oxfmt and whitespace checks pass. Public-consumer compilation includes the new
test app preparation and Jazz writer against rebuilt package declarations. No implementation tests
were added or executed, no server/session was started, and no Jazz data or deployed configuration was
changed. These checks establish static integration only; preparation, recovery, native settlement,
locking and cancellation still require the review-approved runtime qualification above.

## Qualification continuation — historical authority-admission blocker

The user continued after implementation review, authorizing qualification. Added 19 focused machine
cases; all 902 unit cases across 36 files pass. These cover durable issuance before transaction
opening/staging, distinct local/global checkpoints, unknown/missing/conflicting outcomes without
replay, remote-content completion preserving original transaction facts, failed checkpoints, late
acquisition/cancellation, generation invalidation, interrupted global observation, detached native
custody, and missed completion recovery. Unit journal responses are deterministic validated CAS
fixtures; they do not substitute for native IndexedDB or Jazz persistence.

Real Chromium qualification reproduced a concrete native lock bug: `LockManager.request` rejects
`ifAvailable: true` combined with `signal` using `NotSupportedError`. The nonqueued operation lock now
omits the incompatible signal. Its held promise is released by callback disposal, including a late
acquisition; no queue/retry scheduler or second lifecycle flag is added. A focused unit regression
checks the exact permitted options.

The next real-browser check stops before any destination effect: the concrete writer's
`db.canInsert(...)` returns `unknown` while `db.getAuthState().session.user.account` matches the bound
owner. The destination journal is retained at `notIssued`; the coordinator reports incomplete.
This is not a destination write failure or evidence permitting replay. The successful-preparation,
reload reconciliation and owner-policy browser cases remain failing/blocked at that preflight.
No test overrides this preflight to claim a working concrete integration.

Installed alpha.59 source explains a relevant constraint: `JazzClient.requestInsertPermissionAdvice`
delegates to `NativeRuntimeAdapter.requestInsertPermissionAdvice`, whose
`withPermissionAdviceTimeout` returns unknown when its runtime has neither server transport/carrier
nor a configured native upstream. `DefaultRuntimeSource` creates a non-durable foreground peer for
persistent browsers and connects a separate durable browser worker. The observed foreground advice
is not usable as this test app's affirmative creation gate. This is a source-based explanation plus
the actual browser observation; it is not a universal claim about every SDK configuration.

A design question is pending: use current session identity plus the test app's owner-bound creation
policy for admitting a first journaled insert, with the real server accepting/rejecting that insert,
or retain the advice gate and record that this persistent-browser path cannot prepare destinations.
The recommended bounded adjustment concerns first-write admission only. It must not turn an issued
unknown attempt, hidden/null read or generic error into retry permission or acceptance evidence.
No backend authority service, SDK change or automatic retry has been introduced.

Two independent native Chromium cases pass: discovery rejects identity/operation/destination scope
mismatches without resetting the original row; malformed stored bytes are retained and resume issues
zero destination writes. Both delete their disposable journal databases with blocked-deletion
assertions to detect leaked connections. The full new browser suite is not qualified.

Package/strict Publint, Svelte/TypeScript, public-consumer builds, all 17 independent-reader cases,
all 18 existing test app cases and lint pass. These are separate from the blocked concrete restore
qualification. The fixture server at localhost:6199 and disposable Jazz authorities are shut down
after each run. No commits, pushes, production data or production configuration changes are included.

The existing 14 native journal Chromium regressions also pass against the rebuilt public package:
CAS/reload, cancellation settlement, rejected-attempt/content-match metadata, malformed/missing
storage, synchronous schema approval, stop/release cleanup and unsupported-schema preservation.
The task-owned preview on localhost:6027 was shut down. Storybook build, final formatting and
whitespace checks pass. These 14 regressions plus the two new discovery cases do not qualify the
blocked test app destination-preparation happy path.

### Concrete proposed admission adjustment for discussion

Change only the test app writer's `checkAuthority` leaf: observe the original bound database's
current session account and require equality with the intent's restoring identity. The actor still
requires a validated complete intent, exclusive operation ownership, a not-yet-issued preparation,
remote reconciliation and durable issuance before opening/staging. The staged row always uses that
identity as owner and `status: incomplete`; the actual authority enforces the deployed test app
insert policy. Neither the identity check nor the insert call is an acceptance receipt. Success
still requires the separately observed persistence/acceptance and durable checkpoints.

This deliberately avoids making optional/unknown SDK permission advice the affirmative gate for a
new owner-bound creation. It would not relax reconciliation, permit a new transaction for an issued
unknown attempt, or treat hidden/null contents as proof of absence. The generic shared writer
contract and machines need no retry behavior or backend service. This proposal is not implemented;
the user decision requested during qualification remains pending.

### Owner-bound first-write admission — approved continuation

The user approved the concrete admission adjustment above. The test app writer now observes the
bound database's current session identity for first-insert admission. The existing machine guard
continues to own issuance eligibility; the adapter performs no retry or destination selection.
The stage leaf rechecks identity at the mutation boundary, inserts only the incomplete owner-bound
row, and the real server policy remains the authority for acceptance/rejection. Required local and
remote observations and all issued/uncertain reconciliation rules remain unchanged. The previous
permission-advice blocker is historical; qualification continues against this approved change.

## Preparation qualification — completed

The approved owner-bound first-write admission is implemented. The real persistent-browser path now
prepares its destination through the actual test app root, generic coordinator, native IndexedDB
journal and Jazz writer; tests do not replace admission with an always-true capability. The row is
owned by the restoring identity, remains incomplete and is excluded by ordinary active-only
test app discovery. Server policy still rejects forged ownership and premature activation, with
assertions requiring the actual `PersistedWriteRejectedError` / `permission_denied` evidence rather
than classifying every exception as rejection.

Eight real Jazz/Chromium cases pass:

- Actual preparation records native local persistence separately from remote acceptance. Reload
  retains the same identity, operation, mappings and exact journal; preparation issues no new write.
- Missing-journal resume and a different checked file issue no replacement operation; wrong-file
  resume conflicts and preserves the original metadata.
- A held global observation lets the real write reach the server while the journal retains local
  persistence and unknown remote settlement. Cancellation retains that incomplete checkpoint.
  After reload, fresh remote content comparison completes preparation with `remoteContentMatch`,
  unchanged original transaction facts and zero replacement writes.
- Foreign readers cannot read the control row; forged owner insertion and premature activation
  receive explicit server permission rejection. The original destination remains incomplete.
- Malformed discovered metadata is retained byte-for-byte; resume issues no destination write.
- Two same-origin tabs cannot own the operation concurrently. Cancelling the admitted owner releases
  its lock and a later first attempt uses the retained mappings. Live snapshots omit note contents.
- Discovery binds identity, operation and destination; mismatches do not reset the original row.
- A different restoring identity is refused before transaction issuance, retaining `notIssued`.

Qualification found a second concrete bug after the native Web Locks option fix: the test app
parent's `preparingDestination.always` interruption transition stopped the child before its drained
output reached the parent. The interruption guard now runs only when admitting that child, in
`buildingIntent.onDone`. Once invoked, cancellation is forwarded and the parent awaits the finite
child output, preserving observed transaction/checkpoint facts. The actual browser
cancel/reload/content-match case covers this correction.

The full unit regression passed all 902 cases across 36 files, including 19 preparation-owner cases.
The eight browser cases run through `pnpm check:backup-restore`, now included in CI. All 14 existing
native journal browser regressions pass against the rebuilt package. Package/strict Publint,
public-consumer declaration/bundle checks, 17 independent-reader cases, 18 existing test app cases,
Storybook build, Svelte/TypeScript, lint, formatting and whitespace checks pass. These local results
are not a claim of remote GitHub CI for uncommitted work.

All disposable test servers and browsers are shut down. No production data/configuration, commit or
publication changed. This qualifies only preparation/control metadata and the tested same-browser
page-reload recovery. Actual note/attachment writes, complete graph/relationship/byte comparison,
activation, process-crash recovery, broad offline/platform claims and Finance adoption remain open.
T006/T012 remain incomplete. The first-insert identity check grants no replay permission and never
turns a missing/hidden remote read or an uncertain issued attempt into acceptance.
