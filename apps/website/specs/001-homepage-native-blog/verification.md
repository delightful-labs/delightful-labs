# Foundation Verification

**Date**: 2026-11-09
**Scope**: Basic site and read-only native reader. Publication migration and
hosting cutover are not complete.

## Current checks

- Frozen-lockfile installation uses a pinned portable DUI artifact and exact
  application dependencies. Local execution uses Node 25.2.1; CI and the Vercel
  function target Node 24.
- `pnpm test`: 104 tests covering reader/cache behavior, snapshot-stage failures
  and cancellation, a hard refresh deadline, metadata and blob hydration,
  validated socket DNS answers, IP/URL restrictions, response cleanup/size limits,
  native renderer integration, and configuration-only publication verification.
- `pnpm check`: zero errors and warnings.
- `pnpm build`: successful Node 24 Vercel adapter output.
- `pnpm test:browser`: three Chromium checks for the empty homepage, writing
  navigation, direct unknown-article 404, keyboard interaction, and mobile width.
- No font, size, weight, line-height, letter-spacing, or typography overrides
  were introduced. Existing Delightful UI defaults are used.

## Native public-source proof

The explicit read-only proof uses the Leaflet Lab Notes publication owned by
`did:plc:btxrwcaeyodrap5mnjw2fvmz`, publication key `3lppk75kw7k26`, article key
`3mwehnrqsf22g`. This is never the application default or committed site content.

After Standard Reader adoption, the article rendered in initial HTML with 3,217
text characters, 15 links, one loaded PDS image with supplied alt text, zero
frames, correct canonical/document links, and zero browser errors.
`scripts/verify-native.mjs` repeats the check against an explicit local URL.
Screenshots are ignored under `test-results/`; third-party article bodies and
images are not committed. Run this proof after other dev/build/browser processes
in this checkout have stopped: they share SvelteKit's generated environment files.

## Review fixes

- Replaced preflight DNS plus independent fetch resolution with an Undici agent
  whose socket lookup validates and returns the same addresses. Reused ipaddr.js
  classification instead of maintaining a partial IP blocklist.
- A single 40-second deadline cancels the whole refresh, including stalled work;
  five-second connection and twelve-second request limits remain separate.
- Snapshot stages require their prior results through XState v6 state schemas;
  removed non-null assertions and renamed preparation to match its role.
- Article preparation hydrates Leaflet blobs and preserves other content payloads
  for the accepted renderer instead of manufacturing placeholder pages.
- Removed redundant configuration identity tracking and duplicate date formatters.
- Publication verification reads validated configuration without loading posts.

Standard Reader Svelte/core 0.4.0 owns content rendering. The owner accepted its
[evaluated constraints](evaluations/standard-reader/README.md); custom block,
facet, and page parsing and the standalone evaluation harness are removed.
Ongoing SSR tests exercise the actual application integration.

## Remaining gates

- External canonical/edit workflow proof for the owner-created Leaflet publication.
- Production storage enablement and owner-published post/edit/unpublish proof.
  Durable snapshots are implemented and enabled for Preview.
- Editable archive import, preserved assets/anchors, feeds, and final redirects.
- Hosted preview and production cutover. Vercel access is now authorized and the `delightful-labs` project is linked.
  The first hosted run exposed a v5/v6 XState module-resolution collision; SSR
  bundling and a built-output Node smoke check address it. No custom domains,
  publication settings, or DNS records were changed.

## Hosted SSR correction

DUI uses XState v5 internally while the application uses v6. Externalizing both
under one bare module name made the emitted server load v5 imports from v6 on
Vercel. Vite now bundles each resolved XState version. `pnpm test:build` executes
the emitted server through Node and checks homepage/index 200 and unknown-post
404 responses. CI runs this after the production build. Development-server tests
alone do not cover this module-resolution boundary.

## Owner publication

Verified `https://open-thoughts.leaflet.pub/.well-known/site.standard.publication`
and the public PDS record both identify
`at://did:plc:226m7t4kp7d7sg2qsdresypm/site.standard.publication/3mzv6a2yk522y`,
owned by Matt's confirmed DID. The record's URL remains the Leaflet subdomain.
The Vercel Preview environment is configured with this URI; production settings,
DNS, publication content, and canonical records have not been changed.

