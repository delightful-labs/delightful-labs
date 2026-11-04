# Archive payload codec — first implementation review

Branch: `feat/backup-archive`, based on merged PR #15 (`b6c08df`).

## Scope and ownership

This slice implements only the synchronous payload layer of the archive core. Public functions:
`encodeArchivePayload(input, limits?)` and `parseArchivePayload(bytes, limits?)` under
`delightful-local-first/backup/archive`. They have no Jazz, Svelte, XState, browser session, domain,
file-system or network dependency. Zod 4.1.11 is an internal runtime dependency, pinned to the version already used by Finance. Standard UTF-8 facilities are the only platform dependency.

The encoder accepts untrusted-shaped application data, validates it, and emits deterministically
ordered UTF-8 JSON. The parser bounds input bytes before fatal UTF-8 decoding, rejects BOM and
duplicate JSON keys (including escaped aliases), validates exact structure, and returns detached,
deeply frozen payload data. Generic record references resolve against the union of domain and inert
reference records; the profile will decide whether any particular relationship is domain-valid.
Inert provenance uses the same `{ type, id, fields }` shape and a disjoint `(type,id)` identity.

No asynchronous effects or resources are acquired: the operations are synchronous transformations,
so this slice needs no stateful actor. Crypto/resource acquisition and lifecycle ownership require
separate design review before their async implementation. Callers own input/output buffers and
payloads; this raw structural data must not enter diagnostics or persisted actor snapshots.

## Schema validation

At the user’s request, Zod replaces the handwritten object, array, primitive, date and timestamp
validators. Strict objects and a discriminated union define the payload; public value/record/file/
payload types are inferred from those schemas rather than duplicated interfaces. No coercion,
trimming or normalization is used. Nested readonly schemas and explicit final array freezing retain
immutable detached output. Public failures discard Zod issues and expose only safe archive codes.
Consumers do not supply Zod schemas or integrate with its parsing API to use the archive functions.

The installed Zod source was inspected, not just the latest online documentation: `src/v4/core/regexes.ts`
defines calendar-aware date expressions and millisecond timestamp precision; `src/v4/core/schemas.ts`
shows that this version’s `z.record` skips `__proto__`. The field dictionary therefore validates
through `z.map` and reconstructs own data properties using `Object.fromEntries`, preserving that field
name instead of silently dropping it. Map conversion is internal; the wire format stays an object.

Archive-specific code remains for UTF-8/Unicode fidelity, canonical exact integers, bounded duplicate-
rejecting JSON parsing, canonical base64/byte counts, graph integrity and ordering. A generic resource
preflight bounds caller-supplied data before schema cloning and issue collection and rejects accessors,
sparse arrays and unsupported object prototypes without executing `toJSON`. This is not a second
shape validator. These cases still require post-review runtime tests.

## Limits and ordering decisions

The v1 limits are enforced for payload bytes, attachments, combined record counts, depth, text,
names and IDs. Consumers may lower, never raise, them. To bound object overhead as well as byte size,
this implementation adds 256 fields per record and 500,000 JSON values per payload. These limits
also apply to encoding; they are resource ceilings, not target support guarantees for real data.

Record types include types used by both live records and inert reference records. Identity is a
pair of strings, indexed without delimiter concatenation. Source strings are not normalized.
Ordering compares exact JavaScript UTF-16 string sequences, without locale or case folding. Object
keys are serialized explicitly in lexical order, including integer-like field names; ordinary
`JSON.stringify` alone would reorder such keys. Encoded output is bounded incrementally before
allocating its final UTF-8 buffer. Empty text/file contents are allowed; identifiers and names
are nonempty. All input is current-data only; archived status stays consumer-owned data.

## Deliberate remaining work

An attachment SHA-256 string is checked for format only; attachment content has not been hashed.
Canonical base64 and the declared decoded length are checked without allocating decoded attachment
buffers. There is no encryption envelope, password handling, crypto, file inspector, opaque verified
resource, consumer profile validation or restore capability yet. The parsed type is `ArchivePayload`,
not a validated/restorable backup. Source coverage labels are claims to be established by consumer
capture, not evidence produced by this codec.

## Review and verification

The user authorized proceeding with implementation review and tests on 2026-11-03. Review checked
schema strictness and inferred types, duplicate-key handling, prototype-named fields, detachment,
limits before schema processing, exact values, graph identity and public package boundaries.

One correctness finding was fixed: converting an arbitrary numeric JSON token to JavaScript Number
could round a long fractional version into an accepted integer. The parser now requires canonical
safe-integer metadata tokens before conversion; fractional/exponent forms, negative zero and unsafe
integers fail explicitly. Five regression cases cover this behavior.

Verification completed locally:

