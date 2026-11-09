# Native AT Protocol loading research

**Researched**: 2026-11-09. **Scope**: read-only technical research; no publishing,
production changes, typography changes, or application implementation.

## Decision and evidence level

**Recommendation**: read the selected publication's public records directly from
its author's current PDS, normalize the supported Leaflet content into a local
read model, and render semantic Svelte components on the server. Neither Leaflet
HTML scraping, feed ingestion, a Leaflet iframe, nor Leaflet database access is
needed for public articles. This is supported by live public record/image reads
and current source inspection. A Svelte rendering proof is still implementation
work and has not been completed by this research.

Source inspection is pinned to Leaflet commit
[`600c7b5f1f7b31b66fb626c293cc104312a12caf`](https://github.com/hyperlink-academy/leaflet/tree/600c7b5f1f7b31b66fb626c293cc104312a12caf).
Source behavior need not exactly match every deployed service; live observations
below establish what was actually retrieved.

## Live read-only proof

Live reads were performed on 2026-11-09 at approximately 12:28 UTC (the successful
image response carried `Date: Mon, 09 Nov 2026 12:28:25 GMT`). The exact GET
endpoints below are reproducible without a session; pagination results and CIDs
can change when the owner edits its public repository.

The public Leaflet Lab Notes publication was used as an example, not assumed to
be Matt's target publication. No authentication or private endpoints were used.

1. [`https://lab.leaflet.pub/.well-known/site.standard.publication`](https://lab.leaflet.pub/.well-known/site.standard.publication) returned `at://did:plc:btxrwcaeyodrap5mnjw2fvmz/site.standard.publication/3lppk75kw7k26`.
2. [`com.atproto.identity.resolveHandle?handle=leaflet.pub`](https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=leaflet.pub) returned the same DID.
3. [The DID document](https://plc.directory/did:plc:btxrwcaeyodrap5mnjw2fvmz) claimed `at://leaflet.pub` and identified `https://chanterelle.us-west.host.bsky.network` as its PDS.
4. [Public publication getRecord](https://chanterelle.us-west.host.bsky.network/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Abtxrwcaeyodrap5mnjw2fvmz&collection=site.standard.publication&rkey=3lppk75kw7k26) returned a `site.standard.publication` named Leaflet Lab Notes, with `url: https://lab.leaflet.pub` and CID `bafyreienforblsiwcwbjsihxx75pkjtscqgihjfvvgv5i5qsiwtggql6zm`.
5. [Public listRecords with limit 2](https://chanterelle.us-west.host.bsky.network/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Abtxrwcaeyodrap5mnjw2fvmz&collection=site.standard.document&limit=2) returned actual article bodies and cursor `3mtz2mbkozs2c`. Following that cursor returned distinct next records and another cursor.
6. A separate `limit=100` scan returned 38 standard document records, of which 37 matched the exact Lab Notes publication URI. The remaining record demonstrates why filtering by owner DID alone is insufficient. The response still contained a cursor despite having fewer than 100 records; following it returned zero records and no cursor. Do not infer exhaustion from a short page alone.
7. An [image blob read](https://chanterelle.us-west.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Abtxrwcaeyodrap5mnjw2fvmz&cid=bafkreiethxtad6a254thukly6tjfehwahk3l6k3grxjeox6yp2qcsdlvtu) returned HTTP 200, `image/webp`, and 38,490 bytes matching the article's blob size. The response used attachment disposition; test browser image delivery in the application, or serve a validated same-origin image response rather than assuming all PDS headers suit inline presentation.

Representative records observed:

| Record key | Title | Record CID | Observed content |
| --- | --- | --- | --- |
| `3mwehnrqsf22g` | Back to School — Leaflet for Learning | `bafyreien26vv376xhdrfffcftsbkeghrv3cu3lpektz3snbn45ivxmk5lq` | One linear page; text, UTF-8 facets, links, headings, image/alt, lists, button |
| `3mtz2mbkozs2c` | Leaflet FAQ | `bafyreihyk75rlt7ul3ddaob4kpp3ljnbnboq3dxba4cxvifrxqwlbfomdu` | Fourteen linear pages; linked subpages, text/facets, lists, image, three iframe content blocks |

Both articles had `site` equal to the exact publication AT URI and `path` equal
to slash plus record key. The FAQ had `showInDiscover: false` while still being a
public PDS record: discover preferences are not an access-control policy and
should not be confused with draft/private status.

The inspected live collection had no `blobPages` records or membership delimiter
records. Those paths are confirmed by schemas/source, not by this live sample.
Temporary responses were saved outside the repository; full third-party article
bodies have not been copied into this repo.

## Identity, public reads, pagination, and filtering

Configure the publication's stable AT URI/DID, not just an account handle. For a
handle supplied during setup, resolve it and confirm the DID document's reverse
claim. Resolve the DID's current `#atproto_pds` service when reading; do not
permanently bind an account to a Bluesky PDS hostname. A handle change does not
change record identity; PDS migration can change the service endpoint. Periodic
resolution and retry after endpoint failures are appropriate. The official
[handle specification](https://atproto.com/specs/handle) and
[DID specification](https://atproto.com/specs/did) describe these checks.

Read publication metadata with `com.atproto.repo.getRecord`; enumerate the
selected owner's `site.standard.document` collection with
`com.atproto.repo.listRecords`, following opaque cursors through exhaustion.
Filter each document by exact `site` publication URI, then sort by parsed
`publishedAt` with a stable record-identity tie breaker. Collection order is not a
substitute for publication date, especially for backdated imports. Record keys
are stable identifiers; CIDs identify content versions.

The [listRecords schema](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/com/atproto/repo/listRecords.json)
specifies unauthenticated reads, a maximum limit of 100, opaque cursors, and
`uri`/`cid`/`value` results. Public
[getBlob](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/getBlob.json)
takes the owner's DID plus blob CID at that owner's PDS. Restrict server reads to
the configured owner/publication, validate resolved HTTPS endpoints and sizes,
and bound fetch time/recursion; record-controlled URLs should not become an
unrestricted server proxy.

## Current versus legacy Leaflet records

Current Leaflet does **not** guarantee a duplicate record in both namespaces.
[Collection selection](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/collectionHelpers.ts)
defaults new documents/publications to `site.standard.*` and preserves legacy
`pub.leaflet.*` collections for existing records. The
[publisher](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/publishLeaflet.ts)
writes the selected collection. Earlier generic descriptions of permanent dual
records should not drive this implementation.

For a new Open Thoughts publication, target standard records first. Add legacy
ingestion only if the actual target inventory needs it. Legacy documents put
`pages` and `publication` on the document; current
[standard documents](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/site/standard/document.json)
use `site`, `path`, `publishedAt`, and `content.$type = pub.leaflet.content`.
Leaflet's [normalization code](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/src/normalize.ts)
illustrates conversion, but its permissive type guards are not a replacement for
our validation at the network boundary. Do not deduplicate unrelated articles
just because their titles match.

## Pages, blobs, images, and native rendering

The [content schema](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/pub/leaflet/content.json)
supports inline linear/canvas pages or a JSON `blobPages` reference. When
`blobPages` is present, consumers must decode it and ignore the inline page
array, which can be empty or a stub. The schema caps that blob at 5 MB. The
[publisher's offload helper](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/offloadPagesToBlob.ts)
currently offloads inline pages above 100 KiB; referenced media are also retained
under `content.blobs` so PDS garbage collection does not lose them.

Use a discriminated block renderer with escaped text and safe URL handling.
Ignore source theme/font/text-size styling; semantic structure and source text
can be rendered using existing Delightful UI defaults without adding typography.
The [facet schema](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/pub/leaflet/richtext/facet.json)
uses UTF-8 byte offsets, **not** JavaScript UTF-16 string offsets. Split ranges
on byte boundaries, preserve overlapping semantic features, and validate ranges
before rendering. Test emoji, accented text, nested/overlapping facets, and
malformed ranges. Do not treat `plaintext` or authored HTML as trusted markup.

Proposed initial support matrix:

| Content | Native behavior |
| --- | --- |
| Text, header, quote, code, rule | Semantic paragraph/heading/blockquote/code/rule; no new typography CSS |
| Link, bold, italic, inline code, strike, underline, IDs | Validated semantic facets; stable safe anchors |
| Images and galleries | Resolve PDS CID, preserve supplied alt and dimensions; missing media has a meaningful fallback |
| Ordered/unordered lists and checklists | Recursive lists with supported mixed nesting; checklist state rendered read-only |
| Page links and linear subpages | Resolve by page ID within the same document, preserve navigation and stable anchors; avoid cycles |
| Buttons and website cards | Plain accessible links using safe targets and supplied labels |
| Mentions | Safe links to the referenced identity or document; resolve only as needed |
| Canvas, drawing, math, poll, signup, raw HTML, iframe, unknown blocks | Explicit source-link fallback until deliberately supported; never silently discard |

Schemas:
[linear pages](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/pub/leaflet/pages/linearDocument.json),
[lists](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/pub/leaflet/blocks/unorderedList.json),
[images](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/lexicons/pub/leaflet/blocks/image.json).
This matrix must be compared with the migrated archive, rather than promising
pixel-equivalent support for every evolving Leaflet editor feature.

## Restricted content

PDS records are public. Leaflet's current
[membership helpers](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/membership.ts)
truncate a publication article at the members-only delimiter before PDS
publication and store its full gated version privately. They also remove
unreachable subpages; gating the first page but exposing all subpages would leak
content. The reader must respect the delimiter even if older/malformed public
records contain more content. Do not load any private Leaflet source to fill in
missing gated text. A source link explains where the rest can be read. Full
native rendering is feasible for public articles; public records cannot provide
gated bodies, and should not.

## Canonical URLs and the approved native path

Owner decision recorded by the parent: primary native writing address is
`https://delightfullabs.com/open-thoughts/`. Stable article routes can append the
source record key, or use persisted slug aliases if desired; do not derive a
mutable route solely from the title. Keep native route, source AT URI, and Leaflet
reader URL as distinct fields.

[Standard.site](https://standard.site/) defines canonical article URLs by
combining publication `url` with document `path`; it also defines the publication
well-known endpoint and document `<link rel="site.standard.document">` tag.
Leaflet's [URL helper](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/getPublicationURL.ts)
likewise joins base URL plus path. Its
[article metadata](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28published%29/lish/%5Bdid%5D/%5Bpublication%5D/%5Brkey%5D/postPageMetadata.ts)
points canonical tags at the publication's declared URL and advertises feeds
under that URL. Merely setting our own canonical tag does not change upstream
record URLs, Leaflet's outbound links, feeds, or reader links.

Therefore preserve the approved native address, but verify Leaflet's supported
way of declaring an externally hosted subpath before changing publication
records. This is a technical integration issue to resolve, not a reason to ask
the owner to revisit the address. If Leaflet only accepts hosted domains in its
settings, source-reader URLs may temporarily differ from native canonical URLs;
that limitation must be documented rather than claiming a transparent
headless-CMS integration. No record settings were changed by this research.

## Remaining technical verification

- Build the semantic Svelte native-rendering proof using a public article and an image; no typography additions.
- Identify the actual target account/publication before deciding whether legacy record compatibility is needed.
- Exercise real `blobPages` plus member delimiter fixtures; the live public sample did not contain them.
- Confirm Leaflet's externally hosted publication URL/subpath support and preserve access to its own reader/social/authoring routes.
- Design complete-scan reconciliation and durable cache behavior separately; public reads and cursors alone do not provide a cross-page atomic snapshot.

These are concrete technical validation steps. Only the account/publication
choice inherently requires owner input if it cannot be found in connected
project context.

## Svelte renderer package evaluation (2026-11-09)

Evaluated the published `@standard-reader/renderer-svelte@0.4.0` and matching
core in an isolated Svelte SSR harness. Native unstyled SSR works, and snippets
can override links, frames, and unsupported blocks. Current release duplicates
text for overlapping facets, continues past member-only delimiters, and loses
Leaflet checklist state. Retain the current renderer pending upstream fixes;
see the [compatibility report](evaluations/standard-reader/README.md).

Owner decision after evaluation: accept these package constraints and adopt
0.4.0 without parser patches. This supersedes the initial retain-custom-renderer
recommendation above and the original custom supported-block matrix.
