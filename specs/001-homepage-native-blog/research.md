# Technical Research: Native Open Thoughts on Delightful Labs

**Date**: 2026-11-09
**Status**: Native foundation and durable Preview proofs complete; archive inputs preserved. Hosted external canonical/editing proof, editable import, feeds/redirects and production cutover remain.
**Related specification**: [spec.md](spec.md)

## Recorded owner decision

The primary blog address is `https://delightfullabs.com/open-thoughts/`, with
individual native article pages underneath it. The old blog subdomain's article
URLs will permanently redirect to their corresponding native pages. This is a
settled decision and is recorded in the spec's Clarifications section.

Typography remains entirely owner-owned. Initial research was read-only; later implementation and Preview proofs are recorded in [verification.md](verification.md). Current canonical findings and the remaining hosted proof are in [canonical-proof.md](canonical-proof.md).

## Research artifacts and confidence

| Area | Evidence | Detailed findings |
| --- | --- | --- |
| Native AT Protocol reading | Live unauthenticated identity, publication, document, cursor, filtering, and image reads; pinned Leaflet source | [Native loading](research-native-atproto.md) |
| Existing archive and import | Six live articles, feed/sitemap/asset reads, published/unpublished export comparison, pinned editor/import source | [Migration](research-migration.md) |
| Svelte/Delightful UI and Vercel | Clean local UI source, official platform documentation, read-only Netlify project inspection and public DNS | [Hosting](research-hosting.md) |

Source inspection is not proof that the hosted editor supports every configuration.
Native Svelte rendering and durable Preview snapshots are now verified separately
in verification.md. Authenticated authoring and production migration remain
unproved; those boundaries are tracked explicitly.

## Decision: use public AT Protocol records directly

**Recommendation**: resolve the publication's stable owner DID to its current PDS,
retrieve its publication record, enumerate document records with all cursors,
filter by exact publication URI, normalize supported bodies, and server-render
them in SvelteKit with Delightful UI defaults.

**Rationale**: A live scan of Leaflet Lab Notes returned 38 records, 37 belonging
to that publication, plus real bodies and a successfully retrieved image. This
proves public native data access without a Leaflet account session. It also
demonstrates why filtering by author alone is insufficient. A short page still
had a cursor; completion must follow cursors to exhaustion.

**Alternatives considered**: Feeds, iframes, HTML scraping, and private Leaflet
database access are unnecessary for public article reading and do not satisfy
the selected native-ingestion requirement. No public appview dependency is needed
for the initial archive size. See [live evidence and schemas](research-native-atproto.md).

## Decision: use the accepted Standard Reader package

**Owner decision**: use exact `@standard-reader/renderer-svelte@0.4.0` and matching
core with their evaluated constraints. Keep `site.standard.document` ingestion,
Leaflet inline/blob hydration, native server rendering, safe links and explicit
source fallbacks. Do not rebuild the package's parser or adopt Leaflet theme and
font settings. Legacy record support is needed only if actual source data requires it.

**Rationale**: the owner accepted the package's rendering, facet, checklist,
member-delimiter, and anchor limitations before starting to publish. This
supersedes the earlier custom-renderer recommendation. Public records are the
input boundary; the package's member delimiters are not an access-control layer.

The original schema research remains in [native-loading research](research-native-atproto.md).
The accepted package evaluation is in
[evaluations/standard-reader/README.md](evaluations/standard-reader/README.md).

## Decision: preserve a native canonical address and prove Leaflet configuration

**Recommendation**: preserve the owner's chosen main-site path. Keep native
route, AT record identity, and explicit Leaflet reader URL separate. For the six
migrated articles, retain their existing human-readable slugs in the native URL
map; also support the publication-record-derived paths when they differ.

**Rationale**: Standard.site and Leaflet construct public article URLs from the
publication URL and document path. Leaflet's source canonical, feeds, and social
links use that URL too. Merely adding native self-canonical tags leaves duplicate
canonical signals if Leaflet continues to declare its own source URL.

