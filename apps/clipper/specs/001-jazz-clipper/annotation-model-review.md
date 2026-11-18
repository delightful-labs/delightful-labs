# Annotation model review

Status: approved local annotation shapes now have a working saved-reader
implementation. Public sharing reuses `at.margin.note`; publication remains unfinished. The
working implementation section below records the user's subsequent authorization,
the delivered scope and qualification. Earlier review notes retain their original
design context.

## Review boundary

Present every new or changed data model to the user before implementing it. Review
one type at a time, showing a concrete shape and its constraints. Approval of an
earlier shape does not authorize silently changing it during implementation.

Use Jazz's native capabilities wherever possible. Clipper owns its annotation
relationships, representation metadata, policy and publication mapping. It does
not implement another text merge engine, version graph or deletion history.

## Approved local model

- Highlight and Note have independent Jazz identities. Jazz supplies creation
  metadata, native accepted history and soft deletion/restoration.
- Targets are values without a separate target UUID. A whole-document target has
  a Document relationship and source URI. A passage target additionally has one
  or more representation-specific anchors.
- Highlight owns a passage target. It does not duplicate the original quotation
  in a separate `originalQuote` field.
- A document-level Note owns a whole-document target. A highlight-attached Note
  references the Highlight and uses its target, without a copied Document/source.
- Note text lives directly on Note as a native Jazz text-merge column. The custom
  `NoteRevision` proposal is rejected; the existing revision implementation is not
  the selected future annotation model.
- One active Note per parent remains a product invariant. Competing offline
  creations must be addressed explicitly rather than losing either text.
- Native soft deletion is selected for Highlights and Notes. Highlight Undo must
  restore the same identities and preserve attached notes and anchors. Deleting
  only an attached Note leaves its Highlight intact. Native restore requires row
  data; retention and concurrency of restoration data need workflow design.

These are joined domain relationships, not instructions to store nested copies of
Documents, Highlights or library data. Backing UUID columns and named Jazz joins
describe one relationship, not two independent values.

## Approved anchors and interchange

Use Jazz's native `db.textAnchors().captureRange` and `resolveRange` facilities.
Its native `TextRange` replaces the earlier private quote/position objects and
selector array. Retain independent original source and derived reader ranges.

Jazz's native range contains `version?`, `start?`, `end?`, `before`, `matched` and
`after`. Its offsets count UTF-16 units. The native version is not our extraction
or normalization version. Clipper's representation metadata contains source/reader
kind, normalization version, normalized text hash, optional source timestamp and
text length where retained. Reader text length may be derived from retained text.
The hash is SHA-256 of normalized UTF-8 text. Exact normalization rules are not
frozen or qualified by this shape approval.

The user also approved optional `sourceCodePointPosition` on source-page anchors:
the already-reviewed plain `{ start, end }` position value, calculated while the
normalized source text is available. It retains Unicode code-point offsets for
public sharing without replacing Jazz's native UTF-16 range. Reader anchors omit
this source-only field and can derive code-point positions from retained reader
text. Validate agreement between both coordinate descriptions at capture.

For interchange, support only W3C TextQuoteSelector and TextPositionSelector.
Require one quotation and permit an additional position description of the same
passage/representation. Do not use `refinedBy` for alternative locators. CSS,
XPath, fragment selectors and refinement are outside this initial supported set.

Project native `matched`/`before`/`after` into `exact`/`prefix`/`suffix`, adding
fixed W3C type labels at serialization. W3C positions count Unicode code points,
so native offsets require conversion with the relevant text. Runtime validation
must check bounds, quotation/context agreement and representation identity.
Jazz confidence/ambiguity reports do not authorize automatic approximate matching.
Keep ambiguous/unresolved quotes and notes accessible.

Do not persist a W3C TimeState object. Retain the source timestamp as a Date where
known, reusing existing representation metadata when appropriate. Serialize it as
`{ type: 'TimeState', sourceDate: timestamp.toISOString() }` when required. Do not
substitute note creation/publication time or invent a cached URI.

## Approved Jazz table layout

The following records the reviewed layout. `jazzTextRangeSchema` validates the
native range's plain JSON shape; it is not a replacement for Jazz's capture or
resolution algorithm. The actual schema implementation still needs review of
permissions and source-aware invariants.

