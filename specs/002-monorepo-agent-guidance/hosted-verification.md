# PR #10 hosted verification

Historical checkpoint record. Later completion, source handoff and deferred-work
status are recorded in the [migration closeout](closeout.md). Pending-work
statements below describe their original checkpoints, not current migration gaps.

The user requested pre-merge testing on 2026-11-11. GitHub CLI access now uses the
existing Keychain login after the shell PAT override was disabled. No source
repository, organization token policy, protection rule or production deployment
has been changed. The user explicitly approved the website build-setting change
recorded below.

## First hosted run at cc7d1edf

- PR title, all three selection jobs, website checks and UI checks pass.
- All Finance jobs pass: types/unit/build, all six browser matrix suites,
  workspace restoration, all feature-flag combinations and production PWA.
- Clipper tooling/types/build passes. Its combined browser job passes all web,
  schema, 32 worker and eight production offline cases, then reaches the overall
  15-minute job limit while its packaged extension suite runs. There is no
  completed Linux extension result in this run.
- Local First stops at formatting: one extra blank line in its rewritten local
  workflow memory. That line is removed and the full package formatter passes.
- The website Vercel preview builds successfully but fails deployment with
  `STATIC_BUILD_NO_OUT_DIR`: the project still expects `public` from the workspace
  root rather than the website's SvelteKit Build Output API artifacts.

The Clipper workflow now runs packaged extension tests independently of its
web/schema/worker/offline/fake-data job. Both retain their existing test assertions
and deadlines. The existing named browser check waits for and requires both job
results; failure/cancellation/skipping cannot yield its success. This avoids
spending the extension's execution budget on earlier unrelated suites. Thirteen
Node tooling tests pass, including required-check aggregation wiring; all four
workflow YAML files parse and the shared guidance checker passes.

## Upstream and hosted review

The [source audit](upstream-review.json) records exact current heads and open PRs.
UI, Local First and Finance still match the imported main revisions. Clipper's
new main is merged PR #37's public-icon cache assertion, already represented by
the migration correction. Unsquashed subtree merge `29cab027` retains that source
ancestry; resolving the overlapping test edit preserves the qualified exact
allow-list. The merge has no tree changes and current source main is an ancestor. Finance PR #67 is an unfinished draft worker handoff;
it remains in its source repository for subsequent work. No unfinished branch
was imported, closed or merged.

The destination currently has no rulesets. This read does not change required
checks or branch protections. PR and source history should be merged with a merge
commit, preserving imported ancestry.

The website hosting change is fully specified in
[website-hosting-proposal.json](website-hosting-proposal.json). The user explicitly approved
the following change, which is now applied: change the existing Vercel project root to `apps/website`, permit
shared workspace files outside that directory, restore default framework output,
and rebuild only the PR preview from the updated branch. Settings apply to future production builds too;
current deployment artifacts/domains are preserved. Production/source handoff
and merge remain separately authorized actions.

PR preview rebuilding and fresh hosted CI are pending. The Vercel connector supplies build logs and deployment metadata but omits the
project's detailed root/output settings. The browser connector is unavailable;
no attempt to change settings through a browser was made. Failed preview:
[dpl_6QmGRWkxAr6dzPFfUurnUMqchXX7](https://vercel.com/mjamesderochers-projects/delightful-labs/6QmGRWkxAr6dzPFfUurnUMqchXX7).
