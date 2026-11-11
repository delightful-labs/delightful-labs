# Actor orchestration boundaries

Status: complete. Workspace, bank, generic form, application/session work is
implemented and verified. The custom inspector was subsequently removed at the user’s request. D010–D012 were authorized as one combined implementation/verification batch.
The [inspection plan](inspection.md) records the removal decision; historical checks before removal passed 1,049 unit tests, 21 browser checks, static
checks and production build. The [final architecture](architecture.md) records ownership and limits.
[spec.md](spec.md) defines the requirements.
The current workspace ownership tree and creation/integrity workflows are maintained in
[the workspace architecture](../006-multiple-workspaces/plan.md#actor-ownership), rather than a
second actor proposal or chronological implementation log.

## Implemented workspace contracts

- The coordinator owns startup, creation, integrity, navigation and the existing bank actor for one
  exact database attachment. WorkspaceBootstrap supplies Jazz/browser observations; bank presentation
  does not own the workspace attachment or reconstruct workspace authorization.
- Initialization reports identity/session request, generation and initialized profile ID. It accepts
  initialization provenance but does not backfill legacy profiles or select a home workspace.
- Integrity publishes a binding/generation-specific status through a typed recipient. Complete and
  attribution-only usable partial reports can enable finance when the coordinator's access rules also
  permit it. Category assessment/repair and blocked-partial branches have been removed.
- Navigation consumes route/catalog facts and the coordinator's access decision. The URL is authoritative.
  Management/account/login routes need identity readiness but remain available during catalog failures.
- Identity-bound creation survives selection changes. Its public view is projected through supported
  snapshot observation; finite operation results use outcome-specific payloads and invocation output.
  Persistence owns one shared preflight reconciliation pass, then a resource-owning transaction.
- Exact attachment matching and generation correlation reject obsolete detaches/reports. No global
  actor registry, event bus or generic supervisor framework is introduced.

## Lifetimes and cleanup

Startup, creation and integrity have distinct responsibilities and interruption policies; similar
replacement wrappers do not justify merging them. Fixed children remain invoked across work/draining
states. Resource owners retain read/check/stage/commit/settle/rollback decisions in statecharts.
Parents await actual cleanup before replacement or shutdown and do not request impossible
acknowledgements from failed/completed dependents. Navigation observation cancellation does not
promise to undo browser navigation already accepted by the platform.

The [integrity reporting contract](contracts/workspace-integrity-report.md) describes report currency.
The [XState memory](../../.specify/memory/xstate.md) contains reusable orchestration guidance.
Version-matched research used XState 5.33.2; check installed semantics before adopting newer examples.

## Completed subsystem follow-through

Bank internals, generic forms, application/session supervision and diagnostics were separately resumed
and completed through focused audits, rather than folded into workspace implementation. Bank work is complete: the
[ownership audit](bank-audit.md) and reviewed [setup settlement](setup-settlement.md) are
complete; [mapping transaction ownership](mapping-transaction.md) is reviewed and verified.
[Import/disconnect settlement](import-settlement.md) is reviewed and verified;
[Availability/history reports](bank-reports.md) are reviewed and verified. Their scoped evidence remains linked below.
The [generic form audit](form-audit.md) is complete. [Submission progress reports](form-progress.md)
are reviewed and verified. The four-file [readiness adapter](form-readiness.md) is reviewed and verified, including
queued-assessment replacement fixes. Transaction persistence ownership is reviewed and verified:
[transaction creation ownership](transaction-creation.md) is reviewed and verified.
[Transaction editing ownership](transaction-editing.md) is reviewed and verified.
The agreed [avatar save implementation](avatar-preparation.md) confines preparation and cleanup to a
domain operation in four production files, using the existing readiness/write boundary. It is reviewed
and verified with migrated fixtures, 208 relevant unit tests, 12 browser checks and passing static checks. Shared form validation
and controller code stay unchanged.
The [application/session audit](session-audit.md) records current ownership, retry lifetime and recovery/drain
findings. The focused application retry change is reviewed and verified with 88 relevant unit tests, four browser checks and passing static checks; SDK integration and recovery
are reviewed and verified in the [focused recovery/drain slice](session-recovery.md).
The [inspection decision](inspection.md) records removal of custom tooling; no inspector is configured.
The [final architecture](architecture.md) records ownership diagrams, proven redundant code removed
and retained SDK/platform limits. Only unused startup observation commands and unused workspace
snapshot forwarding were removed in the final cleanup. No broad controller or actor consolidation.

Future features still start by identifying responsibilities, lifetimes, command/report contracts and
resource owners. Preserve explicit bank initiation, credential disposal, original write scope, finite
outcome distinctions and local-first finance. This completed feature does not authorize deployments,
data resets, provider requests or unrelated product changes.

## Verification

Workspace changes and subsequent review fixes received relevant unit/browser and static checks,
including stale generations, replacement/draining, scope isolation, creation recovery, offline use,
profile-only integrity, navigation and accessible presentation. The final creation-result cleanup
passed 39 related unit tests and three creation/recovery browser checks, plus both type checks.
These are scoped results, not a final full application/PWA rerun. Reproducible commands and evidence
limits are in [workspace validation](../006-multiple-workspaces/quickstart.md).

Before the custom inspector was removed, the final follow-through passed all 1,049 src/lib unit tests, the 12 diagnostics/shared-form browser
checks and nine recovery browser checks, static checks and the production build. Independent roots retain their existing owners. All remaining task markers are closed.
