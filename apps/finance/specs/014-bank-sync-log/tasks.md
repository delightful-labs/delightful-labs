# Tasks: Bank Sync Log

The user requested the remaining implementation and verification together in one
final slice. Earlier foundation/logging/viewer cycles were separately reviewed
and committed. Subsequent review cleanups are tracked below.

## Foundation

- [x] T001 Inspect persistence, permissions and history APIs; write spec and plan.
- [x] T002 Add attempt/account schemas, canonical validation and scoped policies.
- [x] T003 Present foundation for review.
- [x] T004 Verify validation and full-application permissions.
- [x] T005 Generate the additive migration and snapshot; preserve existing tables.

## Recording

- [x] T006 Implement stable attempt/account identities, per-account import reports,
      best-effort start persistence before provider work and completion after financial cleanup.
- [x] T007 Present recording changes and recursively audit actor helpers.
- [x] T008 Verify financial result preservation, start/result failures, cancellation,
      issued writes, scope changes, unexpected logging crashes and no provider retry.

## Retention

- [x] T009 Implement authority knowledge acquisition, exclusive local rechecks,
      atomic child/parent deletion, cap/tie rules, cancellation and deferred outcomes.
- [x] T010 Present the statechart and resource/knowledge boundaries in the combined
      final slice; document the browser transaction-tier finding.
- [x] T011 Verify 100/101, ties, unfinished/other-connection preservation, concurrency,
      partial knowledge, authority timeout, transaction drain and browser wiring.

## Settings and completion

- [x] T012 Add settings-only scoped queries, bounded pagination, connection selection,
      pure history presentation and reusable outcome labels.
- [x] T013 Present mobile/desktop presentation and query ownership.
- [x] T014 Verify account expansion, paging/reset, reload, connection/workspace
      isolation, warm offline reads, cold unanswered-authority/full-offline reads,
      logging failures and integrated retention without provider requests.
- [x] T015 Reconcile final artifacts and record actual checks in verification.md.

Schema and permission publication to the release environment is a rollout step,
not a local test outcome. No production deployment ran. Transaction revision
history remains a separate feature. System-account display naming is implemented.

## Review follow-up

- [x] Move retention scheduling/lifecycle into the bank actor, independent of
      history selection, and preserve shutdown draining.
- [x] Remove optional profile enrichment from the history loading/error boundary.
- [x] After implementation approval, verify supervisor binding/drain and browser
      active-A/viewed-B/profile-failure regressions; repeat cold/offline history.

Follow-up results: 76 focused unit/lifecycle tests and six browser scenarios pass;
static/format checks pass. See verification.md for scope and the corrected test
navigation locator. These follow-up changes have been committed.

## Complete-review cleanup

- [x] Bound logging waits without blocking sync indefinitely; preserve issued Jazz writes.
- [x] Share unresolved operation-crash handling between logged and fallback paths.
- [x] Remove unread retention errors, logger error payloads and report provider IDs.
- [x] Share log failure construction, operation inputs and crash results.
- [x] Reuse Saved for confirmed history without a dedicated future-only string.
- [x] Centralize pagination defaults/reset and reconcile completed feature documentation.
- [ ] Review implementation, then verify stalled/late log writes, fallback crashes,
      cancellation/drain, pagination reset and existing browser history flows.

## Resilience follow-up

- [x] Review the supplied history summaries and distinguish observed facts from causes.
- [x] Implement provider processing in a disposable worker with bounded lifetime.
- [x] Preserve application-owned sync through navigation and financial-write draining.
- [x] Add optional positive-only duplicate snapshots, bounded reads and traversal yielding.
- [x] Repair invalid-mapping results, import error classification and existing-only status labels.
- [x] Add/update scoped unit fixtures and native bundled-worker tests after user approval.
- [x] Add Playwright navigation/repeat-sync/worker-failure regressions and update routing fixtures.
- [x] Address review findings: batch MessageChannel scheduling, one-shot validated
      replies, state-owned snapshot logging, empty-account fast path and shared relay HTTP.
- [x] Verify focused review regressions, including native channels, port disposal,
      malformed/late replies and transport contracts; 343 tests pass.
- [ ] Execute full application browser regressions and real-browser latency measurement:
      blocked by local-listener and browser-process sandbox restrictions. See
      [resilience.md](resilience.md) for evidence, passing checks and the run command.
