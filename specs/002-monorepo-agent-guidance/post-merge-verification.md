# Post-merge verification

The merge commit is `a6f63dc08baf8201f1271cca9c1cf70964607a86`. Its tree matches
the qualified PR head; this record concerns subsequent master CI and live checks.

Foundation run `43024952497` passes. Finance run `43024952543` has one failure
in application shard 1 (91 other cases pass). The saved trace identifies the
account-order fixture's insert with `archivedAt` already populated. Production
permissions forbid archived inserts and permit archiving through update. Local
persistence sometimes let the test proceed before the server rejected the insert.

The local fix creates an active account, then archives it through the permitted
update, waiting for actual global acceptance of both fixture writes. All existing
workspace isolation, saved-order and archived-account exclusion assertions remain.
All five account-order browser cases pass against a disposable Jazz backend;
browser-test types and Prettier pass. Product permissions and ordinary offline
write semantics are unchanged.

Clipper run `43024952605` passes extension qualification but exhausts the combined
web/schema/worker/offline job's overall 15-minute budget during offline tests.
The local fix splits web/schema from worker/offline/sample-data alongside the
existing extension job. The same required browser check requires all three jobs
to pass. Existing test assertions, commands and deadlines and per-job budgets
remain. All thirteen CI/guidance tooling tests, workflow YAML parsing and guidance
discovery pass. Automatic approval review initially rejected publishing in this post-merge scope.
After the two concrete approval prompts, the user instructed continuing with both
the DNS repair and follow-up PR; publication now proceeds within that scope.

Vercel's automatic production deployment `dpl_AGvCShc6dvnnEBHqhdmicyBYfx6e` is
Ready. Disposable-browser checks against `https://delightful-labs.vercel.app/`
pass desktop/mobile homepage and decoded portrait, app links, keyboard navigation,
native writing navigation/reload, unknown-article 404, six CSS/JavaScript assets,
zero new fonts, zero page errors and zero failed app assets. External embeds are
stubbed to avoid production account writes. No protected production access link
is created or needed.

The old Netlify site automatically published merge deploy
`6af4667557881ffb68fedf45` without a root homepage. The apex and `/open-thoughts/`
return Netlify 404s even though deploy state is Ready. Vercel already has ownership
verified for the domain, but reports its DNS misconfigured. The exact apex/www
routing records and provider-recommended replacements are in
[live-domain-repair-proposal.json](live-domain-repair-proposal.json). After the exact proposal and approval prompt, the user instructed continuing
with the live-domain repair. The two old routing records were replaced by the
three specified Vercel records, and www is configured for a 308 apex redirect.
All nine unrelated records are unchanged. Authoritative and recursive DNS and
Vercel ownership verification pass; HTTPS currently awaits certificate acceptance. Direct-IP TLS probes could not establish
connections; custom-domain HTTPS must be checked after any authorized repair.

Source handoff remains pending while master qualification or custom-domain routing
is unresolved. Existing sources, Finance draft PR #67, nameservers, mail/other
subdomain records, account data and repository protections remain preserved.

## Application source handoff review

Read-only Vercel metadata confirms that both existing application deployments are
Ready and still build from their original repositories:

| App | Project | Current source | Proposed monorepo root |
| --- | --- | --- | --- |
| Finance | delightful-finances | delightful-labs/delightful-finances main at 230bc7c | apps/finance |
| Clipper web | delightful-clipper | delightful-labs/delightful-clipper main at 0fd1cb3 | apps/clipper/apps/web |

No application Git integration, environment variable, domain, SDK app identity,
backend/data namespace or extension release destination was changed. A later
approved handoff should qualify per-app previews, preserve those identities and
existing project configuration, and separately switch the Git integration/root.
Finance draft PR #67 remains in its original repository for subsequent work.

The existing Netlify CLI login can access the authoritative DNS zone, and the
Vercel domain API provides the exact proposed replacement targets. The Netlify
connector does not expose DNS mutation, so any approved repair would use the
installed CLI's scoped record operations. The DNS zone and other records are
preserved; no registrar/nameserver transfer is part of this proposal.
