# Finance draft PR #67: salvage review

Reviewed 2026-11-11 at source head
`8ac042576360d82a21c64a643eab97f09e4bdf7c`, against source base
`952ce14f37bc22efd4a9beeaeddd2093d62dfb46` and the current monorepo architecture.
The [source PR](https://github.com/delightful-labs/delightful-finances/pull/67)
remains a draft. After this review, the user deferred moving Finance's application
off the UI thread while continuing to use the monorepo and shared libraries.
The suggested salvage sequence below remains a recommendation for future review,
not an adopted implementation plan. See the [migration closeout](closeout.md).

## Recommendation

Do not merge or resume the entire branch as one migration batch. Preserve its
history as a reference and evaluate selected contracts and regression scenarios
in small changes against the current monorepo. Salvaging this draft is not a
dependency of completing the monorepo handoff.

The branch changes 189 files, adding 20,017 lines and deleting 1,258. It combines
native storage/lock custody, worker startup, transport protocols, projections,
forms and production route replacement. Completing the remaining integration
would be a substantial application migration rather than a cleanup exercise.
Its size alone does not establish poor code quality; the concrete blockers below
and the changed shared-library baseline drive this recommendation.

## Confirmed blockers at the reviewed head

1. **Production build fails.** The
   [types/unit/build job](https://github.com/delightful-labs/delightful-finances/actions/runs/42804673833/job/129790659279)
   passes 2,109 unit tests across 173 files and 20 worker-state tests across four
   files, then fails bundling the worker. The bundle reaches SDK Svelte provider
   files, including `JazzSvelteProvider.svelte` and
   `JazzSvelteClientProvider.svelte`, and reports parse errors. Passing unit tests
   therefore does not establish a deployable application. The exact import/config
   repair was not implemented or verified during this review.
2. **The production shell blocks existing routes.**
   [WorkerApplication.svelte, lines 31–35 and 77–90](https://github.com/delightful-labs/delightful-finances/blob/8ac042576360d82a21c64a643eab97f09e4bdf7c/src/lib/components/startup/WorkerApplication.svelte#L31-L90)
   admits only overview, accounts, category/tag settings, login and expense/income
   routes. `/account`, `/settings/banks` and `/settings/workspace` fall through to
   startup presentation even with a ready session. This is an unfinished cutover
   that would remove access to existing functionality.
3. **Account ordering is disconnected.**
   [WorkerShell.svelte, lines 88–93](https://github.com/delightful-labs/delightful-finances/blob/8ac042576360d82a21c64a643eab97f09e4bdf7c/src/lib/components/navigation/WorkerShell.svelte#L88-L93)
   disables ordering controls and supplies empty edit/done/move callbacks. This
   is a concrete parity gap, independent of the build failure.

The source execution checklist, `production-worker-cutover.md`, also identifies
the shell integration as an unfinished checkpoint. Older successful harness
results and the PR description must not substitute for qualification of the
current production entry point and all reachable finance flows.

## Material worth evaluating separately

- **Lock custody and native crash regressions.** Commit
  [`f9b2fc94`](https://github.com/delightful-labs/delightful-finances/commit/f9b2fc94accdf6a9065ebe278daea48d3003e8bf)
  addresses the case where worker termination releases a worker-owned Web Lock
  while Window can still execute queued account-selection writes. Its design
  keeps native leases in Window until storage admission is closed and native
  requests settle. Preserve the competing-tab/worker-termination scenarios.
- **Exact lease identity and stale-write rejection.** The independent lock
  protocol and storage protocol changes distinguish successive acquisitions of
  the same key, validate scope/correlation and reject stale operations. These
  are useful requirements for a future worker integration, not proof that the
  entire implementation is ready to import.
- **Lifecycle acceptance requirements.** Retain tests and requirements for
  unknown write outcomes, cancellation during acquisition, native drain receipts,
  identity replacement and secret cleanup. Reconcile them with current shared
  worker/channel/effect-drain contracts before copying implementation code.

Even the earlier custody commit spans 22 files. It is not an assumed clean
cherry-pick. Its native-host browser CI job was canceled at the reviewed head;
the review does not claim fresh cross-browser qualification of that commit.
This is preparation for a future worker boundary, not a demonstrated defect in
the currently deployed Window-owned Finance application.

## Suggested sequence if worker migration resumes

1. Inventory the custody requirements/tests against the current Local First
   worker contracts and Finance account-store boundary. Select the smallest
   independent gap and review its implementation before dependent tests, subject
   to the session's actual task-specific authorization.
2. Establish a production-bundle and native lifecycle baseline from current
   monorepo source. Verify the actual served application, not only a harness.
3. Move a bounded read-only flow, then a bounded financial write flow, preserving
   one SDK/resource owner and existing identity/storage namespaces. Keep each
   intermediate production release usable; do not ship a shell that masks
   unmigrated routes or add a second SDK owner to satisfy old consumers.
4. Require feature parity and native offline/restart, settlement, cancellation,
   access replacement, provider-consent and backup/restoration evidence before
   the production cutover. Account/profile, bank/workspace settings, ordering
   and other remaining integrations belong in that inventory.

The review inspected source and existing hosted CI logs. No new tests or browser
sessions were run, no application code was changed, and the source PR/branch was
left intact. Any later extraction needs its own implementation review and current
qualification; this note does not certify code for reuse.