```ts
highlights: s.table(
  { documentId: s.uuid(), source: s.string() },
  {
    document: s.rel('libraryDocuments', 'documentId'),
    anchors: s.reverse('highlightAnchors', 'highlight')
  }
)

highlightAnchors: s.table(
  {
    highlightId: s.uuid(),
    kind: s.enum('source', 'reader'),
    normalizationVersion: s.string(),
    textHash: s.string(),
    textLengthCodePoints: s.int().optional(),
    sourceDate: s.timestamp().optional(),
    range: s.json(jazzTextRangeSchema),
    sourceCodePointPosition: s.json(positionSchema).optional()
  },
  { highlight: s.rel('highlights', 'highlightId') }
)

notes: s.table(
  {
    documentId: s.uuid().optional(),
    source: s.string().optional(),
    highlightId: s.uuid().optional(),
    text: s.string().merge('text').default('')
  },
  {
    document: s.rel('libraryDocuments', 'documentId'),
    highlight: s.rel('highlights', 'highlightId')
  }
)
```

Document Notes require document/source and omit highlight. Attached Notes require
highlight and omit document/source. Domain validation, permissions and transaction
admission must enforce these alternatives and owner relationships. Highlight and
its original anchor are created in one owned transaction; deriving another anchor
must preserve the original row.

## Editing and public limits

Stored Note text is a string, not a globally bounded read schema. Validate new
input and public projection against both 3,000 graphemes and 10,000 UTF-8 bytes.
Native concurrent merges can exceed those limits; preserve the merged value and
require shortening before publication. New quotations fit both 1,500 graphemes
and 5,000 bytes; each public context side fits 150 graphemes and 500 bytes. No
silent text truncation or splitting is authorized.

Use native edit-base tracking (`editedFrom`) and immediate text-column writes;
the earlier 500 ms source-write debounce is superseded. Review the supported
native editor adapter at the UI/worker boundary. Accepted history does not contain
pending/rejected writes and is not a substitute for recovery of unsaved input.

## Publication direction

Reuse `at.margin.note` directly as the public annotation contract. Shared highlight
anchoring uses its quotation selector; commentary uses its body; article association
uses its target source. Different apps can consume the same shared record type.
Separate private Jazz entities do not require a corresponding public entity type.

### Approved Margin content mapping — 2026-11-14

After the concrete public record was presented, the user directed continuing.
`annotations/margin.ts` implements this reviewed subset of `at.margin.note`:
`$type`, `motivation`, `target.source`, optional `target.selector`
(TextQuoteSelector), optional plain-text `body`, `createdAt` and optional
`modifiedAt`. A bare Highlight requires the selector, omits the body and uses
`highlighting`. A document Note requires the body, omits the selector and uses
`commenting`. An attached Note shares its Highlight target, includes the body and
uses `commenting`. Empty note text remains an empty body, not a deletion.

`createdAt` is the stable first-publication time supplied by the publication owner;
`modifiedAt` is its fixed issued-update time. No private timestamp store or binding
model is introduced. The strict owned-content schema must not strip metadata from
observed remote records. Remote updates, dependent facets, full W3C export and
publication workflow remain unfinished. Source evidence checks do not qualify
original-page capture or actual Margin/PDS interoperability.

### Companion proposal superseded — 2026-11-16

The user challenged the need for all custom companion additions, after first
removing `positionAnchor`. The sidecar proposal is removed from the active design:
there is no extra `subject`, `article`, `note` or `highlight` record/link schema.
A Highlight with commentary maps to one Margin record; removing its attached Note
updates that record to a bare Highlight. A document Note uses its own Margin
record. Private Jazz relationships and native representation validation remain
internal. The public AT URI supplies the shared annotation identity.

Public key allocation, scheduling and private publication evidence remain unselected.
Existing accepted publication policy
in [atproto.md](atproto.md) and [design-decisions.md](design-decisions.md) remains
binding; this review is not publication implementation or interoperability proof.

## Design and evidence identified during model review

### Approved private publication link — 2026-11-16

The user approved a private Jazz link containing `libraryId`, `source` (exactly
one Highlight ID or document Note ID), and a full DID-based `at.margin.note`
record URI. Jazz supplies the link row's identity, timestamps and history.
Native `library`/`highlight`/`note` joins implement those relationships; nullable
backing FK columns are the stored form of the approved source union. Attached
Notes use their Highlight's link. The URI includes its publishing DID, collection
and key; there are no duplicate stored components or public companion records.

