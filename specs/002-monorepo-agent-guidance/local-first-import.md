# Slice 3: Local First source import — workspace integration qualified

## Source and history

Source repository: `delightful-labs/delightful-local-first`, selected main revision
`9d6dd84a50cbf62b13858a5a96d6e35e511ab088`. Imported at `packages/local-first` by
unsquashed subtree merge `fe0c947`. Original history is retained as ancestry;
`git show 9d6dd84:src/lib/index.ts` addresses the original source independently of
hosting availability. The original source repository remains maintained. No
source handoff, publication, consumer dependency substitution or deployment.

All tracked source, specs, decision records, stories, fixtures, vendor packages,
project configuration and provenance were imported. Local installs, Git internals,
generated localization, build output, browser data and environment files were not
imported into tracked source. Other branches, issues, PRs and hosted integrations
remain in the source repository. Nested `.github/workflows` are retained source
records, not active destination workflows. After the user approved this slice with “Continue”, root CI was expanded to
restore the source repository’s full checks, consumers, backup/native and
Storybook verification. The local approval gate still applies to future changes.

## Workspace wiring and boundaries

- Package identity `delightful-local-first@0.0.0`, private status, exports, peers
  and source behavior remain unchanged. Jazz stays pinned to alpha.59. No catalog,
  schema, workflow, backend adapter or dependency API was edited. Four existing
  test fixtures now discover the workspace root for Vite dependency serving.
- Package manager adopts root pnpm 10.28.0. Node 24.22.2 and the existing source
  direct dependency resolutions passed the frozen install and library package
  checks. Framework/tool versions remain project-local.
- Root commands `pnpm dlf:check` and `pnpm dlf:package` run library-only type
  validation and the original strict package validation. `pnpm dlf:test` exposes
  the existing unit command; `pnpm dlf:verify` composes the source verification suite. Original broader commands
  remain available via `pnpm --filter delightful-local-first <command>`.
- The root lockfile includes Local First's original dependency closure and scoped
  UI archive. The competing nested lockfile is retained in history. Fourteen
  shared snapshot differences are explicitly recorded in
  [the lock reconciliation](local-first-lock-reconciliation.json): retain existing
  workspace resolutions for tslib, type/test utilities and optional WASM tools.
  No direct dependency or runtime SDK version is upgraded. Qualification of these combined resolutions includes the approved unit,
  consumer and browser suites recorded below; static/package success alone does
  not establish acceptance.
- Both Finance/Clipper alpha.60 archives and Local First's development UI archive
  stay in their existing consumer dependency paths. There are no new workspace
  consumer links in this slice.
- Local `.specify/feature.json` still selects `003-verified-backup`. Root migration
  and website selectors remain independent. Source templates and helper files
  were byte-identical to the root versions before deduplication; local paths now
  symlink to those single maintained copies. Local memory, constitution and
  project state stay local and unchanged.

## Guidance disposition

Provenance: source `AGENTS.md`, local constitution v2.0.0 and linked memories at
the selected revision. These rules are retained as scoped library policy, not
promoted into root rules. Source entry and memory object IDs are in the source
inventory; their full originals remain in imported history.

| Source entry topic | Disposition and rationale |
| --- | --- |
| Active feature and local constitution | Local and unchanged; root never adopts the library constitution |
| XState, localization, CSS and component memories | Local and unchanged; domain reference examples do not become sibling requirements |
| Pinned unpatched v6 and implementation/design audits | Local and unchanged; no machine changes in this slice |
| Specification-only phase | Superseded only for user-authorized source relocation/workspace wiring; no new product behavior or consumer SDK migration authorized |
| Jazz-first scope revision and backend integration boundaries | Local and unchanged; alpha.60 is not silently substituted |
| Finance/Clipper domain and DUI presentation boundaries | Local and unchanged |
| One-task/one-route review cycle | Local and unchanged; this slice introduces no route/component changes |
| Functions/plain data and no application-owned classes | Local and unchanged |
| No switch/case, inherited-tooling exception | Local and unchanged |
| Implementation review before tests | Local and effective; the user approved this concrete slice with “Continue” before implementation tests ran |
| Oxlint/Oxfmt and scoped formatting | Local and unchanged |
| Announce development URLs | Local retained; shared root network/port rule also applies |
| Explicit commit/publication authorization | Local and unchanged; import uses the user's earlier commit-and-continue authorization, with no publication |
| v6 generated testing and independent oracles | Local and unchanged; existing tests executed after approval, with fixture path fixes only |

The constitution and topic memories retain their complete content and normative
rules. No rule is being replaced by a shared policy, and cross-project
reconciliation of those rules remains pending. The root entry explicitly routes
Local First work to these local requirements.

## Alpha.60 comparison and required follow-up

[Publishable-file comparison](local-first-package-comparison.json) verifies all
tracked library source files against the original selected commit, then compares
the emitted package with committed active consumer archives. It honors the
package's test/spec exclusions, so compiled-but-unpublished tests are not mistaken
for extra package interfaces.

- Clipper: 270 files match, 11 differ, no original file is missing and no new
  publishable file is added. Its generic lifecycle additions are already in
  canonical source; the remaining differences are Jazz adapters/declarations.
- Finance: 242 files match, 15 differ, no original file is missing, and 24 files
  are added for the newer generic lifecycle contracts/workflows. Those additions
  are present in canonical source and Clipper's package.

