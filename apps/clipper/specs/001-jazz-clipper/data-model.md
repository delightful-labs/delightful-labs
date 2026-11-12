# Clipper logical data model

**Updated**: 2026-11-12. Logical model for the full accepted product, not a claim that every row below exists. Native schemas and owner policies are implemented in `apps/web/src/lib/backend/jazz`; PR #19 now includes independent note entities, linked revisions and note-keyed recovery drafts. Highlight entities/workflows, the note editor and AT Protocol integration remain unimplemented. See tasks.md and the handoff for other implementation evidence.

## Identity and authorization

Every source-of-truth row carries or inherits an enforced `libraryId`/owner relation. The library belongs to one DLF/Jazz account. Every client read/write and native asset relationship must enforce the same owner server-side; UI filters are insufficient. Tags, annotations, snapshots and assets cannot reference another owner's rows. No public grants or collaborative roles are introduced.

## Records

| Record | Important fields | Relationships / invariants |
| --- | --- | --- |
| Library | ID = authenticated account UUID, immutable owner ID and bootstrap format 1 | One canonical root per account; idempotently ensure only this immutable payload. Empty replicas never trigger another identity or random root ID; mutable data/migrations are separate. |
| Document | ID, libraryId, optional url, readingProgress, resumePosition?, status, favorite, captured article metadata?, contentRepresentationId? | User-owned library item. Jazz `$createdAt` supplies its creation time. Progress is required, initially 0, bounded to 0–1. Captured article metadata and its optional immutable content representation live directly on the Document. Saved URL is optional for direct file uploads. |
| SourceIdentity | ID, libraryId, normalized accepted URL key, documentId, evidence kind/time, redirect target? | Preserve raw observed aliases separately. Revalidate shortening destinations. Duplicate reconciling must retain annotations and captures. |
| Representation | ID, documentId, kind source/reader, normalizationVersion, selectorVersion, textHash, textLengthCodePoints, native sanitized payload, heading/footnote metadata | A successful reader snapshot is fixed in MVP. Source representation may retain selectors/quote/provenance rather than a full duplicate raw page. No historical revision UI required. |
| Asset | ID, documentId, sourceURL, mediaType, byteCount, width/height?, content fingerprint when needed, native byte payload, processingVersion | Content-addressed only within owner scope; reference tracking prevents deleting bytes needed by another retained record. |
| Highlight (annotation) | ID, libraryId, documentId, originalQuote, createdAt, deletedAt?, defaultColor? | Independent entity with its own stable identity and explicit Document association. One color in MVP, optional metadata supports future colors. One logical annotation can have multiple rendered spans and representations. Overlaps never merge. No resize command. |
| Anchor | ID, annotationId, contentRepresentationId, selectors, normalizationVersion, status resolved/ambiguous/unresolved, derivedFrom? | W3C-compatible quote exact/prefix/suffix and code-point start/end; optional internal DOM path. Original selectors immutable. Deriving a reader anchor does not overwrite source evidence. No candidate repair workflow. |
| Note | ID, libraryId, documentId, optional highlight link, content, editedAt, deletedAt? | Independent entity with its own stable identity. Document association is a relationship rather than the note's identity. One active editable note per parent remains a cardinality rule; concurrent creation needs separate reconciliation. Plain text, linkification at view. Retain conflicting text until reconciled rather than last-write overwrite loss. |
| NoteRevision | ID, libraryId, noteId, text, causal parent revision IDs, editedAt | Current immutable full-text conflict storage. Content belongs to an independently identified note; revision IDs and timestamps cannot replace the note's identity. Concurrent heads are retained until explicitly reconciled. |
| Tag | ID, libraryId, displayName, normalizedKey, deletedAt? | Trim outer whitespace; case-insensitive identity. Proposed Unicode NFC + locale-independent fold/version; implementation must qualify non-ASCII collisions before schema lock. Rename collision fails clearly rather than silently merge. |
| TagAssignment | ID, tagId, targetType article/highlight, targetId | Unique relation, no inherited parent/child assignment. Global deletion removes/hides assignments including Trash. |
| ReadingPosition | ID, account/document/representation/device, logical locator, quote/context?, lastInteractionAt, operationId, furthestLocator? | Per-device observations prevent sync write storms. Pick latest observed timestamp with deterministic operation-ID tie-breaker; clocks are imperfect. Apply only when opening, never jump an active article. Owned by the Document; its format-specific locator references the attachment representation. Initially absent. Progress and last location are separate. |
| ReaderPreferences | ID, account, theme Light/Dark/System, fontFamily, fontSize, lineSpacing, readingWidth | Shared preferences with local cached value. No named presets, width matching, custom font upload, or per-device overrides. |


