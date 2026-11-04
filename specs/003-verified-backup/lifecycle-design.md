# Shared backup lifecycle — T006 ownership review

Based on merged PR #20 (`afc92fd`), on branch `feat/backup-workflow`. The first review slice defined
actor/resource boundaries and implemented the pure notebook validator. After the user requested
continuation, this slice implements the shared capture/export machines and a disposable notebook
source/dataset. The user subsequently authorized continuation from that implementation review;
export qualification is recorded below. Restore machines, persisted journal and full round-trip
qualification remain unimplemented. Restore protocols below remain design requirements; implemented
and locally tested export behavior is described explicitly.

This export slice merged in PR #21 on 2026-11-03 as `04f3203`, after final-commit CI passed for
`06362cf`. Subsequent [restore journal identity/model progress and qualification](restore-journal-design.md)
are recorded separately from this export evidence.

## Ownership tree

```text
consumer application lifetime
  session/access observer and monotonic binding generation
  export coordinator
    consumer capture owner (authority, lease, writer drain, capture, consistency validation)
    existing envelope child (encoding protection and attachment digest verification)
    consumer retained-file handoff child
  restore coordinator
    checked-file resource owner (existing envelope child, then exact profile validation)
    consumer destination owner (authority and incomplete destination isolation)
    journal owner (validated durable operation metadata)
    one write owner at a time (prepare/stage/commit/settle/reconcile)
    consumer comparison and activation children
```

All children are invoked, with typed finite output or correlated observations; no manually started
actor/promise bridges. Consumer-owned children with multiple steps are machines. Promise actors
perform one leaf read/write/hash only. The shared machines live under `src/lib/machines/backup/`.
This fixture's domain rules live under `fixtures/backup-notebook/`, outside shared library exports.

Every operation binds an immutable session identity, workspace identity, generation and operation ID.
The layout owns monotonically advancing generations, including A → B → A. Child reports include
the complete binding; stale reports cannot authorize work or advance a journal. Already issued calls
still settle under their original binding. Binding checks also occur immediately before effects;
an observed invalidation revokes permission to issue later effects, including activation.

Coordinator snapshots contain opaque handles, bounded progress and safe outcomes. Passwords, native
keys, archive bytes, decoded records, leases and destination capabilities remain private to resource
owners. No actor snapshot is a recovery format. Explicit journals alone are persisted. Handles have
single-use claims and descriptor-only serialization. A failed second claim must never release the
first claimant's resources.

## Export protocol

### Concrete export slice

The export request privately owns the consumer source, acquired lease, frozen payload, protection
choice, envelope request and sealed output. An invoked capture child owns the states checking
authority → acquiring → draining → reading → validating profile → checking consistency → releasing.
Source methods are individual leaf capabilities: one authority observation, one lease acquisition,
one writer-drain acknowledgement, one bounded graph read and one consistency observation. Consumers
needing additional stages must expose them through a reviewed actor instead of hiding orchestration
in those methods. The notebook adapter uses an exclusive in-memory lease and an already supplied
archive-shaped dataset; it does not claim Jazz capture or durable storage.

The request retains acquired leases and sealed output before promise/child completion reports.
CANCEL/SHUTDOWN/scoped INVALIDATE latch interruption and abort source reads, but the actor waits for
each issued leaf to settle, then invokes lease release. Explicit release failure is a terminal
cleanup failure; the request retains the lease for an awaited, explicit `retryCleanup()` leaf after
completion. Retry is rejected while the request is still active or source/handoff work remains issued.
Abrupt request release
also aborts, discards late payloads and releases late leases; it is a fallback without a successful
drain acknowledgement. Actor.stop() alone remains insufficient.

After capture success, export prepares the existing seal request, invokes the envelope machine,
then invokes one consumer file handoff leaf. Handoff returns dispatched/rejected/unknown. A thrown
handoff is unknown because dispatch may already have occurred. Rejected/unknown handoffs enter a
retry state retaining the same sealed resource; a binding-qualified RETRY_HANDOFF repeats only this
leaf. Cancel/invalidation releases the sealed resource after outstanding handoff settlement, retaining
the observed dispatch fact in the final result. Request release cannot erase copies retained by a
consumer handoff. No retained-file validation is inferred from dispatch.

The public view selects technical stage/progress and safe codes only; this headless slice introduces
no rendered messages, message catalogs or inline fallbacks. Consumer presentation is a later review.

