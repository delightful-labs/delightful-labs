# Actor orchestration tasks

The workspace phase (W001–W012) is complete, reviewed and verified. Its ownership, contracts and
cleanup model are documented in [plan.md](plan.md) and the
[workspace architecture](../006-multiple-workspaces/plan.md). Completed implementation checklists
and historical test-count logs are omitted.

All subsystems were explicitly resumed after their audits. The user authorized D010–D012 as one
combined implementation and verification batch. Completion evidence is recorded below and in the linked plans.
Bank orchestration is complete through the focused review cycles below. D001's source audit is recorded in
[bank-audit.md](bank-audit.md); implementation scope remains subject to review.

## Completed: bank orchestration — focused review cycles

- [x] D001 Audit the bank tree's ownership, actor contracts, snapshot coupling and resource lifetimes; record which boundaries to retain, merge or change (FR-014). Source audit complete; no runtime verification claimed.
- [x] D002 After separate scope approval, improve bank command/status contracts and responsibility boundaries identified by D001. Preserve credential disposal, explicit user initiation and actual cancellation semantics (FR-014).
      The reviewed setup persistence settlement slice is implemented and verified in
      [setup-settlement.md](setup-settlement.md).
      [Mapping transaction ownership](mapping-transaction.md) is reviewed and verified;
      [import/disconnect settlement](import-settlement.md) is reviewed and verified.
      [Availability/history reports](bank-reports.md) are reviewed and verified.
- [x] D003 Review that implementation, then verify cancellation, identity/scope replacement, partial results, observer errors, provider request races and resource cleanup (FR-014).

## Completed: generic form orchestration — focused review cycles

- [x] D004 Audit scoped-form availability/submission/write/completion composition, forwarding wrappers, snapshot copying and shutdown ownership (FR-014). Source findings and proposed review slices are in [form-audit.md](form-audit.md); no runtime verification claimed.
- [x] D005 After separate scope approval, implement only justified form boundary changes; retain original write scope and independently owned completion effects (FR-014).
      The [submission progress report](form-progress.md) slice is reviewed and verified. The [readiness adapter](form-readiness.md) is reviewed and verified, including queued-assessment replacement fixes. [Transaction creation ownership](transaction-creation.md) and [transaction editing ownership](transaction-editing.md) are reviewed and verified. [Avatar save ownership](avatar-preparation.md) is reviewed and verified.
- [x] D006 Review that implementation, then verify permission changes, input/reset/cancellation, submitted writes, completion failures and unmount draining (FR-014).
      [Transaction creation ownership](transaction-creation.md) is reviewed and verified with migrated
      fixtures, resource/interruption coverage and relevant unit/browser/static checks.
      Transaction editing is also verified with migrated fixtures, guarded-domain/resource coverage,
      composed-operation races and relevant unit/browser/static checks.
      The four-file [avatar save implementation](avatar-preparation.md) is reviewed and verified with no
      shared form framework changes: 208 relevant unit tests, 12 browser checks and static checks pass.

## Completed: application/session supervision — focused review cycles

- [x] D007 Audit root/session attachment, retry, observer failure, replacement and supervision contracts beyond the minimal workspace boundary wiring (FR-014). Source audit complete in [session-audit.md](session-audit.md); audit reviewed; recovery/drain implementation is reviewed and verified.
- [x] D008 After separate scope approval, implement justified supervision changes with explicit live/completed/failed dependent handling (FR-014).
      Retry ownership is reviewed and verified in one production file; see [session audit](session-audit.md). The six-file [recovery/drain implementation](session-recovery.md) is reviewed and verified.
- [x] D009 Review that implementation, then verify startup acquisition, observer failure, session retry, replacement races and application teardown (FR-014).
      Retry ownership is verified: 88 relevant unit tests, four startup/session recovery browser checks and static checks pass. Recovery/SDK drain is verified with migrated fixtures: 102 relevant unit tests, nine browser checks and static checks pass.

## Completed: inspection and architecture follow-through — final combined batch

- [x] D010 Design opt-in actor-system inspection of lifetimes and event causality with sensitive payloads excluded (FR-015). The subsequent user-directed removal is recorded in [inspection.md](inspection.md).
- [x] D011 After separate scope approval, implement and review diagnostics; then verify correlation and absence of credentials/private payloads (FR-015). Historically implemented and source-reviewed under the combined authorization; subsequently removed at the user’s request, with no replacement configured. Before removal, 1,049 unit tests, 21 browser checks, static checks and the production build passed. See [inspection.md](inspection.md).
- [x] D012 Reconcile lessons from completed subsystem audits into orchestration memory and remove only abstractions demonstrated to be redundant. Record final ownership diagrams and remaining exceptions (FR-013–FR-015). Completed in [architecture.md](architecture.md), XState memory and the workspace plan; removed only unused startup status commands and workspace snapshot forwarding.

## Completion

All workspace and D001–D012 orchestration work is complete. The user separately authorized the final
combined design/implementation/verification pass. Historical validation before inspector removal: 1,049 unit tests across 68 src/lib
files, 21 relevant browser checks, both static checks, Prettier, diff checks and production build.
Browser coverage is scoped to diagnostics, shared forms and recovery; historical domain checks remain
linked to their focused implementation plans. No full unrelated finance/PWA browser rerun is claimed.

## Follow-up: startup observation contracts

- [x] S001 Review the implemented scoped bank access, credential, mapping and history event contract in [architecture.md](architecture.md#startup-observation-contract--reviewed-and-verified). Preserve immediate invalidation, original operation scope and resource settlement. The full review identified a historical-result diagnostic false positive and pending fixture migration; both are addressed.
- [x] S002 After implementation approval, migrate affected bank availability/report/owner/import-settlement fixtures and coordinator mocks, add event isolation and stale-revision coverage, and verify relevant unit and bank/workspace browser flows in an isolated checkout. Verified: 214 unit tests, 12 browser checks, application/service-worker and browser-test type checks.
- [ ] S003 Implement and review navigation-specific updates after the bank cycle; its current source audit found broad observation/generation churn.
- [ ] S004 Implement and review identity-bound creation eligibility events after the preceding cycles; startup and integrity already filter equivalent requests.
