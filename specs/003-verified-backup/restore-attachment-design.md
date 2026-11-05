# T006 next slice — one notebook attachment batch

> Historical slice/research record. The complete notebook workflow, fresh comparison and activation
> are now implemented in PR #26. Use [the current task ledger](tasks.md#current-handoff) and
> [completion evidence](restore-completion-design.md) for present status; bounded single-step
> descriptions and dated test totals below describe their original scope.

> Current API: the unmerged preparation/batch specializations described historically below were
> replaced by `createRestoreMachine(native, destination)` at `backup/restore/workflow`, contracts at
> `backup/restore`, with explicit `writeId` input. Both concrete destination writers are machines.
> See [consolidated cleanup and passing qualification](pr23-coordinator-cleanup.md).

Proposed after qualified preparation commit `bba5f49` on `feat/notebook-restore-preparation`.
The preparation implementation is committed locally; no push or PR publication is authorized.
The user authorized this bounded implementation after research. It is now prepared for
implementation review and subsequent user-authorized runtime qualification. The
[research and 14 passing probes](attachment-research.md) inform the refinements below.

## Outcome and scope

Restore the current attachment batch into the existing isolated notebook destination, advance that
one step's journal checkpoint, and stop. Keep the destination incomplete. Notebook/title and note
record writers, full-graph comparison and activation follow in separate reviewed slices.

The qualified plan already orders attachments before notebook and note records. Continue that exact
plan without changing operation/destination IDs, mappings, write IDs, digests or the plan version.
The API executes the current planned step; it does not let callers skip to an arbitrary attachment.
A source with no attachment at its current step reports that the next writer is not implemented,
without advancing the journal or claiming restored data. Preparation is a prerequisite, not repeated
creation. A completed prefix is retained exactly.

## Stored attachment and authority

Add one consumer-owned `restoreAttachments` table to the disposable Jazz schema:

- Existing mapped attachment ID as the row ID.
- Destination control-row reference, restore operation ID and restoring owner ID.
- Exact media type, file name, byte count and declared archive digest.
- Actual contents in `schema.bytes()` as `Uint8Array`, not a URL or digest-only placeholder.

The installed alpha.59 declarations expose `schema.bytes()` / `BytesColumn` / `BYTEA` as `Uint8Array`
and explicit transaction `insert`/`one` methods. Isolated real-browser probes now confirm exact
scalar round-trips through 8 MiB and a bounded included-byte read in remote/transaction contexts.
These results inform the design; actual restore implementation qualification remains separate.
The native SDK explicitly rejects streaming inside a transaction. Use an ordinary scalar insert
inside the owned transaction; no stream actor, file
service, alternate backend or chunk protocol is needed for this disposable slice.

Consumer policies require the attachment owner to match the current session and the linked control
row's owner/operation. Insertion additionally requires the control row to remain incomplete.
Updates/deletes are denied in this slice. Recovery reads can see the owner's stored bytes; ordinary
notebook discovery continues to exclude the incomplete destination. This does not establish Finance
isolation or safety against an older production client.

First-write admission keeps the approved owner-bound rule. The actual server decides acceptance.
Archive provenance and a journal mapping never grant access. Within the transaction, the owner checks
the original control row and mapped attachment ID; the server rechecks the insertion policy when
accepting the write. A mismatched/missing/unreadable control row cannot authorize attachment writes.

## Actor and resource ownership

```text
notebook attachment continuation root
  checked-file/profile/plan owner
  same-operation exclusive lock owner
  native journal load/CAS child
  one journaled write-step owner
    consumer reconciliation/eligibility children as needed
    native transaction custodian
    read -> stage -> commit -> separate settlement/checkpoint states
```