Current [Standard.site verification documentation](https://standard.site/docs/verification)
explicitly supports subpath publications. For this one, serve
`https://delightfullabs.com/.well-known/site.standard.publication/open-thoughts`,
returning the publication AT URI, and document link tags on each article. That
protocol endpoint is resolved by documentation, not an owner question.

**Integration proof gate**: Leaflet's normal custom-domain UI assigns a whole
hostname to Leaflet's hosting project. It is not a verified way to attach a
separately hosted subpath. The record helper can represent the desired URL, but
the hosted setting/edit/publish workflow must be proven in a test publication
before production record changes. Staff support may be needed. Do not assign the
main website hostname to Leaflet's hosting project to work around this.

**Alternatives considered**: The old subdomain as primary was declined by the
owner. A temporary split URL is acceptable for a development proof but is not a
completed production canonical solution. Details: [migration research](research-migration.md).

## Decision: migrate the known public archive through editable drafts

**Recommendation**: use ordinary Leaflet Markdown paste, original publication
dates, and quiet publishing for the six known public posts. Validate one article
with its image before migrating the rest. Preserve the eight uncollected export
entries as unpublished inputs. Keep source files, original image, provenance,
and stable URL mappings in this repository.

**Rationale**: The inspected bulk importer is admin-only and has no general
Markdown option. The ordinary editor's paste/date/quiet paths exist in source;
actual editor migration remains to be tested. A raw PDS write alone does not
establish that Leaflet can edit the imported article.

**Alternatives considered**: Staff-assisted bulk import is possible only after
confirming access; it is unnecessary to assume that dependency for six posts.
Details and pinned implementation references: [migration research](research-migration.md).

## Decision: generate the replacement feeds from native article data

**Recommendation**: generate feeds from the same normalized AT records used by
the native reader. Redirect the old feed path to a native feed. Preserve the six
old opaque Atom entry IDs where useful for subscription continuity while fixing
their article links; use stable source identities for new articles.

**Rationale**: The live feed has template title/author metadata and `example.com`
entry URLs. Blindly proxying it carries those defects forward. Feed generation
does not change AT Protocol as the ingestion source.

**Alternatives considered**: Proxying Leaflet feeds depends on publication URL
configuration and can form a circular dependency if native URLs are advertised
upstream. Native generation is clearer. Actual feed-reader behavior requires a
later continuity check. Evidence: [live feed inventory](research-migration.md).

## Decision: use SvelteKit on Vercel with explicit freshness handling

**Recommendation**: use the explicit Vercel adapter and server-side record loading.
Start with a five-minute request-driven refresh interval, synchronous refresh on
stale reads, and a durable last-successful snapshot. Vercel Runtime Cache can
accelerate this; it cannot guarantee retention by itself. Private Vercel Blob is now implemented and provisioned for Preview; cross-deployment persistence and conditional-write behavior are verified. Production enablement remains a cutover step.

**Rationale**: This is enough for the small public archive without an always-on
consumer. Preserve verification timestamps across cache fills, fail partial scans
without confirming deletions, and never resurrect removed content from stale
snapshots. Isolate preview writes from production.

For consistent deletion reconciliation, a proposed read strategy is to bracket
the paginated scan with `com.atproto.sync.getLatestCommit` on the same PDS. That
[official unauthenticated endpoint](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/getLatestCommit.json)
returns repository CID and revision. If the commit changes during enumeration,
retry a bounded number of times and retain the prior snapshot rather than infer
deletion from a mixed scan. This is a design recommendation, not a tested
cross-page snapshot guarantee; validate endpoint consistency and concurrency in
the integration proof.

**Alternatives considered**: Build-time-only content needs rebuilds; ISR-only
handling does not define upstream freshness or durable fallback. Scheduled
refresh is optional if updates must occur with no readers; current Vercel plan
limits and jitter need checking before making scheduling promises.

Details and sources: [hosting and freshness research](research-hosting.md).

## Decision: migrate the two Netlify hosts together, without moving the DNS zone

**Recommendation**: stage the combined Vercel site, attach the apex and legacy
blog hostname at cutover, and use host-specific per-resource redirects. Keep
Netlify deploys and prior DNS values available for rollback. Change only the
necessary web records; preserve email and unrelated application records.

**Rationale**: Both current public sites are verified Netlify projects. Vercel
supports SvelteKit, Git previews, custom domains, and host-conditioned redirects.
The old image URLs include generated names, not just the source `chart.png`.

**Alternatives considered**: Moving all nameservers is unnecessary; a blanket
redirect loses per-article destinations. Details: [hosting](research-hosting.md)
and [exact URL/asset inventory](research-migration.md).

## Remaining work, separated by who can resolve it

### Owner inputs to ask one at a time

1. **Answered**: A new Leaflet publication is needed under `@derocher.me`
   (owner-confirmed spelling correction). Public handle resolution returned
   `did:plc:226m7t4kp7d7sg2qsdresypm` on 2026-11-09; its DID document confirmed
   `at://derocher.me` and current PDS `https://morel.us-east.host.bsky.network`.
   Resolve that service dynamically. The owner has since created Open Thoughts at `https://open-thoughts.leaflet.pub`, verified as `at://did:plc:226m7t4kp7d7sg2qsdresypm/site.standard.publication/3mzv6a2yk522y`. The earlier
   `@derocer.me` spelling failed resolution and is superseded.
2. **Deferred by the owner**: Homepage content, positioning, and project selection
   will be addressed after the basic site is set up. Do not ask these questions
   now, invent content, or automatically reuse the old studio copy. Foundation
   work requires only the site shell and necessary functional navigation. Existing
   blog content remains migration input, not a request for new editorial content.

Other preferences should be raised only if actual research or implementation
reveals a meaningful tradeoff. Keep proposed cache timings as documented defaults
rather than asking the owner to choose infrastructure without evidence.

### Technical proof gates; do not turn these into preference questions

- Native Svelte rendering from actual target records, including image delivery,
  rich text, source fallbacks, and readable initial HTML; no typography changes.
- Blob-backed pages, member boundaries, error cases, stable identity, complete
  enumeration, concurrent updates, deletions, and durable-snapshot consistency.
- Leaflet external canonical subpath configuration and publishing/editing
  persistence without giving Leaflet ownership of the main hostname.
- One editable archive migration with original date, image, anchors, and no
  announcements, followed by a complete content comparison.
- Native feed continuity and the complete legacy URL map in a staged deployment.

### Operational inputs needed later, not blockers to this research

- Vercel project/team connection and Preview store setup are complete; see verification.md. Production configuration and approved domain cutover remain pending.
- DNS edit access, isolated preview/production configuration, and any snapshot
  store setup before deployment.

The foundation now has an [implementation plan](plan.md), [data model](data-model.md),
[reader contracts](contracts/reader.md), [validation guide](quickstart.md), and
[task tracking](tasks.md). A native Svelte public-source proof is implemented and
verified; see [verification.md](verification.md). Publication mutation, hosted
canonical settings, archive import and production cutover remain separate gates.
Durable caching is verified in Preview. Preserved public archive inputs are in
the old blog repository (the temporary local migration archive was removed after import).