```text
claim -> capture child
  check authority -> acquire lease -> drain writers -> capture -> validate consistency/profile
  release lease -> transfer frozen capture
prepare seal -> existing envelope child -> handoff child -> release -> exported
```

Capture rejects unsupported records and incomplete reads rather than asserting complete coverage.
The capture owner retains a late lease acquired after cancellation and releases it before reporting.
Release happens after the consistency check, before encryption/download. The consumer owns the
meaning and evidence of quiescence; generic archive validation cannot establish it.

Seal preparation uses the existing bounded payload codec and envelope request. The envelope child
owns attachment hashing and crypto states; export must not reimplement those steps. Its parent needs
a pre-done ownership hook for sealed output analogous to the existing checked-output hook, so abrupt
teardown cannot lose the result between acquisition and the child's done event. This slice adds that
internal hook and retains its sealed resource privately in the export request before the done event.

File handoff receives an opaque sealed resource. Handoff failure retains that completed resource for
an explicit handoff retry; retry does not capture again or generate new encryption randomness.
Completion reports archive-produced and handoff facts separately. Browser download dispatch cannot
prove file retention; independent inspection of the user's retained file remains a separate action.

CANCEL, SHUTDOWN and binding invalidation latch interruption, stop admission, forward drain to the
active child and await its finite outcome. Cancellation cannot skip cleanup or stop a promise and
discard its late resource. An interruption during handoff may coexist with a file already dispatched;
report the observed handoff fact without claiming the file was removed.

## Restore protocol

The existing inspector intentionally releases decrypted records and returns only a summary. Its
`profileValid` report cannot serve as restore input. Restore instead opens a separately supplied file
through the existing envelope child, retains its immutable checked resource, and validates the exact
trusted profile. It binds the digest of the original decoded bytes, not a new serialization or the
encrypted file's randomness. It never reloads mutable file bytes after validation.

```text
claim -> open/check/profile -> destination authority -> find validated journal
  missing -> persist operation intent -> prepare isolated destination
  matching -> inspect existing isolated destination
reconcile expected batch -> stage missing batch -> commit -> await qualified settlement
  accepted -> persist checkpoint -> next batch
  rejected -> incomplete
  unknown -> authoritative reconciliation -> accepted / conclusively absent / conflict / unresolved
all batches settled -> compare actual content -> activate -> confirm activation -> complete
```

The journal intent must be durably recorded before creating the isolated destination. Its operation
ID fixes the destination and record mappings before effects. Journal write failures may themselves
be unknown: reread the same key through a qualified storage boundary, never create another operation
to escape uncertainty. Destination creation and activation use the same reconciliation discipline
as record batches. The workspace creation journal is not reused as a restore protocol.

Before every batch, the destination child checks current authority and exact archive/profile/operation
binding. Profile plans define deterministic bounded batches and atomic groups; generic code does not
split relationship cycles across policy-required transactions. The write owner models acquiring,
staging, committing, awaiting settlement and reconciliation. No promise hides the entire transaction.

Local persistence and remote acceptance are independent facts. A completed SDK promise supplies only
its documented fact. Local persistence alone cannot advance a remotely required checkpoint. A lost
commit response stays unknown until a qualified authoritative read establishes exact matching content,
conflicting content or conclusive absence at the original expected IDs. Unknown absence never permits
replay. A checkpoint lost after accepted writes resumes by reconciliation, not by writing the batch
again. If access prevents reconciliation, retain the operation and report unresolved incomplete.

Cancellation drains the write already issued and records its observed settlement, then retains the
incomplete operation. It never deletes potentially committed content or starts a replacement. A local
cancel request does not cancel a remote commit. Cancellation during activation must reconcile whether
activation occurred; already active content cannot be described as cancelled/rolled back.

Content comparison reads the actual isolated destination through a fresh reader and checks exact
values, graph edges, archived content, attachment bytes and metadata against the checked resource.
It uses explicit source-to-destination mappings; source IDs/provenance confer no permission. Activation
requires successful comparison and current authority. Activation is an idempotently identified write
with explicit settlement/reconciliation, not a flag set optimistically by the coordinator.

## T012 persisted journal boundary

Implement a versioned strict Zod record with inferred types when concrete storage is added. Required
correlation: operation ID, identity/environment, destination ID, payload digest, exact profile/version,
mapping seed or entries, deterministic plan fingerprint, cursor and accepted settlement evidence.
The record contains no decoded content, password, tokens, SDK handles or actor snapshots. IDs and
digests remain private recovery data, not diagnostic labels.

