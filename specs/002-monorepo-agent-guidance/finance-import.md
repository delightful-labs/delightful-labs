# Finance workspace import

## Source and scope

Imported `delightful-labs/delightful-finances` default branch main at
`230bc7cc38db3745d75b3c6fd40c861855fa0cf1` into `apps/finance` using
an unsquashed git subtree (`e0cb6e9`). Original commits remain reachable and
`git show <source>:package.json` works locally. The original checkout, current
source branches, deployment destinations and user storage are untouched.
All tracked source files were initially imported, including historical archives, synthetic
backup fixtures, domain policies and feature artifacts. Issue #61's deferred
archive cleanup remains deferred. Open PR inventory is pending the GitHub token
policy restriction documented in `sdk-runtime-patches.md`; no source handoff is
claimed. Upstream commits still need reconciliation before cutover.

## Workspace changes

- Root pnpm 10.28.0 manages the app and its nested worker-state test package;
  the app packageManager now agrees. Node 24.22.2 qualifies the source's Node 24
  requirement. The nested lock/workspace files are retired; exact Finance
  importer, package and snapshot entries are merged into the root lock. Existing
  root resolutions and Finance dependency versions are preserved. SDK patch
  references use the root combined patch instead of Finance's previous hash.
- Finance consumes `delightful-ui` through `workspace:*`. The imported source
  version matches the active UI archive's source commit and its packaged runtime
  comparison. A peer-specific injected workspace dependency preserves Finance’s Svelte
  5.57.2 instead of using the UI development copy’s Svelte 5.57.3; a direct link
  exposed incompatible nominal snippet types. pnpm runs UI’s existing
  `prepublishOnly` packaging during injected preparation, and
  `syncInjectedDepsAfterScripts: [package]` refreshes copies after rebuilding.
  Frozen clean installs must provide ignored `dist` exports before app use.
  `build:libraries` explicitly rebuilds both packages. See
  [pnpm workspace guidance](https://pnpm.io/workspaces/).
- The worker-recovery Local First archive remains active until its distinct
  workflow changes are reconciled with library source. Its UI peer now also
  resolves the injected workspace package. The superseded Finance UI archive and
  its active-vendor provenance entry are removed; original history retains both.
  No XState patch or direct dependency version upgrade is introduced.
- Root `finance:*` commands delegate with the app's working directory, retaining
  local Vite, Paraglide, worker paths and deployment config. Root defaults still
  invoke the website. Build with `FINANCE_PREVIEW=true` and explicit disposable
  build values locally; this does not start a persistent Jazz backend.

The exact-version `@layerstack/utils@2.0.0-next.19` published manifest omits a
Svelte peer despite importing `svelte/store` in `dist/locale.d.ts`. Root
`packageExtensions` supplies `svelte: ^5.0.0`; otherwise its declaration loads
hoisted Svelte 5.57.3 alongside Finance 5.57.2 and produces nominal snippet type
errors even in Finance's own components. No third-party files are patched.
The existing layerchart/runed SvelteKit 2 peer warning against source Kit 3
remains; this migration does not upgrade either dependency to hide it.

## Guidance and feature state

Finance's constitution, XState/Jazz/localization/testing memories and AGENTS
rules stay local. Financial precision, organization authorization, provider
secrets, unstyled localized UI, machine ownership, no casts/switches, review
policy and commit policy are not promoted to root requirements. Source/local
server safeguards continue to apply. The user's 2026-11-10 instruction explicitly
authorizes ongoing migration implementation including tests for this session;
normal review gates remain in the source guidance for future app work.

Source had no tracked feature selector. Its untracked source-checkout selector
is not imported. The app selects the new scoped `017-monorepo-import` spec;
root, website and Local First selectors remain unchanged. Finance templates were
byte-identical to root and are shared through symlinks. Helpers use the shared
nearest-project resolver; `check-prerequisites.sh --paths-only --json` resolves
Finance and its selected spec when invoked from the app. Constitutions and
memories remain independent.

## Qualification

Before integration, an isolated archive of the exact source commit passed a
frozen install, zero-diagnostic app/service-worker checks, and all 1,940 unit
tests in 142 files on Node 24.22.2 / pnpm 10.28.0, using its original SDK patch.

Workspace verification is recorded below as it completes. Relevant coverage
includes the complete app unit suite (shared SDK/runtime changes), worker-state
campaigns, native host adapters, preview worker/WASM/service-worker bundling and
browser authentication/offline startup. No catalogs, generated localization
files, app workflows or financial schemas are edited by this migration.

## Remaining acceptance

Qualify browser account/recovery/offline flows with disposable storage, then
compare a Vercel build/tracing artifact before proposing hosted Root Directory
or required-check changes. Keep current production configuration and source
repositories active until reviewed cutover. Rollback reverts workspace integration
and uses the retained pre-import source/deployment; no user-data rollback is
needed for these source/tooling changes.

Type-resolution tracing also identified the same missing Svelte peer in
`@layerstack/svelte-state@0.1.0-next.25` (`mediaQueryPresets.svelte.d.ts` imports
`svelte/reactivity`). It receives the same exact-version manifest correction.
An inherited transitive peer suffix alone did not install its own Svelte link.

Static inspection identified `@layerstack/svelte-actions@1.0.1-next.20` as the
third manifest missing this peer: it imports `svelte/action` declarations and
`svelte/motion` at runtime. Its exact version receives the same extension.
`@layerstack/tailwind` has no direct Svelte import and needs no added peer.

Workspace checks pass with zero Svelte diagnostics, including service-worker
TypeScript. All 1,940 unit tests in 142 files pass, matching the source baseline.
Worker campaigns pass 17 tests in 3 files; host adapters pass 36 tests in 4 files.
The preview build succeeds with emitted workers, Wasm and service-worker assets.
`check:tests`, `check:e2e` and the nested worker package's type check pass. The
nested package explicitly declares TypeScript 6.0.3, previously supplied only by
its old workspace parent. No app assertions or production source were changed.

Root `.github/workflows/finance.yml` preserves every source CI job: static/unit
checks, six browser selections, native/browser restore, six feature-flag cases
and production PWA coverage. Only workspace context, pnpm version, artifact paths
and destination default branch change. Nested original workflows remain inert
provenance. Local qualification does not claim hosted Actions execution.

A fresh `git archive 48a4849` checkout, with no prior generated files or
node_modules, passes `pnpm install --frozen-lockfile` and `finance:check`.
This confirms UI exports are prepared for clean peer-specific consumption.
The [lock reconciliation](finance-lock-reconciliation.json) records every direct
resolution and the deliberate UI link / worker TypeScript declaration.

All 17 existing account/recovery browser tests and all 23 permission browser
tests pass against the disposable in-memory agent server. All 7 production
startup tests pass in the separate clean checkout, including complete browser
restart with offline or unanswered remote connections, continued local saves,
real server rejection and bank history retention. The agent server was stopped
after verification; user servers and storage were untouched.

The local Vercel-adapter build succeeds using placeholder deployment/build
values, with no deployment. [Artifact inspection](finance-vercel-artifact.json)
confirms the Node 24 handler exists, traced SDK native binaries and Wasm exist,
browser worker Wasm is emitted, and no output symlinks are broken. Optional ws
native acceleration addons produce non-fatal trace warnings. A hosted Linux
build and live preview remain required before changing hosted settings.

Shared library regressions under the final root lock pass: UI 131 tests / 30
files and Local First 1,090 tests / 52 files. Full Finance source CI remains
configured; local evidence above is not a claim that every matrix has run.
