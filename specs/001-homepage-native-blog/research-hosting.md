# Research: Svelte, Delightful UI, Vercel, and hosting cutover

**Date**: 2026-11-09
**Scope**: Technical research only. No project, deployment, storage, or DNS changes.

## Evidence and current state

Read-only Netlify connector calls returned these currently published sites:

| Purpose | Netlify project | Production address | Source branch indicated by branch URL |
| --- | --- | --- | --- |
| Landing page | `youthful-goodall-78c6dd` | `https://delightfullabs.com` | `master` |
| Blog | `open-thoughts` | `https://thoughts.delightfullabs.com` | `main` |

Both returned ready current deploys. Dashboard references:
[landing page](https://app.netlify.com/projects/youthful-goodall-78c6dd),
[blog](https://app.netlify.com/projects/open-thoughts).
These are account observations, not inferences from repository config.

Read-only public Google DNS-over-HTTPS lookups returned NS records
`dns1.p01.nsone.net` through `dns4.p01.nsone.net`, and apex A records
`98.84.224.111` and `18.208.88.157` (120-second TTL). CNAME lookups for `www`
and `thoughts` returned no answers. This does not prove those names are absent:
flattened/managed records can serve other record types. Export the authoritative
zone before cutover; do not infer the editable DNS provider from NS names alone.
Reproducible read-only lookup example:
`https://dns.google/resolve?name=delightfullabs.com&type=NS`.

Vercel account inspection could not enumerate projects: `list_teams` returned
no accessible teams and `list_projects` returned HTTP 403 for the connected
scope. Consequently, no Vercel project, plan, storage availability, or team is
claimed as verified. Resolve access when configuring the deployment; it does not
block public-platform research. No fallback account or different team was used.

Landing-page checkout base: `7c90fc05fd18f11db6a566b2f9bcaf7555aaaaa9`.
Local Delightful UI checkout was clean at
`eaf1b98290944ef3a99c1fa183e227a61a8de2ee`; its package declares Svelte
`^5.57.2`, uses SvelteKit `^3.0.1` for its own demo, and exports components plus
`delightful-ui/theme.css`. This is local-source compatibility evidence, not
verification that every checkout change has been released to npm.

## Decision: SvelteKit server rendering with the explicit Vercel adapter

Use SvelteKit with `@sveltejs/adapter-vercel` and the Node.js runtime. Its
server-side loading supports native record retrieval and readable initial HTML.
Use existing Delightful UI exports and defaults without font installation or
typography overrides. Pin a verified published library artifact during setup.
Sources: [SvelteKit Vercel adapter](https://svelte.dev/docs/kit/adapter-vercel),
[server data loading](https://svelte.dev/docs/kit/load),
[Vercel SvelteKit integration](https://vercel.com/docs/frameworks/full-stack/sveltekit).

**Rationale**: Meets the requested framework and native article behavior on the
requested host. The explicit adapter makes the target clear.

**Alternatives considered**: Static-only builds require rebuilds for new posts;
a browser-only reader withholds the body from the initial response. Neither
is the preferred starting point. No application was scaffolded in this research.

## Decision: refresh public content on demand; separate cache from durable fallback

Recommended initial strategy: on each content request, reuse a successful
publication snapshot for up to five minutes; when older, synchronously refresh
the public records before serving current content. A complete scan must finish
before replacing the publication inventory or confirming absence. This avoids
the first visitor after a quiet period seeing arbitrarily old content. Reserve
time within the spec's 15-minute window for identity refresh and any HTML cache.

Use Vercel Runtime Cache as an optional accelerator, not the only copy of a
last-successful snapshot. It is regional, environment-isolated, eviction-prone,
framework-agnostic, and has a 2 MB item limit. Explicit `getCache` keys can remain
readable across deployments. Shard by publication manifest and article if
needed. Source: [Runtime Cache](https://vercel.com/docs/caching/runtime-cache).

For durable fallback, private Vercel Blob is a viable small-site option. Current
SDK docs describe conditional overwrites (`ifMatch`), ETags, and private reads
with `useCache: false`. These allow versioned snapshots and a manifest update
that detects competing refreshes. A losing writer must discard/retry against
current state rather than restoring an older article or resurrecting a deletion.
Private storage controls serving through the application even when the stored
content was originally public. Source:
[Blob SDK reference](https://vercel.com/docs/vercel-blob/using-blob-sdk).

Keep `verifiedAt` distinct from cache-write time. Failed fetches must not advance
verification time. Use the last successful allowed content for at most 24 hours
after verification; an authoritative removal replaces it with a tombstone.
No cache fill or render may reset that stale clock. Preview environments must
not write the production snapshot. A store has not been created or selected.

For the first proof, avoid full-page ISR while validating deletion and stale
limits. It adds another cache layer: SvelteKit documents timed and on-demand
ISR, but page revalidation does not itself prove the upstream snapshot is fresh.
Later, short CDN TTLs can be added within an explicit end-to-end freshness budget.
Sources: [adapter ISR](https://svelte.dev/docs/kit/adapter-vercel#Incremental-Static-Regeneration),
[Vercel cache headers](https://vercel.com/docs/caching/cache-control-headers).

**Rationale**: Six public articles do not require an always-running consumer or
database. Request-driven refresh and durable fallback meet reader-visible
freshness/availability without assuming a publisher webhook.

**Alternatives considered**:

- Runtime Cache only: simpler but eviction prevents promising reliable fallback.
- Whole-page ISR only: good performance, but stale source snapshots and HTML
  revalidation interact; unsuitable as an unexamined freshness guarantee.
- Scheduled refresh: useful if updates must happen while no reader visits, but
  not necessary merely to serve fresh content on the next visit.
- Database-backed snapshot: feasible, but no relational feature currently
  requires it; consider if a suitable existing store is available at deployment.

The spec's 15-minute wording should be clarified as a reader-visible bound,
including the first request after inactivity, unless the owner specifically
needs background refresh without traffic. This is a recommendation, not a
silently changed acceptance criterion.

## Finding: current schedules and legacy cron jobs have different limits

Do not rely on older assumptions that every Vercel scheduler has daily-only
Hobby limits. Legacy Cron Jobs document Hobby once-daily execution. Current
Schedules are beta and document Hobby 15-minute minimum frequency with
15-minute jitter; Pro permits one-minute frequency with a one-minute jitter.
A 15-minute schedule with 15-minute jitter cannot prove a strict 15-minute
freshness bound. Check the actual team's plan and available product before
choosing scheduling. Sources:
[legacy Cron Jobs](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing),
[Schedules limits](https://vercel.com/docs/schedules/limits).

## Decision: host-specific migration redirects in the combined Vercel project

The owner chose `https://delightfullabs.com/open-thoughts/` as the primary blog
address. Attach the apex and legacy blog hostname to the intended Vercel project
when ready. Match `thoughts.delightfullabs.com` explicitly and map each inventoried
legacy path to its final canonical native path. Use permanent redirects and
consistent trailing-slash behavior so redirects do not chain. Do not apply the
old-host rules to previews or to the canonical host. Sources:
[Vercel redirects](https://vercel.com/docs/routing/redirects),
[custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

Use one versioned URL map to generate redirects and their verification cases.
Feed, image, and tag paths need resource-appropriate destinations. Do not use a
blanket redirect of every old URL to the homepage. A root-domain redirect alone
cannot express different article path mappings.

## Decision: keep Git integration simple and stage the migration

Vercel's Git integration supplies non-production previews and production-branch
deployments. Add only the validation that the app needs; a second bespoke
deployment pipeline is not required by the migration. Verify the actual default
branch rather than assuming `main`; the landing-page repo currently uses
`master`. Source: [GitHub integration](https://vercel.com/docs/git/vercel-for-github).

Cutover sequence for later implementation:

1. Export existing zone records, domain assignments, deploy identifiers, and
   the full published URL inventory. Preserve mail and unrelated app records.
2. Build and verify the native reader and representative editable archive import
   before bulk publishing. Record article identities and final URL mappings.
3. Configure the correct Vercel project, Git source branch, build, and isolated
   configuration. Validate a preview without moving production domains.
4. Stage the release and verify direct article responses, canonical metadata,
   feeds, assets, error responses, and legacy-host mappings.
5. Add/verify domains and use Vercel's project-specific DNS instructions. Change
   only required records; moving all nameservers is unnecessary for web hosting.
6. Check HTTPS and exact redirects on both public hosts after DNS propagation.
   Retain working Netlify deploys and recorded DNS rollback values.
7. Subsequent Vercel release rollback can restore a prior deployment. Reversing
   the initial Netlify-to-Vercel migration additionally requires DNS/domain
   rollback; Vercel rollback does not restore those or external publication data.

Source for release rollback scope:
[Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).

## Still to validate in implementation

- An actual Svelte native reader, direct initial HTML response, safe block
  renderer, and no typography modifications.
- Pinned package versions and a real Vercel build against the correct project.
- Snapshot consistency, conditional-write conflicts, deletion propagation, and
  response-cache freshness in preview.
- Actual Vercel access/plan, DNS edit access, and any store configuration.
- Cutover cannot be called verified until the complete migration URL map passes.