Journal acquisition must distinguish not-found from unavailable, malformed and unsupported-version.
Only qualified not-found permits initial intent creation. Invalid records preserve storage and stop
the operation; no reset, new ID or default progress. Use create-if-absent and revision-checked writes,
with one operation owner across attachments/tabs. Failure to acquire exclusive ownership leaves the
operation unavailable for writes. Storage guarantees and restart behavior need concrete qualification;
an in-memory notebook adapter alone cannot establish durable recovery.

## Notebook profile v1

`fixtures/backup-notebook/profile.ts` registers the exact trusted `dlf-notebook` version 1 validator.
It consumes already bounded, generically validated payloads; envelope integrity remains separate.
It requires one notebook record with a text title, and note records with an exact notebook reference,
text body, explicit archived boolean and either an attachment reference or typed null. Unknown types,
fields, inert records, foreign notebook references and unreferenced attachments fail validation.
Empty notebooks and empty text remain valid; attachments may be shared by notes. No strings are
trimmed or normalized. Types come from the fixture's Zod schemas.

The disposable dataset now includes multiple notes, an archived note, exact Unicode and line breaks,
an empty body, shared relationships, and the nontext bytes `00 ff 80 0a`. `NotebookSource` excludes its
synchronous writers with an exclusive lease, checks the supplied binding and returns bounded detached
data with a fresh archive ID/time per capture. Its drain acknowledgement describes only this fixture's
synchronous writers. It does not establish Jazz quiescence, source inventory or durable storage. The
validator remains domain-only. No persisted destination, restore authority or round-trip proof exists.

## Review and later qualification

The export implementation and notebook source have been reviewed and locally verified after the
user authorized continuation. Next implement restore/write/journal owners within focused review cycles. Keep T006
open until both lifecycles and the notebook round-trip are implemented and verified. T004's large-file
measurements and Finance T007–T010 remain outstanding.

The export → retained file → independent exact profile inspection portion is now qualified for the
disposable notebook below. After restore implementation approval, qualify isolated restore and fresh
reader content comparison, wrong digest/profile on resume, malformed journal, concurrent owner,
missing/denied authority, local-only settlement, lost commit/checkpoint responses, conflict and unknown
activation. Demonstrate stable operation/record IDs and zero blind replay; export tests cannot
establish those restore guarantees.

The public API is `backup/export` (preparation and leaf contracts) and `backup/export/workflow`
(coordinator factory and control events). The capture machine is an internal invoked child using the
same opaque private request. Its done event is scoped to that single invocation; the coordinator's
result carries the complete immutable binding. Both machines expose no decoded records or raw errors.
Export tags are `capturing`, `protecting`, `handingOff`, `handoffRetry` and `cleaning`; no UI messages or
catalog entries were introduced. Rejected/unknown handoffs wait for explicit binding-qualified retry.
An earlier unknown dispatch remains unknown after a later rejected attempt. Cleanup failure takes
precedence over cancellation and retains the lease for explicit caller cleanup retry.

Static validation passed: `pnpm check` (zero Svelte errors/warnings plus strict TypeScript), package
build/strict Publint, standalone notebook and public-consumer TypeScript, the browser bundle including
the new public export factories, full Oxlint/Oxfmt and Git whitespace checks. The notebook retains
the root's strict source options and `skipLibCheck`; the existing consumer project independently
checks package declarations with its established dependency-compatible compiler settings. No lockfile,
dependency version, UI, consumer deployment or live storage changed.

## Export qualification

Local qualification completed on 2026-11-03 after the user requested continuation from the presented
implementation. Tests required no changes to production capture/export logic. The verification setup
keeps root unit/source checks independent of `dist`; notebook implementation/Node checks and browser
bundles consume the actual built public package. A clean check with `dist` temporarily absent passed.

- **51 export unit cases** pass. These cover cancellation at all seven capture stages and eight
  coordinator stages; late acquisition and release drain on cancel/shutdown/invalidation; source leaf
  synchronous throws and rejections; authority/profile/source/consistency/bounds/digest rejection;
  unexpected child crash with issued read drain; concurrent/reused claims; first-owner preservation;
  generation/operation-qualified retries; A → B → A invalidation; encrypted handoff retry with identical
  bytes and no recapture; unknown-dispatch preservation; cleanup failure and awaited cleanup retry;
  pending native digest drain; redacted persisted snapshots; and exact opened graph/attachment bytes.
  Abrupt-stop cases retain late leases, wait for late graph reads, retain borrowed files until the
  handoff settles and release sealed output in both construction and child cleanup handoff windows.
