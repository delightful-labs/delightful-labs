# Local migration qualification

All five source repositories are represented in the workspace. Finance, Clipper
web and extension consume source UI and Local First packages. Root defaults
continue to invoke the website. Work is committed on `feat/monorepo-foundation`;
no source repository, hosted setting or deployment was changed.

## Final common toolchain and checks

Node 24.22.2 / pnpm 10.28.0. After Finance's source link and the shared storage
availability port, the final root regression passes:

| Project | Unit tests | Files |
| --- | ---: | ---: |
| Finance | 1,940 | 142 |
| Clipper web/extension | 906 | 132 |
| Local First | 1,098 | 52 |
| UI | 131 | 30 |
| Website | 152 | 11 |
| Total | 4,227 | 367 |

Website, Finance, Clipper and library type checks pass with zero Svelte errors
or warnings. Local First format/lint, package/publint and consumer fixtures pass.
Finance's nested worker-state campaign passes 17 tests and its host adapters
pass 36 tests; worker tooling, browser-fixture types and e2e coverage-scope checks
also pass. Finance preview, Clipper web and extension builds succeed. Earlier
library native/restore and Storybook qualification is recorded in the individual
slice records; these are local results, not hosted Actions execution.

A fresh archive of `ca537bea` passes frozen install without existing node_modules
or generated library exports, all six installed module-identity checks and
Finance types. A later `pnpm install --lockfile-only --ignore-scripts --offline`
leaves the lockfile byte-identical (SHA-256
`342e00f5891fa8560d8015df6c00f350862f9b312bc7f5312332b2f09b9ee26b`).
This check preserves the pinned peer contexts rather than upgrading dependencies.

The original UI `7a7f61b`, Local First `9d6dd84`, Finance `230bc7c` and Clipper
`549e4b5` full source commits are all verified ancestors of the final migration
branch. Original paths remain available through `git show <source>:<old-path>`;
source-to-import mappings are in each slice record. No external repository is
needed to recover those imported histories.

## Browser evidence

- Finance with workspace UI/DLF: all 17 account/recovery and 23 permission tests
  pass. All 7 production cold-start tests pass in the final clean checkout,
  including full offline browser restart, unanswered remote authority, local
  writes, real rejection and bank history retention.
- Clipper with workspace UI/DLF: all 60 ordinary browser tests pass in a clean
  checkout, covering account isolation/restoration, discovery, filters, images,
  drafts, organization, reader and startup.
- Clipper's 32 worker tests pass, including proof renewal and rejection of
  expired/forged/wrong-audience/wrong-identity admission, account custody and late
  cleanup. Its complete production offline suite passes 8/8, including linked,
  existing and expired-provider accounts through two complete offline restarts.
- Clipper extension tests pass 9/12, including direct offline capture and restart
  reconciliation. The same three sign-in/settings failures reproduce against
  unchanged source with its original SDK patches, archives and pnpm 10.22.0.
  This is an existing release limitation, not full extension sign-in acceptance.

The inherited Clipper offline-cache assertion was corrected to require the exact
seven existing public PWA icon/manifest files. Private/API cache entries remain
rejected. No product caching policy, assertions about auth/durability, skip list
or deadline was changed to conceal a failure. See the Clipper import record for
the baseline extension failure evidence and original platform notes.

All browser authorities, profiles and account data used disposable fixtures.
Owned Finance agent servers were stopped after checks. The original source
checkouts, user development environments and data were untouched.

## Deployment evidence and remaining work

Finance's local Vercel-adapter artifact has an existing Node 24 handler, traced
native/Wasm files and no broken symlinks; inspect `finance-vercel-artifact.json`.
A hosted Linux build/live preview is still required before deployment settings
or source handoff. Root CI retains the source project suites and adds installed
peer-identity checks; hosted required checks were not changed.

The following work remains explicit:

1. Resolve Clipper's three reproduced source extension sign-in/settings failures
   before release; do not count the migration as repairing that existing issue.
2. UI snapshot compatibility is now complete; see the
   [2026-11-11 qualification](ui-workspace-links.md). Both remaining consumers use
   workspace UI, existing defaults are preserved through its classic entry, and
   the two active snapshots are removed. No new font choices were introduced.
3. Shared topic guidance, dependency-aware CI selection and the all-PR title
   check are implemented and locally verified; see [the record](shared-guidance-ci.md).
   The stricter common engineering rules apply to every project by user direction;
   constitutions, product policies and translation/tool boundaries retain scope.
4. Complete source PR inventory and reconcile newer upstream commits before
   handoff. GitHub's configured token-lifetime restriction currently prevents
   complete PR inventory; no authentication setting was altered.
5. Verify hosted previews, deployment roots, required checks and independently
   approve source-of-truth cutover. No push, deployment, repository archival,
   branch rename, production migration or data operation was performed here.

## UI links completed — 2026-11-11

The website and Local First development UI snapshots are replaced by peer-specific
workspace packages. Unit regressions still pass 4,227 tests; the affected UI,
website and Local First browser suites pass 97 tests. All six deterministic website
screenshots match the old-archive baseline byte-for-byte. A final clean frozen
install passes all eight installed dependency-identity checks and consumer types.
The packed UI tarball builds in a separate consumer, including its new public
classic stylesheet and shared registration asset. Details and limits are in the
[UI link record](ui-workspace-links.md) and its linked evidence.

## Shared guidance and CI completed — 2026-11-11

Seven shared engineering guides own common practice. The stricter baseline now
applies to all apps/packages by explicit user direction; domain constitutions
remain local. Finance and Local First link the ten byte-identical root Spec Kit
skills. All six discovery contexts retain their intended feature selectors.

The built-in CI planner selects transitive consumers, handles both paths of moves
and divergent push comparisons, and falls back to all projects when history is
unavailable. Existing jobs fail if planning fails. The independent title workflow
covers every PR, including drafts and title edits. No hosted required checks or
repository settings changed. Twelve Node tooling tests, guidance/link validation,
four workflow YAML parses and the 66-file baseline hash audit passed locally.
These docs/CI changes did not rerun the previously recorded app/browser suites;
no application code, catalogs, dependencies or lockfile changed in this slice.
