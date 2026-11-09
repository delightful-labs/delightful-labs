# Restore journal identity and record — first review slice

Branch `feat/backup-restore-journal`, based on PR #21 merge `04f3203`.

The export/inspection slice is merged. This slice defines the recovery metadata and storage boundary
needed by T006/T012, and implements its bounded pure codec. It does not open storage, create a
destination or issue restore writes. T012 stays open until concrete storage and restart behavior are
implemented, reviewed and qualified. New implementation tests must follow review approval.

The subsequent [browser journal owner/store](browser-journal-design.md) is now implemented and
reviewed with focused native Chromium qualification. See that design for current evidence and limits;
the codec qualification below remains separate from destination writes.

## Owners and ordering

```text
application binding/access owner
  restore coordinator (planned)
    checked archive owner (existing envelope child plus trusted exact profile validation)
    journal owner (planned acquisition/read/create/CAS/reconciliation/release states)
    consumer destination/write owners (planned)

pure journal codec (this slice): unknown metadata/bytes -> bounded strict immutable record
```

The restore coordinator receives a fresh generation bound to the restoring identity, application,
environment, destination workspace and operation ID. Storage keys use application/environment/
identity/operation as a tuple; never delimiter concatenation or a raw ID as a filesystem path.
Generation belongs to the live operation and is not stored as permanent identity: a resumed operation
uses the same durable IDs and a newly observed generation. A → B → A never admits old child reports.

The checked archive's original decoded-byte SHA-256 and exact profile/version bind the operation.
Its archive ID/source IDs remain descriptive metadata. The current identity and destination authority
come from the consumer/session boundary. Archive provenance, journal metadata and a successful parse
cannot grant permissions or reactivate archived grants.

## Immutable intent

The strict v1 record contains an operation binding, archive binding, explicit source-to-destination
mappings and a deterministic consumer plan. Allocate the operation, destination and complete mapping
before effects, then durably create the intent before any destination write. IDs never change after
an unknown response. Source and destination IDs are disjoint; each source tuple has one mapping;
destination mapping IDs are unique. Records and inert provenance share the archive's `(type,id)`
namespace; attachments have a separate source namespace. No domain fields, credentials or raw bytes
are stored here.

Preparation and each batch have a stable write ID, an expected-content digest and mapping indexes.
Their index lists partition the complete mapping without duplicates or omissions. A batch represents
a profile-approved atomic group; the generic journal does not split graph cycles or policy invariants.
Preparation may own no archived records when the consumer creates separate destination control rows.
The activation write has its own stable ID/digest. Write IDs are unique across the plan.

The profile owns plan ID/version, declared plan fingerprint and expected full graph digest. The codec
checks their structure, not their cryptographic derivation. On resume, trusted profile logic must
reconstruct and compare the complete expected intent from the checked file and validated recovery
context. Merely reading matching fingerprint strings from storage proves nothing. Destination owners
must independently check isolation, ownership, operation metadata and actual mapped rows before
effects; new-looking IDs do not prove an unused destination.

Intent changes are forbidden. A storage update uses the expected prior revision, the next revision
and exactly the same intent. Native create-if-absent/CAS must enforce those checks atomically; the
codec does not turn a proposed update into a persisted one.

## Recovery checkpoints

```text
writing preparation -> writing batch 0 -> ... -> writing final batch
  -> comparing actual isolated contents -> activating -> complete
any observed conflict -> conflict retaining the prior checkpoint
```

Checkpoint data records completed write receipts and the current write intent. It is not a serialized
actor snapshot. The future machines own eligibility, issuance, effects, reconciliation and cleanup;
this codec owns only structural/correlation invariants of the durable data.

A write is either `notIssued` with a retained issuance counter, or `issued` with its stable write ID,
issuance number and separate local/remote observations. Persist `issued` before calling the backend.
A crash between that journal commit and the backend call is conservatively uncertain: reconcile the
same expected IDs rather than assuming the call did not happen. Under the focused attempt rules
below, only a confirmed remote rejection with a known transaction ID admits another attempt;
authoritative-absence reissue remains outside this slice. A parsed `notIssued` marker is never
sufficient authority to replay an existing operation.