- **13 notebook/public-package cases** pass through `pnpm check:backup-notebook`, included in normal
  `check:consumer`. Plaintext/password exports write real disposable files. Independent child processes
  use the built inspector, the existing bounded file/password sources, a statically registered notebook
  validator, common network APIs disabled and only PATH in their environment. Both report profile-valid
  integrity matching the exact payload digest. Fresh opening compares every record/value/relationship,
  archived content, empty body, Unicode/newlines/NUL, attachment metadata and bytes, coverage and inert
  records. Original source content and retained file bytes remain unchanged. Additional cases cover
  lease exclusion/idempotent release/late old-owner cleanup, binding/limit checks, empty notebooks,
  shared files and nine generically valid but domain-invalid payloads.
- **Three new Chromium cases** pass against the public-package-backed notebook browser fixture.
  Plaintext/password exports trigger actual downloads; Playwright saves the files and compares exact
  saved bytes against the produced bytes. Native Web Crypto opening and trusted profile inspection
  validate the archived/Unicode/empty content, shared attachment references and binary bytes. A delayed
  acquired lease survives invalidation, excludes writers while draining, then releases without a
  dispatch or stale A → B → A retry.
- **All 728 repository unit tests across 30 files** pass. The initial sandboxed run could not bind
  disposable Jazz listeners; the permitted run passed all suites. **All 45 Chromium tests** pass,
  including the existing envelope and native journal cases, on a task-owned port 6021 preview that
  Playwright shuts down. All 11 separate-process reader checks, package/public-consumer checks,
  browser bundles, Storybook build, Svelte/TypeScript, Oxlint/Oxfmt and whitespace checks pass.

This qualifies the shared export protocol and this fixture in the exercised Node/Chromium environment.
An export success still reports observed dispatch, not general retained-file validation. These tests
independently validate specific retained fixture files; they do not certify arbitrary consumer capture,
all browsers, large-file memory/latency, Jazz/Finance quiescence, durable restore journals, remote write
settlement or a successful full restore. T006 remains open for restore/T012 and round-trip qualification;
T004 and Finance adoption remain outstanding. No live data, identity configuration or deployment was
changed. The user authorized committing/publishing this export slice and subsequently merged PR #21.
All final-commit GitHub CI checks passed. Subsequent restore work uses its own feature branch and
review cycles; this export qualification is not authorization to publish or merge those later changes.

## Machine-first export correction — ownership design in progress

The prior journal/envelope/inspection corrections were committed locally as f50a97c at the user's
request. Envelope and inspection have focused runtime qualification; the committed journal correction
still awaits separate review/qualification. The user authorized continuing to export/capture.

The existing export class privately coordinates pending counts, drain waiters, release-promise
coalescing, cleanup failure/retry eligibility and fire-and-forget disposal. These are the ownership
findings to correct, not merely class syntax. Capture already exposes meaningful states, but its
helpers still own those lifecycles. Keep binding checks, unknown handoff observations, retained
sealed-file retries and confirmed release failure precedence.

```text
claim input -> active export scope
  capture owner: authority observation -> allowed/denied
    acquire -> retain lease -> drain -> bounded graph read -> pure payload/profile validation
    consistency observation -> consistent/inconsistent -> release lease -> capture result
  prepare seal -> invoke envelope owner -> retain sealed output
  handoff -> observe dispatched/rejected/unknown
    rejected/unknown -> await binding-qualified handoff retry or interruption
  cleanup -> settle issued effects -> release owned lease -> clear private resources -> final
```

Only leaf native adapters may retain an issued call after abrupt actor stop. Each lease effect must
retain its acquired handle until that effect settles; stopping an owner cannot release a lease still
borrowed by a graph read. A late acquisition still needs disposal. A borrowed handoff file similarly
must remain usable until its issued handoff settles. Root/capture states own admission, interruption,
settlement, cleanup failure and handoff retry; there must be no second private pending/drain workflow.

Pure payload validation remains a bounded synchronous transform. Authority/consistency observations
must be returned as facts for chart decisions. Native adapters must not combine check/read/write
policy into their promise chains. Private storage retains payloads, passwords, capabilities and
resource references, never a competing phase/claimed/released/pending state.

### Cleanup recovery API decision — resolved below