## Accepted Document model (2026-11-12)

This decision supersedes the earlier Article-as-primary-object and independent immutable-Document library-item descriptions. It is a target model; the native schema and migration are not implemented by this specification update.

```ts
type ReadingStatus = 'inbox' | 'later' | 'archive'

type DocumentStatus =
  | { status: ReadingStatus }
  | {
      status: 'trashed'
      previousStatus: ReadingStatus
    }

type Document = DocumentStatus & {
  id: string
  libraryId: string
  url: string | null
  readingProgress: number // Required, initially 0, bounded to 0–1
  resumePosition: ReadingPosition | null // User-owned; initially null
  favorite: boolean
  title: string | null
  author: string | null
  publishedAt: string | null
  siteName: string | null
  language: string | null
  finalUrl: string | null
  canonicalUrl: string | null // Only when verified
  contentRepresentationId: string | null
}
```

`contentRepresentationId`, when present, points directly to the immutable captured content bundle. Its UUID is distinct from the user-owned Document ID because they identify different records. PDF/EPUB locator design and ingestion remain outside MVP.

Saving creates the Document with progress 0 in the same owned transaction; all capture entry points must satisfy this invariant. Jazz `$createdAt` records when the Document was created. Content attachment, failure, retry and re-clipping preserve Document identity and existing progress. Required progress propagates to reader/library render contracts without optional fields or consumer `?? 0` defaults. A missing value on a known Document is an invariant failure, not a display fallback. Resume location may move backward while furthest progress remains unchanged.

A trashed Document requires previousStatus. Non-trashed variants omit it; restore returns to previousStatus and removes the Trash-only field. This union replaces separate logical Trash/status flags while keeping the user's previous reading status recoverable.

Notes and highlights associate with the Document; anchors reference the attachment representation. The library lists Documents only, not independent attachment/content rows. Multiple formats of a book are separate Documents under this single-attachment decision. Source-identity deduplication must preserve user records and annotations; exact conversion of existing shared-content relationships remains a migration design gate.

Migration must preserve existing progress from reader history, resume evidence, identities/links, organization and annotations; initialize genuinely unread items to 0; and account for legacy document-only items. A schema default of 0 alone is insufficient for already-read items. Jazz `$createdAt` records the creation time of each new Document row. Qualify native migration, permissions, concurrent offline progress reconciliation and restart/reconnect behavior before claiming this target implemented. No schema migration, ownership relaxation or data reset is authorized by this documentation change.

### Reading-progress cleanup plan (implementation deferred)

The Document model above replaces the current scattered progress handling. This is a specification for subsequent implementation, not a request to restore the discarded progress patch.

- **Single state owner:** the worker-owned reader experience machine owns live progress updates and persistence. The persisted Document is the authoritative user record. Retained reader observations may support reconciliation, but must not become a second independently mutable progress authority.
- **Initialize at creation:** all Document creation paths write required progress 0 in the creating transaction. Migration supplies preserved historical progress for existing records. Article/attachment constructors, collection projections and UI components must not synthesize initial values.
- **Canonical rules:** keep the bounded progress schema, measurement-to-progress calculation and furthest-progress reconciliation rules in the reader domain. Compose related Zod schemas from that canonical schema. A scrolling measurement and a final detach measurement use the same pure update calculation; their admission, validation, queueing, drain and write settlement remain explicit in the owning statechart. Removing duplicated calculation must not conceal workflow selection inside a helper.
- **Measurement boundary:** the UI viewport adapter measures DOM geometry and reports a location. The worker owns domain progress calculation and mutation decisions. Resume position remains Document-owned, representation-specific and initially absent; it is not replaced by a numeric percentage.
- **One stable key:** use Document ID for reading-state ownership and progress updates. Attachment/representation IDs identify content and locators, not substitute user-state owners. Remove the current implicit dependence on article content ID, document ID and snapshot ID being interchangeable.
- **Ready-to-render projections:** project required numeric progress into each visible Document row and a scalar on the available active-reader view. Remove the worker's one-entry progress-map reconstruction and the corresponding Svelte lookup. Library and reader must consume the same owner's state, including live admitted measurements before persistence settles. Such feedback must not claim local durability or remote acceptance.
- **Remove consumer policy:** eliminate repeated `?? 0` fallbacks, undefined guards, optional progress props, placeholder row values and progress augmentation in unrelated collection/search/organization layers. `Reader`, `ReaderView`, `ReaderToolbar`, list items and the progress component only pass/render required values. Percentage formatting/localized labels remain presentation. Unknown/unavailable Documents stay explicit unavailable states; missing progress on a known Document is an invariant failure.
- **Simplify existing code together:** review `reader/schema.ts`, `reader/anchors.ts`, `reader/viewport.ts`, `machines/reader/experience.ts`, `machines/capture/library.ts`, `capture/library-articles.ts`, `contracts/articles.ts`, `runtime/worker/views.ts`, `integrations/Reader.svelte` and reader/list components as one affected flow. Remove redundant progress maps/projections once the Document-backed replacement is qualified; retain observation history needed to preserve offline conflict semantics.

