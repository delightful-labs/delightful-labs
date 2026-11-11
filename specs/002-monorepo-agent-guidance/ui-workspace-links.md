# Remaining UI workspace links

The user authorized UI workspace-link implementation including tests on
2026-11-11. This slice replaces the website and Local First development UI
archives while preserving their existing font choices, product content, feature
selectors, consumer behavior and all other apps' current UI defaults.

## Compatibility decisions

Website Heading/Text/Navigation source assets are byte-identical to workspace UI.
Its theme archive SHA-256 is
`bdd1f72bd0aef25e0f20d0c8567c4e8e259dec900c7b66f8390545f64a7ddf3c`.
Local First's development theme SHA-256 is
`ad46e0171171e1e2f7efb54b85a2e8e977ddf8bd8c2162179b473bec6bfe390d`.
After removing the website theme's shared property registrations, their remaining
styles are byte-identical. Both use Source Code Pro/monospace for controls and
system/sans-serif body defaults. Current UI instead bundles Jost/Cascadia fonts.

An explicit `delightful-ui/theme-classic.css` export retains the existing theme
and maps the newer interactive-font role to its existing control-font token.
No new font, size, weight, spacing or color is chosen. UI remains the sole owner
of its theme registrations; consumers import one theme entry. Current
`theme.css` defaults remain unchanged for Finance, Clipper and the UI development app.

Website and Local First use `workspace:*` UI dependencies. Both retain Svelte 5.57.3, while UI development resolves 5.57.2; peer-specific
injected workspace copies preserve the consumer versions. Existing
Finance/Clipper peer-specific copies continue to use Svelte 5.57.2. The module
identity check expands to both new links and checks devDependencies as needed.

Local First's older UI snapshot differs in property registrations, added public
exports, dialog native-close synchronization and component implementations. Its
actual compositions will be qualified through library types/package consumers
and the complete existing Storybook browser suite. UI's own unit/browser tests
cover the current component behavior; no machine conversion is part of this slice.

## Verification plan

Build the existing consumers in an isolated baseline checkout. Compare website
screenshots with fixed viewport/reduced motion and public theme asset provenance;
verify navigation and native blog behavior with existing browser coverage.
Preserve exact classic-theme declarations in source evidence, without adding
computed-style/class assertions. Run website check/unit/build/output/browser
checks, library check/unit/package/consumer/Storybook checks and relevant UI
unit/browser coverage. Build and browser tests within each project run sequentially.
Validate packed UI theme export as well as installed workspace identities.

Remove only superseded active UI archives after source links pass; preserve Git
history, unrelated archives and all source/deployment restrictions. Fresh frozen
installation must prepare exports and pass every module-identity check. Record
results, remaining limitations and rollback below before completing this slice.

Both theme entries import one `theme-properties.css` registration owner, avoiding
duplicated token definitions. Expanding that import preserves the existing
default theme declarations; the classic variant retains the old declarations
plus the interactive-role alias and existing universal font-role registrations.

## Results — 2026-11-11

Implemented in `98d83751`, with canonical shared registrations in `265b3efc`.
The two active UI archives are removed; their original source/archive hashes and
Git recovery paths remain in [the evidence](ui-workspace-links-evidence.json).
No active UI file dependency remains in the root lockfile. Historical Clipper
artifacts are retained as unrelated provenance.

All eight installed source-library edges pass the expanded identity check. The
new website and Local First copies retain Svelte 5.57.3; Finance/Clipper retain
5.57.2. Reconciliation preserves their already-qualified shared SDK peer context,
including the pnpm optional-peer deduplication behavior recorded in the earlier
Finance source-link slice. No package version upgrade is introduced.

| Verification | Result |
| --- | --- |
| UI Svelte check, package/publint, production build | Pass |
| UI unit / native browser tests | 131 / 27 pass |
| Website Svelte check, unit tests | Zero diagnostics / 152 pass |
| Website production output, feeds, redirects and sitemap checks | Pass |
| Website browser tests | 7 pass, including no new font downloads |
| Local First full Svelte/TypeScript, format and lint | Pass |
| Local First unit tests | 1,098 pass |
| Local First package/publint and public consumer fixtures | Pass |
| Local First Storybook build / browser tests | Pass / 63 pass |
| Finance types / unit regressions | Zero diagnostics / 1,940 pass |
| Clipper web/extension types / unit regressions | Zero diagnostics / 906 pass |
| Standalone consumer installed from packed UI tarball | Build passes with public classic-theme import |

The unit total remains 4,227. The UI, website and Local First browser suites pass
97 tests. UI and Local First browser suites were rerun after extracting the
shared registration file, and the final website build was rechecked afterward.
No assertions about computed/inline styles or CSS classes were introduced.

All six website screenshots are byte-identical to the old-archive baseline:
homepage and writing index at desktop/mobile light mode and desktop dark mode.
Comparisons use reduced motion, fully loaded images, fixed viewports and blank
mocked app embeds. Both baseline and final captures have no page errors or font
requests. Screenshot hashes are in the evidence JSON; local PNG artifacts are
under `apps/website/test-results/ui-workspace/`. Live embedded applications and
published article content are not claimed as screenshot fixtures.

The classic declaration audit preserves every original website theme declaration,
with only the documented role alias and existing universal role registrations.
Expanding the shared-property import leaves the current default theme declarations
unchanged, so Finance/Clipper retain their chosen bundled-font defaults.

A fresh archive of `265b3efc`, without node_modules or generated exports, passes
frozen installation, all eight identities, website types and library types.
An offline lockfile-only install leaves the lock byte-identical (SHA-256
`3cbc39d287c8be21a257f3c95efd655703770fd764741c38d6b37bd5f304725b`).
The new public CSS entry and its shared internal asset also build in an isolated
consumer that installs the packed UI tarball, without workspace source aliases.

## Scope and rollback

Feature selectors, content, localization, application state machines, independent
release identities, user data and hosted settings are unchanged. No deployment,
push or publication was performed. The earlier source-baseline Clipper extension
sign-in failures remain outside this UI slice; this work does not claim to repair
them. Shared guidance and hosted cutover remain subsequent migration work.

Rollback reverts the dependency/theme-import commits and restores the two archived
artifacts from retained Git history. It requires no data migration. Keep both
theme entry points explicit: one chosen theme per application, UI-owned shared
registrations, and consumer-owned page layout.