The existing request.retryCleanup() ran after the export actor completed. The user was asked to prefer an explicit caller-owned cleanup machine for this recovery, or preserve the
method as one native release leaf. This is a consequential public protocol choice, not permission to
silently remove cleanup recovery. The user selected the explicit machine, as recorded below. The requested explicit cleanup machine would model claim -> release -> success/failure,
retain failed lease custody for a subsequent explicit attempt, and reject concurrent attempts or
attempts while an issued export effect still borrows the lease. No automatic retries or manually
started hidden child actors are proposed. Pure transform/error cleanup can proceed independently.

### Cleanup recovery decision accepted; implementation design

The user selected the explicit cleanup machine. Remove request.retryCleanup(); callers run
createArchiveExportCleanupMachine() from backup/export/workflow with the same opaque request.
One attempt claims the available cleanup resource, releases only its retained failed lease, and
returns cleaned or a safe failure. No automatic retry, cancellation of release, capture/handoff
replay, hidden actor start or promise bridge is added. Concurrent attempts and attempts before
export's issued work settles fail with exportInUse. An already cleaned request is an idempotent no-op.

Keep the existing capture child and envelope child. The export's active scope invokes a narrow
resource teardown observer. Private data holds the actual issued native promise as a resource fact,
not a pending counter or waiter set; the chart's draining state awaits this single native settlement
if a child crashes. Leaf adapters loan the lease (or sealed handoff handle) into exactly one call,
removing it from idle storage until settlement. On abrupt teardown the call retains its borrowed
resource; its narrow finalizer disposes it after settlement. Late acquired leases also receive one
native release. Release failures quarantine the actual lease rather than setting a parallel failure
flag. The chart publishes cleanup custody only after clearing export input and settling issued work.
A failed cleanup attempt returns that custody for a subsequent caller-owned cleanup machine.

CANCEL/SHUTDOWN/invalidation still abort leaf signals and forward drain only to an active child.
Root output retains dispatched/unknown facts and release-failure precedence. An issued handoff owns
its borrowed sealed handle until settlement, so no new archive-sized copy is required. Native leaf
finalizers may dispose only their resource; they do not choose capture, consistency, retry or handoff
stages. Single-use request/cleanup admission uses consumed resource references, not lifecycle flags.
Present the complete correction for review before adding/running implementation tests.

### Export ownership correction qualification after implementation review

The user authorized continuation from export/capture and explicit cleanup-machine review. All 140
existing focused envelope/inspection/export cases passed. Added four cleanup protocol cases:
concurrent attempt rejection with no extra release/capture/handoff; synchronous and asynchronous
retry failure retaining custody for another explicit actor; and stopped-actor custody remaining
unavailable until the issued native release settles, with late failure recoverable by a new actor.
All 144 focused unit cases pass. Existing acquisition/read/handoff late-disposal, child-crash drain,
crypto drain, cancellation/invalidation, output retention and safe failure cases still pass.
No production fixes were needed during this qualification.

After rebuilding the package, all 14 notebook/package integration cases pass. The added case imports
the new cleanup factory through backup/export/workflow, forces initial lease release to fail, proves
fixture writers remain excluded while custody is retained, then runs cleanup and proves writers can
resume without dispatching an archive. All 11 independent reader cases also pass. Fresh public-export
browser bundles pass all four focused Chromium cases: standalone envelope protection/integrity,
plain/password notebook file dispatch and inspection, and invalidation/drain/stale binding rejection.
Playwright owned a temporary localhost preview on port 6014 for that run.

Svelte/TypeScript, package/strict Publint, public-consumer/reader declarations, lint, formatting and
whitespace checks pass. No full repository unit/browser suite was run. These results qualify the
export correction with the current notebook source; they do not qualify its forthcoming owner
rewrite, the older workspace journal disposal finding or the committed restore-journal correction.
Cleanup custody remains in-memory; this is not a durable recovery journal. Graceful drain still
requires issued consumer calls to settle, and native release cannot be cancelled by stopping an
actor. No new commit, push or merge was performed.

## Notebook source ownership correction — design before implementation (2026-11-04)

The user requested committing the qualified export correction and completing the next cleanup,
including tests. The prior correction is committed locally as 77b008f. This instruction explicitly
authorizes implementation and tests together for this fixture slice.

