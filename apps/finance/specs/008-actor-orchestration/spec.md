# Feature Specification: Actor Orchestration Boundaries

**Feature Branch**: `feature/xstate-orchestration`.

**Created**: 2026-10-22

**Status**: Workspace phase implemented and verified after review. Bank setup, mapping, write settlement and availability/history reports are reviewed and verified. The generic form source audit is complete; submission progress reports, the readiness adapter and transaction creation/editing ownership are reviewed and verified. Avatar save ownership is reviewed and verified; generic form boundary work is complete. Application/session supervision, including retry ownership and recovery/workspace drain coordination, is reviewed and verified. Final architecture reconciliation is complete and verified. The custom inspector was subsequently removed at the user’s request; no replacement is configured.

**Input**: Specify clearer actor ownership, lifetimes, communication and cleanup. Implement only workspace-related orchestration now; retain unfinished work for other areas in the repository.

## User Scenarios & Testing

### User Story 1 — Safely switch workspace context (Priority: P1, current)

A user opens, switches or revisits a workspace and receives availability and recovery feedback for that workspace and identity only.

**Why this priority**: Stale readiness must never enable work in a different ledger or under outdated permissions.

**Independent Test**: Switch between two workspaces while access checks and integrity repair complete in different orders.

**Acceptance Scenarios**:

1. **Given** workspace A is usable, **When** the user selects B, **Then** A's status cannot enable B's operations while B is being checked.
2. **Given** an old check for A is pending, **When** the user switches A → B → A, **Then** the old A report cannot satisfy the new A selection.
3. **Given** membership is revoked or changed during a check, **When** the old report arrives, **Then** it cannot restore the previous authority.
4. **Given** a malformed, duplicate or inaccessible explicit workspace query, **When** the page opens, **Then** the app does not silently select another ledger.
5. **Given** workspace management is opened without a selection, **When** the user's identity is ready, **Then** selection and creation remain available without granting access to a ledger.

### User Story 2 — Create and recover workspaces independently of selection (Priority: P1, current)

A user can create or recover a workspace even while another workspace is selected, without bank setup being a prerequisite.

**Why this priority**: Workspace creation belongs to the identity; selecting another ledger must not lose or duplicate the creation attempt.

**Independent Test**: Begin creation, change the selected workspace, and recover or complete the original attempt.

**Acceptance Scenarios**:

1. **Given** a creation attempt is active, **When** only the selected workspace changes, **Then** the attempt retains its original identity and recovery record.
2. **Given** identity or database attachment changes, **When** an old attempt is settling, **Then** it finishes required cleanup before its owner accepts replacement work, and its result cannot appear as the replacement identity's result.
3. **Given** no bank connection exists, **When** the user opens workspace management, **Then** initialization, creation, selection and integrity feedback remain functional.

### User Story 3 — Predictable recovery and shutdown (Priority: P2, current)

A user can retry workspace failures or leave the app without new work starting during cleanup or unresolved writes being reported as rolled back.

**Why this priority**: Safe resource settlement is necessary for reliable local-first finance.

**Independent Test**: Interrupt initialization, integrity repair and creation at their meaningful write/settlement boundaries.

**Acceptance Scenarios**:

1. **Given** a write has started, **When** shutdown occurs, **Then** its owner reports actual settlement before release; cancellation alone is not treated as rollback.
2. **Given** a child has already failed or completed, **When** shutdown starts, **Then** the parent does not wait for an acknowledgement that child cannot send.
3. **Given** shutdown or identity replacement is underway, **When** a late success, observation or retry arrives, **Then** it cannot reopen work or override shutdown intent.
4. **Given** integrity repair has only a profile-attribution issue, **When** its result is published, **Then** finance remains usable under the existing policy and the issue remains visible.

### User Story 4 — Extend the same discipline beyond workspaces (Priority: P3, completed after resumption)

A maintainer can later improve bank, form and application orchestration using documented ownership and communication boundaries without reopening the workspace design.

**Why this priority**: Preserve actionable follow-up work without expanding the current refactor.

**Independent Test**: For each later subsystem, review its ownership map and verify its existing user flows after a separately approved change.

**Acceptance Scenarios**:

1. **Given** workspace work is complete, **When** a maintainer resumes orchestration work, **Then** unchecked deferred tasks identify the subsystem, audit questions and required validation.
2. **Given** a deferred task is listed, **When** workspace work is implemented, **Then** that listing alone does not authorize refactoring the deferred subsystem.

### Edge Cases

- Separate tabs select different workspaces; reload, bookmarks and history preserve each tab's query scope.
- Route, membership, catalog and initialization observations arrive in different orders or fail independently.
- A late report matches the workspace ID but belongs to an obsolete identity, authority revision, attachment or selection generation.
- A child throws unexpectedly rather than returning a normal failure result.
- A selected workspace is unavailable while identity-wide creation is still eligible.
- Cancellation races a committed write, a journal update or a completed child.
- Legacy transaction resolution finishes after the URL or identity has changed.
- Submitted transaction work retains its original scope; unfinished inputs are discarded under existing switching behavior.