Local observations are `unobserved`, `persisted` or `rejected`; remote observations are `unobserved`,
`accepted` or `rejected`. They remain distinct. The plan explicitly states whether local persistence
and remote acceptance are required; neither can silently default to optional and at least one is
required. Any rejection blocks completion by that attempt's settlement receipt. The separate
remote-content completion basis below preserves rejected/unknown transaction facts. Supported SDK
transaction identifiers are optional, represented by explicit null when unavailable, never invented.

Completed entries form the exact preparation/batch prefix, with either required transaction
settlement or the separate remote-content completion evidence described below. The current write ID
must be the next expected step. Comparison and activation require all those entries. A comparison
receipt binds the expected graph digest and original payload digest; activation retains its own
settlement or remote-content completion evidence. The future restore owner must
recompare/reconcile current destination contents after restart; stored receipts alone cannot prove
current integrity or authorization. Conflict keeps its exact prior checkpoint and offers no automatic
overwrite, reset, new operation or replacement destination.

The codec intentionally supplies no lifecycle reducer. Future machines choose transitions using
current observations, while the storage owner validates immutable intent, revision order and retained
positive settlement evidence before CAS. Parsing a later-looking record does not establish how that
record was reached.

## Concrete browser storage

The subsequent [browser journal owner](browser-journal-design.md) implements read/create/revision-CAS
inside one IndexedDB transaction. The initial abstract lease/storage interface was removed during
review because there is no second implementation requiring it. See the concrete design for actor
ownership, settlement, cancellation and same-browser recovery limits. No destination writer exists.

## Bounds and API

`backup/restore/journal` exposes inferred types and synchronous functions to create an initial record,
parse unknown stored metadata, encode/decode bounded UTF-8 JSON and compare a record with a complete
expected intent. Browser storage has its own prepared-request and actor subpaths.

The record ceiling is 8 MiB, with 500,000 JSON values, depth 16, at most 50,000 record/provenance
mappings and 5,000 attachment mappings. Strings use archive-compatible exact Unicode and UTF-8
identifier/name bounds. Individual array ceilings are additional limits, not a guarantee every
maximum-sized graph fits the byte/value budget. Reject oversize input; never omit mappings or receipts.
Actual consumer size qualification remains T004/T007 work.

Before Zod cloning, the existing pure resource preflight bounds objects and rejects accessors, sparse
arrays, unsupported prototypes and excessive depth. Decoding reuses the existing duplicate-rejecting
JSON tokenizer with canonical safe-integer metadata. The wire schema is strict and versioned; no
coercion, trimming, defaults, migration, repair or storage reset occurs. Results are detached and
deeply frozen. Failures expose safe codes and discard raw schema issues/values. Journal metadata is
private recovery data and must not enter diagnostics.

There are no async functions, promise actors or external effects in the production codec. After its
implementation was presented, the user authorized continuation with review/tests; qualification is
recorded below. Later storage tests must prove real create/CAS, exclusivity, restart, lost responses,
invalidation and cleanup before any durable recovery claim.

## Implementation and static review status

Implemented under `backup/restore/journal`: strict internal Zod schemas and inferred public types,
initial record creation, object/UTF-8/JSON parsing, bounded encoding, complete intent comparison and
typed acquisition/read/CAS/release contracts. Shared preflight/tokenizer code is reused without
changing its archive behavior. The TypeScript package-consumer fixture checks the new public subpath
and declarations; a separate runtime consumer exercises that same built export on Node.

Source inspection checked deep readonly boundaries, safe errors, own-data preflight before schema
processing, byte bounds including serialized syntax, canonical integer decoding, mapping partitions,
record/provenance identity collisions, required settlement, exact receipt prefix, comparison binding,
activation receipt and conflict retention. The source review is complemented by the tests below;
neither is evidence for a storage implementation that does not yet exist.

