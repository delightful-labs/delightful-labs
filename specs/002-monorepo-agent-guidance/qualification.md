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
2. Reconcile the website and Local First development UI snapshots. The website's
   Heading/Text/Navigation source matches current UI, but theme defaults differ
   (Source Code Pro/system fonts versus Jost/Cascadia and new font roles). Keep
   current snapshots until a behavior/presentation-preserving compatibility
   slice is reviewed and qualified. No new theme or typography is introduced.
3. Finish shared topic-policy activation and Clipper's PR-title check scope while
   preserving local approval/constitution/localization exceptions.
4. Complete source PR inventory and reconcile newer upstream commits before
   handoff. GitHub's configured token-lifetime restriction currently prevents
   complete PR inventory; no authentication setting was altered.
5. Verify hosted previews, deployment roots, required checks and independently
   approve source-of-truth cutover. No push, deployment, repository archival,
   branch rename, production migration or data operation was performed here.
