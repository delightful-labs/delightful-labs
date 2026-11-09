# Delightful Labs foundation

SvelteKit 3 and Svelte 5, Delightful UI, and the Vercel adapter. The homepage
contains only functional navigation; editorial content and typography are deferred.

## Run locally

Use Node.js 24 (`nvm use`) and pnpm 10.28.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development server binds to `0.0.0.0` and prints localhost and network URLs.
Use `pnpm dev --port 5183 --strictPort` for an explicit available port.

```sh
pnpm check
pnpm test
pnpm build
pnpm test:build
pnpm test:browser
```

Browser tests require Playwright Chromium (`pnpm exec playwright install chromium`
if not already installed). They start their own default-config server on port
5185; use another available port/configuration rather than stopping an unknown
server. `BASE_URL=http://localhost:5183 pnpm test:browser` tests an existing empty
foundation server. Test fixtures stay in tests and do not appear in the app.

## Publication configuration

Copy `.env.example` to `.env.local` when configuration is needed; do not commit
local environment files. Open Thoughts now exists at
https://open-thoughts.leaflet.pub/ and is configured in Vercel Preview. The
application default stays unset; an unconfigured environment makes no upstream
article requests.

- `LEAFLET_PUBLICATION_URI`: verified Open Thoughts URI
  `at://did:plc:226m7t4kp7d7sg2qsdresypm/site.standard.publication/3mzv6a2yk522y`.
- `LEAFLET_AUTHOR_DID`: defaults to Matt's confirmed `@derocher.me` identity,
  `did:plc:226m7t4kp7d7sg2qsdresypm`. The publication owner must match.
- `SITE_ORIGIN`: defaults to `https://delightfullabs.com` for native canonical URLs.

These variables are declared as runtime, server-only values in `src/env.ts`.
Public reading needs no publishing credentials. PDS location is resolved from
the DID document, rather than permanently hard-coded.

The index loads public AT Protocol records, follows every cursor, filters exact
publication membership, and sorts original dates. Articles render semantic native
HTML using `@standard-reader/renderer-svelte@0.4.0` and its matching core.
The small integration wrapper uses existing Delightful UI defaults, safe links,
PDS image resolution, and a source link in place of iframe blocks. Source theme
and font settings are not adopted. Rendering follows the package's supported
behavior; the owner accepted its current facet, checklist, page, and delimiter
limitations before starting to publish. See the
[renderer evaluation](specs/001-homepage-native-blog/evaluations/standard-reader/README.md).

The server bundle includes each dependency's resolved XState version so DUI's v5 internals stay separate from the app's v6 machines. `pnpm test:build`
executes emitted SSR routes through Node, without Vite's development resolver.

The server reader's cache/refresh lifecycle is an XState v6 machine, pinned to
`6.0.0-beta.1` as requested. Fetching and Zod validation live in focused modules;
the machine owns concurrency, freshness, stale fallback, retries and cancellation.
See [the lifecycle contract](specs/001-homepage-native-blog/contracts/reader-lifecycle.md)
for the state diagram and tested invariants. With `BLOB_STORE_ID` configured, it checks the shared durable snapshot on every
read; local-only environments retain the original process cache.

## Local public-source proof

The verification script accepts only an explicit local article URL. Run a separate
local server with both author and publication overridden for an approved public
example, then run `node scripts/verify-native.mjs <local-article-url>`. This checks
initial HTML, browser text/links, a loaded image, no frames, and no page errors.
Never use a demonstration publication as the committed or production default.
Evidence from the initial proof is in the feature's `verification.md`.
Run this proof after other dev/build/browser-test processes have stopped, or
from a separate checkout: SvelteKit processes in one checkout share generated
environment files, even when they use different ports.

## Deployment status and remaining gates

`pnpm build` generates `.vercel/output` with the explicit Node.js 24 adapter.
The build is deployable output, not evidence of a hosted release. The repository is linked to the `delightful-labs` Vercel project for preview
verification. No custom domains or publishing credentials are configured.

The Vercel connection is authorized for the selected team/project. If using
the CLI, link before `vercel env pull .env.local` and keep preview configuration
separate from production. Do not overwrite an existing local environment file
without preserving its local settings.

Durable snapshots use private Vercel Blob (`@vercel/blob@2.8.2`). Set
`BLOB_STORE_ID` to enable them; Preview uses the connected
`delightful-labs-snapshots` store. The SDK uses platform OIDC or the project's
connected storage credentials; none are exposed to the browser. Local use without
a store still works with the process cache. At production cutover, configure a
separate private store and the publication URI for Production.

Snapshots stay fresh for five minutes. Failed refreshes can use the latest
stored snapshot for at most 24 hours from its original verification time. Every
request checks storage without CDN caching. Conditional writes prevent competing
refreshes from overwriting a newer snapshot; failures/conflicts re-read the winner.
A confirmed empty archive replaces the old body. If storage cannot be read,
requests return unavailable instead of serving an unchecked local copy. Preview
branches, Production, and publications have distinct versioned keys. Each snapshot
is bounded to 10 MB. See [the lifecycle contract](specs/001-homepage-native-blog/contracts/reader-lifecycle.md)
for concurrency, availability, and validation details.

The owner created the Leaflet publication; its URI and ownership are verified. Before cutover,
prove its external canonical `/open-thoughts/` URL and edit workflow, import one
editable archive post quietly, preserve all six posts/assets and old URL mappings,
generate correct feeds, and verify redirects. No redirects to absent articles are
enabled in this foundation. No DNS records or upstream publication settings have
been changed. Keep the existing Netlify blog available through migration.

See [the spec](specs/001-homepage-native-blog/spec.md),
[implementation plan](specs/001-homepage-native-blog/plan.md),
[tasks](specs/001-homepage-native-blog/tasks.md), and
[research](specs/001-homepage-native-blog/research.md).