The root takes ownership of a newly opened immutable checked archive, validates the exact notebook
profile, discovers the retained mappings, reconstructs the complete expected intent, then loads it
again under exclusive operation ownership. Reuse the existing planning states through a focused
invoked planning child instead of duplicating their asynchronous sequence in a helper. Private
capsules retain archive content, expected bytes and observed SDK rows; snapshots expose opaque
handles and bounded metadata. Release those references after issued leaves and rollback/commit
observation settle, or transfer native receipts through the existing host custodian on abrupt stop.

Reuse the preparation owner's journaled transaction statechart for a single planned write step.
Generalize its pure checkpoint projections to preserve `completed` and append only the current
receipt. Preparation remains the first step; an attachment batch uses its existing index/write ID.
The existing public preparation factory keeps its finite `prepared` behavior. Select preparation
versus attachment work in the parent chart; do not branch between SDK operations using flags inside
promise capabilities or actions. Avoid duplicating the existing transaction/settlement machine or
adding a generic job runner.

## Explicit flow

### Write-boundary identity denial (2026-11-04)

The destination owns scope/content eligibility and invokes a shared notebook write-admission
machine for authority or staging. The shared transaction owner retains acquisition, commit,
settlement, rollback and detached custody. No promise wrapper owns an application workflow.

```text
destination: expected data available? -> scope/mapping -> select operation
  remote/read -> one SDK read -> observation/content guards -> finite result
  authority/stage -> invoke write-admission machine
    observingIdentity -> SDK identity report -> denied / allowed / inserting
    inserting (owns tracked insert invocation)
      pending -> identity loss: revoked; observer failure: observationFailed
      revoked / observationFailed retain the failed fact even after A -> B -> A
      invocation settles -> interruption / denied / unavailable / staged
```

The SDK callback leaf subscribes to `db.onAuthChanged`, which emits initial and subsequent facts,
and unsubscribes when its owning machine completes/stops. It reports typed, binding-correlated
identity observations or subscription failures. It makes no admission, retry or write decisions.
The machine consumes reports in guards and transitions. During insertion, nested states preserve
loss/failure without exiting the state that owns the issued operation. Cancellation is latched and
drained there; while waiting for initial identity it can complete without waiting for another report.
An unexpected insert failure uses `onError` after settlement. Both destination parents forward
interruption and await the admission child's finite output.

Expected attachment access is an optional pure lookup in the existing root request, with no new
load actor, promise or duplicate byte buffer. Missing/released data reaches `unavailable` through
an admission guard. Scope/content predicates tolerate absence. Native leaves require the resource
only at their SDK boundary; invocation errors remain finite. The root keeps ownership of bytes.

The shared write machine retains the synchronous identity recheck beside the single native insert
inside the borrowed transaction callback. A mismatch reports the native fact `identityMismatch`
without inserting; invocation completion routes to the machine's finite `denied` state. The native
fact `inserted` routes to `staged`. Unexpected SDK failures retain the invocation error
path. Interruption takes precedence after the issued leaf settles. The shared write owner rolls
back any non-staged result before returning, so denial never permits commit or checkpoint advance.
Transaction ownership, observation cleanup and private attachment bytes keep their existing owners.

The user subsequently authorized runtime qualification together with the remaining state-model fixes.
The required coverage includes identity replacement
between admission and the write-boundary check for both writers: no insert or commit, finite denied
destination output and parent rollback; retain cancellation precedence and SDK-failure coverage.
Also cover missing/released attachment data, stale binding reports, cancellation before the first
identity report, identity loss and A -> B -> A while insertion is pending, observer failure while
insertion is pending, and subscription disposal on completion/stop. Pending writes must settle
before the transaction owner attempts rollback. The three existing browser-test injection sites
now replace the native identity subscription inside the write machine; their assertions are
unchanged. All 22 actual Jazz/Chromium restore tests now pass, including six new cases for identity
loss and A -> B -> A during pending insert, observer failure, stale binding rejection, cancellation
before initial observation, native write-boundary identity replacement, missing expected bytes and
subscription disposal. Injected pending-insert cases qualify the machine protocol; the separate
boundary case and existing preparation/attachment cases use the actual native transaction adapter.