Links are owner-readable and backend-written. The native link writer verifies
library/account ownership, parent type/library, active Document, publisher DID and
scope before staging. It retains addresses when source rows are deleted. A link
is an address association, not publication acceptance evidence. Publication intent,
issued payload/receipt, consent and reconciliation shapes remain unselected.

### Approved temporary publication preview — 2026-11-16

The user approved this concrete Zod response shape before implementation:

```ts
const publicationPreviewSchema = z.strictObject({
  libraryId: publicationLinkSchema.shape.libraryId,
  source: publicationSourceSchema,
  publishingDid: didSchema,
  record: marginRecordSchema
})
```

This is a temporary snapshot, not a Jazz table, public Lexicon, consent token,
reserved address or accepted-publication receipt. It reuses existing validation
for the private source, DID and Margin content. The initial backend reader handles
document Notes only and refuses existing same-publisher links; source-page
verification and remote-record reconciliation remain prerequisites for other
paths. The caller supplies a copied candidate creation time for display. Future
confirmation must recheck accepted content, scope and destination before issuance.

### Approved first-publication lifecycle — 2026-11-17

The user requested a discriminated union instead of the proposed boolean choice,
then approved this first-publication path:

```ts
const base = publicationPreviewSchema.pick({
  libraryId: true,
  source: true,
  publishingDid: true
})
const addressed = base.extend({ uri: atRecordUriSchema })
const issuedPublicationSchema = addressed.extend({
  state: z.literal('issued'),
  record: marginRecordSchema
})
const publicationSchema = z.discriminatedUnion('state', [
  base.extend({ state: z.literal('private') }),
  base.extend({ state: z.literal('requested') }),
  issuedPublicationSchema,
  addressed.extend({ state: z.literal('published') })
])
```

Private means no sharing choice; requested records the choice, including offline;
published means the PDS write was confirmed. The user subsequently approved adding
the exact validated Margin `record` to issued and clarified its meaning: saved in
Jazz for dispatch, possibly sent, awaiting confirmation. The future owner must wait
for durable Jazz acceptance before dispatch and retain that exact payload through
an uncertain outcome; no atomic Jazz/PDS operation is claimed. Later local edits
cannot rebuild an unresolved issued request. The addressed variants require the
URI repository to match the exact publishing DID. The strict unaddressed variants
reject an added URI, and only issued carries the payload.

The implementation extracts those existing common fields into
`publicationBaseSchema`, reused by the unchanged preview response. This adds no
Jazz table or independent address copy. The existing private link store retains
reservations and cleanup addresses. Requiring the payload in this union does not
itself persist write-ahead evidence or provide consent/grant admission. Durable
native Jazz acceptance and XState ownership/settlement must still be implemented
and qualified before sending a PDS request. Recovery must inspect the PDS before
retrying an uncertain write; the shape alone is not authority for replay.
Unpublishing, retained-address restoration and conflict pauses still need their
reviewed lifecycle extensions; these four variants cover only first publication.

### Approved native publication storage — 2026-11-17

The user approved evolving the existing `publicationLinks` storage into
`publications` after reviewing this concrete shape and its explanation:

```ts
publications: s.table(
  {
    libraryId: s.uuid(),
    highlightId: s.uuid().optional(),
    noteId: s.uuid().optional(),
    publishingDid: s.string(),
    lifecycle: s.json(publicationLifecycleSchema)
  },
  {
    library: s.rel('libraries', 'libraryId'),
    highlight: s.rel('highlights', 'highlightId'),
    note: s.rel('notes', 'noteId')
  }
)
```

`publicationLifecycleSchema` is the previously approved union's state-specific
fields only. The native binding columns are stored once, with exactly one source
FK, and reconstructed into the unchanged flattened `publicationSchema` at the
domain boundary. Whole-record validation checks that an addressed lifecycle's
repository DID matches `publishingDid`. Backend-only transitions own uniqueness,
ownership, active-source eligibility and accepted-content matching in native
serializable transactions. All ordinary client writes remain denied.

Jazz supplies identity, timestamps and accepted history. No custom revision or
attempt graph is added. Issued payloads are saved before any future dispatch and
remain in accepted native history after the current row advances to published.
The persistence capability requires its trusted backend caller to supply only
actually confirmed published outcomes. It does not issue or reconcile PDS writes.
New first-publication transitions for Highlights remain gated on source evidence.

