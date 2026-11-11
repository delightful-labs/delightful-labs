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
`theme.css` remains unchanged for Finance, Clipper and the UI development app.

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