This is **not** merely a package metadata difference. Clipper's committed
`tooling/build-v6-vendor.mjs` at consumer revision
`2e0ae22805185daf5b1565acdf75892fec87c2a0` explicitly adapts emitted modules:

| Alpha.59 source | Alpha.60 consumer adaptation to preserve |
| --- | --- |
| `createJazzSession` from `jazz-tools` | `createJazzClient` from `jazz-tools/client` |
| `session.user.account` | `session.user` |
| `beginExclusiveTransaction` | `beginSerializableTransaction` |
| Exclusive/transaction conflict handling | Also recognize `serialization_conflict` |
| `withAttributionForRequest` using captured auth headers | `forReqUser` using a captured Request |
| Request-authentication error handling | Also recognize `isNoJazzAccountError` |
| Session/config types from `jazz-tools/svelte` | Client types/config from `jazz-tools/client` |

Clipper's `tooling/build-domain-transaction-vendor.py` and
`vendor/auth-lifecycle-provenance.json` explain why generic workflows were updated
while native adapters were retained byte-for-byte. The provenance source is
`9c13e3f`; changes through selected `9d6dd84` to library source are test reference
annotations, not an upstream alpha.60 SDK conversion.

Before either consumer changes to a workspace source link, bring these adapters
into a reviewed source implementation against the exact installed alpha.60 SDK
and consumer patches, then qualify packed interfaces, session acquisition,
invitation authentication, transactional backup and offline/account lifecycles.
Do not broaden the peer range to claim compatibility or drop the adaptations.
Current source import remains alpha.59, with an explicit pending compatibility
path for alpha.60 consumers.

Reproduce after `pnpm dlf:package`:

```sh
python3 scripts/monorepo/compare-library-build.py /path/to/source-parent packages/local-first delightful-local-first > specs/002-monorepo-agent-guidance/local-first-package-comparison.json
```

The same generalized audit supports UI. It replaces `compare-ui-build.py` without
changing the underlying archive evidence or the UI source baseline.

## Fixture dependency-serving regression

The approved native browser checks first failed because the four disposable Vite
servers explicitly allowed only `process.cwd()`. After the move, the Jazz WASM
asset resolves under root `node_modules/.pnpm`, outside the package directory.
The server reported “outside of Vite serving allow list”; the browser then failed
to initialize. Test-server `fs.allow` now uses Vite's published
`searchForWorkspaceRoot(process.cwd())` API in the two native-capture fixtures,
private-creation restart fixture and test-app restore fixture. Default Vite file
deny rules and existing host/port choices remain intact. No test assertions,
timeouts, library behavior or SDK patches changed. All 20 native cases and all
10 private-creation cases passed after this fix.

## Verification and implementation review

Isolated source baseline and integrated workspace both passed frozen installation,
library-only Svelte/TypeScript checks (zero errors/warnings), package generation
and strict publint. Paraglide requires network access to its existing pinned
message-format plugin. A sandbox-blocked plugin fetch first produced incomplete
local generated output; rerunning with access succeeded. No localization source was changed. Implementation tests ran only after the
user approved this concrete slice with “Continue”.

Under the combined root lockfile, website and UI checks remained clean, all 283
existing website/UI unit tests passed, UI package validation passed, and the
website production build and emitted SSR route/feed/redirect checks passed. These
checks cover the already imported projects; they do not substitute for Local
First qualification.

Spec Kit path discovery from the Local First directory resolves its own feature;
root discovery continues to select the migration feature. Test/spec files compiled
by packaging are excluded from publication. Separate approved test commands
exercise the retained source and public package interfaces.

The approved qualification completed successfully:

| Check | Isolated source baseline | Integrated workspace |
| --- | --- | --- |
| Frozen install and library package validation | Passed | Passed |
| Unit tests | 1,085 passed | 1,085 passed |
| Packaged consumer types, runtime checks and builds | Passed | Passed |
| Format, lint and full Svelte/TypeScript checks | Not repeated | Passed |
| Generated session readiness | Covered by baseline unit suite | 27 passed |
| Native backup/capture and export | Not repeated | 20 passed after fixture path fix |
| Private creation and restart | Not repeated | 10 passed |
| Backup restore browser integration | Not repeated | 72 passed; 7 opt-in measurement skips |
| Public Storybook build | Not repeated | Passed |
| Storybook Chromium | Not repeated | 63 passed |

The seven skipped restore cases are existing workload measurements gated by
`DLF_BACKUP_MEASURE` / `DLF_BACKUP_RECORD_MEASURE`; no new skip was introduced.
The first native run failed on the fixture serving boundary described above;
only that failure-triggered rerun and remaining checks were needed. No SDK or
library implementation change was needed to pass the imported qualification.

This completes local qualification of the alpha.59 source/wiring slice, including
combined-lockfile reconciliation. Root CI now reproduces the source verification
sequence; it has not been executed on a hosted runner yet. Consumer archive
replacement, alpha.60 compatibility, hosted integration and source handoff remain
pending. User approval applies to this slice and does not remove the library's
review-before-tests rule for subsequent implementation changes.

## Rollback

Revert integration changes and the subtree import together, using destination
parent 1 for the import merge. Restore the website/UI-only lockfile and frozen
install. Keep subsequent unrelated changes. No consumer release or stored user
data changed, so rollback needs no SDK downgrade or storage migration. No live
resources or repository settings were modified.
