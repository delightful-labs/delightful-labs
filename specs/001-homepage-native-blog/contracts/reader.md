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
addresses and redirects. Bound response size, cursors, recursion and time. Follow
cursors to exhaustion; filter exact publication; sort by original date. Fetch
page blobs from the same PDS. Respect member boundaries and reachable subpages.
Render escaped text and safe semantic elements with existing UI defaults. Do not
inject authored HTML, adopt source typography, or render iframe blocks.
