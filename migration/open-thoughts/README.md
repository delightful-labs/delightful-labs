# Open Thoughts migration inputs

This directory preserves the six already-public articles from the Eleventy blog.
It is outside `src/routes` and `static`; only its URL/identity manifest metadata is imported by the application. These are migration/comparison inputs, not an application content source.
All six articles are now quietly published on Leaflet. No article text has been rewritten.

## Provenance

Source repository: https://github.com/delightful-labs/open-thoughts

Pinned source commit: `3017dd1244f874ba0bb9bbdc9ee79e49e30041a3`.

- `source/`: byte-for-byte original Markdown files, `chart.png`, feed stylesheet,
  and original license, retaining their repository paths.
- `live/`: HTTPS captures of the six public article pages, three generated image
  variants, Atom feed, sitemap, and feed stylesheet on November 9, 2026.
- `manifest.json`: per-file SHA-256, byte size and origin; each post's public
  date, export timestamps, old URL, proposed native path, heading/landmark IDs,
  image references, and legacy Atom ID/link. All six articles have public Leaflet record mappings and proof metadata. Editor URLs are capability-bearing and are not stored here.

Run `pnpm check:migration` to verify the preserved bytes and manifest references.
The files are frozen evidence: don't run formatting tools over archived Markdown,
HTML, XML, or images. Make migration-specific transformations in a separate
working copy, retaining the original inputs.

## Routing and feeds

All six public posts are quietly published on Leaflet, preserving their original
public dates and body text. The manifest records their public AT URIs, CIDs and
native record-key routes. The application imports mapping metadata from this
manifest; article bodies always come from AT Protocol. Archived source files are
never served as application content.

Legacy article URLs redirect directly to native record-key routes. Readable slug
aliases redirect to those routes only when the source article still exists.
Original generated images are copied byte-for-byte to `static/` at their original
paths; checksums cover those copies too. The old feed stylesheet remains only in
the archive because the replacement feeds do not reference it.

Native Atom, RSS and JSON feeds are `/open-thoughts/atom.xml`,
`/open-thoughts/rss.xml` and `/open-thoughts/feed.json`. The old Atom URL redirects
to the new Atom endpoint. Preserve the original opaque `example.com` entry IDs
for subscription continuity; destination links use the native site. New posts use
their complete AT URI as their feed identity. Feeds reuse the article renderer.

The page title and `main` landmark retain their old IDs. Body heading fragments
remain limited by the accepted Standard Reader renderer; no custom renderer or
typography has been added. Canonical alignment is a nonblocking research item.

The full Write.as export includes account fields and eight unclassified entries.
Keep an owner-controlled copy before retiring the old repository; none of those
entries have been published here. Keep Netlify available until DNS cutover and
verification complete. See the [cutover runbook](../../specs/001-homepage-native-blog/cutover.md).