### Approved authorization scope — 2026-11-17

The user approved this shape and the scoped auth-plugin extension needed to
request different scopes for identity sign-in and publication:

```ts
const authorizationScopeSchema = z
  .enum(['atproto', 'atproto repo:at.margin.note'])
  .default('atproto')
```

The broader choice permits create/update/delete of Margin notes only. Client
metadata declares the maximum permissions; ordinary sign-in explicitly requests
identity alone. Clipper validates this enum before provider I/O, and the existing
OAuth SDK enforces the declared ceiling. Actual grants belong to the provider's
OAuth session, not configuration or linked-account metadata. No additional Jazz
model, public Lexicon or token store is introduced by this authorization choice.

### Approved first-publication PDS request — 2026-11-17

The user approved this request body for `com.atproto.repo.putRecord`:

```ts
const tidSchema = z
  .string()
  .regex(/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/)

const firstPublicationWriteSchema = z.strictObject({
  repo: publicationBaseSchema.shape.publishingDid,
  collection: z.literal('at.margin.note'),
  rkey: tidSchema,
  record: marginRecordSchema,
  swapRecord: z.null()
})
```

Implementation additionally applies `.length(13)` to enforce the approved exact
TID length even when JavaScript's `$` anchor could accept a final line break.
The repository, key and record are derived together from the retained `issued`
Publication. Explicit null is mandatory; the body cannot omit the absence guard
or replace it with a previous-record CID. No caller override fields are admitted.
The existing generic record-URI reader remains broad enough for retained/imported
addresses, while this first-write contract requires Margin's TID key syntax.

This is request preparation only. It neither establishes native acceptance nor
authorizes dispatch, confirms a PDS outcome or permits replay after uncertainty.
The future publisher must supply those observations. No Jazz model, TID generator,
dependency, product wording or live PDS write is added by this contract.

### Approved PDS record observation — 2026-11-17

After reviewing this response shape and the dependency's origin, the user approved
using the already-resolved `@atcute/lexicons@2.1.1` as a direct Clipper dependency:

```ts
import { isCid } from '@atcute/lexicons/syntax'

const pdsRecordSchema = z.object({
  uri: atRecordUriSchema,
  cid: z.string().refine(isCid).optional(),
  value: z.record(z.string(), z.json())
})
```

This reads the complete remote JSON record instead of applying the narrow owned
Margin serializer. CID remains optional as permitted by `getRecord`; a record
without a CID is still an existing record, not absence. `isCid` checks syntax,
not whether that CID matches the supplied content. Future conditional updates
must establish their own required version evidence.

The reader requires the exact retained URI and refuses any parse that changes
the remote value. In particular, Zod strips `__proto__` keys; such observations
are refused rather than exposed with missing metadata. Ordinary unknown nested
fields, foreign content and metadata are retained. No Jazz fields, lifecycle
variants, live PDS read/write or public Lexicon are introduced. The lockfile only
adds the existing version to Clipper's importer; no package versions change.

### Approved explicit PDS read result — 2026-11-17

The user rejected a nullable result and approved this explicit alternative:

```ts
const pdsReadResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('found'),
    record: pdsRecordSchema
  }),
  z.strictObject({
    status: z.literal('notFound'),
    uri: atRecordUriSchema
  })
])
```

This is a transient read observation, with no Jazz fields. found preserves the
full reviewed record response; notFound identifies the retained address that the
PDS reported as unavailable. The reference PDS also reports RecordNotFound for
takedowns, so this does not establish deletion/absence or authorize recreation.
Network, malformed-response, authentication, timeout, cancellation and scope-loss
failures stay on XState error paths. Only a named JSON RecordNotFound response on
400/404 produces notFound. The SDK session remains owned by the existing auth host;
the finite child owns request/body lifetime and emits one terminal observation.

### Earlier model review findings

The authenticated request endpoint now reuses the approved `publicationBaseSchema`
directly as its input and returns the approved `requested` Publication after Jazz
acceptance. It adds no data model or stored fields. Its transient authentication
facts are extracted from the existing preview owner for reuse. UI copy, offline
Publish interaction, actual permission upgrade and PDS dispatch remain unfinished.

1. Define and qualify text normalization and DOM/code-point/UTF-16 conversion.
   In particular, exporting source-page positions later requires either the
   original normalized text or conversion evidence retained while it is available;
   native UTF-16 offsets alone are insufficient. The approved
   `sourceCodePointPosition` retains that conversion result; its capture and
   publication use still need qualification.