```text
validate checked archive/profile -> rebuild exact intent -> acquire operation lock -> load journal
  -> guard: preparation complete and current step is an attachment batch
  -> read isolated control row with only the mapped attachment included
     exact bound contents + issued attempt + required separate local evidence
       -> checkpoint remoteContentMatch with unchanged attempt facts -> attachment step complete
     conflicting contents/binding -> conflict, retain journal
     missing/hidden contents + issued attempt -> unresolved, no write
     missing/hidden contents + notIssued step + valid owner/control binding
       -> persist issued marker -> acquire transaction
       -> read control with only the mapped attachment included -> guard transaction eligibility
       -> stage bytes and metadata together -> commit
       -> observe transaction ID -> observe local persistence -> persist observation
       -> observe remote acceptance/rejection -> persist observation
       -> guard required settlement -> append current completion -> advance one step -> stop
```

I/O leaves perform individual native reads/writes/waits. The investigated filtered reverse include
returns control plus zero/one visible child in one query, including actual bytes. Prefer that bounded
query for both remote reconciliation and transaction eligibility; named predicates distinguish a
missing control, no visible child and mismatching contents. If reading the control and attachment needs
two SDK calls, those are separate invoked states in the same transaction owner, not a multi-read
promise helper. Pure Zod shape/bound validation and exact-content predicates may remain functions;
statechart guards consume their results. No completed-prefix count becomes authority to write.

Byte reconciliation compares the actual returned byte array and length against the checked archive,
along with exact metadata, mapped ID and operation/destination/owner relationships. A matching
stored digest alone is insufficient. Full byte equality with the checked expected bytes supports
the planned content-match digest without inventing a receipt for the original transaction. Do not
normalize strings, compare only counts, omit empty bytes or split a metadata/blob pair across writes.
If hashing is needed by the chosen read representation, make that one explicit invoked stage.

Cancellation/invalidation before commit drains the issued leaf and rolls back the owned transaction.
After commit, retain/checkpoint observed facts; global-observation cancellation does not undo the SDK
write. Parents forward interruption and await their active child's finite result. Do not put an
interruption `always` transition on the state owning that child. A -> B -> A uses new live generations
while durable restore identity and mappings stay fixed.

## Limits and remaining uncertainties

- Same-browser/origin recovery still requires retained journal storage, the operation/destination
  reference and selecting the same backup file. No cross-device recovery or discovery UI is added.
- Issued uncertainty remains unresolved on missing/hidden reads. No absence-based reissue, automatic
  rejected-attempt retry, replacement destination or journal reset is introduced.
- Isolated SDK probes materialized complete scalar bytes through the transaction/remote path at
  0, 4, 128 KiB, 1 MiB and 8 MiB. The concrete restore entry point still needs end-to-end qualification;
  its resource ownership, journal progression and cancellation were not implemented by those probes.
- The include-read probe used four bytes; large joined reads remain unqualified. Existing archive
  bounds still apply. Peak memory, responsiveness, browser-process crash and broader platform
  qualification remain open. A successful 8 MiB scalar read is not a performance guarantee.
- A recovered remote match still cannot satisfy separately missing local-persistence evidence.
- Preparation's existing plan/digests must remain unchanged. Changes required by an unexpected SDK
  constraint must be discussed rather than silently re-planning an existing operation.

## Review and later qualification

Present the single-step owner changes, schema/policies and concrete attachment writer for
implementation review before adding/running their tests. Keep existing preparation APIs and
qualified behavior intact; static checks may run before that review.

After approval, qualify actual nontext bytes (`00 ff 80 0a`), empty bytes, exact metadata, owner and
control-row policy enforcement, separate local/remote settlement, one-step prefix advancement,
reload/content-match recovery with zero duplicate writes, wrong bytes despite matching digest
metadata, stale binding, missing local evidence, cancellation/drain and unchanged preparation
behavior. Compare actual bytes from a fresh read. This slice must not report verified full recovery.