## Durable snapshot implementation

Private store `delightful-labs-snapshots` is connected to the project. The
`BLOB_STORE_ID` opt-in is enabled only in Preview; Production's publication and
cache opt-ins remain unset. Storage credentials are managed by the integration
and were not printed or committed. No article content or publishing actions were
created for this work.

Thirty added checks cover restart recovery, cross-instance deletion/CAS races,
shared reads and storage outage behavior, stale expiry at completion, failed first
loads/writes, cancellation, exact Blob options, identity/schema/size validation,
and publication/environment/branch isolation. All 93 tests, type checks, Vercel
build, and emitted-server checks pass locally. Hosted persistence proof is recorded below.

### Hosted restart/redeployment proof

Both deployments ran on Node 24 against the real empty Open Thoughts publication:

- `dpl_5cpMmdgnUpDfEYiNQXEYks1tgBhL`: `/open-thoughts/` returned 200 and logged
  `outcome: saved, verifiedAt: 1794237877196`.
- Separate deployment `dpl_GnKBea4N9yfuHscbmHUPwP9AU7tp` returned 200 and logged
  `outcome: fresh, verifiedAt: 1794237877196`. The original timestamp was retained
  across deployments rather than resetting age or relying on process memory.
- Its publication-verification endpoint returned the correct owner publication URI.
- Node 24 CI passed all 93 tests, emitted-server smoke checks and browser checks.

This proves real private-store persistence and readback across deployments.
Deletion/conflict/error cases use isolated fixture tests; no test posts were
published or removed from the owner's publication.

## Cache lifecycle refactor

Blob operations and the durable loader now use XState v6 machines, with typed
state prerequisites and explicit terminal outcomes. All original 93 checks remain;
ten additional lifecycle/cancellation checks cover first-writer verification,
failed recovery reads, CAS recovery, stale-state transitions, and cancellation
during Blob and durable read/write work. Shared actor cleanup also retains all
existing snapshot-stage cancellation/deadline coverage. Serialized snapshots,
namespace keys, SDK consistency options and freshness limits are unchanged.

The Blob adapter now sends data-only operations to registered SDK actors.
Lifecycle tests mock the actual SDK rather than injecting operational callbacks
into machine input. An additional check verifies the explicit download → validate
→ complete path; all 104 tests and emitted-server checks pass.


## Merged workflow composition and migration preparation

PR #4 merged with all 123 tests, type checks, production/emitted-server checks,
three Chromium checks, and Node 24 CI passing. The final Preview deployment
`dpl_6jGMpweRPVJuXtcTXa31zmHDjCKu` logged `saved` followed by `fresh` with the
same `verifiedAt: 1794241422337`. The application now composes named child
machines with data-only inputs; Promise runners/store facades are test support.

Archive preparation preserves six public source Markdown files, original chart,
license/stylesheet, six live HTML pages, three generated image variants, live
Atom feed, sitemap and stylesheet: 21 original files with SHA-256 and sizes.
All twelve live captures returned HTTP 200 on November 9, 2026. The manifest
records legacy/native URL plans, fragments, exact legacy Atom IDs, public dates,
and export timestamps. `pnpm check:migration` verifies these preserved bytes.
The full account export and its eight unclassified entries are not copied.

The ecosystem article's public date is November 14, 2022; its export creation date
is November 12. Both are preserved, with public-date parity required for import.
No article has been imported, published or edited in Leaflet by this work.

The owner's publication still has URL `https://open-thoughts.leaflet.pub` and zero
matching documents after complete enumeration. External-subpath persistence is
not yet proved. See [canonical-proof.md](canonical-proof.md) for source evidence,
the authenticated workflow still required, and an unsent support request.


## First owner-approved quiet publication

The owner explicitly approved publishing the ecosystem article quietly as the
first integration proof while external canonical URL support remains unresolved.
The real Leaflet editor created and saved an editable draft from the preserved
Markdown. The original chart was uploaded through the editor. Title, complete
body, links and image survived reload; Leaflet's documented read API also returned
the eight correct heading levels and one image. Draft/edit capability URLs are
not committed to this public repository.

The publish wizard was set to November 14, 2022 at midnight America/New_York.
Date and quiet-sharing choices survived a reload. “Post Quietly” was checked;
Bluesky sharing and Discover were unchecked. The final publish action reported
“Published!”. Public PDS retrieval then verified:

