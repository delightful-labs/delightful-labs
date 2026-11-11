# Feature Specification: Bank Sync Log

**Feature Branch**: `fix/mobile-sync-and-button-content`

**Created**: 2026-10-30

**Status**: Implemented — complete-review cleanup verification pending; release deployment pending

**Input**: Provide a persistent bank-sync log in Bank Sync settings, with one entry
per explicit sync attempt, account-level results, and retention of the latest
100 completed attempts per bank connection. Keep unfinished attempts.

**Resilience follow-up**: See [resilience.md](resilience.md) for the approved
provider-worker, navigation, duplicate-read, deadline and error-handling changes.
A succeeded/partial attempt with no new inserts must show its existing outcome
label instead of "not completed" in its status detail. Keep persisted settlement
facts unchanged; Saved still describes locally persisted imports even if a later
part of the attempt failed. No new localized messages or automatic provider retries.

## User Scenarios & Testing

### User Story 1 — Understand a sync result (Priority: P1)

As an authorized bank-settings user, I can review recent sync attempts and expand
an attempt to understand what happened to each account.

**Why this priority**: A disabled button and a single latest-result summary do not
explain previous attempts or differences between accounts.

**Independent Test**: Sync a connection containing two accounts with different
results, then inspect the overall attempt and both account results after reload.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they open Bank Sync settings, **Then**
   attempts appear newest first with start/finish times, initiating user, outcome
   and imported, already-present and omitted transaction counts.
2. **Given** an attempt covering multiple accounts, **When** the user expands it,
   **Then** each account has its own outcome, counts and safe failure explanation.
3. **Given** all account results succeeded without omissions, **When** the attempt
   finishes, **Then** the overall result is succeeded; omissions, provider warnings
   or mixed successful/unsuccessful account results produce partial success.
4. **Given** saved entries, **When** the user reloads, opens another compatible
   device after synchronization, or goes offline with entries locally available,
   **Then** the available history remains readable without a provider request.

### User Story 2 — Recognize interruptions and failures (Priority: P1)

As a user, I can distinguish success, partial success, failure, cancellation and
an attempt whose final result is unknown.

**Why this priority**: An interrupted operation must not appear successful or
encourage an automatic duplicate provider request.

**Independent Test**: Cancel or interrupt an attempt, and independently simulate
a failure saving its final log result after imports have been saved.

**Acceptance Scenarios**:

1. **Given** an explicit authorized sync request, **When** it is accepted, **Then**
   an attempt is recorded when possible before provider transaction fetching starts, including
   when passkey verification is subsequently cancelled or fails.
2. **Given** a failed start-record write, **When** sync would begin, **Then** sync
   proceeds normally and the logging failure is reported separately. Logging
   failure alone must not prevent provider work or replace the financial result.
   A log write that does not settle stops blocking sync after five seconds; its
   eventual persistence outcome must not retry provider work.
3. **Given** cancellation, **When** cleanup and issued writes settle, **Then** the
   attempt records cancellation and any imports already saved or still uncertain.
4. **Given** the browser exits before completion is recorded, **When** history is
   opened later, **Then** the attempt remains unfinished with its final result
   unknown; age or absence of a local actor must not imply failure.
5. **Given** imports were saved but final logging failed, **When** the operation
   ends, **Then** the user sees both the import result and the logging failure;
   the app neither claims rollback nor automatically fetches again.

### User Story 3 — Keep history bounded (Priority: P2)

As a user, I retain a useful recent history without accumulating completed logs
indefinitely.

**Why this priority**: Predictable retention bounds the number of retained attempts.

**Independent Test**: Complete a connection's 101st attempt while other connections
and unfinished attempts exist, then verify which records remain after cleanup.

**Acceptance Scenarios**:

1. **Given** more than 100 completed attempts for a connection, **When** authorized
   cleanup succeeds, **Then** its latest 100 completed attempts remain and older
   attempts and all their account results are deleted together.
2. **Given** unfinished attempts or another connection's history, **When** cleanup
   runs, **Then** those entries are unaffected.
3. **Given** offline use, partial local history, concurrent devices or a cleanup
   failure, **When** a sync completes, **Then** its result remains valid; cleanup
   may be deferred and must not delete entries based on incomplete knowledge.
4. **Given** deferred cleanup and later sufficient information and authorization,
   **When** cleanup resumes, **Then** retained completed history converges to the
   latest 100 entries without initiating a bank fetch.

### Edge Cases

- A connection has no history: explain that logging starts with this feature;
  do not fabricate earlier attempts from the latest-result summary.
- Failure occurs before accounts are known: retain an attempt-level reason and
  no fabricated account results; distinguish unavailable counts from known zero.
- A sync covers multiple accounts, fails midway, or encounters duplicate/pending/
  invalid transactions: retain actual results and avoid double-counting.
- Concurrent attempts complete out of order: order the display by start time and
  retain completed entries by finish time, using stable entry identity for ties.
- Account names change or accounts are archived: preserve account identity and
  the display name observed during the attempt for readable historical results.
- Connection revocation does not erase its retained logs; lost authorization
  prevents further reads/writes as the access change is observed.
- An account result or completion arrives late: settle an attempt once and never
  attach results to a replacement user, workspace, connection or attempt.

## Requirements

### Functional Requirements

