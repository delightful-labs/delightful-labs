# Research: archive migration and canonical URLs

Researched 2026-11-09. Scope: read-only technical research; no content was
published, no publication records were changed, and no DNS/hosting changes were
made. Typography is outside this work.

## Evidence and limits

- Open Thoughts repository inspected at commit [`3017dd1244f874ba0bb9bbdc9ee79e49e30041a3`](https://github.com/delightful-labs/open-thoughts/tree/3017dd1244f874ba0bb9bbdc9ee79e49e30041a3).
- Leaflet source inspected at commit [`600c7b5f1f7b31b66fb626c293cc104312a12caf`](https://github.com/hyperlink-academy/leaflet/tree/600c7b5f1f7b31b66fb626c293cc104312a12caf).
- The live Open Thoughts homepage, sitemap, archive, tags page, feed, six article
  pages, and three generated image variants were fetched directly over HTTPS.
  All returned 200. These are actual live checks, distinct from source inspection.
- Leaflet's authenticated writer UI was not exercised and its hosted commit was
  not identified. UI behavior below is verified in source, not demonstrated in
  Matt's account. No migration import has been performed.

## Decision: retain native canonical URLs under the main site

**Owner decision**: the primary public writing address is
`https://delightfullabs.com/open-thoughts/`, with article pages below it. Old
`thoughts.delightfullabs.com` article URLs redirect directly to their new native
counterparts. Do not ask the owner to choose this again.

**Rationale**: this matches the requested integrated homepage and native reader.
Keep native route identity separate from Leaflet record keys; a small mapping can
preserve the six old human-readable slugs even if normal Leaflet publication
creates TID record keys. Preserve those mappings across edits.

**Alternatives considered**: keeping the old hostname as the public blog would
also be technically possible but the owner has chosen the main-site path.

## Finding: Leaflet does not expose a general Markdown bulk importer in inspected source

The import UI offers Ghost exports, Substack exports, and Offprint publications.
The `/admin/import` page checks an admin identity allowlist and deliberately
returns not-found for other identities. Import actions also run through admin
authorization. It is incorrect to assume Matt can invoke this importer from a
normal account, or that creating a Ghost-shaped export alone makes hosted import
available.

Sources:

- [Import route authorization](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28identity%29/admin/import/page.tsx)
- [Supported import sources](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28identity%29/admin/import/AdminImport.tsx)
- [Ghost import action](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/actions/admin/importGhost.ts)

### Available migration path for six posts

**Recommendation**: create ordinary editable Leaflet drafts using the editor's
Markdown/plaintext paste pipeline, then verify and publish with original dates
and quiet sharing. For six posts this avoids a dependency on staff-only tools.
This is a supported editor code path, not a tested automated import API.

- Plain text without clipboard HTML passes through `markdownToHtml`, then the
  block paste pipeline creates editor facts. Remove YAML frontmatter and supply
  the article title separately. Leaflet supports headings, emphasis, links,
  lists, quotations, code, and pasted images through these paths.
- For the image-containing article, upload the original `chart.png` rather than
  leave a relative `chart.png` URL pointing at the editor's host. The resulting
  native article should reference the published PDS blob, and old generated
  asset URLs must remain available independently.
- The publish UI contains a publication-date picker and accepts a supplied
  `publishedAt`. It offers **Post Quietly**, which disables email, Bluesky
  sharing, and Discover distribution. This is the appropriate archive setting;
  backdating by itself must not be assumed to suppress email.
- Keep every original Markdown file and image in the consolidated repo. Compare
  the draft and public record against that source before declaring migration
  complete. Do not rewrite article prose.

Sources:

- [Plaintext and Markdown paste](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/components/Blocks/TextBlock/useHandlePaste.ts)
- [Markdown parser](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/htmlMarkdownParsers.ts)
- [Paste pipeline](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/paste/README.md)
- [Publish date and sharing arguments](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28identity%29/%5Bleaflet_id%5D/publish/PublishPost.tsx)
- [Quiet-sharing behavior](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28identity%29/%5Bleaflet_id%5D/publish/ShareOptions.tsx)

**Alternative**: Leaflet staff can potentially use the existing Ghost importer
on prepared HTML and metadata. Its implementation creates editable draft facts,
links the draft to the publication, copies images, passes the original publish
date, explicitly suppresses email, and can preserve a valid slug as the record
key. This alternative requires confirmation from Leaflet staff and is not an
available self-service dependency in the current plan.

Sources: [Import/draft linkage and email suppression](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/import/importPost.ts),
[Ghost content conversion](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/ghostImport/ghostPostToLeaflet.ts).

**Rejected shortcut**: write article records directly to the PDS and call the
Leaflet migration finished. In inspected source, editable drafts, entities, and
publication-to-draft links exist in Leaflet's own storage and the publisher uses
them to update the record. A raw PDS write does not demonstrate that Leaflet can
edit that article. Native site reading and Leaflet editor integration are
different requirements.

## Finding: canonical publication URL is coupled to Leaflet links

Standard.site models the article's public URL as publication `url` plus document
`path`. Leaflet's current helper strips trailing slashes from the base and appends
the document path. The ordinary publisher sets `path` to `/<rkey>`, preserves the
record key on updates, and defaults new records to a TID key.

Therefore a publication record with
`url: https://delightfullabs.com/open-thoughts` and a document with `path: /<rkey>`
can describe a native canonical article at
`https://delightfullabs.com/open-thoughts/<rkey>`. If migrated human-readable
native paths differ, provide aliases for the record-derived paths or arrange
matching record keys; a title-derived route alone is not enough.

Leaflet's source metadata also derives its HTML canonical and open-graph URL
from that same publication URL. This is useful if the external native URL is
configured, but changing that field affects publication navigation, post links,
feeds (`/rss`, `/atom`, `/json`), and social sharing. It cannot be treated as an
isolated SEO switch.

Sources:

- [Standard.site URL and verification rules](https://standard.site/)
- [Leaflet publication/document URL construction](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/getPublicationURL.ts)
- [Publish path and identity behavior](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/publishLeaflet.ts)
- [Source page canonical metadata and feed links](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28published%29/lish/%5Bdid%5D/%5Bpublication%5D/%5Brkey%5D/postPageMetadata.ts)

### Important distinction: Leaflet's domain UI hosts a whole domain

The inspected domain actions add the hostname to Leaflet's Vercel project and
assign that hostname to the publication. The default-domain menu selects from
those assigned hostnames. It is not a UI for attaching only `/open-thoughts` to
a separately hosted Svelte app. Do not point `delightfullabs.com` DNS to Leaflet
or add it to Leaflet's hosting project when the new native site owns that host.

The record-building helper itself accepts a base-path string and prepends
`https://`, so an external subpath is representable in the stored record. That
does not establish that it is a supported hosted-product configuration or that
future settings changes will preserve it. No authenticated external-URL setting
was exercised in this research. A Next.js server action found in source is not a
documented public API to invoke directly. If the hosted product lacks the needed
setting, a one-time staff-assisted configuration is an option to investigate;
forking or self-hosting Leaflet is not justified for this site.

Sources: [Domain hosting/assignment](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/actions/domains/index.ts),
[Default-domain UI](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28identity%29/lish/%5Bdid%5D/%5Bpublication%5D/dashboard/settings/PubDomainSettings.tsx),
[Record builder](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/buildPublicationRecord.ts),
[Authenticated base-path action](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/actions/publications/updatePublication.ts).

### Recommended technical sequence

1. Develop the read-only native frontend against records while retaining the
   normal Leaflet source publication URL. Source fallback links can use explicit
   Leaflet routes rather than reconstructing them from the native canonical URL:
   `https://leaflet.pub/lish/<did>/<publication-rkey>/<document-rkey>`. In the
   inspected source, the publication post route calls `DocumentPageRenderer`
   directly and that renderer calls `loadPostPage`; neither issues a canonical
   redirect. This makes the route a plausible independent source-view link even
   after a publication URL change, but that exact changed configuration still
   needs a live test. See [post route](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28published%29/lish/%5Bdid%5D/%5Bpublication%5D/%5Brkey%5D/page.tsx)
   and [document renderer](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28published%29/lish/%5Bdid%5D/%5Bpublication%5D/%5Brkey%5D/DocumentPageRenderer.tsx).
2. In a designated test publication, prove the external canonical publication
   URL configuration without assigning the native host to Leaflet's hosting
   project. Verify publishing, editing, source-view links, follow/subscribe links,
   comments links, preview links, and settings persistence.
3. Expose `/.well-known/site.standard.publication/open-thoughts` at the native
   origin, returning the publication AT URI, and each article's
   `rel="site.standard.document"` reference. Current official
   [Standard.site verification documentation](https://standard.site/docs/verification)
   explicitly specifies this endpoint form for non-root publications: append the
   publication path after the well-known endpoint, not before it. The optional
   publication link tag is a discovery hint, not a substitute for verification.
   Validate the actual responses with the selected publication during integration.
4. Serve native feed endpoints matching any record-derived advertised feed URLs.
   The site can generate feeds from its normalized AT records; this still uses
   AT Protocol for ingestion and avoids a feed dependency loop.
5. Align the actual publication record URL with the selected native public
   address only after these checks pass. Until then, native self-canonical tags
   and retained source self-canonical tags may conflict; do not describe that
   temporary development state as a finished cross-site canonical solution.

**Remaining technical proof, not an owner preference**: confirm the hosted
Leaflet external-publication URL workflow and edit/settings behavior. If it
requires staff support, document that constraint instead of silently changing
the canonical address chosen by the owner.

## Live legacy inventory

All article rows below returned HTTP 200 on 2026-11-09. Their URLs are listed in
the [live sitemap](https://thoughts.delightfullabs.com/sitemap.xml) and
[archive](https://thoughts.delightfullabs.com/blog/). Source dates agree with the
repository's frontmatter. Although the ecosystem article sits in a nested source
folder, its live URL does **not** repeat the slug.

| Title | Date | Old path on `thoughts.delightfullabs.com` | Proposed native path |
| --- | --- | --- | --- |
| Thinking As You Go | 2023-07-17 | `/blog/thinking-as-you-go/` | `/open-thoughts/thinking-as-you-go/` |
| Thoughts on Files over Apps | 2023-07-09 | `/blog/thoughts-on-files-over-apps/` | `/open-thoughts/thoughts-on-files-over-apps/` |
| Filtering feeds | 2023-02-01 | `/blog/filtering-feeds/` | `/open-thoughts/filtering-feeds/` |
| IFTTT for the Semantic Web | 2023-01-31 | `/blog/ifttt-for-the-semantic-web/` | `/open-thoughts/ifttt-for-the-semantic-web/` |
| A Tools for Thought Ecosystem | 2022-11-14 | `/blog/a-tools-for-thought-ecosystem/` | `/open-thoughts/a-tools-for-thought-ecosystem/` |
| Two Steps Forward, One Step Backwards | 2022-04-07 | `/blog/two-steps-forward-one-step-backwards/` | `/open-thoughts/two-steps-forward-one-step-backwards/` |

Other live 200 routes:

- `/` and `/blog/`: map directly to the native writing index.
- `/tags/`: currently an empty tags index; there are no per-tag pages in the
  current sitemap and no article frontmatter tags. Preserve a meaningful empty
  tags destination or route it to the writing index; no existing tag collection
  needs reconstruction from the current archive.
- `/feed/feed.xml`: current Atom feed. See the defects and continuity plan below.
- `/sitemap.xml`: replace with a valid sitemap or redirect to the new sitemap.
- `/feed/pretty-atom-feed.xsl`: valid live stylesheet for the old Atom feed;
  preserve with any archived legacy feed representation if still referenced.

### Image variants and anchors

Only the ecosystem article contains a published image. Its live `<picture>`
references these three paths, each verified 200:

- `/blog/a-tools-for-thought-ecosystem/m-R-Dmd_ly-1280.avif` — 33,848 bytes.
- `/blog/a-tools-for-thought-ecosystem/m-R-Dmd_ly-1280.webp` — 51,454 bytes.
- `/blog/a-tools-for-thought-ecosystem/m-R-Dmd_ly-1280.png` — 160,742 bytes.

The source `chart.png` exists in Git but `/blog/a-tools-for-thought-ecosystem/chart.png`
currently returns 404. Preserve the **generated live URLs**, not just the original
source path. The current published image has empty `alt`; flag for owner content
review rather than inventing alternative text.

Preserve these existing body-heading IDs in the native renderer or explicit
legacy anchor aliases:

- Ecosystem article: `motivation`, `guiding-ideas`, `avoid-lock-in`,
  `small-apps-for-specific-tasks`, `interoperability`,
  `components-of-the-ecosystem`, `technical-foundations`, `conclusion`.
- Two Steps article: `the-promise-of-technology`, `broken-promises`,
  `personal-growth`, `the-internet-changed-everything-and-not-all-for-the-good`,
  `making-new-promises`.
- Every article also has a title ID equal to its old slug and a `main` landmark
  ID. Redirects cannot inspect URL fragments server-side; preservation requires
  compatible IDs in the destination page.

### Feed defect discovered during live checks

The live Atom feed is well-formed XML with six entries, but its title is
`Blog Title`, its feed ID is `https://example.com/`, and every entry's `id` and
`link` use `https://example.com/blog/<slug>/`. The repository's Eleventy feed
configuration contains the same template values. Do not blindly proxy this feed
or advertise its current incorrect destinations.

**Recommendation**: generate a native Atom feed from the same normalized article
records and route the old `/feed/feed.xml` directly to it. Correct title, author,
article links, and base URL. To reduce duplicate items for existing subscribers,
the six migrated entries can retain their exact existing opaque Atom IDs while
their links are corrected; record that intentional legacy-ID mapping. New entries
can use stable AT record identities. Test the resulting feed in a reader; feed
reader behavior is not proved by XML parsing alone.

Sources: [Live feed](https://thoughts.delightfullabs.com/feed/feed.xml),
[Eleventy feed configuration](https://github.com/delightful-labs/open-thoughts/blob/3017dd1244f874ba0bb9bbdc9ee79e49e30041a3/eleventy.config.js).

## Export classification

The repository's Write.as JSON export has one public `Open Thoughts` collection
containing the same six articles. It separately contains eight root-level
uncollected entries with null slug/type and no evidence of public publication.
Some have nonzero view counts; that alone does not establish publication status.
Do not auto-publish those eight entries. Preserve them as migration inputs
outside the native public content and leave their status unchanged. This resolves
the initial inventory ambiguity without asking Matt to classify drafts merely to
migrate the known public archive.

The Write.as export also preserves original timestamps (not merely dates),
whereas current Eleventy Markdown frontmatter stores dates. Use current public
dates for parity and retain original timestamps/provenance in the manifest;
avoid importing unrelated account/profile fields into public site data.

Source: [Write.as export at the inspected commit](https://github.com/delightful-labs/open-thoughts/blob/3017dd1244f874ba0bb9bbdc9ee79e49e30041a3/WriteAs%20exports/mjamesderocher-202509131051.json).

## Readiness assessment

Resolved by evidence: current public archive size and URLs; real image variants;
empty tag collection; existing feed defects; protected bulk importer; editable
editor-paste path; original-date and quiet-publish code paths; record URL/link
coupling; whole-host domain assignment behavior.

Not yet proved: authenticated editor migration of one representative article;
hosted external-subpath canonical workflow and settings persistence; final
publication/account identity; final Atom reader continuity. These are explicit
implementation/migration proof gates. They must not be reported as completed
because source inspection found plausible code paths.


## Preparation update — November 9, 2026

The blog source still resolves to the pinned commit above. The six known-public
Markdown posts, original chart, license and stylesheet are preserved byte for
byte in [migration/open-thoughts](../../migration/open-thoughts/README.md).
Twelve live HTTPS captures preserve the six article HTML pages, three generated
image variants, Atom feed, sitemap and stylesheet. All returned 200. The manifest
contains file hashes/sizes/origins and the exact proposed URL/fragment/feed-ID
mapping; these plans are not active redirects.

The ecosystem article's current public date (`2022-11-14`) differs from Write.as
creation time (`2022-11-12T15:55:33Z`). Preserve the public date during import;
retain the export timestamp as provenance. The full export is not copied because
it also contains account fields and eight unclassified entries.

Owner publication identity is now verified and enumeration is empty. The hosted
external canonical URL/edit/settings workflow is still unproved; current source
findings and the concrete proof checklist are in [canonical-proof.md](canonical-proof.md).


## First quiet publication proved

Following explicit owner approval, the ecosystem article was quietly published
as `site.standard.document/3mzvkf4zddc2n`. The original public date, complete body,
links/lists/headings, uploaded image and native Preview initial HTML/browser
rendering were verified; see [verification.md](verification.md). Its public record
mapping and proof metadata are now in the migration manifest. The other five
articles remain unimported. Canonical alignment, old slug/fragment compatibility,
feeds and production cutover remain separate open work.