Acceptance must cover required progress at every creation boundary (including URL-only saves), preservation during attachment/retry, migration of already-read and unread records, identical library/reader progress, scrolling backward, final-position flush, stale account/attachment events, and permission failures. Prove furthest-progress reconciliation across concurrent offline devices; a local `Math.max` followed by an ordinary field write is not sufficient evidence. Retain local/remote/unknown-write settlement and full browser restart/offline/reconnect qualification. No PDF/EPUB reader or general content-refresh work is added to this cleanup.

## AT Protocol identity boundary

Research follow-up (2026-11-07): [AT Protocol highlights and notes research](../../docs/atproto-research.md)
compares public Lexicons, private Spaces, anchoring, offline reconciliation and DLF/backup ownership.
It consolidates accepted publication behavior and companion fields, with unapproved mechanics
kept separate. Jazz upgrade and backend hosting are being handled independently; this research
does not authorize implementation or migration.

AT Protocol support is confirmed product intent; the original planning conversation did not carry it into this specification. Notes and highlights therefore need their own records and identities, with explicit Document relationships, regardless of the eventual AT storage/publication choice. The Document must not be the only address through which an annotation can be retrieved. A note attached to a highlight has its own identity, not the highlight's identity.

AT Protocol addresses records with an AT URI containing repository identity, collection and record key. A version-specific strong reference additionally carries a CID; record address and content version are different concepts. See the official [data repository guide](https://atproto.com/guides/data-repos) and [AT URI specification](https://atproto.com/specs/at-uri-scheme). DLF owns shared identity integration and the broader cross-app AT Protocol boundary, starting with identity. Clipper domain IDs must remain independent of DIDs, provider subjects, AT record keys and content-version identifiers. No Lexicon namespace, record-key format, source-of-truth or publication lifecycle is selected here; those choices are not prerequisites for modeling independent local entities. A portable article reference also needs design because a private Jazz article ID alone is not an externally resolvable source reference.

PR #19 now implements independent `notes` and linked `noteRevisions`; `articleNoteRevisions` remains read-only legacy evidence, with an explicit preserving import operation. Recovery storage keeps old article-keyed drafts until an atomic, validated move to a particular note ID succeeds. The note editor must consume those migration capabilities before editing old content. Retaining full-text revision history versus another qualified conflict-safe text model remains an implementation decision to review; AT Protocol integration does not require exporting the internal revision graph. Existing private-library behavior remains intact. Clipper must consume DLF identity capabilities rather than adding its own account-linking system; future shared transport/publication behavior can be designed separately without using the article or current account-provider identity as the note/highlight record identity.

## Device-local records (not synced authority)

The accepted target creates a Document immediately for Add Link and optionally attaches supplied Article content through the same operation. Current native `articles` and immutable `contentRepresentations` tables implement an older naming/ownership split; they are not the target logical entities. Snapshots/assets remain content storage records. A dedicated worker processes missing-content articles serially. No separate intake graph or IndexedDB journal is selected. See [durable-capture-design.md](durable-capture-design.md). Pre-session external intake remains a distinct future boundary.

- Availability ledger keyed by account/representation/asset: native row availability and local write settlement; derive offline-complete only when required native text/byte values are locally available.
- Chromium source references: at most eight small Chrome-storage records containing version/ID, tab/document, URL and ready/issued phase, with account ID on issued markers. They hold no article HTML or credentials and are not a second article database. The trusted offscreen runtime waits for identity, serializes saves and never replays issued references. Pre-session mobile-share handoff remains a separate future qualification; never silently attach old-account work to a new account.
- Worker search checkpoint: account, schema/index versions, source sequence/hash and serialized index. Discard/rebuild on mismatch; maintain separate default/Trash scopes without losing retained text.
- Note drafts use independent note identity, local edit sequence, draft text, base revision IDs and exact durable acknowledgment. Parent association comes from the note entity. The old article-keyed store is retained until validated atomic recovery to an explicit note ID completes. Never clear on an unconfirmed persistence result.
- Same-profile web capture uses Web Locks; Chromium extension launch/save queues and offscreen lifetime are implemented. Future asset coordination still needs qualification. A local lock/lease is not a global lock, and does not authorize replay of an uncertain native operation. No separate durable checkpoint store is selected for PWA capture.

## State and durability rules

A document is link-only when no usable text exists, partial when captured content is known/suspected incomplete, and readable when text is locally persisted. Asset completeness is separate. A failed image does not downgrade readable text to failed capture. Schema availability, local persistence, remote acceptance and runtime lifecycle are separate dimensions, not duplicate booleans that reconstruct actor state.

Write confirmation uses alpha.59 local durability waits. Global acceptance may be pending offline; rejection later must produce recoverable status and retain note drafts. A transaction groups related logical rows where supported; external asset acquisition is staged outside it. Local commit outcome uncertainty is reconciled by stable operation IDs before retry, not replayed blindly.

Concurrent duplicate captures may temporarily produce provisional records offline. On sync, a deterministic canonical identity winner (stable document ID ordering under verified identity key) gathers aliases/annotations without erasing source snapshots. Recheck invariants at writes and preserve unresolved merges for retry. Exact server constraints/transaction support must be qualified before this algorithm is considered implementation-ready.

## Anchor normalization contract

`clipper-text-v1`: visible readable text nodes in document order; exclude reader controls and hidden/non-content nodes; normalize line endings; decode HTML entities through inert parse; define deterministic separators for paragraph/heading/list boundaries and `<br>`; preserve internal text meaning. Each separator maps to a boundary in the final sanitized DOM. W3C offsets count Unicode code points; conversion maps to DOM UTF-16 offsets without splitting surrogate pairs/graphemes. Rules require fixture proof before v1 freeze.

Source-page capture has its own projection and scope. Its offsets are never applied blindly to the extracted projection. Match exact quote/context against target projection, validate unique result, persist derived anchor under target representation. Multiple plausible results → ambiguous; no exact reliable result → unresolved. Keep saved quote and notes readable in either outcome.

## Trash, permanent delete, and Undo

Trash preserves the full document graph with prior status; default searches filter the graph by parent document lifecycle. Restore clears Trash and returns prior status, tags, favorite and position. No expiry. An attempted duplicate of trashed source offers Restore, never auto-restores.

Permanent deletion requires confirmation naming article plus annotations; commit a durable owner-scoped deletion marker first, hide content immediately, then clean dependent rows/assets/index entries idempotently. Offline devices must honor the marker on reconnect instead of resurrecting data. Server/backup erasure guarantees are not claimed without provider policy verification.

Only highlight-delete Undo is in MVP. Keep a local bounded operation record containing highlight ID, note and tag/anchor references. Proposed 10-second availability, accessible dismiss/Undo, expiry does not delete unrelated annotations. Restoration preserves identities; intervening permanent parent deletion or authorization loss prevents restoration with a clear outcome. Broad tag/status/bulk Undo remains deferred.

## Partial capture retry boundary

Retry may enrich an incomplete initial capture under its existing document. Stage candidate text, verify durability and evaluate whether annotations already depend on the partial representation. Without annotations, replace the incomplete provisional representation before marking capture complete. With annotations, preserve their original quote/context and representation; never discard it while deriving the completed representation. This narrow initial-capture repair must not become general refresh/history UI; if implementation cannot maintain it safely, retain partial content and expose failure instead of corrupting annotations. This interaction remains an explicit proof case.

Native storage boundary (PR #5): Jazz owns byte representation, transfer and storage integrity. Clipper owns bounded domain validation, parent relationships, publication and uncertain-operation reconciliation. The initial publication transaction inserts snapshot, asset and document atomically after its operation journal; no application-level blob parts or compression protocol is selected.