2. Review server-enforced ownership, parent alternatives, anchor immutability,
   accepted-source eligibility and concurrent Note creation.
3. Design native edit integration, oversized-input recovery, offline restart and
   rejected/pending-write handling without another version graph.
4. Model grouped deletion/Undo and restoration-data custody with account scopes,
   settlement and retained public removal duties.
5. Present publication bookkeeping shapes for approval before establishing
   schemas. Finalize immutable issued payload/reconciliation
   evidence and verify exact Jazz acceptance APIs.
6. Review worker/statechart ownership and implementation before its test stage,
   following current project approval rules. Obtain separate approval for any new
   catalog strings, dependencies or hosted changes.

The installed alpha.60 declarations confirm native text merging, `editedFrom`,
history, soft delete/restore and text-range APIs. The original model review did not
establish runtime results; subsequent implementation evidence is recorded below.


## Working reader implementation

The user subsequently authorized proceeding with best judgment to produce a working
implementation instead of continuing type-by-type approvals. This authorizes the
local implementation and necessary qualification within this task. Existing copy
and dependencies are reused. Public PDS writes remain outside this initial reader
slice; no real grant, schema publication or hosted mutation is performed.

The reader slice implements a worker-owned annotation child of the existing library.
Its parallel regions own command admission/drain, scoped native subscriptions,
queued prepare/transaction/settlement and localized feedback. The existing DLF
transaction bridge owns acquisition, staging, commit, rollback and local durability.
Source/identity changes refuse new admission; issued writes stay bound to their
original resources. Unresolved settlement blocks clean shutdown and automatic replay.
Reader navigation changes the observation scope without retargeting admitted edits.

The UI owns only DOM measurement, CSS Highlight ranges and native text-field effects.
The worker owns normalization, hashing, native Jazz range capture/resolution, bounds,
parent eligibility, subscriptions and ready-to-render projections. Native textarea
synchronization uses the supported Jazz adapter through DUI's optional element binding.
Global receipt observation remains distinct from local durability. Original source
clipping and PDS publication are subsequent slices, not implemented claims.

Native range JSON uses schema validation. Nullable JSON columns must explicitly allow
JSON null in their nested schema as well as declaring a nullable Jazz column. Native
restore is admitted through the table's update permissions, with owner/parent checks.

Legacy revision storage remains for historical fixtures and compatibility, but the new
reader annotation path does not read or write that graph. It writes native Note text.

Reader normalization converts CRLF and CR to LF without collapsing whitespace or
changing Unicode. SHA-256 covers the normalized UTF-8 bytes. Native ranges use
normalized UTF-16 offsets; the worker maps resolved positions back to the measured
DOM's original UTF-16 offsets for painting. Unknown hashes or ambiguous ranges keep
their quotation and notes accessible without painting an approximate location.

Current bounds are 100 visible highlights and 20 document notes per reader query.
Local creation admits one note per parent. Simultaneous independent offline
creations are retained as separate notes; this slice does not implement a user
reconciliation workflow or claim a global uniqueness guarantee. Native history is
available through Jazz but has no new history UI. Following the reader demo, the
user requested that removing a highlight show no Restore option. The reader no
longer exposes that action; Jazz's native soft-delete/restore capability remains.

## Highlight sharing MVP (2026-11-17)

The sharing flow now accepts the existing highlight source alternative, with or
without one attached note, alongside document notes. It reuses the approved
Publication union, native Jazz history and Margin `at.margin.note` projection.
This slice adds no stored fields, dependencies, public lexicons or product copy.

The backend fetches the original public source through the bounded capture gateway
and parses its DOM text in the existing isolated Node worker, before Readability
or reader transformations. Source normalization converts CRLF/CR to LF and leaves
other whitespace and Unicode intact. Scripts, styles, templates and explicitly
hidden content are excluded. A missing or repeated exact quotation is unavailable
for this MVP. A unique match supplies an ephemeral source anchor for the existing
projection; the saved reader anchor is unchanged. Margin receives a
TextQuoteSelector with source context and no position selector. The issuance
transaction rechecks the accepted highlight, quotation and attached commentary
against the verified record before the existing conditional PDS write.

