# Review, CI and independent releases

Every PR must use a Conventional Commits title: `type(scope): description`.
Scope is optional; `!` marks a breaking change. This is a workspace-wide user
instruction, not a UI/Clipper-only convention. The global title workflow reads
JSON event data and never interpolates a title into shell source.

Work on feature branches targeting destination master. Never push directly to
master. Commits, merges, publication, production deployment, repository settings,
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

Vercel projects use the shared ignored-build script to cancel Markdown-only
builds before installation. It compares the current commit with Vercel's previous
deployment SHA; missing/invalid history continues the build. This also covers
Markdown-only pushes after merge. Vercel may record a canceled deployment.

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
