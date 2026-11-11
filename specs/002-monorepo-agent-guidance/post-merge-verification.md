# Post-merge verification

Historical checkpoint record. Later completion, source handoff and deferred-work
status are recorded in the [migration closeout](closeout.md). Pending-work
statements below describe their original checkpoints, not current migration gaps.

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

## Live-domain repair accepted

The user explicitly approved apex TLS certificate issuance after the automatic
reviewer required that separate security-configuration approval. Vercel issued
`cert_zObX5yLsc2wAqlu3gnQ0FAp3` for `delightfullabs.com`. Normal public HTTPS
requests now return 200 for the apex homepage and native writing page; www returns
308 to the apex. Live disposable-browser checks on the actual custom domain pass
desktop/mobile homepage, decoded portrait, app links, keyboard navigation, writing
navigation/reload, unknown-article 404 and six CSS/JavaScript assets. No new fonts,
page errors or failed app assets were observed; external embeds were stubbed to
avoid production account writes. Deployment protection and all nine unrelated
DNS records remain unchanged.

## Follow-up PR qualification

PR #11 publishes the fixture and CI-job fixes. Its first hosted browser jobs stop
at browser dependency installation because runner DNS cannot resolve
`security.ubuntu.com`; these are setup failures, not application-test failures.
Tooling/types/build jobs pass. After diagnosis, one website job is retried on a
fresh runner as a control before any broader retries. The control failed at the
same apt step, resolving neither the Azure, archive nor security Ubuntu hosts. No tests are skipped,
assertions weakened, deadlines extended, apt security settings relaxed or package
mirrors changed to conceal the infrastructure failure. Hosted application
qualification remains outstanding until the dependency setup can complete.


Browser jobs now run in the official Playwright Noble CI images, pinned to
registry-verified immutable digests and matching the frozen package versions:
1.64.0 for Website/UI/Finance/Clipper, 1.60.0 for Local First. These images include
the browser binaries and system libraries; per-job apt/browser installation is
removed. Node 24.22.2, frozen workspace installation, job names, check selection,
all test commands, fail-closed aggregation and time budgets remain unchanged.
Containers use an init process and 1 GiB shared memory without privileged mode.
See [Playwright's image documentation](https://playwright.dev/docs/docker).
Fresh hosted qualification is required before merge.


The first image-based run passed Website, Local First and packaged extension
qualification and exposed two additional native fixture boundaries. Firefox
rejected GitHub's mounted home because its owner did not match the container's
effective user; jobs now correct that disposable directory's ownership without
changing the HOME variable or browser sandbox settings. Finance restore ran
95 cases successfully before its eight Firefox launches failed at this boundary.
The UI mobile full-swipe test awaited accessibility removal, which begins before
dismissal completes and the Reset button finishes moving. It now also awaits
the retained row's native `hidden` property before tapping Reset. No production
component, test assertion or deadline is weakened. Ten repeated native mobile
cases pass with the stronger wait; full local Storybook qualification passes: 191 cases, with the same 11
platform-scoped skips as the existing suite.
