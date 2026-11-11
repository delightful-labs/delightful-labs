# Slice 2: UI source and history import

## Provenance and boundaries

Imported `delightful-labs/delightful-ui` at
`7a7f61b236220bb5edb2bef4390b9db075775e43` using a Git subtree add without squash.
Import commit: `b0b4c82`. Original commits are ancestors of this branch, so history
is retained independently of source hosting. `git show 7a7f61b:src/lib/index.js`
reads the original public entry point. `git merge-base --is-ancestor 7a7f61b HEAD`
succeeds. Source root maps to `packages/ui`; no unfinished branch is imported.

The selected revision is the source default recorded in the inventory and named
by Finance/Clipper's current archives. Original docs, assets, test fixtures,
configuration and source workflow records are retained. No local install,
generated output, environment settings or Git internals were copied into tracked
source. Original repository issues, PRs and hosted settings remain there. No
archival, source-of-truth handoff or external publishing occurred.

The library retains package name `delightful-ui`, version `0.0.25`, exports, peer
constraints, app/test/package commands and all source/test files unchanged.
Package commands still verify the emitted public package via `publint`. Package
publishing remains independent of the website and other apps. No app is switched
to a new UI implementation in this slice. The website retains its older archive;
Finance, Clipper and Local First remain maintained in their source repositories.

## Workspace integration

Root commands: `pnpm ui:check`, `pnpm ui:test`, `pnpm ui:package`, `pnpm ui:build`.
Direct library commands also work from `packages/ui`. Node 24.22.2 and pnpm
10.28.0 were qualified for both imported projects. UI's `packageManager` field is
updated to the root version; the original pnpm 10.22.0 lockfile is retained in
history instead of maintained as a competing nested lockfile.

The root lockfile combines both existing dependency closures, preserving importer
versions. UI retains Svelte 5.57.2, Kit 3.0.1 and Vite 8.3.4; the website retains
Svelte 5.57.3, Kit 3.1.1 and Vite 8.3.7. The two shared snapshots for
`is-reference@3.0.3` and `estree-walker@3.0.3` resolve `@types/estree` to the
website's existing 1.0.10 rather than UI's prior 1.0.9. This is the only shared
snapshot reconciliation, affects type definitions, and passed both projects'
checks and package builds. No runtime/framework upgrade was introduced.

Root CI adds a UI job reproducing the source unit/browser/package/Storybook
checks. Nested source `.github/workflows` files remain provenance records and
are not active GitHub workflows in the destination. Existing website job identity
and checks remain. Until more projects and dependency edges are qualified, CI
conservatively runs both projects on every PR; root lockfile/config changes also
exercise both. New UI job requirements have not been added to hosted protection.

## Guidance disposition

Source: imported `AGENTS.md` at the selected revision. Every source rule retains
its scope as follows:

| Source topic | Disposition | Rationale |
| --- | --- | --- |
| Pinned v6 schema/function model; migration docs | Local, UI entry point | Library implementation contract |
| Installed docs/stability manifest, design audit, no XState patches | Local, unchanged | Existing qualification requirements |
| Visible transitions, predicates, immutable patches, queued effects/order | Local, unchanged | Not reconciled as universal app policy |
| Component ownership of DOM resources and cleanup | Local, unchanged | Library resource lifecycle |
| Network server default and discoverable URLs | Shared root rule; local link replaces duplicate | Same current user instruction |
| Observable behavior/native HTML/accessibility tests | Local, unchanged | UI verification policy |
| No computed/inline CSS or class assertions | Local, unchanged | Does not retroactively govern sibling tests |
| Semantic selectors; stable IDs only when needed | Local, unchanged | UI test discovery |
| Replace style assertions with behavioral checks | Local, unchanged | UI test semantics |
| Styles allowed for scenario setup | Local, unchanged | Explicit existing exception |
| v6 generated testing, independent oracles, preserved gates | Local, unchanged | Source testing commitments retained |

No approval gate is waived or broadened. Shared policy reconciliation for the
remaining projects stays open. Root guidance links UI tasks to its scoped entry
point and design docs. UI has no `.specify` selector; its decisions remain in
its imported `docs`, without inheriting the website's feature selector.

## Evidence

An isolated source baseline passed frozen install under Node 24.22.2 / pnpm
10.28.0, zero Svelte diagnostics, 131 unit tests, packaging and `publint`.
The integrated workspace frozen install then passed using the combined root
lockfile (467 packages). Its UI checks, 131 unit tests, build and package
validation passed. The website's checks, 152 unit tests, production build and
emitted-server route/feed/redirect checks also passed with the combined install.

[Emitted package evidence](ui-package-comparison.json) records a byte-for-byte
match for all 120 library files against each Finance/Clipper archive, with no
extra or missing emitted files. It checks current library source files against
the selected original commit before comparing the build. Reproduce after
`pnpm ui:package`:

```sh
python3 scripts/monorepo/compare-ui-build.py /path/to/source-parent packages/ui > specs/002-monorepo-agent-guidance/ui-package-comparison.json
```

UI browser verification passed: all 27 app checks and 191 Storybook checks
passed, with 11 existing conditional skips. Public Storybook also built
successfully. Browser checks used the library’s isolated preview servers; no
existing user server was stopped and no test implementation was changed.

The website and Local First development archives still differ, as expected;
those consumers need their own reviewed workspace-link compatibility slices.
The report compares `dist` files; metadata contracts remain separately recorded
in the archive inventory. Rebuilding does not prove those consumers support the
new behavior, so this slice leaves their archives in place.

## Acceptance and rollback

This accepts UI source/build integration locally, not a release or a source
repository handoff. Source-repository discussions, public Storybook hosting and
release settings remain there until separately inventoried and handed off.
No website deployment-root or production setting changes were made.

To roll back, revert the integration change and subtree import together (the
subtree import is a merge; use parent 1 as its destination mainline), restore the
website-only lockfile and run a frozen install. Preserve newer unrelated work;
do not reset shared branches or erase original history. Existing consumers and
published packages keep working because their dependencies were not changed.
