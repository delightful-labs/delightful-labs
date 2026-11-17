# Review, CI and independent releases

Every PR must use a Conventional Commits title: `type(scope): description`.
Scope is optional; `!` marks a breaking change. This is a workspace-wide user
instruction, not a UI/Clipper-only convention. The global title workflow reads
JSON event data and never interpolates a title into shell source.

Work on feature branches targeting destination main. Never push directly to
main. Commits, merges, publication, production deployment, repository settings,
branch protection, source cutover and destructive data operations require the
applicable user authorization. Existing scoped authorization persists; do not
request it again merely because files moved. New repositories are public unless
the user explicitly requests private. Do not post messages/comments to others
without task authorization.

Apps, extension and libraries keep independent release identities, versions,
destinations, environment configuration and rollback. Verify public packed library
exports as well as linked sources. Shared changes include affected consumers in
the same branch or a documented compatibility path. Older deployed/offline clients
and extension installations retain their compatibility obligations.

## Check selection

The built-in selector maps changed paths to existing suites and transitive
consumers. UI selects all projects. Local First selects itself, Finance and
Clipper. Website/Finance-only changes stay scoped. Clipper web and extension are
verified together because current source and native fixtures cross that boundary.
Changes consisting entirely of `.md` files (case insensitive) skip project suites
and guidance/tooling checks. Mixed changes keep the existing conservative routing.
Root/unknown/config/guidance uncertainty and manual/missing-history events select
all. Renames/deletions include both old and new paths. Selection and PR-title
checks still run so required checks resolve without workflow-level path filters.

Vercel projects use the shared ignored-build script to cancel Markdown-only and
unaffected-project builds before installation. It resolves the project from the
app root and reuses the CI scopes, including transitive consumers and Clipper's
parent tooling/extension boundary. Shared UI, root and unknown changes rebuild
all projects; Local First changes rebuild Finance and Clipper. Previews remain
enabled for affected apps. It compares the current commit with Vercel's last
successful deployment SHA for that project and branch, so skipped commits cannot
hide undeployed code. A first Preview deployment, with no previous SHA and a
known non-main branch, fetches `main` from the checkout's origin and compares the
unique merge base with the checked-out deployment commit. When Vercel reconstructs
Git metadata without an origin remote, validated GitHub provider/owner/repository
system variables supply the HTTPS URL of this public repository. This needs no
new credentials; inaccessible/private sources retain the conservative build.
This covers the entire
branch, including earlier skipped commits, without treating newer main-only
changes as changes on the preview branch. Shallow history is deepened once by
100 commits for the pinned main/head SHAs if necessary, within a total 15-second
comparison budget. It does not use a single-parent diff or a stale local ref.
Production/main deployments, malformed metadata, unavailable/ambiguous history,
failed fetches, unknown project roots (except the existing Markdown-only rule),
and empty diffs continue the build. Vercel may
record a canceled deployment. This script requires no dependency installation.
Project upload-ignore rules must retain Git metadata: Vercel applies
`.vercelignore` before the ignored-build command. Removing `.git` at that stage
breaks comparison and makes the conservative fallback build even documentation.

Deployment selection also filters test/spec/test-support modules, known test
directories and fixtures, test runner configurations, CI workflows, and explicit
editor/formatter/linter settings. Mixed Markdown/test/tooling changes can skip
deployment too; mixed runtime changes still rebuild their consumers. The filter
is separate from CI selection: test and tooling fixes still run existing checks.
The three exact deployment-control modules (`scripts/monorepo/ci.mjs`,
`vercel-ignore.mjs` and `deployment-paths.mjs` in that directory) run only before
installation or in CI, so their changes also skip app builds while retaining all
CI suites. This exception does not cover unknown scripts or app build commands.
Production Vite/Svelte/TypeScript settings, manifests, lockfiles, build scripts,
static assets and unknown configuration continue to deploy. UI Storybook inputs
still deploy the hosted UI Storybook, but do not rebuild its library consumers.
Keep new verification-only paths explicit in `scripts/monorepo/deployment-paths.mjs`.

Workflows keep their triggers and existing job names. Job conditions skip
unaffected suites; they do not silently reduce an affected suite. A failed plan
must fail existing selected/required check jobs rather than turn them into a green
skip. Do not use workflow-level path filters that can strand required checks.
No hosted ruleset/required check is changed without authorization. Report local
versus hosted evidence accurately and retain native/generated failure artifacts.

A shared practice change updates its authoritative guide and affected local
exceptions in the same review. Validate all six discovery contexts and local
links. CI does not deploy or prove production acceptance. Before source handoff,
reconcile upstream commits/open work, verify hosted build/preview roots and
required checks, then obtain cutover approval. Keep the previous deployed source
and rollback available; do not archive source repositories by implication.
