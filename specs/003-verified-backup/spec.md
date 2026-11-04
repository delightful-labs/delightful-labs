# Feature Specification: Verified workspace backup and restore

**Feature Branch**: `feat/verified-backup`

**Created**: 2026-11-03

**Status**: Archive, envelope, independent inspection, shared capture/export and the browser
restore journal are implemented and locally qualified; PR #22 is merged. The bounded notebook
preparation coordinator and concrete Jazz destination-control writer are now locally qualified:
19 focused preparation unit cases and eight real Jazz/Chromium cases pass. This prepares an isolated
incomplete destination with durable intent and mappings, separate settlement observations and
same-browser reload reconciliation. Note/attachment writers, fresh full-content comparison and
activation remain unimplemented. T006/T012 and Finance adoption remain incomplete; no successful
full restore or production restore safety is claimed. See the
[preparation qualification](restore-preparation-design.md#preparation-qualification--completed)
and [current handoff](tasks.md#current-handoff-2026-11-04).

**Input**: Back up the deployed Finance app before identity or storage changes. Put reusable backup capabilities in DLF, using Finance’s approved backup requirements as the first consumer.

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
- **SC-008**: Before changing deployed Finance identity or storage, the user has retained a backup of the actual deployed workspace and demonstrated verified restoration into an isolated destination, with the original preserved.

## Assumptions

- The user has confirmed the important data is in the deployed app. Its actual deployed revision, schema, and data coverage still need verification; repository schemas alone are insufficient evidence.
- One workspace is the initial backup unit. Whole-identity backups, automatic scheduled backups, cloud vaults, and importing into existing workspaces are deferred.
- Backup protects current application data and declared provenance; complete engine history and deleted records are not implicitly included.
- Full offline export is not promised when the device lacks required data. Independent file inspection can work offline; remote destination restoration requires its normal connectivity and authorization.
- Clipper can adopt the generic contract later. This feature does not implement Clipper capture or reader workflows.
- Encryption password loss makes that encrypted file unrecoverable. Existing identity recovery remains separate.
- Implementation review and subsequent tests follow repository agreements. This specification does not claim that a usable backup exists yet.

## Known restore limitations and implementation gate

**Current authorized slice: notebook restore preparation, now locally qualified.** The earlier
journal-only gate was superseded by the user's authorization to implement and qualify this bounded
slice, including owner-bound first-write admission. The journal changes merged in PR #22. The
[preparation qualification](restore-preparation-design.md#preparation-qualification--completed)
records the actual machine/native evidence and remaining limits. Further data writers, full-content
comparison, activation and Finance adoption require their own review slices.

- **Retry representation is implemented and locally qualified; writer integration is unbuilt.** A new transaction attempt
  can follow a confirmed remote rejection with a known transaction ID, retaining the same operation,
  destination and mappings. Preserve the most recent rejected attempt and the attempt counter;
  this is bounded recovery metadata, not a complete audit history. A generic exception or uncertain
  outcome cannot increase the counter. The future writer still needs corrected authority before
  actually issuing a retry. FR-010 and SC-004 remain unfulfilled until restore integration is qualified.
- **Recovery is scoped to the same browser and origin with retained journal storage.** The user
  approved this scope. Resuming requires selecting the backup file again. IndexedDB holds operation
  identity, mappings and progress; Jazz holds restored application data. Clearing or losing browser
  storage removes that local recovery metadata. Cross-browser/device recovery is outside this scope.
- **Qualification is limited.** Chromium page reload, atomic journal updates and cancellation around
  commit are tested. Browser-process crash recovery and actual Jazz destination restoration are
  unqualified. Journal commit does not establish Jazz local persistence, remote acceptance or a
  verified restore. The preparation coordinator/control writer is now qualified; data writers and activation remain unimplemented.

The [real-code limitation investigation](research.md#restore-limitation-investigation--2026-11-03)
reproduced a Jazz retry after permission repair at the same destination IDs, which the current
journal previously could not represent. It also demonstrated pending acceptance across disconnect/reconnect,
permission-filtered remote null results and journal retention across graceful Chromium process
restart. These findings do not qualify actual Jazz recovery after restart.

### Accepted retry behavior — 2026-11-03

The user confirmed that fixing access after a confirmed rejection should allow continuation of the
**same restore operation**, retaining its destination and source-to-destination mappings. A new
transaction attempt may be issued after the failure is corrected and current authority is checked
again. Preserve evidence of the rejected attempt rather than rewriting it as accepted.

An uncertain outcome must continue waiting or reconcile existing destination contents before another
write is issued. A generic exception or permission-filtered missing result is not sufficient evidence
for replay. A new destination is not the recovery action for this permission-failure case.

The user subsequently authorized the focused journal representation change after the follow-up
research. It is implemented for review: current attempt plus the most recent rejected attempt, and
completion by either a settled transaction receipt or an exact remote content match retaining the
unchanged attempt evidence. Reconciliation cannot silently satisfy a separately required local
persistence observation. No generalized retry engine or unbounded attempt history is required.
No restore coordinator or destination writer is authorized by this slice.

### Follow-up recovery evidence — 2026-11-03

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
production destination comparison or the unbuilt restore coordinator/writers.

See the [reviewed browser journal design](browser-journal-design.md) for implementation evidence.

## Evidence and implementation investigation

See [source findings and unresolved implementation work](research.md). Detailed contracts, archive encoding, cryptography parameters, consistency proof, and restore persistence must be resolved in planning before dependent implementation.

## Zod follow-up TODOs

The user selected Zod for internal archive schemas. Track the additional repository opportunities
in [T011–T013](tasks.md#zod-follow-ups-from-repository-review): optional form-error adaptation,
concrete persisted restore-journal schemas, and a bounded review of profile draft checks. Preserve
library-neutral consumer contracts and simple workflow guards. Sign-in external-input/configuration
validation is tracked in [its delivery TODOs](../002-shared-delightful-sign-in/delivery.md#zod-validation-todos).
These follow-ups are not prerequisites for reviewing the current payload codec.