- **FR-001**: Bank Sync settings MUST expose persistent, read-only attempt history
  with expandable account results, on mobile and desktop, newest attempts first.
- **FR-002**: Each accepted explicit sync MUST have one stable attempt identity
  across its creation, execution and completion. Duplicate completion handling
  MUST NOT create duplicate attempts or account results.
- **FR-003**: Each attempt MUST identify its organization, connection, initiator,
  start, optional finish, outcome, aggregate counts and import settlement.
- **FR-004**: Each account result MUST belong to exactly one attempt and identify
  the account, its name at sync time, outcome, counts and optional failure code.
- **FR-005**: Outcomes MUST distinguish unfinished, succeeded, partial, failed and
  cancelled. Terminal outcomes MUST preserve the actual settled import result.
- **FR-006**: Counts MUST distinguish newly imported, already-present and omitted
  transactions. Known account counts MUST reconcile with aggregate counts;
  unavailable information MUST NOT be presented as a confirmed zero.
- **FR-007**: Import settlement MUST distinguish locally saved results, confirmed
  server acceptance when observed, no issued imports, and unresolved settlement.
- **FR-008**: Failures MUST use bounded, translated reason codes. Logs MUST NOT
  contain tokens, credentials, raw provider responses, transaction descriptions,
  passkey material or raw exception messages.
- **FR-009**: Active organization owners/admins MUST be able to read retained
  connection logs. Only the connecting owner with current required authorization
  may create or settle its attempts or perform retention cleanup. Other users
  MUST NOT gain log access through knowledge of an entry identifier.
- **FR-010**: Attempt/account identity, ownership and scope MUST be immutable.
  Users MUST NOT be offered manual log editing, deletion or replay controls.
- **FR-011**: Opening history, reload, reconnect, log replication and retention
  cleanup MUST NOT initiate or retry provider fetching or passkey prompts.
- **FR-012**: Logging MUST preserve cancellation, identity/workspace changes,
  shutdown cleanup and issued-write settlement. Log persistence failures MUST
  be reported separately from the financial operation's actual outcome. Log
  completion waiting MUST be bounded to five seconds after financial cleanup; an
  already-issued log write may finish later, without retries or subsequent writes.
- **FR-013**: Retention MUST keep the latest 100 completed attempts per connection,
  remove older attempts and their account results together, and preserve all
  unfinished attempts. Failed, partial and cancelled attempts count as completed
  once their terminal result is recorded.
- **FR-014**: Cleanup MUST be safe under concurrency, missing local history and
  interrupted writes. It MAY temporarily exceed the limit until it can safely
  complete, but MUST NOT block ordinary sync or reading available history.
- **FR-015**: History MUST support bounded recent results and access to earlier
  retained entries without loading every connection's history at startup.
- **FR-016**: Retention deletion MUST remove records from normal permitted reads
  as devices observe it. The feature MUST NOT promise physical erasure from all
  replicas, backups or underlying history.
- **FR-017**: Existing latest-result feedback MUST remain available. Setup,
  discovery and disconnect events, transaction edit history and revision restore
  are outside this feature's scope.

### Key Entities

- **Sync Attempt**: One explicit sync operation for one bank connection. Owns
  timing, initiator, scope, overall outcome, counts and settlement information.
- **Account Sync Result**: A result within an attempt for one account, including
  historical display name, outcome, counts and a safe failure reason. Stored
  history must remain attributable when an account is renamed or archived.
- **Retention Policy**: A fixed cap of 100 completed attempts per connection;
  unfinished attempts are excluded from the cap and automatic deletion.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every accepted sync in success, partial, failure and cancellation
  scenarios has exactly one identifiable attempt, with account results whenever
  account-level information is available.
- **SC-002**: All known per-account transaction counts reconcile with the overall
  counts in controlled multi-account scenarios.
- **SC-003**: After successful cleanup of 101 or more completed attempts, exactly
  100 completed attempts remain for that connection, with zero orphan account
  results; unfinished attempts and other connections remain intact.
- **SC-004**: Reload, offline history viewing, reconnect and cleanup scenarios
  generate zero provider requests without a new explicit sync action.
- **SC-005**: Permission scenarios disclose zero log entries or account results
  to unauthorized identities and allow no unauthorized mutation or cleanup.
- **SC-006**: Interruption and logging-failure scenarios never show an unknown
  attempt as successful or describe saved imports as rolled back.
- **SC-007**: A user can reach recent history from Bank Sync settings and inspect
  one account's results with one expansion action on mobile and desktop.

## Assumptions

- The agreed limit is fixed at 100 completed attempts per connection, not per
  account or workspace; user-configurable retention and time-based expiry are
  deferred. Unfinished entries may accumulate and are intentionally not pruned.
- One attempt may cover multiple accounts; account results are related records
  presented together rather than separate top-level attempts.
- Access follows existing bank-settings owner/admin rules. Broader member/viewer
  access requires separate account-level disclosure requirements.
- Existing authorization and explicit provider-operation rules remain in force.
  Cleanup depends on sufficient observation and authority, not browser connectivity
  alone. It does not require a continuously running browser or background service.
- Previous sync attempts cannot be reconstructed. This feature records future
  activity and does not backfill historical logs.
- The earlier engineering draft at ../002-manual-bank-sync/sync-log.md supplies
  background only; this formal specification governs scope and acceptance.