Static checks passed: Svelte/strict TypeScript, package build/strict Publint, public-consumer
TypeScript, full Oxlint/Oxfmt and Git whitespace checks. No restore journal store or destination was
opened by the new codec checks, and no commit/publication occurred. The next implementation slice
is the journal resource owner and concrete storage; T012 remains open.

## Codec qualification

Completed locally after the user authorized proceeding from implementation review on 2026-11-03.
The reviewed production codec required no changes during this verification slice.

- **87 journal unit cases** pass against an independently authored literal v1 wire fixture. They
  cover initial state, deep freezing/detachment, borrowed Buffer preservation, exact Unicode and
  UTF-8 identifier limits, schema-key order, unknown versions and safe errors. Duplicate/escaped
  keys, trailing/truncated/BOM/invalid UTF-8 data, unsafe/noncanonical numeric tokens and counterfeit
  rounded version tokens fail without changing input or creating replacement operation IDs.
- Resource checks reject getters and `toJSON` without executing them, sparse arrays, symbol data,
  non-data prototypes, excessive depth/value count, oversized wire input and mapping sublimits.
  A 15,000-row proposal exercises an otherwise shaped record whose serialized syntax exceeds the
  byte ceiling. These are bound checks, not peak-memory/latency or maximum-consumer-size qualification.
- Mapping/receipt checks cover record/provenance identity collisions, separate source namespaces,
  delimiter-shaped tuple identities, duplicate/cross-source destination IDs, exact mapping partitions,
  missing/duplicate/out-of-range indexes and duplicate write IDs. Empty plans and preparation-owned
  atomic groups are supported without manufacturing placeholder batches.
- Unknown or rejected current writes remain pending recovery data. Local persistence never upgrades
  remote acceptance. Tests cover exact completed-prefix correlation, required settlement, retained
  issuance counts, comparison hashes, separately uncertain activation, settled completion, preserved
  conflict checkpoints and explicit local-only/remote-only policies. Full-intent matching checks
  individual binding, archive, plan, mapping and digest fields rather than trusting fingerprints;
  corrupt stored/expected records throw instead of becoming ordinary mismatches.
- The built public Node consumer executes through `backup/restore/journal` without supplying Zod
  schemas or an application session, preserves input bytes and checks initial/unknown-write round-trip,
  scope mismatch and strict error outcomes. It is included in normal `check:consumer` ordering after
  packaging. Source/unit checks continue to import only source code and literal data.
- One new **Chromium public-package case** verifies native UTF-8/JSON handling, deep frozen output,
  preservation of local-persisted/remote-unobserved facts and strict duplicate/version rejection.
  The test harness uses an explicit JSON module import attribute required by the Node test loader.
  All **46 Chromium tests** pass on task-owned preview port 6022, which Playwright shuts down.
- All **815 unit tests across 31 files** pass, using permitted disposable localhost Jazz listeners
  for the existing backend suites. Package/strict Publint, public consumer/Node runtime and browser
  bundles, all 11 independent-reader cases, all 13 test app cases, Storybook build, Svelte/TypeScript,
  Oxlint/Oxfmt and whitespace checks pass.

This qualifies the pure record/codec behavior in the exercised Node/Chromium environments. The
storage interfaces remained contracts at codec qualification. A subsequent browser owner/store is
now prepared for review; its native CAS, fencing, acknowledgement and restart behavior remain
unqualified. No restore destination exists yet. Parsed
settlement and digest fields are metadata claims, not fresh authoritative observations. T006/T012
and the full restore round-trip remain incomplete. No live data, identity/storage configuration,
deployment, commit or publication changed in this slice.

## Focused attempt/completion change — implementation review (2026-11-03)

