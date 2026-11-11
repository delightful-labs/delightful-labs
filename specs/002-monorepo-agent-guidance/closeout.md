# Monorepo migration closeout

Updated 2026-11-11. Core migration and application hosting handoff are complete.
This record supersedes pending-work statements in earlier slice checkpoints;
those records remain historical evidence. The closeout documentation is under
review, while implementation and deployment acceptance are already recorded.

## Development ownership

Use `delightful-labs/delightful-labs` for ongoing application and library work,
with feature branches and PRs targeting `master`.

| Project | Maintained location | Operating boundary |
| --- | --- | --- |
| Website | `apps/website` | Independent Vercel project; `delightfullabs.com` and writing routes |
| Finance | `apps/finance` | Independent Vercel project; `finance.delightfullabs.com` |
| Clipper web | `apps/clipper/apps/web` | Independent Vercel project; `clipper.delightfullabs.com` |
| Clipper extension | `apps/clipper/apps/extension` | Preserved extension identity; unpublished production candidate |
| UI | `packages/ui` | Generic presentation, workspace consumption and packed public exports |
| Local First | `packages/local-first` | Shared foundations, workspace consumption and packed public exports |

All projects use the root lockfile, Node 24.22.2 and pnpm 10.28.0. Root default
commands still invoke the website; the [README](../../README.md) lists scoped
commands. Shared guidance starts at [AGENTS.md](../../AGENTS.md); local feature
selectors and domain requirements remain scoped to their projects.

The four former app/library repositories remain available and unarchived for
history and the retained items below. They are not the destination for new
development. Existing discussions retain their original URLs; future work should
reference them from monorepo PRs. This documentation does not close or transfer
issues/PRs, change old repository settings or retire hosted rollback artifacts.

## Completion evidence

- **Source and history:** website move, UI, Local First, Finance and Clipper
  imports retain recorded path mappings, original commits and provenance. See
  [implementation](implementation.md), [source inventory](source-inventory.json)
  and each linked slice record. The [current upstream audit](upstream-review.json)
  distinguishes imported work from deferred work and later equivalent CI fixes.
- **Workspace and packages:** internal consumers use workspace UI/Local First;
  frozen installation, peer-specific module identity, packed exports and consumer
  verification are recorded in [qualification](qualification.md),
  [UI workspace links](ui-workspace-links.md) and [alpha.60 adapters](alpha60-adapters.md).
- **Guidance and CI:** [shared guidance/CI](shared-guidance-ci.md) records the
  stricter common rules, topic ownership, six-context discovery, Conventional
  Commits title check and conservative dependency-aware test selection.
- **Website hosting:** the approved root/output change and custom-domain repair
  are completed. [Domain acceptance](live-domain-repair-proposal.json) records
  DNS, ownership, apex/www HTTPS and browser checks. Earlier pending HTTPS or
  preview statements in hosted/post-merge notes are historical checkpoints.
- **Finance and Clipper hosting:** [application handoff](app-preview-handoff.json)
  records approved monorepo Git connections, roots, staged production builds,
  promotion, public-domain acceptance and previous deployments for rollback.
  Project identities, environment variables, domains and production storage
  naming were preserved. Synthetic-account tests do not claim inspection of
  existing users' private data.
- **Extension:** [release handoff](extension-release-handoff.json) records the
  exact production candidate, preserved ID, artifact digest and native Chromium
  checks. The [release guide](../../apps/clipper/docs/extension-release.md) and
  opt-in check are merged in [PR #14](https://github.com/delightful-labs/delightful-labs/pull/14).
  Its required CI, including the isolated packaged extension suite, passed.
  A store upload is not required to establish the preserved independent build
  and release path.

These records cover the specification's source/history, shared-development,
guidance, CI-selection, independent-operation and release-continuity outcomes.
They do not declare unrelated product or full platform qualification complete.

## Outstanding-work dispositions

| Item | Disposition | Migration impact |
| --- | --- | --- |
| [Finance draft PR #67](https://github.com/delightful-labs/delightful-finances/pull/67) | Application-worker migration deferred by the user. Preserve the branch/reference and [salvage review](finance-worker-pr67-review.md); any extraction needs a separately reviewed monorepo change. | Does not block closeout. Finance continues to run with its current Window-owned application and shared packages. |
| [Finance issue #61](https://github.com/delightful-labs/delightful-finances/issues/61) | Retain `apps/finance/archive/jazz-alpha59` and active legacy-backup fixtures. Revisit cleanup only after its dependency, historical-reproduction, rollback and restore-verification criteria are met. | Deferred cleanup, not missing import work. No archive or backup deletion is authorized here. |
| [Clipper source PR #38](https://github.com/delightful-labs/delightful-clipper/pull/38) | Merged upstream as `9930bc3c`. Product commits through `4972bd3a` were already imported in monorepo PR #12. Later source changes affect only CI and have equivalent image/home-ownership fixes in monorepo CI. | Reconciled; no remaining product delta identified. |
| Public extension release | The user explicitly chose not to release publicly now. Keep the candidate unpublished; store listing/version, installation/update and broader browser/OS qualification remain future release work. | Out of scope for current closeout. |
| Former repository retirement | Keep all four source repositories available and unarchived. Archive/read-only settings, source notices and issue transfers can be considered separately. | Administrative follow-up; not required for monorepo use. |
| Legacy hosting/integration retirement | Keep existing historical integrations and rollback artifacts unless separately reviewed for retirement. | Optional operational cleanup; public app cutovers are complete. |

The upstream audit found no open issues or PRs in UI, Local First or Clipper.
Finance has only draft #67 and issue #61. This is a dated snapshot, not a claim
that an unchanged old repository cannot receive new work later.

Deferring Finance's whole-application worker move preserves current behavior;
it does not relax worker ownership and other shared rules for new or reworked
code. Similarly, keeping the extension unpublished does not waive its future
release or compatibility gates.

## Closeout boundary

No known unimported product work blocks the core migration. Review and merge this
closeout record with the refreshed upstream inventory and Finance review note.
Remaining product migrations and optional administrative retirement should be
tracked separately rather than leaving completed import/hosting tasks open.
