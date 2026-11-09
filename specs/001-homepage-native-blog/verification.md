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