- 82 archive cases pass: independent literal wire data, all value variants, malformed/trailing JSON,
  escaped duplicate keys, prototype-named fields, invalid UTF-8, exact integer/date/timestamp rules,
  Unicode byte budgets, graph closure/identity collisions, canonical base64 and lengths, resource
  limits, immutability, cyclic/sparse input, getters/toJSON rejection and safe errors.
- All 556 repository unit tests pass across 25 files. The initial sandboxed full run could not bind
  disposable Jazz test listeners; the permitted rerun passed without changing those tests.
- Repository Oxlint, full Svelte/TypeScript checks, Oxfmt and Git whitespace checks pass.
- Package build/strict Publint, declarations through public exports, standalone Node ESM codec use
  and the browser consumer build pass. The consumer provides no Zod schema, Jazz or app session.
- Archive tests are included in the normal Vitest/CI configuration. No live data, storage or schema
  was accessed or changed. No encryption/digest/recovery readiness is implied.

PR #16 receives these verification changes; its final-commit CI status is checked separately before
reporting completion. Merge remains subject to the user’s explicit authorization.

These checks do not establish universal parser security, browser peak-memory limits or end-to-end backup safety. Cryptography and actual source capture/restore remain subsequent slices.

## Cross-slice machine-ownership audit

Requested after the user identified hidden lifecycle ownership and application-owned classes in the
browser restore journal. This is a source audit, not a new implementation or runtime qualification.
The journal rewrite already in the worktree remains a separate, uncommitted review slice.

### Scope and method

Re-read `.specify/memory/xstate.md` and constitution III/VII. Inventoried 104 non-test source/config
files: 93 under `src/lib` (excluding generated Paraglide/declarations) and 11 under the notebook,
independent reader and private-creation fixtures. Included TypeScript in Svelte integrations. Used
syntax inventory for classes, native promises, async functions and actor starts, then traced the
actual helper bodies beneath backup and foundation actors. Also reviewed the eight Svelte story/
example files and 29 public-package consumer source/config files for the same patterns, for 141
non-test source/config files in total. A low await count is not evidence of a
leaf: the violations below use chained promises and private mutable state.

The criterion is meaningful steps, decisions and resource lifetimes, not whether a function could
technically be represented as a machine. Pure transformations and narrow native/event translation
remain functions. A class-to-closure rewrite alone does not correct a hidden workflow.

### Required lifecycle corrections

1. **Export/capture: `src/lib/backup/export.ts:120`.** `ExportOperation` is another lifecycle owner
   beneath `machines/backup/export.ts` and `capture.ts`. `#track` controls admission and issued-work
   retention (`:163`); `releaseLease` maintains a release promise and cleanup-failure flag (`:234`);
   `#settled`, `drainIssued`, `retryCleanup`, `finish` and `#clear` implement drain/retry/disposal
   (`:291`–`:332`). `#clear` can start lease release with a fire-and-forget promise. These decisions
   belong in the capture/export owner states, including a failed lease release and explicit retry.
   Source authority/read/consistency calls and the consumer handoff can remain individual effects;
   their completion must be reported to the owning actor. Preserve an issued handoff's borrowed
   file until that effect settles. Retain late acquired leases without a second imperative lifecycle.

2. **Envelope/crypto: `src/lib/backup/envelope-operation.ts:104`.** `Operation` duplicates lifecycle
   through `#claimed`, `#released` and `#pending`; `#track` decides when late native results are
   discarded and cleanup runs (`:182`), while `release` gates clearing on the counter (`:347`). The
   attachment cursor advances inside `hashAttachment` and controls the chart via `hasAttachment`
   (`:294`–`:306`). Put operation admission, attachment index/continuation, interruption, native
   completion and result transfer in the envelope machine. Each Web Crypto import/derive/encrypt/
   decrypt/digest remains one native effect. Keep passwords, keys and raw bytes in an opaque data
   capsule, not ordinary/persisted context; privacy is not a justification for a second lifecycle.

3. **Inspection: `src/lib/backup/inspection.ts:97`.** `Inspection.readSource` reads a provider, bounds
   and parses its bytes, then chooses plain/password/password-required routing (`:130`–`:148`). The
   inspection machine currently receives that already-classified result. Separate file reading,
   header validation and protection/password routing in the chart. `#claimed`, `#released`, abort,
   retained child output and `cleanup/release` (`:230`–`:251`) also duplicate owner lifecycle. Keep
   profile validation/summary construction pure and retain the checked archive through its owning
   actor's cleanup. The class-backed `Report` is a separate unnecessary class, not a reason to create
   another workflow for a reference getter.