- URI: `at://did:plc:226m7t4kp7d7sg2qsdresypm/site.standard.document/3mzvkf4zddc2n`.
- CID: `bafyreifncz3hegl25dzfajuzaixqgiyht7cp5qclcmbgrnpljslo47eadi`.
- Exact publication membership and path `/3mzvkf4zddc2n`.
- `publishedAt: 2022-11-14T05:00:00.000Z`, preserving the public calendar date;
  this chosen date-only normalization is not a recovered original timestamp.
- `preferences.showInDiscover: false`; no Bluesky `postRef`.
- Public source: https://open-thoughts.leaflet.pub/3mzvkf4zddc2n.
- Explicit Leaflet source-view fallback also returned the full article without
  redirecting away from that route.

Native Preview:
https://delightful-labs-gou5e192e-mjamesderochers-projects.vercel.app/open-thoughts/3mzvkf4zddc2n/

The initial HTML returned 200 with the article body, all eight headings, image,
canonical tag, and exact `rel="site.standard.document"` reference. In the browser,
the normalized body matched all 6,448 source characters after removing Markdown
syntax/image markup. It retained four numbered items, five bullet items, nine
bold spans, one emphasis span, and all three original external links. The chart
loaded directly from the public PDS at 1280 × 853; there were zero iframes.
The only browser resource error was the foundation's absent `/favicon.ico`.

Remaining limits: native heading IDs are empty under the accepted renderer, so
legacy heading fragments are not yet preserved. The planned human-readable slug
alias is not implemented. Leaflet's source page still declares its Leaflet URL
canonical while native Preview declares the intended main-site route; this
owner-approved proof does not resolve that temporary conflict. Native feeds,
remaining imports, production configuration, DNS and redirects remain outstanding.
No publication settings, primary URL or DNS records were changed for this proof.

## PR #6 complete archive, routing and feeds — November 9

All six known-public posts now have editable Leaflet drafts and public Standard
Site records, mapped in `migration/open-thoughts/manifest.json`. Initial paste
verification checked editor text too early: four newly published records lacked
their opening text. Those existing drafts were repaired, reloaded to confirm
persistence, and updated under the same record identities. Public/native output,
not editor DOM alone, is the final comparison authority. Two Steps and the
previously proved ecosystem post were intact. Original public dates remain.

The five newly imported bodies were compared from the actual native JSON feed
HTML against normalized original plaintext: 2,089 / 4,454 / 3,697 / 3,323 / 5,594
characters respectively, exact matches. The ecosystem body's prior text, list,
image and link proof remains applicable. All six native record-key routes returned
200 with their document references and no iframe; all six readable aliases
returned 308 with preserved query strings. All three feeds returned 200, contained
six full bodies and retained all six legacy Atom IDs with native destinations.
Feed output contains no Svelte hydration comments. Live checks used emitted SSR
modules with the real publication, network access and no Blob configuration;
hosted durable-cache evidence must be checked independently in Preview.

Local verification: zero type errors/warnings, 147 passing tests, production
Vercel adapter build, emitted SSR route checks, archive/static-copy hashes, and
three passing Chromium tests. Emitted SSR checks cover the six one-hop legacy
article redirects, feed filename matching, aliases, sitemap, unconfigured feeds
and private archive-file 404s. No typography or new editorial copy was added.

Production environment configuration and domain attachment are prepared; DNS
still points to Netlify. Canonical alignment is explicitly nonblocking and has
not been changed. Body-heading fragments remain an accepted package limitation.
See `cutover.md` for release checks and rollback rather than treating these
Preview/local checks as evidence of completed production cutover.

## Archive cleanup after verified import

At the owner's request, removed the temporary migration archive, manifest,
checksum tooling and copied legacy images. The original blog repository remains
the archive. Earlier archive paths and checksum commands above describe historical
verification and are no longer available in this checkout. Only six slug/record-key
pairs remain in `src/lib/server/publication/legacy.json` for URL compatibility and
stable feed IDs. Bodies, images, publication metadata and dates come from Leaflet.
Legacy title IDs were also removed. Old generated image paths are no longer served;
native article images continue to load from the PDS.