The user authorized this focused implementation after the real-browser recovery investigation.
It extends the unreleased draft journal v1; no released journal migration or second storage format
is introduced. Initial records and ordinary first-attempt receipts keep their existing representation.

The immutable intent remains the planned work: restore identity, destination, mappings, write IDs
and expected content digests never change on retry. Existing receipt `issuance`, transaction ID and
settlement fields describe one transaction attempt. An optional `lastRejectedAttempt` records the
immediately previous attempt's issuance, transaction ID and separate local/remote observations.
Only a server-confirmed `remote: rejected` with a known transaction ID qualifies for a new attempt.
Increment issuance once, retain that rejected attempt, and start the new attempt with unobserved
settlement and no transaction ID. Within an attempt, observed settlement and known transaction ID
remain immutable. A second rejection replaces the previous rejection summary with the most recent
one; the counter retains the attempt number. This is bounded recovery metadata, not an audit log.

The successor guard must reject increasing issuance for an uncertain attempt, erasing rejection
metadata within the same attempt, resetting issued to notIssued, changing intent, or skipping steps.
The future write owner still checks corrected authority before actually writing; metadata grants no
authority. Unknown access, a generic exception, or a missing read cannot become a retry permission.
Reissue based on authoritative absence is not added by this change.

Completed preparation/batch steps and activation can have either:

- The existing settled transaction receipt, meeting the plan's required settlement observations.
- `basis: remoteContentMatch`, with the stable write ID, exact planned content digest, separately
  observed local persistence and the retained attempt receipt. The original attempt's unknown or
  rejected settlement remains intact. Remote content match alone does not satisfy a separately
  required local-persistence observation. The future trusted profile/reconciliation owner supplies
  the real content comparison; the codec validates correlation, not the truth of that observation.

An attempt can only complete its current planned step. Completed entries remain immutable and form
the exact plan prefix. Reconciliation preserves the current attempt and last rejected attempt; it
never fabricates a global transaction receipt. Comparison/activation ordering, native transaction
ownership, revision CAS, cancellation and same-browser scope remain unchanged. No coordinator,
destination writer, UI, retry scheduler, history collection or new asynchronous owner is added.

### T014 writer integration — qualified 2026-11-07

Use the existing shared write statechart and journal format. A caller explicitly invokes the
selected write again after a previous invocation returned incomplete; there is no in-machine retry
loop, timer or new destination allocation. The operation lock and immutable intent retain the same
destination, mappings and write ID across invocations.

The write owner keeps this order:

1. Reconcile actual remote content. Exact matches use the existing completion path, including any
   separately required local-persistence evidence; conflicts stop the operation.
2. A missing-or-hidden result can reach the existing authority check only for an unissued step or
   an issued step whose journal records a confirmed remote rejection and a known transaction ID.
   Missing/hidden content, unknown settlement and generic errors alone never permit another attempt.
3. Only an affirmative current authority result constructs a new issued checkpoint. Increment the
   attempt number and retain the previous attempt's number, transaction ID and settlement as
   `lastRejectedAttempt`. Repeated rejection retains only the latest rejected attempt.
4. Commit that checkpoint through the existing journal CAS before opening a transaction. Then reuse
   transactional reread, staging, commit and separate local/remote settlement checkpoints. A rejected
   new attempt returns incomplete; another explicit invocation is required to try again.

No new async helpers, owners or resources are needed. The destination child owns the current
authority observation; the shared write owner retains transaction custody; the outer restore owner
retains the operation lock. Cancellation/invalidation/shutdown drain existing work and block later
effects through the existing protocol. Failed CAS does not open a transaction. An unknown attempt
is still unresolved, including the existing crash window after intent issuance and before commit.

The user reviewed this implementation and authorized testing. Sixteen new machine cases cover
preparation/batch/activation retry, evidence retention, repeated rejection without an automatic loop,
denied/unavailable authority, uncertain/accepted/missing-ID attempts without replay, remote-content
reconciliation, failed checkpoint/CAS and cancellation/shutdown/invalidation during authority checks.