4. **Older workspace journal: `src/lib/machines/workspaces/journal.ts:33`.** This already models
   normal read/validate/write/settlement/close decisions; it does not need wholesale conversion.
   However, the open promise retains the acquired database only through its resolved output (`:40`),
   and native callback teardown only removes transaction listeners (`:84`). If the actor is stopped
   during opening, the late connection has no explicit cleanup owner. Graceful SHUTDOWN/CANCEL is
   modeled and must not be confused with arbitrary actor stop. Correct/qualify the native resource
   disposal boundary; do not add a second lifecycle or claim the existing cancellation tests prove
   abrupt-stop cleanup. This is a source-level ownership finding, not a reproduced runtime failure.

5. **Notebook fixture lease: `fixtures/backup-notebook/source.ts:29`.** `NotebookSource` owns available/
   leased source state through `#owner`, rejects writers while leased, checks binding changes and
   permits release only for the matching owner token. If this mutable lease/writer demonstration is
   retained, model ACQUIRE/RELEASE/REPLACE/BINDING_CHANGED with an explicit fixture owner instead of
   another class-backed lifecycle. Payload detachment and the profile validator stay pure. This is
   fixture work; it does not justify a new production locking feature or broader platform support.

The first three are the same architectural mistake as the original journal owner, despite the
presence of outer machines and earlier passing runtime tests. Source comments describing methods
as leaves do not make the hidden lifecycle acceptable.

### Remaining application-owned classes

The inventory found 13 remaining class declarations after the journal correction. Three are the
production lifecycle owners above; one is the notebook fixture. The other nine are:

- `SealedResource` and `CheckedResource` in `backup/envelope-operation.ts:56` / `:73`, and `Report`
  in `backup/inspection.ts:81`: replace with ordinary opaque data/reference factories. These getters,
  copies, descriptors and reference/buffer release operations do not themselves require machines;
  their orchestration/lifetime belongs to the corresponding workflow owner.
- `ArchivePayloadError`, `ArchiveEnvelopeError`, `ArchiveInspectionError`, `ArchiveExportError` in
  `backup/types.ts:38`, `envelope.ts:32`, `inspection.ts:66`, `export.ts:82`: use native Error factories
  and narrow type guards. Error classification is pure; error objects need no lifecycle machine.
- `QuerySubscription` and `QuerySubscriptionOne` in `backend/jazz/data.svelte.ts:16` / `:21`: the
  subclasses only supply local-first options to the SDK. Replace application inheritance with
  functions/options composition while preserving SDK construction/ownership semantics. The SDK
  owns the subscription lifecycle; adding an independent subscription machine just to remove the
  classes would duplicate ownership.

### Reviewed areas where another machine is not indicated

| Area                                                                                                                                                         | Source conclusion                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payload/envelope wire parsing, JSON tokenizer, binary conversion, budgets, Zod schemas, journal intent/successor predicates, notebook dataset/profile        | Synchronous bounded transformations/validation. Local parser cursors are algorithm data, not an operation lifecycle. Keep functions; replace only the custom error classes listed above.                                                                                             |
| Form readiness/submission/write, profile/avatar, workspace naming/creation/persistence/initialization/invitations, identity restoration/session coordination | Meaningful phases are already modeled in their machines. The in-repo promise bodies delegate individual effects or normalize one result/error. No additional concrete hidden multi-effect workflow was found in those inspected bodies.                                              |
| Jazz session/acquisition/readiness, recovery phrase/restoration and invitation-authority adapters                                                            | Single SDK calls, synchronous binding/generation projections, current-binding rechecks and event subscriptions. SDK-owned internal workflows stay behind the documented boundary; no new app lifecycle machine is indicated for these adapter bodies.                                |
| `backend/jazz/startup.ts`, Svelte form/recovery bindings and reader CLI entrypoint                                                                           | Start application/host-owned root actors, rather than manually starting hidden children. The startup registry retains an actor reference, not an acquisition promise cache.                                                                                                          |
| `machines/forms/lifecycle.ts`                                                                                                                                | Sends SHUTDOWN and observes the existing owner's completion/error before stop. Its subscription bookkeeping does not implement form cleanup itself. Keep the narrow root-integration helper.                                                                                         |
| `fixtures/backup-reader/io.mjs`                                                                                                                              | One bounded native stream read with byte counting, abort/error/end/close translation and listener/buffer cleanup. It does not choose password, crypto, profile or retry stages. Narrow native adapter bookkeeping can remain here; inspection stages belong to the inspection chart. |
| `fixtures/private-creation/browser.ts`                                                                                                                       | Test controls expose separate SDK acquisition/stage/commit/wait/read boundaries. The test harness owns sequencing/process termination. This is not a production promise pretending to own a transaction workflow.                                                                    |
| Contracts, public barrels, localization projections, logger, validation mappings and presentation components                                                 | Data contracts, composition, synchronous projection or presentation state. No new resource-owning lifecycle was found.                                                                                                                                                               |
| Current journal rewrite                                                                                                                                      | Machine owns decision/settlement/cleanup states; native adapter holds handles and translates events. Still awaiting implementation review/runtime qualification. It is not declared correct merely because the class declarations are gone.                                          |

