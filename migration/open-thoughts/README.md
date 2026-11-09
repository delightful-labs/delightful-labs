# Open Thoughts migration inputs

This directory preserves the six already-public articles from the Eleventy blog.
It is outside `src/routes` and `static`; the application does not import or serve
it. These are migration/comparison inputs, not published Leaflet posts or new site
content. No article text has been rewritten.

## Provenance

Source repository: https://github.com/delightful-labs/open-thoughts

Pinned source commit: `3017dd1244f874ba0bb9bbdc9ee79e49e30041a3`.

- `source/`: byte-for-byte original Markdown files, `chart.png`, feed stylesheet,
  and original license, retaining their repository paths.
- `live/`: HTTPS captures of the six public article pages, three generated image
  variants, Atom feed, sitemap, and feed stylesheet on November 9, 2026.
- `manifest.json`: per-file SHA-256, byte size and origin; each post's public
  date, export timestamps, old URL, proposed native path, heading/landmark IDs,
  image references, and legacy Atom ID/link. Leaflet record mappings are null
  until actual editable migration is proved.

Run `pnpm check:migration` to verify the preserved bytes and manifest references.
The files are frozen evidence: don't run formatting tools over archived Markdown,
HTML, XML, or images. Make migration-specific transformations in a separate
working copy, retaining the original inputs.

## Decisions still gated

The six article redirects are a plan only. Their target slugs do not exist yet.
The native reader currently routes by record key; migrated record keys or explicit
aliases must match this manifest before redirects can be activated. Preserve the
listed title/body heading fragments and `main` landmark where package support
allows; fragment compatibility remains a separate migration check.

The live Atom feed uses `example.com` IDs and links. Retain the IDs as opaque
legacy identities if needed for subscription continuity; fix the destination
links in the replacement feed. No native feed route has been chosen or created
by this archive preparation.

The ecosystem post is publicly dated `2022-11-14`, while its export creation time
is `2022-11-12T15:55:33Z`. Preserve the public date; don't substitute export
creation time automatically. A few raw export update timestamps precede creation
by one second; they are retained as provenance, not normalized into new dates.

The full Write.as export contains account fields and eight uncollected entries
whose publication status has not been established. It is not copied here. Its
original repository path, pinned commit, SHA-256 and classification counts are
recorded in the manifest. Preserve an owner-controlled copy before retiring the
old repository; do not treat those entries as public migration candidates.

Editable Leaflet import, quiet publishing, canonical URL alignment, destination
and fragment checks, feeds, redirect activation, production hosting/DNS, and old
repository retirement remain outstanding. The first representative migration
should be the ecosystem article because it exercises the image and headings.