The notebook source is a fixture-owned root whose lifetime spans writes and successive exports:
available -> leased.current -> leased.invalidated -> available. The chart owns acquisition,
writer exclusion, exact binding/current-owner checks, invalidation and release. An observed binding
replacement invalidates the current lease until its own release, even if the binding later returns
to the same value. Old lease release cannot release a newer token. Aborted calls cannot acquire,
drain or read; release is idempotent and does not depend on AbortSignal. All fixture writers remain
synchronous; this does not qualify real Jazz capture, durability or remote acceptance.

The factory returns an unstarted source actor and leaf adapter methods. The fixture host explicitly
starts/stops this independent source root; it is not a hidden child started by the shared library.
Its lifetime outlasts a single export so the host can write and export again. The machine belongs
under fixtures/backup-notebook/machines, not the reusable DLF machine exports: notebook domain
models stay outside the foundation. The host exposes the source actor for explicit disposal.

Synchronous typed request/reply events keep the existing leaf API: one actor event is processed
before returning Promise.resolve for the capture contract. No deferred promise/await bridge,
subscription waiter, private owner flag or class is added. Actor context holds binding facts, an
opaque data reference and an opaque lease token; payloads/proposed writes stay in private capsules.
Pure codec/profile transforms and inert lease adapters remain functions. Invalid writes/reads return
errors without crashing the source owner. An inactive source rejects work; it has no external lease
resource requiring asynchronous stop cleanup. Hosts drain exports before stopping their source.

Qualify existing content/lease/public package tests plus focused invalidation, wrong-owner release,
writer rejection, failed write preservation and explicit host-stop behavior. Rebuild and run focused
shared backup units, reader/notebook integrations and Chromium checks. No commit/push/merge of this
new slice is implied by committing the preceding correction.

### Notebook source correction qualification (2026-11-04)

Implemented the fixture-owned source chart and removed NotebookSource. The source factory returns
an unstarted actor with synchronous leaf adapters. The fixture host starts it explicitly and Node/
Chromium callers stop it after export drain. The readiness state is explicit: XState reports an
initial snapshot as active before start, so initializing waits for the start-entry event before
admitting adapter calls. No private started flag is used, and early calls cannot queue later writes
or acquisition. Context contains only binding, opaque data and lease references.

All 18 notebook/package integration cases pass, including four added cases for pre-start admission,
A -> B -> A invalidation without revival, failed-write preservation/opaque snapshots, and stopped
source/harmless old release. Existing exact file content, writer exclusion, old-owner release,
reduced bounds and explicit cleanup recovery cases pass. All 144 focused shared backup unit cases,
11 independent reader cases and four Chromium cases pass with the rebuilt notebook bundle. Chromium
host paths explicitly stop the new source root after drain. Playwright owned a temporary preview on
localhost port 6014 for its run. Svelte/TypeScript, public-consumer declarations, lint, formatting
and whitespace checks pass. The browser host declaration was updated to include actor.stop().

This only qualifies the disposable, synchronous in-memory notebook fixture. It does not prove
Jazz capture/quiescence, persistence, remote acceptance or production completeness. Hosts must drain
exports before stopping their source. Synchronous replies are confined to the fixture's immediate
leaf adapter boundary; no asynchronous actor/promise bridge or hidden child start was introduced.
The source chart and payload policy remain in the fixture, outside DLF's reusable public exports.
The new cleanup is uncommitted; prior export/capture work is committed locally as 77b008f. No push
or merge. Older workspace journal disposal and restore-journal qualification remain separate work.

## Notebook finite-operation correction — design before implementation (2026-11-04)

The user identified that the source conversion still embeds fallible read/write work and response
routing inside event actions. Correct that ownership rather than treating the presence of a machine
as sufficient. Keep the synchronous fixture contract and existing lease/binding semantics.

```text
available.idle -> validatingWrite -> committingWrite / rejectingWrite -> idle
leased.current.idle -> capturingRead -> returningRead / rejectingRead -> idle
leased.current -> binding replacement -> leased.invalidated -> owning release -> available
```

Named actions perform one bounded transform or one assignment/reply. Validation/capture helpers
return typed success/failure facts; they do not choose commit, reply or next-stage behavior. Write
success updates source data in committingWrite only; failure preserves the old data. Read success
stores an opaque captured-data reference until returningRead replies. Both branches clear their
request/result references before returning idle. Payloads remain private capsules, not raw context.
The adapters observe a readiness tag attached to accepting states, without reconstructing lease
policy. Source lifecycle, admission, invalidation and ownership remain chart decisions.