## Research-informed decisions

The [actual-code investigation](attachment-research.md) supports native scalar bytes, one-row
metadata/content atomicity and a single bounded included read per meaningful read stage. It also
reproduces local persistence followed by server policy rejection when the control becomes active,
and acceptance of false digest metadata with different actual bytes. Keep the separate settlement
model and compare actual bytes. Graceful same-profile restart with the authority stopped retained
an accepted 1 MiB scalar, without issuing any replacement write; offline restore and crash safety
remain unqualified. No new application lifecycle, streaming protocol or retry engine is needed.

## Authorized implementation boundary

The user authorized implementing this suggestion after the isolated research. Implementation tests
remain gated on review of the resulting implementation. The concrete entry point will be a resume-only
notebook attachment request: it reopens/checks the same file, discovers/rebuilds the immutable intent,
selects only the current attachment batch, then reloads under the operation lock before effects.
A changed step between discovery and admission stops incomplete; it cannot silently select new data.

Extract the notebook plan into a finite invoked child and keep checked-archive/expected-byte ownership
in the root request capsule. The root supplies its private expected attachment through a bound getter
to the concrete writer; no global registry or content-bearing actor input is introduced. Extract the
native operation-lock callback for reuse. The preparation API keeps its existing finite behavior.

The shared write owner will take a fixed planned write descriptor and pure checkpoint projections.
Static preparation/batch factory bindings select the descriptor and success report; all eligibility,
issuance, reconciliation and effects remain the same explicit statechart. Batch projections retain
prior completions and advance only the selected current step. The attachment adapter performs one
bounded included SDK read per remote/transaction read leaf and pure structural/content projection.
A missing/unreadable control is distinct from an empty visible attachment set and blocks issuance.
Parents await active children after interruption. Native transaction custody is retained unchanged.

## Implementation prepared for review

Implemented the bounded slice after the user's authorization; no new implementation tests have
been added or run. The 14 prior probes remain isolated research, not qualification of this code.

- `restore-write-step.ts` holds pure current-step predicates/checkpoint projections. They preserve
  every completed receipt, retain the selected attempt facts and append only that step's completion.
- The existing transaction statechart is shared by preparation and batch factories. Its descriptor
  selector is a pure lookup; its success label is a static report projection. Neither selects I/O
  workflows in a promise/action. Eligibility, issuance, transaction read/stage/commit/rollback,
  observation, journal CAS and interruption remain explicit machine states.
- `createRestoreBatchMachine` loads an existing exact-intent journal under the same operation lock;
  it cannot initialize/create intent or replace a destination. The requested write ID must still be
  the current batch after lock acquisition. Stale selection stops incomplete without switching data.
- Notebook planning is now a finite invoked child. The root owns the checked archive and expected
  bytes throughout planning and the write child. Requests remain single-use opaque capabilities;
  no content-bearing SDK rows/byte arrays are placed in snapshots.
- `createNotebookAttachmentRestore` binds an unstarted host root, resume-only request and concrete
  Jazz writer. The root requires completed preparation and selects only the current attachment batch.
  `noAttachmentStep` reports a different/no current data step without advancing it. Pending
  preparation instead remains incomplete.
- The additive disposable schema stores scalar `contents` and exact metadata in one attachment row.
  Owner/control/operation policies protect reads and insertion; insertion requires incomplete control.
  Updates/deletes remain denied. There is no activation writer or deployment/configuration change.
- The native writer performs one filtered destination-plus-attachment read per remote/transaction
  leaf. Zod validates observed shapes/bounds, then named pure predicates distinguish unavailable
  control, conflicting binding/content, no visible file and exact metadata/byte match. It does not
  trust a stored digest as proof. Mutation rechecks scope/identity and makes one SDK insert.

### Interruption detail for review

