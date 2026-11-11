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