These are synchronous finite states, not promise actors: the leaf transforms require no asynchronous
resource owner, and introducing promises would change the synchronous writer contract and create
another reply bridge. Do not make a state for each expression. Existing source/lease adapters remain
inert protocol translation. Present implementation and static checks for review before further
runtime qualification of this correction.

## Envelope preparation routing correction — design before implementation

Keep the existing envelope root and its fixed native crypto child. Replace the procedural
preparation actor with chart-owned selection and bounded leaves:

```text
claim completion -> parsingPayload (seal) / parsingEnvelope (open)
parsingPayload -> creatingPasswordHeader (password seal) / checkingAttachments
creatingPasswordHeader -> checkingAttachments
parsingEnvelope -> decodingPlainEnvelope / decodingPasswordEnvelope
decodingPlainEnvelope -> hashingPayload
decodingPasswordEnvelope -> importingPassword
```

The claim operation reports the requested mode as an observed fact. Envelope parsing reports
protection; completion guards choose the decoding state. Parsed envelope content remains in
private request storage until decoding or cleanup, never actor context/output. Decode leaves
each handle one known envelope shape, retaining the existing bounds and expected digest/header.
Payload parsing is reused for sealing and post-open validation. Password header generation is
an independently invoked leaf, selected only for password sealing.

Each invocation retains the existing failure-to-cleaning path and checks interruption before
advancing. Native crypto ownership, output transfer, cancellation drain, and public contracts
stay with their existing owners. No extra supervisor or new retry behavior is required. Review
the implementation and static checks before adding/running envelope tests, including all four
modes, malformed preparation, and release/cancellation at the new boundaries.

## Avatar selection ownership — design before implementation

The component-owned selection workflow becomes a component-lifetime root machine, attached by a
private Svelte integration. It owns saved/selected files and the current crop request. The existing
submitted-avatar processor/write actor remains separate. No new public export or localized copy.

```text
ready/invalid -> SELECT(file) -> validating -> cropping / invalid
ready/invalid -> EDIT(file) -> cropping
cropping -> ACCEPT(current crop, file) -> ready + notify selection
cropping -> DISMISS(current crop) -> ready
SELECT(null) -> request saved removal / clear draft to saved
OBSERVE(profile or reset revision change) -> ready + discard draft/crop
SHUTDOWN -> closed + clear file references
```

Validation is one synchronous pure leaf returning a boolean, with thrown validators treated as
invalid selections. Named actions validate, assign, or notify; guards choose outcomes. A crop request
object correlates acceptance/dismissal with the current selection. Late crop results after reset or
replacement are ignored. Saved-image refresh updates the saved reference and follows it only when
the selection still points to the previous saved image; it does not close an active crop.

The binding owns root start/subscription/stop and forwards one observation containing profile ID,
reset revision and saved file. Presentation consumes selected file, crop request, invalid/dirty
facts and callbacks; no component flags reconstruct workflow state. Native dialog close reports
dismissal for the captured crop request. Scope/reset discards presentation state without publishing
an extra selection callback, matching the form owner's reset responsibility. Review before tests.

## Recovery child failure — design before implementation

Finance's current host distinguishes recovery invocation errors from finite results: ordinary
completion resumes readiness and may attach pending workspace work. Returning a new unknown-mutation
result without changing that host would silently route an unresolved failure through normal
completion. Preserve the existing public error protocol and finite result union.

```text
restoring child error -> exit restoring (invalidate binding, drop reference)
                     -> restorationChildFailed (clear submitted request, internal failure result)
                     -> queued PROPAGATE_FAILURE -> fail at the output boundary
```

The present handler throws during the error transition and consequently never exits restoring.
Replace that throw with an actual state transition. Existing restoring exit cleanup then executes
before the failure terminal/output boundary. A self-sent event queues propagation for the next
actor turn: the cleared snapshot must commit before output throws, or an error snapshot could
retain the previous binding reference. Shutdown cannot turn this failure into ordinary completion.
The internal failure result carries only a fixed
discriminant, not raw error, credentials, or inferred mutation settlement. No navigation, SDK retry,
or successful shutdown result follows it, including when the child crashes while closing.

Binding invalidation remains a synchronous total/idempotent reference-release operation; the Jazz
adapter implements it with one reference assignment. It is not SDK logout, cancellation, rollback,
or a new fallible I/O workflow. Do not add actors around this assignment. A host-provided invalidator
must honor that contract. Abrupt coordinator stop/ancestor failure and already-issued SDK calls
remain the documented host ownership limitation, not newly solved by this transition.

