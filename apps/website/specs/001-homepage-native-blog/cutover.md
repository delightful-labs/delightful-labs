# PR #6 hosting cutover

Prepared November 9, 2026. DNS has not been changed. Canonical URL changes are
explicitly deferred. No new homepage content or typography is included.

## Prepared

- All six archive posts published quietly, original dates and text retained.
- Native article routes, slug aliases, Atom/RSS/JSON feeds, sitemap and direct
  legacy-host redirects implemented. Article images load from the PDS; old generated image assets are no longer
  hosted by this repository. Unknown legacy paths are not redirected indiscriminately.
- Vercel project `delightful-labs`, team `mjamesderochers-projects`.
- Node build/runtime 24; Production publication URI and `BLOB_STORE_ID` configured.
- Existing private store `delightful-labs-snapshots` reused. Production keys are
  isolated from Preview by namespace. A second store was not created.
- `delightfullabs.com` and `thoughts.delightfullabs.com` attached to Vercel;
  ownership verification succeeds, DNS configuration remains pending.

## Release sequence

1. Review and merge PR #6. Confirm the resulting Production deployment is READY
   for that exact merge commit. Use its deployment URL to verify the six native
   articles, image, Atom/RSS/JSON feeds, sitemap and publication endpoint before
   touching DNS. Confirm runtime snapshot reads/writes succeed.
2. Export the complete existing DNS zone and record current Netlify site/deploy
   identifiers privately for rollback. Keep the old sites deployed. Preserve an
   owner-controlled copy of the full private Write.as export before retiring
   the old repository; it is not part of the six public migrated posts.
3. Re-read Vercel's domain configuration immediately before changing records.
   The project-specific recommendations observed November 9 were apex A records
   `216.198.79.1` and `64.29.17.1`, and CNAME
   `dda4277d778e61d4.vercel-dns-017.com.` for the blog subdomain. Replace only the
   relevant existing web A/AAAA/CNAME records with the current recommendations.
   Leave nameservers, mail/MX, TXT, and unrelated hosts alone. Check whether
   `www` is used and preserve its current behavior before making any changes.
4. Wait for DNS/TLS readiness and check both public hosts over HTTPS. Verify all
   six old article URLs redirect once to native record-key URLs, query strings
   survive, article images load, and `/feed/feed.xml` redirects to the
   native Atom feed. Check subscription IDs, dates and destinations, source-view
   links, document references, sitemap and unknown-path 404s.
5. Record final deployment, DNS observation, runtime checks and rollback evidence.
   Keep Netlify and the old repository available through the observation period.

## Rollback

Current nameservers are `dns1.p01.nsone.net` through `dns4.p01.nsone.net`.
Observed web A answers for the apex and old blog were `52.52.192.191` and
`13.52.188.95`. These observations are not a substitute for the full pre-change
zone export, including TTLs and any AAAA/CNAME records. Restore the exact exported
web records if cutover fails; do not change mail or nameservers. Keep existing
Netlify deployment identifiers so their prior builds can be restored if needed.
For a Vercel application regression, roll back/promote the last verified
Production deployment and recheck native routes and durable snapshot behavior.
Do not delete Leaflet posts or rewrite their stable identities during rollback.

## Accepted limits

Canonical alignment with Leaflet remains unresolved and nonblocking. Body
heading fragment IDs are not provided by the accepted renderer. The main landmark ID is preserved; legacy title IDs are not added. The renderer
has not been patched.
