# Migration implementation

Implementation started 2026-11-10 on `feat/monorepo-foundation`, based on destination
`master` at `c75d672f231e8d6e7087454431b80496dc353c67`. This record tracks implementation;
the original specification remains the reviewed requirements baseline.

## Current progress

- Source inventory and archive comparison tooling implemented.
- Website workspace move implemented and locally verified; see
  [the slice record](website-move.md) for exact mapping, guidance dispositions,
  checks and rollback. Hosted preview verification and source handoff remain open.
- UI imported with original history and qualified under the root toolchain; see
  [the UI slice record](ui-import.md) and [emitted package comparison](ui-package-comparison.json).
- Local First source imported with original history. The user approved the
  wiring slice; [local qualification passed](local-first-import.md), including
  unit, packaged-consumer, native backup/restore and Storybook checks. A fixture
  Vite allow-list regression was fixed without changing library behavior.
  The user also approved the [alpha.60 source adapters](alpha60-adapters.md);
  their full unit, package, native, restore and Storybook qualification passed.
  Finance and Clipper now consume qualified workspace source libraries.
- The [recovery-view compatibility export](recovery-view-export.md) is now in
  source and verified through the packed consumer and 63 Storybook tests.
- Existing SDK runtime patches are [reconciled in one root patch](sdk-runtime-patches.md),
  with passing library native/restore, Finance account/permission/startup and
  Clipper worker/proof/offline qualification.
- Finance is [imported and integrated](finance-import.md) with original history,
  root lockfile, peer-specific workspace UI consumption and retained source CI
  suites. Source and workspace baselines pass, including 1,940 unit tests,
  account/recovery, authorization and cold-offline/unanswered-remote browser
  tests. Its existing [storage-availability behavior](finance-session-availability.md)
  is preserved in source, and both library dependencies now use workspace packages.
- Clipper web/extension are [imported and integrated](clipper-import.md), with
  source library links and retained CI suites. Its 906 unit, 60 ordinary browser,
  32 worker and 8 offline tests pass. Extension qualification passes 9/12;
  all three failures reproduce against unchanged source and original dependencies.
- A [module-identity check](../../scripts/monorepo/check-links.mjs) guards all six
  app-to-library source edges in CI. Fresh install, source history reachability
  and lockfile idempotence are verified. Final regression results are in
  [the qualification record](qualification.md).
- Website and library-development UI snapshot compatibility, shared topic-policy
  reconciliation, source PR inventory and hosted qualification remain pending.

## Slice 0: reproducible source inventory

Run from the destination checkout:

```sh
node scripts/monorepo/inventory.mjs /path/to/source-parent > specs/002-monorepo-agent-guidance/source-inventory.json
```

The parent must contain all five repositories under their existing names. The
command uses each repository's `origin/HEAD` remote-tracking ref, never its checked
out branch. Fetch those refs before refreshing the inventory. It performs no fetch,
install, checkout, source modification, or deployment. The checked-in report was
produced after fetching all five default branches on 2026-11-10. Local branches
and dirty paths are observations, not selected import material.

The report records full candidate commit IDs, remotes, proposed destinations,
package commands and dependency constraints, internal archives, lockfiles,
guidance/skill/template object IDs, symlink targets, feature selectors, and tracked
integration configuration. Git object IDs permit exact comparisons across future
runs. They do not preserve history by themselves. Platform settings, open PRs and
issues, external memory targets, rule-by-rule dispositions and archive contents
remain separate review work; an empty list of tracked integrations does not prove
that no integration exists. Do not put credentials or environment values in reports.

Validation completed: script syntax check and successful inventory generation
against all five repositories. No application code changed, and no app tests or
release checks were run. This slice changes no effective policy. Rollback is removal
of the inventory script and these feature artifacts; source repos remain maintained.

Archive investigation is recorded in [archive-findings.md](archive-findings.md),
with reproducible file-level and contract evidence in `archive-comparison.json`.
The website move can retain its current UI archive; library workspace replacement
remains gated on the recorded compatibility checks.

## Compatibility findings and proposed sequence

- The website pins pnpm 10.28.0; the other source roots pin 10.22.0. Clipper also
  constrains the pnpm engine. Do not adopt a single version until frozen installs
  and existing commands have been qualified for every project.
- Node 24 is the common major. Clipper requires at least 24.22.2 and below 25;
  use that intersection for the baseline experiment, without changing packages.
- Finance and Clipper depend on UI `7a7f61b` archives; the website uses UI 0.0.25.
  Finance and Clipper reference different Local First archives. Replacing these
  with `workspace:*` before comparing their contents could discard behavior.
- Clipper already has a workspace. Map `apps/web` and `apps/extension` separately;
  account for root scripts, patches, tooling and vendor-relative paths. Experiments
  are inventoried, not automatically selected as maintained applications.
- Finance's implementation-review-before-tests rule remains local and effective.
  Clipper's dependency/string approval rules and its i18next message ownership must
  not become universal rules by copying its entry file to the root. Finance uses
  Paraglide and a different message-descriptor boundary. Resolve scope explicitly.

Execute these slices in order, with each review recording exact commits, checks,
and rollback evidence:

1. **Guidance and source review.** Classify every normative rule in the inventoried
   files as shared, local, superseded or unresolved. Follow external memory links;
   inventory open work and hosted required checks/deploy roots. Review snapshot
   differences, select source commits, and qualify the common toolchain. Existing
   approvals stay effective throughout. This is the next required work.
2. **Website workspace foundation.** Move website source/config/tests/vendor and
   its feature artifacts to `apps/website`. Retain migration planning at root.
   Introduce pnpm workspace config and root commands that delegate to the website.
   Verify relative paths, SvelteKit output and Vercel tracing in an isolated build
   before proposing hosted root changes. Keep public URLs and current deployment.
3. **UI import.** Retain history, establish `packages/ui`, reconcile website's
   snapshot differences, link the workspace dependency, build packaged exports and
   verify the website against both supported consumption paths.
4. **Local First import.** Retain history and package interface at
   `packages/local-first`; qualify packed exports and reconcile both consumer
   archives before replacing them.
5. **Finance import.** Preserve domain policy and local feature state under
   `apps/finance`. Follow its implementation review gate before tests. Verify
   worker bundling, persistence and offline compatibility in isolated storage.
6. **Clipper import.** Map both apps, retain extension identity and web hosting,
   qualify workspace/root scripts, worker and extension artifacts, and existing
   account/offline/recovery contracts. Release destinations remain independent.
7. **Shared guidance activation and CI selection.** Activate only reconciled rules;
   validate local links and discovery in all six contexts. Library changes select
   transitive consumers; root/lock/config uncertainty selects all projects. Keep
   app-only checks scoped once dependency evidence supports that selection.

## Required evidence before accepting each move

Record a source-to-destination path map, exclusions, original full commit ID and
retained-history mechanism. Prefer a history-preserving import that keeps original
commits reachable; verify representative `git show` lookups after import. Do not
rely on external repository availability as the history archive.

Record baseline commands and their results before moving source, then run the
same commands after migration with equivalent isolated configuration. Check
packaged library exports as well as workspace links. Preserve each project's
own spec selection; no root helper may overwrite a sibling selector.

Record source-of-truth handoff only after review and acceptance. Until then, source
repositories remain maintained and new upstream commits require reconciliation.
Rollback a failed move on the feature branch and keep the previous deployed
artifact/source revision available. Hosting configuration, repository settings,
archival, branch renaming and production releases are separate actions; this slice
performs none of them.
