# Feature Specification: Predictable Vercel costs and reliable Jazz sync

**Feature Branch**: `fix/vercel-test-only` (current PR #44)

**Created**: 2026-11-16

**Status**: Draft specification; runtime design and implementation pending

**Input**: Investigate and reduce the cost of two lightly used apps, including
Jazz connection lifetimes and failures, unnecessary builds, and spending controls.
Add the specification to the current deployment-filter PR.

The [evidence and investigation brief](research.md) separates recorded facts
from hypotheses. The deployment filter is implemented in this PR; the remaining
work below is specified, not implemented or production-qualified by this PR.
Existing root and app feature selectors remain unchanged, following the
[cross-project precedent](../003-shared-workspaces/spec.md).

## User Scenarios & Testing

### User Story 1 - Know what causes spending (Priority: P1)

As the owner, I can attribute spending to development, normal app use, and
unnecessary background activity before choosing an optimization.

**Why this priority**: A timeout or restart does not itself prove waste. Cost
changes must be grounded in equivalent usage and reliable billing evidence.

**Independent Test**: Observe both apps in controlled usage scenarios and produce
a reconciled resource/cost report without changing application behavior.

**Acceptance Scenarios**:

1. **Given** the same billing window and account, **when** usage is reported,
   **then** builds, functions, sandboxes, and storage are separated by project and
   environment where available; subscription fees, included credit, and overage
   are distinguished. Partial or delayed data is labeled.
2. **Given** both apps, **when** each is measured with no clients, one active tab,
   a background tab, multiple tabs, and an authenticated extension connection,
   **then** connection counts, reconnect reasons, backend awake time, function
   occupancy, CPU, and memory consumption are recorded for each scenario.
3. **Given** an optimization, **when** its result is compared, **then** equivalent
   workloads and durations are used and unrelated deployment activity is excluded
   or reported separately. No savings are inferred solely from fewer log errors.

### User Story 2 - Stop paying for unused connections (Priority: P1)

As an app user, I can leave or close an app without abandoned connections keeping
its backend awake, while edits and legitimate synchronization remain safe.

**Why this priority**: Backend memory is the next material expense after builds.

**Independent Test**: Exercise active, idle, disconnected, and resumed sessions
with retained data, and verify both resource release and synchronization.

**Acceptance Scenarios**:

1. **Given** no clients or legitimate background jobs remain and all admitted
   effects have settled, **when** the last connection is released, **then** compute
   becomes idle within the documented idle window plus a measured platform margin
   and does not repeatedly wake itself during a 30-minute quiet observation.
2. **Given** an active user, **when** a sync connection reaches its supported
   lifetime, **then** it closes and reconnects through a bounded, owned lifecycle
   without lost edits, repeated writes, or a platform-forced timeout in normal use.
3. **Given** a background tab or multiple tabs, **when** connection ownership is
   inspected, **then** each connection has a justified owner; abandoned owners
   cannot keep resources alive. Visibility alone is not proof that sync is safe
   to suspend, and separate identities must not share authority or data.
4. **Given** offline edits, network loss, sleep/wake, or a full browser restart,
   **when** connectivity returns, **then** retained local work reconciles and
   ordinary offline use remains available. Remote acceptance is not claimed from
   local durability alone.

### User Story 3 - Deploy compatible Jazz schemas (Priority: P1)

As a Clipper user, I can open existing data after deployment without a broken
migration history causing repeated store initialization failures.

**Why this priority**: The recorded disconnected migration histories are concrete
failures; their cost contribution is not yet measured.

**Independent Test**: Qualify supported upgrade paths against isolated copies of
representative existing stores and retained clients, including refused upgrades.

**Acceptance Scenarios**:

1. **Given** a supported deployed schema history, **when** an upgrade is validated,
   **then** a connected, compatible upgrade path is established and existing data
   and access rules survive the upgrade.
2. **Given** an incompatible history, **when** validation fails, **then** release
   is refused before production cutover; the last compatible service remains
   available or a documented compatible rollback is used.
3. **Given** a deterministic initialization failure, **when** clients retry,
   **then** attempts follow a bounded policy rather than repeatedly allocating
   compute without progress. Recovery preserves the original data and intent.

### User Story 4 - Spend on useful deployments (Priority: P2)

As the owner, I receive previews for relevant changes without paying for builds
that cannot change the deployed application.

**Why this priority**: Builds were the largest measured expense.

**Independent Test**: Replay representative commit changes and compare expected
deployment decisions, actual hosted decisions, and billable build consumption.

**Acceptance Scenarios**:

1. **Given** Markdown, tests, or recognized verification/editor settings alone,
   **when** a valid deployed-to-current comparison is available, **then** the
   build is skipped before installation while required CI checks still resolve.
2. **Given** runtime, shared library, production build configuration, or dependency
   changes, **when** deployment is selected, **then** every affected consumer
   builds. Renames, deletions, and intervening skipped commits cannot hide changes.
3. **Given** a first deployment, unavailable history, or explicit rebuild,
   **when** the decision is uncertain, **then** the existing conservative build
   fallback is preserved. Hosted Storybook changes still deploy Storybook.
4. **Given** remaining build costs after filtering, **when** preview policy,
   machine sizing, and dependency/build caching are evaluated, **then** measured
   cost and latency tradeoffs are presented before changing hosted settings.

### User Story 5 - Receive useful spending warnings (Priority: P2)

As the owner, I can choose a spending budget and understand what an alert or
automatic pause would do before enabling it.

**Why this priority**: Savings do not replace protection against unexpected usage.

**Independent Test**: Review budget semantics and demonstrate notifications and
any proposed pause/resume procedure without interrupting production.

**Acceptance Scenarios**:

1. **Given** a proposed budget, **when** it is reviewed, **then** its scope, amount,
   treatment of included credit, alert thresholds, detection delay, and excluded
   resources are explicit. No alert is described as an instantaneous hard cap.
2. **Given** optional automatic pausing, **when** the owner considers it, **then**
   the outage impact, continuing storage/other charges, and resume procedure are
   documented; pausing is disabled unless separately approved.

### Edge Cases

- Hidden or suspended tabs with pending edits, captures, imports, or remote writes.
- Several tabs, restored identities, extension workers, and preview environments.
- Requests that connect without responding; rapid reconnects and platform shutdown.
- Account/workspace replacement while acquisition, settlement, or cleanup is pending.
- Late results after cancellation, partial replicas, and uncertain write outcomes.
- Old/offline clients returning after a schema upgrade or rollback.
- Missing billing dimensions, retention gaps, delayed charges, and changing prices.
- A test-named file used in a deployed artifact, unknown tooling, and shallow history.
- Spending while production is paused, including stored resources and previews.

## Requirements

### Functional Requirements

- **FR-001**: Produce the attributed baseline and repeatable workload report in
  Story 1, labeling missing evidence and accounting differences explicitly.
- **FR-002**: Classify timeout, reconnect, and initialization failure causes before
  selecting a fix; report expected connection expiration separately from faults.
- **FR-003**: Give every connection, session, retry, and background operation one
  explicit lifetime owner. Design acquisition, active use, expiration, backoff,
  cancellation, settlement, and release before implementing lifecycle changes.
- **FR-004**: Release unused compute according to Story 2, without shortening an
  idle timeout merely to mask leaks or extending request duration merely to hide
  platform errors. Measure useful work, repeated startup, and idle cost separately.
- **FR-005**: Preserve local-first usability, acknowledged local edits, financial
  integrity, tenancy, membership, credential boundaries, and extension admission.
  Network recovery must not initiate provider imports or replay uncertain writes.
- **FR-006**: Validate forward migration and compatible rollback against supported
  existing store histories and retained clients as required by Story 3. A store
  reset, deletion, or replacement is not a migration repair.
- **FR-007**: Preserve affected-consumer deployment coverage and verification
  checks while excluding non-deployment inputs as required by Story 4.
- **FR-008**: Identify and measure additional build-policy, sizing, and cache
  candidates before changing them. Storage cleanup is a lower-priority candidate
  and must retain recoverable data and required rollback artifacts.
- **FR-009**: Present an owner-selectable budget configuration and recovery
  procedure meeting Story 5; record approval before any hosted configuration change.
- **FR-010**: Diagnostics must omit credentials, financial/content payloads, and
  private documents, and must not introduce new paid monitoring by default.
- **FR-011**: Follow each app/library's existing public integration contracts and
  review gates. Prefer supported SDK capabilities; document a concrete limitation
  and obtain scoped approval before proposing dependency patches or a new service.
- **FR-012**: Compare total recurring and operational cost before proposing a
  different backend host. No migration, new backend, or vendor commitment is
  selected by this specification.

### Key Entities

- **Usage baseline**: Time window, project/environment, workload, resource usage,
  cost basis, data completeness, and deployment identifiers for comparison.
- **Connection lifetime**: Owning client/session and scope, admitted work,
  expiration/reconnect reason, settlement, and observed resource release.
- **Schema compatibility record**: Supported deployed history, target history,
  retained-client obligations, upgrade evidence, and compatible recovery path.
- **Budget proposal**: Scope, amount, credit semantics, notifications, optional
  pause behavior, exclusions, approval, and resume instructions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Both apps have baseline and candidate reports for every Story 1
  workload, with all nonzero billing categories accounted for or explicitly
  identified as unavailable. An independent reviewer can reproduce comparisons.
- **SC-002**: Ten consecutive idle/release trials per app satisfy the documented
  release bound, followed by no unexplained wakeups in each 30-minute quiet window.
- **SC-003**: Each app completes a 30-minute active synchronization trial and
  network interruption/resume trial without forced normal-use request timeouts,
  lost acknowledged edits, duplicate domain writes, or unauthorized access.
- **SC-004**: Every supported migration fixture upgrades without data loss, and
  every intentionally disconnected-history fixture is refused before release.
  Recovery is demonstrated without resetting or deleting the store.
- **SC-005**: All agreed deployment-selection scenarios pass locally and in
  hosted qualification, with zero skipped required runtime deployments and CI
  checks retained for test/tooling-only fixes.
- **SC-006**: Each adopted optimization has a measured reduction in its targeted
  cost/consumption under a matched workload, with no regression in SC-002 through
  SC-005. Any unsupported savings hypothesis is explicitly rejected, not counted.
- **SC-007**: The owner receives a monthly forecast for the agreed normal workload,
  a comparison with the included $20 usage credit, and a reviewed budget proposal.
  If that workload cannot fit the credit, the remaining cost and options are stated
  rather than promising that all hosting will be free of overage.

## Assumptions

- The normal workload is initially one person using Finance, Clipper, and the
  extension, with development/previews measured separately. Its active hours and
  device/tab mix must be recorded during baseline collection.
- Keeping ordinary monthly usage within the included credit is the planning
  objective, not a guaranteed saving or an approved budget amount.
- The current 60-second configured idle window is a baseline observation, not a
  proven platform guarantee. Planning will document a measured release margin.
- Existing credentials, accounts, stores, and preview isolation remain in place.
- Alert-only budgeting is the default proposal until the owner chooses amounts
  and any outage-producing action. This document does not enable notifications.
- Spec approval does not approve implementation tests, new catalogs, dependency
  changes, production deployment, destructive operations, or hosted settings.
- Planning must identify evidence owners, bounded test costs, supported SDK
  lifetime controls, exact migration fixtures, and rollback compatibility before
  implementation. This spec introduces no new production behavior.

## Related authorities

- [Resource ownership and state machines](../../docs/engineering/state-machines.md)
- [Testing and implementation review](../../docs/engineering/testing.md)
- [Releases and deployment selection](../../docs/engineering/releases.md)
- [Finance constitution](../../apps/finance/.specify/memory/constitution.md)
- [Clipper implementation handoff](../../apps/clipper/specs/001-jazz-clipper/implementation-handoff.md)
- [Local First guidance](../../packages/local-first/AGENTS.md)