Three real Jazz/Chromium cases deploy an insert-denying policy only to the disposable local server,
observe the actual correlated remote rejection, repair its policy and resume in the same session,
after page reload and after graceful Chromium process restart with a temporary persistent profile.
They retain the identical intent/mappings, persist the prior rejected attempt, write one
destination row, refuse duplicate writes on repeated resume, and complete the remaining graph writes,
content comparison and activation. No synthetic rejection or production app/data/credential is used.

Validation: all 947 unit cases pass. The full native restore regression run passed 71 cases (seven
optional measurement cases skipped); the final focused run passed all three permission-repair cases
through full restore completion, including the added Chromium process restart case.
Root and test app TypeScript, Oxlint, package/strict Publint and public-consumer declaration checks
pass. The runtime changes remain two existing source files; tests reuse two existing suites. No new
states, journal format, resource owner, UI or files are added. Publication and Finance's pinned-package
adoption are still pending; the uncommitted Finance capacity work is untouched.

### Attempt/completion qualification — completed 2026-11-03

The user approved testing after implementation review. The reviewed production implementation
required no fixes. Added 16 focused unit cases in `restore-journal-attempts.test.ts`, covering a
confirmed rejection followed by a new accepted attempt, repeated rejection retaining only the latest
summary, uncertain/accepted/local-only failures not permitting retry, immutable rejection evidence,
and schema validation of the rejected transaction ID/counter. Content-comparison cases cover unknown
and rejected original attempts, retention of the latest rejection, no invented transaction acceptance,
exact planned digest/write identity, separate local-persistence requirements, activation completion
and terminal evidence retention. Codec round-trips preserve the new immutable nested metadata.

One new Chromium case exercises the built public package with real IndexedDB transactions: an
unconfirmed retry conflicts; a confirmed rejection then retry commits; remote-content completion
commits without changing transaction facts; page reload returns the exact metadata; deleting the
disposable database confirms connection cleanup. These are journal observations supplied by the
fixture, not a new Jazz reconciliation/writer integration.

Final checks pass:

- All **833 unit tests across 32 files**, including **105 journal cases** (89 existing plus 16 new).
- All **51 Chromium tests**, including six journal cases, on task-owned preview port 6026.
- Package build/strict Publint and public consumer checks, including 11 independent reader and
  13 test app cases; all public browser bundles rebuilt before Chromium qualification.
- Svelte/strict TypeScript, Oxlint, Oxfmt and whitespace checks.

The temporary preview was shut down. No live user database was used and no production code changed
during this testing slice. The results qualify this bounded journal representation and native CAS,
not end-to-end restore, destination authority, actual content evidence production or Finance adoption.
Restore coordinator/destination writers remain paused; T006/T012 remain open for integration.

### PR #22 CI follow-up: fixture read completion

[The initial CI run](https://github.com/delightful-labs/delightful-local-first/actions/runs/41744594358/job/126294299044?pr=22)
passed unit/package/consumer/private-creation checks but failed the malformed-row browser test during
database deletion. The same `Leaked database connection` failure reproduced locally once in 30
runs with two Chromium workers.

The fixture resolved its retained-row read on request success, then called `close()` while that
read transaction could still be active. The
[IndexedDB connection-closing algorithm](https://w3c.github.io/IndexedDB/#closing-connection)
waits for transactions to complete; deletion can report blocked during that interval. The fixture
now resolves the read on the native transaction `complete` event and rejects on abort before
closing the connection. The blocked-deletion assertion remains intact. Production ownership and
journal behavior are unchanged; no sleeps, automatic test retries or weaker cleanup assertions
were introduced.

After the fix, all 30 repeated runs and the full 51-case Chromium suite pass with CI settings/two
workers. Svelte/strict TypeScript, lint, formatting and whitespace checks also pass. Remote CI for
the follow-up commit is checked separately.
