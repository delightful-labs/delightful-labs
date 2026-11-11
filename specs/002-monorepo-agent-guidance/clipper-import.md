# Clipper workspace import

## Source and path decision

Imported `delightful-labs/delightful-clipper` main at
`549e4b543bbca51b3a243fa7f88d4165f9f405f7` through an unsquashed subtree into
`apps/clipper`. All tracked source, specs, memories, archives, tooling and tests
are included; original commit identities remain locally reachable. Untracked
source environment files, generated output, browser profiles and data are not
imported. Source checkout and deployments remain untouched.

The spec's proposed flattened web/extension paths are not adopted for this
slice. Static inspection found many extension-to-web imports of worker/runtime,
account, localization and domain contracts, plus shared coordinator tooling,
relative archive paths and root browser configs. Keeping `apps/clipper/apps/web`
and `apps/clipper/apps/extension` preserves this graph and avoids application
source edits. They remain separately named pnpm packages with explicit workspace
entries, build commands, extension identity and independent release paths. A
future flattening or extraction of shared Clipper contracts would need its own
review and qualification; neither is needed to use the root monorepo.

The coordinator at `apps/clipper` remains a private tooling package. Its nested
workspace and lock are retired in favor of the root workspace/lockfile; root
`clipper:*` commands delegate with its working directory. Root default commands
continue to invoke the website. Root Node is qualified/pinned to 24.22.2, meeting
Clipper's Node 24 constraint; pnpm metadata now agrees on 10.28.0.

## Source dependencies and patches

Web and extension use peer-specific injected `workspace:*` UI and Local First
packages, preserving their Svelte 5.57.2 runtime. Prior package comparison and
recovery-view source qualification account for the active archives' runtime and
presentation deltas. Local First's existing package command is attached to
`prepublishOnly`, matching UI's injected-install preparation pattern. Root
`syncInjectedDepsAfterScripts: [package]` refreshes both packages after rebuilding.
Root `build:libraries` rebuilds their exports explicitly.

The root combined Jazz patch replaces Clipper's original SDK patch, preserving
both app patch contributions. The existing Better Auth Bluesky plugin patch
remains scoped to its exact version at the imported path. The source SDK peer
allowance for Better Auth 1.7.18 is retained; XState remains unpatched.
Clipper's old Local First presentation patch is not activated globally: the
workspace source already contains its two fixes, and a version-wide patch would
also affect Finance's different archive. Existing archives/manifests and original
patch files remain provenance until cutover; the vendor verifier still checks
their digests and actual installed public exports.

## Guidance and CI

Clipper worker ownership, private account isolation, offline restart gate,
extension identity and explicit sign-in, product scope, localization approval,
new-dependency approval, styling and release restrictions remain local in its
entry file and memories. No sibling constitution is adopted. Only its obsolete
PR target is adjusted from source main to destination master; its merge/settings
approval policy remains unchanged. Scoped Spec Kit state selects a new import
spec, using root shared helpers/templates without changing sibling selectors.

Root `clipper.yml` preserves both source CI jobs and every original browser
command, adapting working directory, pnpm version, destination branch and
artifact path. The original PR-title workflow is retained as inert provenance;
activating its requirement with an appropriate monorepo scope is pending shared
release-guidance reconciliation. No hosted required checks/settings are changed.

## Baseline and qualification

The exact source archive passes frozen installation using Node 24.22.2 and its
pinned pnpm 10.22.0, zero-diagnostic checks for web/extension plus root tooling,
and all 906 unit tests in 132 files. Workspace qualification uses pnpm 10.28.0.
Results are recorded below as each check completes. Native proof renewal,
authorization, complete offline browser restart and extension build/identity
remain acceptance requirements for the shared SDK/source-package transition.

No strings, product workflows, domain schema, auth destinations, user data or
hosted settings are changed. Local builds do not establish live deployment
acceptance. Source repositories stay maintained until reviewed handoff; open PRs
and newer upstream commits must be reconciled before cutover. Rollback restores
source package/patch references and prior deployed artifacts without data changes.

Root frozen installation succeeds and prepares both source libraries. The
integrated `clipper:verify` passes vendor archive digests/installed exports,
formatting (560 files), lint, coordinator tooling types, zero-diagnostic web and
extension checks, all 906 unit tests in 132 files and the Netlify-adapter web
build. The extension release build also succeeds. Both apps' product source
files are unchanged. Scoped helper discovery from the extension resolves the
Clipper coordinator/import spec, preserving sibling selectors.

All 32 native worker browser tests pass against the disposable worker fixture.
This includes browser jobs, broker lifetime, account custody/binding, fresh-proof
renewal, refusal of expired/forged/wrong-audience/wrong-identity proofs with
visible retry and offline edit retention, and resource failure/late-cleanup
ownership. No real clock, user identity, profile or storage was altered.

A clean archive of `5d059db8` passes frozen installation and app/coordinator
checks with source-built UI and Local First exports. All eight production
offline browser scenarios pass, including linked/existing/expired-provider
accounts across two complete offline restarts, stopped web/Jazz servers,
reconciliation, immutable-byte reuse, update failure and first-install retry.

Qualification exposed an inherited source assertion mismatch: the cache check
allowed only `/` and immutable paths, but source already includes seven public
PWA icon/manifest files in static assets and deliberately precaches them. The
test now requires those exact seven paths outside the immutable shell; unexpected
private/API entries still fail, and the authorized private probe remains in the
scenario. This changes test expectations/diagnostics only; cache policy and
product behavior are unchanged. Source baseline contains the same old assertion
and the same static files. The corrected complete offline suite passes 8/8.

The complete ordinary browser runner passes all 60 tests across eight specs:
account 21, discovery 13, filter popovers 2, images 4, note drafts 2,
organization 8, reader 9 and startup 1. Each spec owns and drains its disposable
backend; these ran in the clean monorepo checkout.

Extension browser qualification passes 9 of 12 scenarios, including direct
offline capture, complete restart/reconciliation, account separation and issued
reference retention. Three existing sign-in/settings scenarios fail. Repeating
only those three against unchanged main `549e4b5`, its original vendored
libraries, original SDK/auth patches and pnpm 10.22.0 reproduces the same three
failures: sign-in popup does not close after valid restoration; stale-account
and repeated-settings fixtures never confirm the connection. The sign-in trace
shows completed identity restoration followed by a missing extension message
receiver. No assertions/skips/deadlines or product behavior were changed to
conceal these failures. This is a documented source-baseline limitation, not
full extension sign-in acceptance. Review the source's existing platform notes
in `apps/clipper/docs/reviews/image-browser-ci-2026-11-10.md` before release.


The 2026-11-11 [extension completion repair](extension-signin-repair.md) supersedes
the local 9/12 limitation above: all 12 packaged cases now pass locally, including
the three failures and 24 settings teardown cycles. It fixes lost popup closure
after acknowledged native drain; Linux skips are removed for hosted verification.
The original source-baseline comparison remains historical evidence. No source
checkout or hosted setting changed; hosted Linux qualification is still pending.
