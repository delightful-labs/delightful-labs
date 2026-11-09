# Foundation Verification

**Date**: 2026-11-09
**Scope**: Basic site and read-only native reader. This is not a completed
publication migration or hosting cutover.

## Checks

- `pnpm install --frozen-lockfile`: reproducible installation from the committed
  local UI artifact and lockfile.
- `pnpm test`: 17 behavior checks covering pagination, exact publication
  filtering, owner mismatch, empty config, failed initial fetch, coalesced reads,
  stale age limits, confirmed removal, changed/incomplete scans, malformed records,
  UTF-8/overlapping facets, unsafe links, member boundaries, unknown blocks and
  annotations, reachable/cyclic subpages, blob-page precedence, and private IPs.
- `pnpm check`: no errors or warnings.
- `pnpm build`: successful Vercel adapter output; generated function config
  identifies Node.js 24 and SvelteKit 3.1.1. This is a local build, not deployment.
- Chromium: three passing checks for empty homepage/navigation, direct 404,
  mobile-width navigation and keyboard use. No page errors were observed.
- Source scan found no added font family, font sizes, weights, line heights,
  letter spacing, or font-face declarations. Existing Delightful UI defaults
  were used; no source library files were changed.

Local execution used the installed Node.js 25.2.1. The repository pins Node.js 24
for CI and the Vercel runtime; an actual hosted Node.js 24 release is not claimed.
Browser verification used installed Playwright Chromium because the Chrome
DevTools connector was unavailable.

## Live native source proof

An isolated local process on port 5184 explicitly overrode both author DID and
publication URI with the public Leaflet Lab Notes publication. The default app
on port 5183 kept an unset publication and displayed no posts. Overrides were
process-only; no `.env.local` or demonstration default was committed.

- Author: `did:plc:btxrwcaeyodrap5mnjw2fvmz`.
- Publication: `at://did:plc:btxrwcaeyodrap5mnjw2fvmz/site.standard.publication/3lppk75kw7k26`.
- Document: `at://did:plc:btxrwcaeyodrap5mnjw2fvmz/site.standard.document/3mwehnrqsf22g`.
- Source article: [Back to School — Leaflet for Learning](https://lab.leaflet.pub/3mwehnrqsf22g).
- Local article response: HTTP 200, native article body and image in initial HTML.
- Browser evidence: 3,272 article-text characters, 17 article links, one loaded
  image with source alternative text, zero frames, and zero page errors.
- Canonical and `site.standard.document` link tags were present. The canonical
  pointed to the native route as configured locally; upstream Leaflet canonical
  settings were not changed or validated by this check.
- The writing index loaded source metadata; direct unknown article requests on
  the default app returned 404. Default homepage/index requests returned 200.

`scripts/verify-native.mjs` reproduces the browser/direct-HTML check against an
explicit local article URL. Screenshots are ignored under `test-results/`;
third-party article bodies and images are not committed as site content.

## Remaining gates

- The real Open Thoughts publication has not been created; Matt's account has
  not been authenticated or mutated by this implementation.
- Hosted Leaflet external canonical `/open-thoughts/` configuration, editable
  archive import, original anchors/assets, feeds and final redirects need their
  designated integration proofs. No redirects to missing articles are enabled.
- The initial cache is process-local, not durable across Vercel instances.
  Persistent snapshots and cross-instance reconciliation must precede migration.
- Vercel project inspection returned HTTP 403 for the connected team. A consent
  link was supplied; no Vercel project or deployment was created and no domains
  or DNS records were changed. The GitHub CI run will be separate hosted evidence.