Injected host callbacks such as form completion/save handlers and domain transaction/capture
capabilities remain a qualification boundary. An interface returning a promise does not certify
that an external implementation is a leaf. No deployed consumer implementation was inspected in
this audit; its internal workflows cannot be certified by inspecting DLF's delegation alone.

### Follow-up boundaries

Keep the current journal ownership correction as its own review slice. Then correct envelope
ownership first (inspection and export both depend on it), followed by inspection, export/capture,
and the notebook fixture. Address the older workspace journal's disposal boundary as a separate
foundation slice. Remove the remaining helper/error/SDK wrapper classes with their owning slice,
including public consumer API updates. Do not turn every predicate or native call into a machine.

No additional production files were changed for this audit, no tests were added/run, and nothing
was committed or published. These findings are recorded for review; earlier green CI is behavior
qualification of the old implementations, not proof of machine-first compliance.

## Envelope ownership correction — implementation awaiting review

The first follow-up slice is implemented locally, uncommitted. `machines/backup/envelope.ts` now owns
admission, parsed mode, attachment index/count and advancement, digest decisions, crypto stage
sequencing, cancellation/drain, construction and output transfer. `backup/envelope-operation.ts`
contains private payload storage, single-use admission, pure construction/serialization and inert
revocable resource handles. The Operation, SealedResource and CheckedResource classes are removed;
there is no private pending counter, cursor, release phase or cleanup promise.

`backup/envelope-native.ts` translates one machine command into one Web Crypto call. Each issued
call owns a dedicated input buffer, cleared before its completion/error report. Native callback
disposal detaches reports and clears capsule originals; a late ArrayBuffer is cleared instead of
being published. It cannot stop native crypto. Graceful CANCEL/SHUTDOWN waits for settlement, and
request release reports revocation to the owner. A prepared request not yet attached to the working
owner still requires explicit request release if abandoned, as before. JavaScript strings/CryptoKey
objects have no proven zeroization guarantee. The additional bounded copy increases peak memory;
large-file memory/latency qualification remains open under T004.

Successful output passes through an explicit transfer state before the working owner exits.
Cancellation during the final cleanup window releases that transferred but undelivered result.
Parent retention hooks continue capturing constructed output before a child done event can be
lost; inspection/export ownership itself is not rewritten here.

The public error subclass is replaced by `createArchiveEnvelopeError` and `isArchiveEnvelopeError`
on `backup/envelope`; callers that constructed the subclass or used instanceof must migrate.
Internal parent imports and existing tests were adjusted mechanically for the API and nested working
state paths. No new test cases were added, and no implementation tests were run for this correction.
Svelte/TypeScript, package generation/strict Publint, public-consumer declaration type checking,
lint and formatting are the static checks; they do not establish race, wire interoperability,
cleanup or browser correctness for this implementation. Prior test/CI totals qualify the previous
implementation only. Implementation review must precede runtime qualification under AGENTS.md.

Remaining audited owners: inspection, export/capture, notebook fixture and the older workspace
journal disposal boundary. Their findings remain open; pure helper and SDK wrapper cleanup follows
its owning review slice.

### Envelope correction — reviewed continuation and focused qualification

