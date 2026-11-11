# Article metadata PR import

User requested importing [Clipper PR #38](https://github.com/delightful-labs/delightful-clipper/pull/38)
into the monorepo on 2026-11-11. The source PR was open at inspection.

Source head: `4972bd3a43587c26afe854325f16bdc9d1d1d72e`.
Source base: `0fd1cb389e8fccc9e5eecb642f9c0f10fa42d5e6`.
Imported commits: `56546d01c74950518b830385cd50d7963d2e1ec5`
and `4972bd3a43587c26afe854325f16bdc9d1d1d72e`.

The subtree integration maps source paths beneath `apps/clipper` and preserves
source history. It is based on monorepo follow-up commit `3196f073`, which already
contains the Finance fixture and Clipper CI job-budget fixes awaiting review in
monorepo PR #11. The newer monorepo extension sign-in lifetime fix and exact
public-icon offline expectations are preserved. Source PR #38 remains open;
this import does not merge or close it or publish a production deployment.

Imported behavior retains full excerpts and nullable article metadata, projects
bounded library previews in the worker, and queues featured images through the
existing offline image workflow. The original two additive migrations and
snapshots are retained unchanged, with no refetch, destructive reset or backfill.
The source authorization and migration contract remain in
[the metadata memory](../../docs/memory/article-metadata.md).

All implementation files match the source PR byte for byte. Import adaptations
retain the enabled Linux sign-in cases and exact offline icon expectations, and replace
three CSS-class browser locators with paragraph-role locators to meet the common testing rules. No dependency,
permission, localized copy or capture/account ownership change was introduced
by the integration.

## Verification in the monorepo

- `pnpm --filter delightful-clipper verify`: passed vendor, formatting, lint,
  strict tooling/web/extension types, all 921 unit/native tests in 136 files,
  and production web/service-worker build.
- Desktop/mobile excerpt capture: 2/2 passed, including full metadata, featured
  image bytes, literal-markup safety, preview bounds, accessible descriptions
  and reload without recapture.
- Chromium/Firefox historical schema upgrades: 8/8 passed, covering cold/live
  clients and rejected-deployment recovery, retained legacy content and previews.
- Production offline suite: 8/8 passed, including cold browser restart with both
  servers stopped and metadata/featured-image reconciliation.
- Packaged Chrome extension suite: 12/12 passed, including native metadata capture,
  duplicate preservation, sign-in, account changes and repeated settings teardown.
- Workspace guidance and all eight shared module-identity checks: passed.

All native tests use disposable authorities, databases and browser profiles.
These are local results; they do not establish hosted CI or production cutover.