After implementation approval, exercise actual child crashes before preparation and during issued
restoration/shutdown, verify invalidation before the parent error report, secret/reference cleanup,
and absence of normal completion/navigation. Review existing successful restoration/navigation
coordination as regression coverage. No Finance code change or new public outcome is needed.

## Transaction teardown custody — implementation and tests authorized together

Use one fixed native custody scope under each transaction chart. Its data contains issued native
promises only: acquisition, latest call, and commit receipt. It is not a second workflow owner.
Leaves record exactly one call; the chart clears custody after confirmed persistence, safe
confirmed rollback, or the invitation owner's existing explicit unresolved-output handoff. On abrupt stop/crash, or unresolved creation completion, callback disposal/owner-error observation
hands the receipts to a required total synchronous host retainDetached capability. Acquisition may
still resolve after the actor stops, and commit may already have started: never automatically
rollback/retry from teardown. The host retains this handoff and waits for outstanding operations
before deciding recovery. No credential/request bodies are included in the handoff.

This intentionally adds a required capability member to creation and invitation transaction
contracts; old hosts must implement custody retention before adopting this package. Keep sibling
consumer source untouched and document migration. Update packaged consumers and typed doubles.
Qualify late acquisition, stop during a read/stage, stop during commit, unresolved receipts,
confirmed rollback/persistence without handoff, and ordinary cancellation using real actors.

## Independent reader stream lifecycle — design before implementation

Replace boundedRead's ended/settled/failure callback flags with a fixture-owned statechart:
reading -> awaitingSuccessClose (file EOF) -> assembling -> succeeded;
reading -> assembling (stdin EOF);
reading/awaitingSuccessClose -> destroying -> awaitingFailureClose -> failed.
Premature close fails. Stream error waits for close in file mode and fails immediately in stdin
mode. Abort and oversize input destroy the stream; later chunks are discarded. The chart chooses
bounds, EOF/close policy, interruption and terminal outcome. Buffer collection/concatenation/zeroing
are bounded leaves; the fixed native callback child only observes events and performs destroy.
File success cannot precede descriptor-close observation. Password decoding remains a pure transform.

io.mjs is the independent CLI host's Promise-based source adapter. Each read call owns one finite
root actor and converts its terminal result to the existing Promise contract; it starts no manual
child actor. The root invokes its native stream scope. No shared library API, registry or native
stream flags are introduced. Buffers remain private read storage and chunks are cleared on scope
teardown; returned bytes transfer to the existing inspection/password consumer. Do not inspect or
persist this actor tree. File reads keep the existing inclusive maximum+one-byte detection bound.

After implementation review, qualify EOF-before-close, premature close, stream errors, abort,
limits, chunk zeroing/listener disposal and the existing independent-reader subprocess cases.
No test execution is implied before that review for this new slice.

## Journal schema approval — design before implementation

Move the initialize-only schema-creation decision out of onupgradeneeded. Opening now has
awaitingOpen, creatingSchema and rejectingSchema substates. Native upgrade callbacks report
UPGRADE_REQUESTED with the observed old/new versions. The chart rejects interruption/failure,
then permits creation only for initialize with version 0 -> 1; every other request rejects.
creatingSchema issues CREATE_SCHEMA; rejectingSchema issues REJECT_UPGRADE. UPGRADE_APPLIED
returns to awaitingOpen. Actual OPENED/OPEN_FAILED still decide the next stage, and schema creation
alone never establishes initialized/durable journal success.

The native scope temporarily retains the open request during its upgrade callback. Commands
operate on that active native handle synchronously, with reporter/current-request checks beside
the mutation. No promise, timer or asynchronous child is inserted into the upgrade transaction.
The callback aborts any upgrade still undecided when synchronous chart reporting returns, including
stop or delayed/ignored command delivery. Creation failures report NATIVE_FAILED and reject/abort;
the owner waits for native open settlement before closing. A late open after stop still closes its
connection. This models policy without stretching IndexedDB's active callback lifetime.

Review before tests. Required browser qualification: initialization on an absent database,
load/create/update refusing to create missing schema, unexpected stored schema/version, failure
and interruption/release during upgrade, and proof that schema creation occurs inside the native
upgrade callback. Existing restore-journal Chromium cases remain the regression baseline; static
checks alone do not qualify this new synchronous command handshake.
