# Annotation model review

Status: approved local annotation shapes now have a working saved-reader
implementation. Public sidecar schemas and publication remain unfinished. The
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

Follow Margin for the shared core and leave `at.margin.note` unchanged. Use a
Clipper-controlled sidecar for additional selectors/representation evidence and
the separately addressable entity relationships. Link companions to the Margin
record using URI/CID as previously approved. Reuse W3C names and semantics.

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

### Approved companion fields

The user previously approved the public relationship shapes below:

- Common companion base: required `subject` using the standard
  `com.atproto.repo.strongRef` (record URI and content CID), and required `article`
  using Clipper's HTTP/HTTPS source URL validator. Article must match the source
  in the referenced Margin record; it is not another public article record.
- Highlight companion: the common base plus optional `note`, a record-level AT
  URI of the current published attached Note's companion.
- Note companion: the common base plus optional `highlight`, a record-level AT
  URI of the parent Highlight companion. Article-level Notes omit this link.
- The AT record URI is each companion's public identity. Add no duplicate ID,
  private Jazz identities, quotation or commentary. Reciprocal links use stable
  URIs; subject uses URI/CID to identify the matching common-content version.

The user also approved optional `positionAnchor` on the Highlight companion:

```ts
const sourcePositionAnchorSchema = z.object({
  normalizationVersion: textRepresentationSchema.shape.normalizationVersion,
  textHash: textRepresentationSchema.shape.textHash,
  selector: textPositionSelectorSchema
})
```

Its source is the companion's article URI, with quote/context in the referenced
Margin version. Publish this only from verified source-page evidence using the
retained source code-point position. Reader offsets remain private to their reader
representation. This selects the position payload shape, not qualification of
normalization/hash reproduction by another consumer.

Namespace, keys, scheduling and publication evidence remain unselected.
Existing accepted publication policy
in [atproto.md](atproto.md) and [design-decisions.md](design-decisions.md) remains
binding; this review is not publication implementation or interoperability proof.

## Design and evidence identified during model review

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
5. Present each public sidecar type and publication bookkeeping shape for approval
   before establishing schemas. Finalize immutable issued payload/reconciliation
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
