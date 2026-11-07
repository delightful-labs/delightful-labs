# Feature Specification: Verified workspace backup and restore

**Feature Branch**: `feat/verified-backup`

**Created**: 2026-11-03

**Status (2026-11-07)**: Finance capture/restore/UI and deployed fake-data rehearsal are complete.
T004 is closed with the user's acceptance of the known performance limitation below. T014's explicit
same-operation retry is implemented and locally qualified, completing the shared implementation
scope. Publication and Finance's adoption of the updated package remain pending; review/publication
of the existing uncommitted Finance capacity change is separate.

**Implementation baseline (2026-11-05)**: Shared archive/envelope, independent inspection, capture/export and the
versioned browser restore journal are implemented. The complete test app reference now writes all
mapped content, freshly compares exact fields/relationships/attachment bytes and activates the
isolated destination. Same-browser resume and conservative uncertain-activation recovery are
qualified. PRs #23–#26 are merged; [PR #26](https://github.com/delightful-labs/delightful-local-first/pull/26)
has 1,097 functional cases and GitHub CI passing on `d69fe4c`.
The routing review covers all 45 machine-bearing modules.

T007's [read-only Finance inventory](finance-deployment-inventory.md) is complete: frontend `31f70cb`,
matching 22-table backend schema/policy head v8, 633 scoped projected records, zero reachable
attachments and no observed tracked pending writes or projected local/remote differences.
This establishes inventory and the test app reference, not Finance production recovery. T014's
explicit retry integration is implemented and locally qualified. T004 is closed by acceptance
of its documented limitations. T010 passed on the user-directed deployed fake graph below. See
[the active TODOs](tasks.md#current-handoff), [restore qualification](restore-completion-design.md),
[routing audit](native-event-routing-review.md) and [desktop measurements](test-app-performance.md).

**Input**: Back up the deployed Finance app before identity or storage changes. Put reusable backup capabilities in DLF, using Finance’s approved backup requirements as the first consumer.

**Scope correction (2026-11-07):** the user requires qualification on a deployed Finance preview
filled with fake data and backed by a separate Jazz app. T010 uses that environment and a fresh test
identity/browser. Do not access production workspace data or its admin credential. Production-data
backup or migration is outside this task; older references to actual deployed source data do not
authorize it.

**Finance adoption merged (2026-11-07):** [Finance PR #54](https://github.com/delightful-labs/delightful-finances/pull/54)
and [Finance PR #57](https://github.com/delightful-labs/delightful-finances/pull/57) implement
T008 capture/profile/UI and T009 isolated restore, comparison, recovery and UI on Jazz alpha.59,
using DLF `ad99117`. The final PR CI run
[42376826034](https://github.com/delightful-labs/delightful-finances/actions/runs/42376826034)
passed, including the three-browser restore recovery job. Finance's
[implementation and evidence](https://github.com/delightful-labs/delightful-finances/blob/ab6c85073b0fbb2187283965a547eb50928f166c/specs/015-workspace-backup/spec.md)
records the disposable-data qualification. T004 is closed with accepted limitations; T014's
confirmed-rejection retry is locally qualified and awaits package adoption. T010 passed on the PR57 deployed preview with 120 fake
transactions, three accounts, eight categories and zero original attachments. The independent
reader, full browser restart, exact business/reference comparison, byte-exact retained source,
original preservation and duplicate prevention passed. See the task ledger for evidence and limits.

## User Scenarios & Testing

### User Story 1 — Save a complete workspace (Priority: P1)

As a workspace owner, I can save a portable backup of my application data before changing how I sign in or how the app stores data.

**Why this priority**: The deployed app contains the user’s real data. Account recovery alone does not protect against a failed data migration.

**Independent Test**: Export a workspace containing every supported record type, archived records, relationships, and attachment contents. Independently open the saved file and compare its contents with the source.

**Acceptance Scenarios**:

1. **Given** owner access and all required data, **when** export completes, **then** the file contains the complete declared workspace scope, exact values, relationships, and attachment bytes.
2. **Given** restricted access, an unavailable attachment, or a failed read, **when** export runs, **then** it explains the missing coverage and does not report a complete backup.
3. **Given** changing source data, **when** export captures it, **then** it produces a coherent capture or explicitly fails instead of silently combining incompatible versions.

### User Story 2 — Choose protection and check a saved file (Priority: P1)

As an owner, I can choose a password-encrypted or unencrypted file and check the saved file independently of the original application login.

**Why this priority**: A backup must remain useful if application access fails.

**Independent Test**: Reopen both file types, validate supported versions and contents, and reject incorrect passwords and corrupt files without writing restored data.

**Acceptance Scenarios**:

1. **Given** an encrypted backup, **when** it is opened, **then** the correct independent password is required; application login cannot substitute for it.
2. **Given** a corrupt, oversized, unsupported, or inconsistent file, **when** validation runs, **then** it fails with an explanation before destination writes.
3. **Given** either protection option, **when** contents are inspected, **then** no login recovery secrets or bank credentials are included.

### User Story 3 — Recover into an isolated new workspace (Priority: P1)

As an owner, I can restore the saved backup into a new workspace and verify that the recovered data matches, without modifying my existing workspace.

**Why this priority**: A downloaded file alone does not demonstrate recoverability.

**Independent Test**: Restore a validated file into a fresh workspace, compare exact values and attachment contents, interrupt restoration, and resume without duplicate records.

**Acceptance Scenarios**:

1. **Given** a valid file, **when** restored, **then** the restoring user owns the new workspace; existing workspaces remain unchanged and prior collaborators receive no access automatically.
2. **Given** interruption or an uncertain write outcome, **when** the operation resumes, **then** it reconciles prior writes and continues the same restoration without duplicating records or relationships.
3. **Given** an incomplete restore, **when** ordinary app workflows run, **then** the destination is unavailable for ordinary use until restoration and content verification finish.
4. **Given** a completed restore, **when** verification runs, **then** it compares actual restored values, relationships, and file bytes rather than only counts.

### User Story 4 — Reuse the capability outside Finance (Priority: P2)

As an application developer, I can use the same backup machinery with another application’s data without adopting financial models or routes.

**Independent Test**: Use a small nonfinancial data profile with relationships and a byte attachment through the same export, validation, and restore lifecycle.

**Acceptance Scenarios**:

1. **Given** an application-defined data profile, **when** it supplies authorized capture, validation, restore, and comparison behavior, **then** shared backup behavior does not require Finance-specific fields.

### Edge Cases

- Access is revoked or identity/workspace changes during export or restore.
- Local data is incomplete, unsynchronized, or differs from remotely accepted data.
- Files have missing parts, duplicate part indices, incorrect lengths, or no content.
- Source relationships reference records outside the declared scope.
- A destination write succeeds but its response is lost.
- A new source data type appears without backup support.
- The browser initiates download but cannot establish that the user retained the file.
- The user forgets the independent encryption password.

## Requirements

### Functional Requirements

- **FR-001**: DLF MUST provide reusable versioned archive, file validation, protection, progress, cancellation, and restore lifecycle capabilities. Each consumer MUST own domain coverage, authorization, value validation, relationships, and destination operations.
- **FR-002**: The first adoption MUST work with the deployed Finance storage and login arrangement before its identity or storage migration. It MUST NOT require the proposed AT Protocol integration or a Jazz upgrade first.
- **FR-003**: Each backup MUST identify its application profile and version, archive version, source workspace, capture scope, and included data types. Unsupported required data MUST prevent a complete-backup result.
- **FR-004**: Export MUST establish authorized full coverage and a coherent capture. A successful query or currently displayed records alone MUST NOT establish completeness. Local persistence and remote acceptance MUST remain distinguishable.
- **FR-005**: Backups MUST preserve exact supported values, relationships, provenance, archived records, and attachment contents. The profile MUST explicitly declare treatment of deleted records and historical revisions; a current-data backup MUST NOT be described as a full database history backup.
- **FR-006**: Users MUST be able to select password encryption or an unencrypted file. Encryption MUST use established authenticated encryption and password derivation, with independently readable versioned parameters. No login secret may be needed to decrypt it.
- **FR-007**: Export MUST use an explicit inclusion policy. Login secrets, recovery phrases, live session material, bank credentials, and encrypted credential containers MUST be excluded. Integrations require reconnection after restore.
- **FR-008**: Restore MUST validate the entire supported archive, bounded resource requirements, exact domain values, references, and attachment contents before any destination writes. An invalid archive MUST cause zero destination writes.
- **FR-009**: Restore MUST create a new isolated workspace owned by the restoring user. Previous memberships, invitations, and grants MUST NOT reactivate access. Source provenance MUST remain distinguishable from new destination ownership and audit metadata.
- **FR-010**: Restoration MUST retain recoverable progress, stable source-to-destination mappings, and operation identity. Retries after interruption or uncertain write outcomes MUST reconcile existing results without duplication. Incomplete destinations MUST stay outside ordinary application use.
- **FR-011**: Restore MUST compare recovered values, relationships, and attachment contents against the validated archive before reporting verified recovery. Counts alone are insufficient.
- **FR-012**: Cancellation and identity/workspace changes MUST stop obsolete operations and release owned resources. Passwords and decrypted content MUST NOT leak into logs, telemetry, or persisted workflow snapshots.
- **FR-013**: Feedback MUST distinguish capture completed, file handed to the browser, saved file checked, restore incomplete, and recovery verified. Download initiation MUST NOT imply verified file retention or recovery.
- **FR-014**: Finance adoption MUST satisfy its approved FR-042 through FR-047 and FR-056 for every released data type. Finance’s owner-only workspace policy and financial rules MUST remain consumer responsibilities.
- **FR-015**: Export MUST NOT mutate source application data. Restore MUST NOT modify existing workspaces. Existing-workspace merging and automatic login or storage migrations are outside this feature.
- **FR-016**: Shared interactions MUST support consumer localization, keyboard use, accessible progress and errors, and consumer-owned routes. Generic presentation remains DUI’s responsibility.

### Key Entities

- **Backup profile**: Consumer-owned versioned description of data scope, permissions, validation, and recovery behavior.
- **Archive**: Portable saved data with version and coverage metadata, exact records, attachment contents, and integrity information.
- **Capture result**: Evidence of source coverage and consistency, with explicit failure when these cannot be established.
- **Restore operation**: Recoverable operation identifying its archive, new destination, mappings, progress, and incomplete/completed status.
- **Verification report**: Result of checking the saved archive or comparing a restored destination against it; these are separate outcomes.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every released Finance data type is included in an explicit coverage inventory; missing required records or bytes prevent complete-backup success.
- **SC-002**: Restoring each supported example preserves every exact financial value, relationship, and attachment byte, while changing zero existing workspace records.
- **SC-003**: Each invalid or unsupported example is rejected with zero destination writes.
- **SC-004**: Interruption and retry examples complete with zero duplicate records or relationships and no ordinary use of incomplete destinations.
- **SC-005**: Inspected archives contain zero login recovery secrets or bank credentials, and restore activates zero previous grants.
- **SC-006**: A retained file can be opened and checked without the original service or login; a fresh destination can subsequently be restored and compared in full.
- **SC-007**: Finance and one small nonfinancial example use the shared capability without financial concepts in its generic contract.
- **SC-008**: A deployed Finance preview with a separate Jazz app and fake data demonstrates retained-file independent validation, isolated restoration and fresh-session exact comparison, preserving its fake source. Production-data backup and identity/storage changes are outside this task.

## Assumptions

- The user has confirmed the important data is in the deployed app. T007 verifies its current frontend/backend schema/policy identity and the selected workspace's scoped graph and sizes. Repeat inventory if these change before capture; repository schemas alone remain insufficient evidence.
- One workspace is the initial backup unit. Whole-identity backups, automatic scheduled backups, cloud vaults, and importing into existing workspaces are deferred.
- Backup protects current application data and declared provenance; complete engine history and deleted records are not implicitly included.
- Full offline export is not promised when the device lacks required data. Independent file inspection can work offline; remote destination restoration requires its normal connectivity and authorization.
- Clipper can adopt the generic contract later. This feature does not implement Clipper capture or reader workflows.
- Encryption password loss makes that encrypted file unrecoverable. Existing identity recovery remains separate.
- Implementation review and tests follow repository agreements and explicit user authorization. The test app and deployed Finance fake-data rehearsal are qualified within their recorded scope. No production-data rehearsal is required or authorized by this task.

## Accepted performance limitation — 2026-11-07

The user accepts Jazz alpha.59's measured slowdown as unrelated backend data accumulates and its
intermittent `not_observed` read failures. Successful backup/restore and exact source preservation
are qualified by the recorded tests; some larger/repeated attempts failed. The SDK defect is not
fixed, and those failures remain in the evidence. T004 is closed for this delivery by acceptance,
not by a claim of universal reliability or responsiveness. Reopen investigation if these symptoms
occur in real production use. No further SDK/performance work is scheduled now.

Phones, maximum aggregate archives and storage pressure remain unqualified claims outside the
accepted delivery scope. The existing limits, failure feedback, native validation and cleanup stay
in place. Production workspace data remains outside this task. See the task ledger and Finance's
`specs/015-workspace-backup/spec.md` / `qualification.json` for measurements and limits.

## Known restore limitations and remaining implementation gates

- **Test app restore is implemented and qualified.** The reference coordinates the complete retained
  plan, freshly reads all restored records and actual attachment bytes, compares exact sets/values
  and relationships, journals comparison and activates through the existing transaction owner.
  Active reconciliation compares the graph again; counts and stored digests alone are insufficient.
- **Explicit rejected-write retry is implemented and locally qualified (T014).** A new invocation
  reconciles remote contents, then checks current authority before retrying a confirmed remote
  rejection with a known transaction ID. It retains the same destination/mappings and bounded
  rejection evidence. Uncertain outcomes stay incomplete or reconcile without replay. Real Jazz
  permission denial/repair, page reload, graceful Chromium restart and completion are qualified in
  the test app; Finance still pins the earlier package. No automatic retry loop is added.
- **Recovery is same-browser/origin with retained journal storage.** Resume requires reselecting the
  matching file and supplying its password when applicable. IndexedDB holds operation identity,
  mappings and progress; Jazz holds destination data. Clearing storage loses local recovery metadata.
  Cross-browser/device recovery is outside this qualified scope.
- **The qualified source is quiescent single-user data.** Actual Jazz destination policies enforce
  owner, scope, immutable provenance and the incomplete-to-active phase boundary. The trusted client
  owns content verification; the server does not attest that arbitrary owner clients ran it. This is
  not a cross-client serializable graph snapshot guarantee.
- **Qualification has concrete limits.** Retained-file independent inspection, exact test app restore,
  page reload/fresh session, cancellation/drain and uncertain activation without replay are tested.
  Browser-process crash, cleared journal and offline restart are not qualified full-restore claims.
  Journal commit alone proves neither Jazz local persistence nor remote acceptance.
- **T004 is closed with accepted performance limitations.** The 1/4/8 MiB desktop and deployed
  fake-data measurements, SDK scaling and intermittent failures are retained. Phone, maximum
  aggregate and storage-pressure guarantees are not claimed. Reopen only upon production occurrence.
- **Finance T008/T009 are merged; scoped T010 passed.** Use a deployed Finance preview with fake
  data and a separate Jazz app to demonstrate retained-file recovery and fresh-session comparison.
  Local development and shared test app results do not substitute for that deployed rehearsal.
  Do not use the user's production data, session or admin credential.

### Accepted retry behavior — 2026-11-03

The user confirmed that fixing access after a confirmed rejection should allow continuation of the
**same restore operation**, retaining its destination and source-to-destination mappings. A new
transaction attempt may be issued after the failure is corrected and current authority is checked
again. Preserve evidence of the rejected attempt rather than rewriting it as accepted.

An uncertain outcome must continue waiting or reconcile existing destination contents before another
write is issued. A generic exception or permission-filtered missing result is not sufficient evidence
for replay. A new destination is not the recovery action for this permission-failure case.

The user subsequently authorized the focused journal representation change after the follow-up
research. The journal representation is implemented and qualified: current attempt plus the most recent rejected attempt, and
completion by either a settled transaction receipt or an exact remote content match retaining the
unchanged attempt evidence. Reconciliation cannot silently satisfy a separately required local
persistence observation. No generalized retry engine or unbounded attempt history is required.
The later test app coordinator/writer authorization is implemented in PR #26. T014 now integrates
explicit permission-repair retry into that shared writer. See the
[implementation and native qualification](restore-journal-design.md#t014-writer-integration--qualified-2026-11-07).

### Historical recovery evidence — 2026-11-03

[Persistent-browser probes](research.md#persistent-jazz-write-recovery-investigation--2026-11-03)
recovered an accepted-but-uncheckpointed write and a locally persisted pending write after graceful
Chromium process restart, with zero application-issued replacement writes. This qualifies those small
cases, not a full restore or forced-crash recovery.

With read permission revoked, the browser returned null for an existing remote row and `canRead`
returned `unknown`; it remained unknown after permission repair even though the row became readable.
Recovery must therefore leave this case unresolved instead of treating null/unknown as authority to
reissue a write. Matching remote contents may support step reconciliation, but must not be recorded
as an invented acceptance receipt for the original transaction. The focused journal change now
represents that completion basis separately, with the exact planned digest and unchanged attempt
facts. After review approval, 105 journal unit cases and six journal Chromium cases pass (full suites:
833 unit and 51 Chromium tests). These checks qualify the representation and journal storage, not
production destination comparison. Later test app coordinator/writer qualification is recorded in
[the completion evidence](restore-completion-design.md); full browser-process restart remains outside it.

See the [reviewed browser journal design](browser-journal-design.md) for implementation evidence.

## Evidence and implementation investigation

See [historical source investigations](research.md), the implemented [archive contract](contracts/archive-v1.md),
[workflow contract](contracts/workflow.md) and [current implementation plan](plan.md). Remaining
Finance consistency/isolation and consumer performance evidence are tracked in [tasks](tasks.md).

## Zod follow-up TODOs

T011–T013 are complete: the optional form-error adapter, concrete versioned restore-journal schemas,
and profile draft-check review. Consumer contracts remain library-neutral; simple workflow guards
remain ordinary code. Finance's journal integration is T009. Sign-in configuration/external-input
validation remains in [its separate delivery TODOs](../002-shared-delightful-sign-in/delivery.md#zod-validation-todos).