The user continued from the implementation review above. Runtime qualification found and fixed
non-idempotent revocation: request release now returns when the prepared input reference is already
revoked. The existing snapshot test explicitly asserts one report for repeated release without
creating an unbounded subscriber loop. Focused validation passes: 134 envelope/inspection/export
unit cases, 13 notebook/package integration cases, standalone public envelope consumer, four
Chromium cases using fresh public-export bundles, and the static checks listed above. See
[qualification](envelope-design.md#ownership-correction-qualification-after-implementation-review).
The earlier static-only status is historical; the journal correction and remaining owner rewrites
are not qualified by these results. No commit/publication/merge. Inspection is the next owner slice.

## Inspection ownership correction — implementation awaiting review

The user continued after envelope qualification. The inspection owner is now locally rewritten,
uncommitted. `machines/backup/inspection.ts` owns source/header/password routing, the invoked
envelope's lifetime and drain, exact profile matching, valid/invalid/unsupported decisions,
report construction/transfer and cleanup. It holds only safe observed facts and opaque handles.
`backup/inspection.ts` holds private data, single-use admission and pure helpers; Inspection,
Report and ArchiveInspectionError classes are removed. The report remains an inert releasable
metadata reference. There is no private claimed/released flag, pending counter or cleanup promise.

The invoked `backup/inspection-native.ts` callback owns one AbortController, issues one source or
password read per command and reports settlement without interpreting headers/profiles. The chart
requests abort and waits for an issued read to settle; disposal clears owned references and drops
reports, clearing late transferred byte arrays. It retains only the issued provider, not the whole
profile registry. Request release revokes the existing input reference once, sends the owner a
revocation report and reaches the appropriate read abort/envelope shutdown protocol. Failed claims
do not enter that native scope or clear another owner's resources. Abrupt teardown still cannot
prove cancellation of a provider that ignores AbortSignal, nor zeroize JavaScript password strings.

The existing checked-output retention hook still captures decrypted output before the envelope's
done event can be discarded. Report construction also records its handle before returning. An
explicit transfer state detaches the successful report before disposing private payload resources;
CANCEL/SHUTDOWN during final cleanup releases an undelivered report.

Public inspection errors now use createArchiveInspectionError/isArchiveInspectionError; the reader
adapter's constructor calls were mechanically migrated. CLI outcomes, exit statuses, metadata and
wire format remain the same. Existing unit tests received only state-path compatibility updates;
no new cases were added and no implementation tests were run for this slice. Affected runtime
qualification after review is inspection/envelope/export units, independent reader and notebook
consumers, and public envelope/notebook Chromium cases. The previous envelope totals qualify the
prior inspector integration, not this new owner.

Static checks cover Svelte/TypeScript, package/strict Publint, public consumer declarations, reader
adapter types, lint, formatting and whitespace. These do not establish read cancellation/drain,
late-result disposal, output handoff or native crypto correctness for this owner. Export/capture,
notebook lease ownership and the older workspace journal disposal finding remain separate follow-ups.
No commit, publication or merge was performed.

### Inspection correction — reviewed continuation and focused qualification

The user continued from implementation review. All existing 134 focused envelope/inspection/export
unit cases passed. Six additional focused cases cover the newly exposed cancellation stages,
idempotent release during a pending source read, envelope drain after request release and late
source disposal on actor stop without explicit release after native ownership attaches. All 140
focused cases, 11 independent reader cases, 13 notebook/package integration cases and four Chromium
cases pass. Package/strict Publint and static checks pass. No production fixes were needed.
See [qualification](inspector-design.md#ownership-correction-qualification-after-implementation-review).
The static-only status above is historical. The pending journal correction remains separately
unqualified. Export/capture is the next owner slice; no commit/publication/merge was performed.

## Export/capture correction — started, cleanup API decision pending

At the user's explicit request, committed the prior ownership changes as local feature-branch
commit f50a97c (`refactor(backup): move resource lifecycles into state machines`). This includes the
journal correction with its separately recorded unqualified runtime status. No push or merge.

Started export/capture independently of the pending cleanup protocol choice: authority and
consistency observations are returned to capture-machine guards, bounded structural/profile
validation is extracted as a pure synchronous transform, and the export error subclass is replaced
with createArchiveExportError/isArchiveExportError. The public barrel follows that error API.
The existing operation lifecycle remains in place until its cleanup recovery contract is resolved;
this is partial progress, not a completed ownership correction.

A question is pending with the user about replacing request.retryCleanup() with a caller-owned
cleanup machine, versus preserving it as a single native release leaf. The explicit-machine option
is recommended because retry admission/settlement remains visible after export completion. Do not
silently remove cleanup recovery or choose the dependent API without the user's answer. The
[ownership design](lifecycle-design.md#machine-first-export-correction--ownership-design-in-progress)
records the resource and interruption constraints for either implementation.

No implementation tests added/run for these new changes; static checks only. The previously passing
140 focused unit cases and other integration totals describe the preceding committed slice.

## Export/capture ownership correction — implementation awaiting review

The user selected the explicit cleanup machine, resolving the preceding API question. The export
class is now removed. Capture-chart guards own authority and consistency decisions; the export
chart owns child drain, handoff retry, failure precedence and cleanup. Private data contains actual
resources and payloads, not a pending count, waiter set, release promise cache or lifecycle flags.
`backup/export-native.ts` keeps one native call's promise as a settlement receipt, which the chart
awaits in its draining state if a child crashes. This is the actual native effect, not a manually
started child or an actor/promise bridge.

Native leaves move a lease or sealed handoff handle out of idle storage while borrowing it, return
it on settlement while its owner remains attached, and dispose it after settlement if teardown has
revoked the owner. Late acquired leases receive one native release. Failed lease disposal retains
the resource rather than silently retrying. The fixed teardown observer aborts/clears input and
performs narrow native disposal; cleanup custody is published only after that owner is detached
and the actual issued call has settled. Cleanup cannot steal resources from an active export or
another cleanup actor. Previously reported dispatch/unknown facts and cleanup-failure precedence
are retained. No new archive-sized input copy or generalized retry framework is introduced.

`createArchiveExportCleanupMachine()` is exported on `backup/export/workflow`. A caller-owned root
claims cleanup custody, makes one uninterruptible lease-release attempt, and returns `cleaned` or
`failed` with exportInUse/captureCleanupFailed/exportFailed. A failed attempt restores the retained
lease for another explicit cleanup actor; an already cleaned request is a no-op. Stopping the
cleanup actor drops reports but does not claim to cancel an issued native release. The request's
retryCleanup() method is removed as approved. Existing test callers were mechanically migrated to
run that root actor, preserving their existing throw-on-failure expectations in a test host helper.
The notebook README records the public API migration. Export errors now use factory/guard functions.

No implementation tests were added/run for this correction. Existing test edits only migrate the
cleanup API and nested root scope paths. Static checks cover Svelte/TypeScript, package/strict
Publint, public-consumer and notebook declaration checks, lint, formatting and whitespace. Review
must precede runtime checks of capture release, native drain, late lease/read/handoff disposal,
cleanup admission/concurrency/failure recovery and existing notebook/browser integrations. Earlier
140-unit/reader/notebook/browser totals qualify the preceding implementation, not this correction.

The lease and cleanup custody are in-memory resources, not persisted recovery or a restore journal.
Providers that ignore AbortSignal still must eventually settle for graceful drain. Native lease
release cannot be cancelled or proven successful from actor.stop(). Consumer-retained file copies
cannot be recalled. Notebook source ownership, older workspace journal disposal and the committed
restore-journal correction remain separate unqualified follow-ups. No new commit/push/merge.

### Export/capture correction — reviewed continuation and focused qualification

The user continued from implementation review. All 140 existing focused units passed. Four new
cleanup protocol cases cover concurrency, synchronous/asynchronous retry failure, stopped actor
custody and late settlement. All 144 focused units pass. A new built-public-package notebook case
proves retained lease cleanup actually restores writer access without replaying export; all 14
notebook/package, 11 independent reader and four Chromium cases pass. Static/package checks pass.
No production fixes were needed. See [qualification](lifecycle-design.md#export-ownership-correction-qualification-after-implementation-review).
The preceding static-only status is historical. These changes remain uncommitted; f50a97c is the
prior ownership commit. Notebook source ownership is next. Journal corrections remain separately
unqualified. No push/merge.

## Notebook source ownership correction — implemented and tested (2026-11-04)

The user authorized committing the preceding export correction and doing this next cleanup including
tests. Committed export/capture work as 77b008f; no push/merge. Removed NotebookSource in favor of a
fixture-owned source chart with initialization, available, leased.current and leased.invalidated
states. The chart owns admission, writer exclusion, binding/current-owner decisions and release;
payloads stay in private data capsules. Pure codec transforms and inert lease adapters remain
functions. There is no private owner/started flag or source-owned multi-step promise workflow.

The source factory returns an unstarted root. The fixture host starts it explicitly and exposes
source.actor so hosts can stop it after drain; its lifetime spans writes and successive captures,
rather than being a manually started hidden shared-library child. An explicit initialization state
handles XState's pre-start active snapshot without queuing work. Binding replacement invalidates
an existing lease even when the binding returns to the same value. Failed writes preserve the prior
data and keep the actor usable. These are bounded fixture rules, not new persistence/recovery scope.

All 18 notebook/package cases (four added ownership cases), 144 focused shared backup units,
11 independent reader cases and four Chromium cases pass. Static/declaration/lint/format checks
pass. See [qualification](lifecycle-design.md#notebook-source-correction-qualification-2026-11-04).
No full repository suite was run. The new source cleanup remains uncommitted. Next audited source
finding: the older workspace journal's native disposal boundary. The committed restore-journal
correction still requires separate review/qualification; these tests do not qualify it.

## Older workspace journal native disposal correction — implemented and tested (2026-11-04)

At the user's request, committed the preceding notebook source cleanup as 8e5efe0, then corrected
the audited workspace journal disposal boundary. A fixed invoked native owner retains database/
transaction handles before delivery, closes a late successful open after stop and aborts a late
upgrade after disposal. Transaction teardown detaches callbacks and attempts native abort without
inventing abort settlement. The existing chart keeps validation/conflict/transaction decisions.
The exported event union is aligned with its new native observations for typed consumer compatibility;
input and result contracts stay the same.

All 213 workspace units and nine real Chromium journal cases pass, including four added native
stop/deletion/rollback probes. Package/strict Publint and static/declaration/lint/format checks pass.
See [qualification](../001-local-first-foundation/cleanup-review.md#workspace-journal-disposal-qualification-2026-11-04).
This correction is uncommitted; no push/merge. It does not qualify the separate restore-journal
correction or claim rollback after commit/browser-process crash. Remaining audit cleanup includes
inert payload-error/SDK subscription wrappers; those do not warrant new lifecycle machines merely
to remove inheritance. Restore-journal review/qualification remains separate.

## Final class-wrapper cleanup — implementation boundary (2026-11-04)

The user requested continuing the remaining cleanup after committing workspace journal disposal
as 75bee3a. Replace ArchivePayloadError with createArchivePayloadError/isArchivePayloadError;
keep safe codes/name/message and migrate constructor/instanceof/public-barrel callers. Replace
DLF's two SDK subscription subclasses with createQuerySubscription/createQuerySubscriptionOne,
which return the SDK-owned instance with the same lazy local-first options default and explicit-tier
precedence. Component/Svelte/SDK subscription disposal remains native; no new lifecycle machine,
application class, subscription cache or consumer domain migration is warranted. Update the app
integration example and package fixtures. Continue the established implementation/test cleanup cycle
with codec regressions, focused wrapper-boundary tests and package/consumer checks. This work does
not qualify the separate restore-journal correction.

### Final wrapper cleanup qualification (2026-11-04)

Removed the last three application-owned class declarations. Payload errors retain their safe
name/message/code through factory/guard functions. Codec, envelope, inspection/export and journal
codec classifiers and the independent reader now use the guard; constructor/error assertions and
public-package exports are migrated. The subscription factories return the native SDK objects,
retain lazy local-first default options and preserve caller-provided static/reactive tiers. The
next-app example and public Svelte consumer use factory calls rather than inheritance.

All 232 focused archive/envelope/inspection/export/subscription-boundary units and 89 journal-codec
units pass (321 distinct cases). Added one payload-error classification case and five mocked SDK
constructor-boundary cases. Static checking caught and corrected a test's invalid tier constant to
the installed SDK's ReadTier.Remote. A public consumer declaration check verifies inferred row fields
for both factories without importing SDK types outside the permitted integration boundary. These
mocked tests verify delegation/options, not native Jazz data/session behavior or Svelte disposal.

Package/strict Publint, Svelte consumer bundling, standalone codec/envelope public consumers,
18 notebook/package cases, 11 independent reader cases and four focused Chromium cases pass.
Svelte/TypeScript, public consumer declarations, lint, formatting and whitespace checks pass. No
full repository suite was run. A source/fixture declaration scan finds no remaining app-owned
classes; SDK implementations/dependencies and TypeScript generic constraints are not app classes.
No new machine, subscription owner, SDK implementation fork or live sibling consumer migration.

This final wrapper cleanup is uncommitted. Prior workspace journal correction is in 75bee3a.
No push/merge. The original code-cleanup audit items are addressed; separate restore-journal
validation and full regression/PR qualification still remain, and cannot be inferred from these
focused codec tests.

## Notebook finite-operation correction — awaiting implementation review (2026-11-04)

The user correctly identified that eliminating classes did not finish the notebook's state modeling:
REPLACE/READ still combined fallible work, branch selection and replies in large inline actions.
Those operations now have explicit validatingWrite -> committingWrite/rejectingWrite and
capturingRead -> returningRead/rejectingRead states. Named actions perform a single transform,
assignment or reply. Bounded synchronous helpers return typed success/failure facts; chart guards
choose the branch and success states publish the result. Failed writes preserve source data.
Requests/results are cleared on return to idle, with captured payloads held only in opaque capsules.

Unavailable-operation defaults now belong to available/leased state handlers instead of the root.
Only shared binding/authority observations remain global. The adapter reads an acceptingCommands
state tag rather than matching internal initialization paths; it keeps no lease-policy copy. The
synchronous API remains unchanged. No async promise actor or reply waiter was added for pure,
synchronous fixture transforms.

Svelte/TypeScript, notebook/public-consumer declaration checks, lint, formatting and whitespace
checks pass. No implementation tests added/run for this correction before review, per AGENTS.md.
Existing qualification totals apply to the preceding implementation only. Review should precede
checks of both success/failure state branches, data preservation, response cleanup and existing
lease/invalidation/opaque-snapshot integration cases. No new commit/push/merge.

## Envelope preparation correction — awaiting implementation review

Repository state-model review finding 1 is implemented locally. The former prepare promise actor
is removed. Claim completion guards select payload parsing for seals or envelope parsing for opens.
Envelope parsing reports protection only; completion guards select plain/password decoding. Password
sealing separately invokes header construction after payload parsing. The existing payload parsing
leaf is reused, and all new invocations route failures/interruption through existing cleanup.

Parsed envelope content has one private request-storage reference, cleared after decoding and by
normal/abrupt cleanup. Context retains mode/count facts only. No public API, native crypto owner,
retry policy or consumer workflow was added. Reviewed the changed leaves and their parsing/decoding/
header helpers against the machine-first gate; shape-narrowing checks remain leaf invariants.

Svelte/TypeScript, lint, formatting and whitespace checks pass. These do not qualify runtime
behavior. Existing envelope cancellation
tables at envelope.test.ts lines 438 and 475 still refer to the removed preparing state; update
those tables to exercise the new meaningful preparation states after implementation approval.
No tests added/run and no commit/push. Avatar selection, recovery failure and transaction teardown
findings remain untouched; they need their own review slices and ownership decisions.

### Envelope correction qualification

After the user approved continuation, replaced the two obsolete preparing-stage cancellation
entries with payload parsing/header construction and envelope parsing/password decoding. Added
focused cases for release during plain decoding (no hashing afterward) and failed password-header
generation (no hashing or password import; request revoked). Existing independent crypto vectors,
all four modes, malformed inputs, interruption drain, output ownership and secret-free snapshots
remain covered by the focused suite.

All 148 cases in envelope, inspection and export unit suites pass. The rebuilt public package
passes publint, consumer declarations and the Node envelope consumer. Its freshly rebuilt IIFE
passes the Chromium envelope integration (one test). Playwright's temporary localhost preview on
port 6015 required sandbox escalation for socket binding and shut down after the run.
Svelte/TypeScript, lint, formatting and whitespace checks pass. No implementation adjustment was
needed after testing. No commit/push; the separate notebook correction and backup journal owner
still have their previously recorded qualification limits. Remaining review findings are unbuilt.

## Avatar selection correction — awaiting implementation review

Committed the preceding notebook/envelope correction and repository review as a16cdaf at the user's
request. No push. Notebook runtime qualification remains pending; the envelope checks above passed.

Implemented review finding 2 as a separate local slice. The selection machine owns ready,
validating, invalid, cropping and closed states. Guarded transitions decide validation outcome,
saved-image removal versus draft clearing, reset and crop acceptance/dismissal. Its named actions
perform bounded validation, assignments or host notifications. Validator exceptions become invalid
selection; notifications retain the existing synchronous callback contract.

The private Svelte binding owns actor start/subscription/SHUTDOWN/stop and forwards profile, reset
revision and saved-image observations. ProfileAvatarForm consumes selected/crop/invalid/dirty view
facts and forwards callbacks. Crop requests correlate callbacks by object identity, and each native
dialog is keyed to that request. Reset/replacement invalidates old acceptance/dismissal callbacks.
Saved preview refresh preserves drafts and active crops. The same profile composition moves from components/profile to integrations/profile because it
now owns an actor binding; the public profile/avatar-form entry targets the moved file. Only this
component is changed; the submitted image processor/write actor, public component props and localized copy stay
as before. No new exported entry, image processing or generic dialog implementation.

Svelte/TypeScript, lint, pnpm format, pnpm format:check and whitespace checks pass. Rebuilt package,
publint, consumer declarations and the consumer Vite build also pass with the relocated public
component target. No runtime tests
added/run before implementation review. After approval, qualify valid/invalid/throwing validation,
crop accept/cancel, stale crop callbacks after reset/replacement, saved refresh, draft clear versus
saved removal, and shutdown. Component/browser validation must cover actual DUI input/dialog
callbacks and profile reset; machine tests alone will not qualify that binding. Recovery failure
and transaction teardown remain separate unresolved design slices. Avatar changes are uncommitted.

### Avatar selection qualification

After approval to continue, added ten real-actor cases covering validation acceptance/rejection/
exceptions, crop acceptance/dismissal, profile/revision reset, stale crop callbacks, saved-image
refresh, draft clearing versus saved removal, and shutdown reference cleanup. All ten pass. The
combined avatar, form cleanup/submission and extraction regression run passes 51 cases in four
files. Lint, formatting and whitespace checks pass.

Added a small synthetic host consuming the built public profile/avatar-form entry and real DUI
controls. Two Chromium scenarios pass: native Escape dismissal, accepted file and Save binding,
reset clearing the input, profile replacement rejecting an old crop callback, invalid-file feedback,
and unmount closing the native dialog. The synthetic cropper invokes callbacks; this does not
qualify a consumer's image crop/processing implementation. Host controls/labels are test fixtures,
not additions to the product catalog. No production change was needed after testing.

The normal consumer check now builds this browser fixture for CI, and root Svelte checking includes
test components. The package fixture build and root Svelte/TypeScript checks pass. Playwright owned
a temporary preview on localhost port 6015, with sandbox escalation for socket binding, and stopped
it after the run. Runtime checks apply to avatar selection only; notebook/journal qualification
limits remain as previously recorded. No commit/push of this avatar slice.