Preview, Publish, Unpublish and same-address republishing work for highlights.
Accepted native highlight deletion joins the existing library cleanup workflow;
it retains the publication address and removes the public record using the same
content/CID checks as document notes. Removing a private attached note alone does
not automatically update its published highlight. Automatic content-edit and
document Trash/restore synchronization remain deferred; Unpublish then Publish
reflects changed commentary.

Qualification: 1,039 unit/native tests and 31 component tests pass. The built
Chromium flow selects reader text, publishes a bare highlight, unpublishes it,
attaches a note, republishes at the same address, then deletes the highlight and
observes public cleanup. It also retains the existing two full offline browser
restarts and reconnect cleanup for a deleted document note. Provider, source and
PDS responses are synthetic; auth, Jazz, parser worker, application worker and UI
are real. No live grant upgrade, PDS mutation or deployment was performed.

### Live preview preflight and typing correction (2026-11-17)

With explicit user approval, PR #50 now has branch-only auth configuration with
an independent sensitive secret and its stable preview callback origin. Preview
deployment `dpl_5chP7165cyfJuyR4ZUN8LJD7nsyJ` serves `2af12aae`; its session and
client-metadata endpoints return HTTP 200 in the authenticated Vercel browser.
Cookie-free metadata and service-worker requests still redirect to Vercel login.
The public-access override was rejected by automatic approval review because it
has no automatic expiry. No override or live repository grant/write is claimed.

Actual Add link capture saved and extracted the public AT Protocol OAuth article.
Fast note entry then exposed a UI bug: unrelated worker snapshots repeated the
unchanged saved text, causing the text adapter to overwrite an in-flight edit.
The editor now derives the saved text as a primitive, so only changed column
values reach Jazz's existing adapter. No revision field or custom text merge is
added. A regression using the real SDK adapter fails before this correction and
passes afterward; all 32 component cases and four native annotation browser cases,
including sequential typing and reload persistence, pass.

### One sign-in for identity and publishing (2026-11-17)

The live preview completed real identity sign-in and reopened the private article
and note, but publishing then required another provider sign-in for Margin access.
The user rejected this two-step experience. This supersedes the earlier
identity-only default for Clipper: ordinary sign-in now requests
`atproto repo:at.margin.note` together. The shared OAuth plugin and Finance keep
their existing defaults. Publishing remains a separate explicit user action.

The worker retains the existing BEGIN → attempt creation → authorization →
redirect → callback confirmation lifecycle and its cancellation/drain rules.
Only the default requested scope changes in the worker and Clipper's server
validation. Existing narrower or reduced grants still require authorization;
grant checks at publication remain enforced. No stored model or product copy is
added. The live test stopped before any public record was created. The temporary
preview alias exception was revoked and cookie-free metadata again redirects to
Vercel login.

Qualification: all 39 focused OAuth and publication-permission cases pass,
including the ordinary worker request, the actual client/plugin/PAR default,
callback persistence across native backend restart, and rejection of insufficient
grants at publication. The shared plugin's identity-only default remains covered.
The combined first-sign-in scope has not yet been qualified with the live provider.

### Remove unused intermediate endpoints (2026-11-17)

The MVP UI calls Preview, Publish, Unpublish and deletion Cleanup. Its Publish
owner already checks the actual OAuth grant and persists requested intent before
issuance. The separate request-only and permission-observation routes have no
application callers and are removed along with their duplicate statecharts.
The publisher retains its existing publication lifecycle, native transaction ownership and
permission predicates. Relevant SDK, refresh, revocation, admission and
cancellation tests exercise the actual Publish handler instead. No data model,
product copy or dependency changes are needed.

The XState/Svelte follow-up uses the installed XState v6 documentation and Svelte
5 effect guidance. Publication routing returns context changes from the grant
completion transition instead of a separate choice state. Cleanup uses ordinary
conditional transitions when retaining selected work; choice states only route.
The note editor's DOM effect owns the native Jazz adapter and its teardown, with
a nested effect forwarding changed saved text. The component regression verifies
that detached input events cannot write after unmount, alongside unchanged-row
typing and accepted remote edits.

Qualification: 1,026 unit/native tests, 32 component tests and all four native
annotation browser tests pass. Focused publisher/SDK tests also pass after the
final transition refinement. Strict root/web/service-worker/extension checks,
lint, formatting, whitespace checks and the production build pass. The batch
removes 667 net production lines; the public/private annotation shapes are
unchanged. Hosted checks must run on the resulting commit.