## Requirements

### Functional Requirements — current workspace phase

- **FR-001**: Workspace availability and action eligibility MUST refer to the current identity, database attachment, requested workspace and applicable authority revision.
- **FR-002**: Replacement or invalidation MUST immediately withdraw obsolete capabilities; reports from superseded operations MUST be ignored, including switch-away-and-back races.
- **FR-003**: Requested workspace selection MUST remain URL-authoritative through `?workspace=<uuid>`, independently per tab. `/settings/workspace` MUST remain the sole workspace management URL; no replacement route or redirect is introduced.
- **FR-004**: Identity-wide initialization and creation MUST have lifetimes distinct from selected-workspace access and integrity. Switching selection alone MUST NOT cancel identity-bound creation.
- **FR-005**: Workspace management MUST function without bank configuration, bank interaction or a selected workspace. Readiness to manage workspaces MUST NOT imply permission to use the selected ledger.
- **FR-006**: Workspace coordination MUST use explicit responsibility boundaries and scoped reports; consumers MUST NOT reconstruct another workflow's private lifecycle to decide authority or readiness.
- **FR-007**: One responsible owner MUST determine each access/readiness decision; other workflows MUST consume its result without duplicating its policy. Persistence-boundary invariant checks MUST remain.
- **FR-008**: Graceful shutdown and replacement MUST stop new commands and await required settlement from live direct dependents. Completed or failed dependents MUST NOT require impossible acknowledgements.
- **FR-009**: Failure, cancellation, successful completion, partial completion and unresolved settlement MUST remain distinguishable where relevant. Existing profile-link-only partial integrity usability MUST be preserved.
- **FR-010**: Focused retries MUST restart the responsible recoverable workflow without restarting unrelated work or sending commands to a failed actor.
- **FR-011**: The refactor MUST preserve creation recovery/idempotency, authorization, offline operation, navigation behavior and original-scope submitted writes from the multiple-workspaces feature.
- **FR-012**: Each focused implementation MUST be reviewed before its unit/browser tests are added or run. Passing formatting or static checks MUST NOT be reported as runtime verification.

### Functional Requirements — deferred phase

- **FR-013**: Bank orchestration, generic forms and application/session orchestration MUST remain separate unchecked follow-up scopes until explicitly resumed.
- **FR-014**: Each deferred subsystem MUST receive its own ownership/lifetime audit before refactoring; known workspace patterns MUST NOT be copied mechanically without checking its resource semantics.
- **FR-015**: If cross-subsystem diagnostics are added, they MUST make actor relationships and event causality inspectable without exposing provider credentials or private finance payloads.

### Key Entities

- **Identity binding**: Database/environment attachment and user identity associated with identity-wide work.
- **Workspace binding**: Identity binding plus organization and authority-relevant membership information.
- **Observation generation**: Correlation identifying a particular selection or observation lifetime, including successive visits to the same workspace.
- **Scoped status report**: A public readiness, access or integrity result tied to its binding/generation, with presentation-relevant issues preserved.
- **Settlement result**: Actual outcome of resource-owning work, including unresolved local persistence when certainty is unavailable.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All approved workspace selection, creation, recovery, rename and offline scenarios retain their existing expected behavior.
- **SC-002**: Zero obsolete reports enable actions in the identity/selection/authority race scenarios listed above.
- **SC-003**: Every reviewed workspace interruption scenario reaches a documented terminal or unresolved outcome without waiting for an acknowledgement from a dead dependent.
- **SC-004**: Workspace management remains usable with zero bank connections and zero selected workspaces, when identity eligibility permits it.
- **SC-005**: Every implementation and deferred follow-up has a recorded scope and verification status; completing the workspace phase leaves deferred tasks visibly unchecked.

## Assumptions

- This changes orchestration, not finance permissions, workspace product features or data schemas.
- [Multiple workspaces](../006-multiple-workspaces/spec.md) remains authoritative for existing product behavior.
- [Workspace architecture](../006-multiple-workspaces/plan.md#actor-ownership) records the implemented ownership model; broader boundaries and unchecked follow-ups are in [plan.md](plan.md) and [tasks.md](tasks.md).
- The user authorized the workspace implementation as one combined review batch. Tests still follow implementation review. This spec is not authorization for a broad application rewrite.

## Final completion

The user explicitly resumed each later subsystem and authorized D010–D012 together as one design,
implementation and verification batch. [All tasks](tasks.md) are complete. Final ownership, cleanup
and retained SDK/platform limits are in [architecture.md](architecture.md). The subsequent user-directed removal of custom
inspection and the future tooling boundary are documented in [inspection.md](inspection.md). Historical checks before removal
passed: 1,049 src/lib unit tests, 21 focused browser checks, both static checks and production build.
This is scoped orchestration completion, not a claim that unrelated product/PWA browser suites were rerun.
