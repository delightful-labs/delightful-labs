# Reader Contracts

## Configuration

LEAFLET_PUBLICATION_URI is optional; empty means no publication configured.
LEAFLET_AUTHOR_DID defaults to Matt's confirmed DID. Override only for isolated
read-only proofs. SITE_ORIGIN defaults to https://delightfullabs.com.

## Routes

- /: empty main landmark and functional Home/Open Thoughts navigation.
- /open-thoughts/: published source metadata and native links, or a minimal empty
  state. Upstream failure is 503 unless a bounded stale snapshot exists.
- /open-thoughts/[rkey]/: server-render body, source link, canonical URL and
  standard document link. Unknown records are 404; unavailable upstream is 503.
- /.well-known/site.standard.publication/open-thoughts: configured validated
  publication URI as text, otherwise 404. Does not claim hosted canonical setup.

## Upstream and rendering

Resolve current PDS from DID. Validate HTTPS endpoints and reject private/local
addresses and redirects. Bound response size, page count, cursors and time. Follow
cursors to exhaustion; filter exact publication; sort by original date. Fetch
page blobs from the same PDS. Render using the pinned Standard Reader Svelte/core 0.4.0 packages, with the
owner's accepted constraints documented in the renderer evaluation. Do not
maintain custom block traversal or facet parsing. Member delimiter, checklist,
subpage, unknown-block, and facet behavior follow the package; this reader is
for public records, not an access-control boundary. Use existing DUI defaults
and safe URL overrides. Do not
inject authored HTML, adopt source typography, or render iframe blocks.