Pre-write remote/authority observations now latch interruption and await their issued leaf's finite
result before cleanup. The read callback can retain expected bytes; dropping the actor's output is
not a drain of that SDK call. An offline remote read with no abort capability may delay graceful
cancellation until the SDK settles. Abrupt release/stop remains a fallback without a drain promise.
After commit/local checkpoint, interrupting global observation continues to preserve the original
write/native custody rather than claim it was undone. Parents await active child output; planner
hashing stages also await their native digest completion before consuming interruption.

The shared owner/planning extraction changes the preparation actor tree, so the earlier 902-unit /
eight-browser preparation totals do not qualify this working tree. After implementation approval,
rerun those regressions along with actual attachment, prefix, policy, recovery and cancellation
cases through the built public package. No assertion of an integrated working restore is made yet.

### Static validation before implementation review

Root Svelte/strict TypeScript, package build/strict Publint, notebook TypeScript and the public
package-consumer declaration check pass. The public consumer now includes the concrete attachment
entry point against rebuilt package declarations. Oxlint, Oxfmt and Git whitespace checks pass.
No implementation tests, browser/server runs or live data operations were performed in this slice.
No tests were added or changed. Source review covered the full changed actor tree, current-step
selection, retained-prefix projections, expected-byte lifetime, native custody, scope/result
consumption and parent drain boundaries. These static results do not prove the integrated behavior;
actual attachment and preparation-regression qualification follows implementation approval.

## Attachment qualification — completed (2026-11-04)

The user approved implementation qualification with “continue”. Current-tree evidence supersedes
pending qualification statements in the historical review above:

- All **914 unit tests** pass, including **31 focused preparation/single-step tests**. The added
  cases preserve completed prefixes, advance exactly one batch, block failed issuance checkpoints,
  retain uncertain attempts, avoid blind replay, drain cancelled remote/authority observations,
  roll back transaction conflicts and reject stale requested steps.
- All **13 real Jazz/Chromium tests** pass against the rebuilt public package and actual notebook
  adapter, schema, permission policy and IndexedDB journal. This includes the eight preparation
  regressions and five attachment cases: exact bytes/prefix/reload without replay; empty bytes;
  1 MiB bytes with Unicode filename; conflicting bytes despite a matching declared digest; and
  uncertain attachment reconciliation after reload without a replacement write. The latter holds
  only the acceptance observation after a real commit/local checkpoint and proves actual remote
  contents before cancellation. Recovery records remoteContentMatch while preserving the original
  transaction/issuance/settlement; it does not fabricate remote acceptance of that attempt.
- Root Svelte/TypeScript, notebook TypeScript, package/strict Publint, public consumer builds and
  runtime checks (including 17 independent reader and 18 notebook export tests), lint, formatting
  and whitespace checks pass. Browser services and Chromium are disposed by the harness.

The prior preparation browser lock test now releases its deliberately held authority observation
before expecting cancellation to finish, matching the explicitly draining lifecycle. Test-only commit
instrumentation counts native transaction commits for both roots. Initial failures were test issues:
incorrect expected fixture bytes, an incorrect SDK wait method, missing test type narrowing, and a
concurrent package build triggering Vite reload; the final browser run used stable rebuilt files.

Evidence remains bounded: attachment-specific policy denial combinations and cancellation during
native attachment staging have not each received a dedicated integrated browser case. Shared actor
cancellation/rollback behavior is unit-qualified and preparation policy boundaries are browser-tested.
The earlier 14 journal browser regressions and 14 isolated SDK research probes are historical evidence,
not rerun totals for this qualification. No forced-crash, cross-device/browser, performance, full
restore, Finance completeness or production safety claim follows. An issued write without sufficient
local/fresh-content evidence remains incomplete; there is no automatic replay or destination replacement.
Notebook/note writers, fresh comparison of the full restored graph/relationships/bytes and activation
remain separate reviewable work. The user subsequently authorized committing and pushing this
qualified slice for pull-request review.
