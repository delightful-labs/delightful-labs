# Feature Specification: Local-first usability and startup

**Feature Branch**: `feature/local-first-startup`

**Created**: 2026-10-29

**Status**: Draft ready for specification review — current product questions resolved;
technical planning and implementation review remain outstanding

**Input**: Improve time to usable state and offline operation; cover Jazz, application workers,
service workers, known safe changes, remaining investigations, and conflicting project guidance.
Ask product questions one at a time. Implement lower-risk local usability improvements first.

## User Scenarios & Testing

### User Story 1 - Use available finances immediately (Priority: P1)

A returning user opens a workspace and uses available finance data without waiting for a server,
whether the device is offline, online, or connected to an unresponsive service.

**Why this priority**: Removing unnecessary remote dependencies directly improves usability and
restores the existing local-first product principle without changing the database authority.

**Independent Test**: With required records persisted locally, prevent all remote responses, restart
the application, and view, create, edit, and delete permitted records before restoring connectivity.

**Acceptance Scenarios**:

1. **Given** a saved identity and locally available workspace, membership, and required finance data,
   **When** the user launches or reloads offline, **Then** finance views and eligible actions become
   usable without a remote result.
2. **Given** the same records and a connection that opens but never answers queries, **When** the app
   starts, **Then** local usability does not depend on a connectivity timeout or remote first answer.
3. **Given** an eligible edit, **When** local persistence completes, **Then** the user can continue;
   synchronization and remote acceptance remain separate outcomes.
4. **Given** an empty or partial local result, **When** the page opens, **Then** available local work
   remains usable and the app does not infer global absence, recreate records, or repair permissions.
5. **Given** later synchronized updates or observed access loss, **When** they arrive, **Then** views
   and capabilities update for the current identity/workspace; rejected changes are reported truthfully.

### User Story 2 - Restart reliably without a connection (Priority: P1)

A user who has prepared the application online can close every app tab and later reopen a saved
link offline, including when no previous background database runtime remains alive.

**Why this priority**: An offline edit in an already-running tab does not establish offline startup.

**Independent Test**: After preparation, close all clients and restart offline at a supported direct
link. Verify both the executable application and locally persisted finance data are usable.

**Acceptance Scenarios**:

1. **Given** a fully prepared application and required local data, **When** it restarts offline,
   **Then** all code and runtime assets needed for local work load without the network.
2. **Given** a supported finance detail link, **When** opened directly offline, **Then** its local
   record is usable with the correct workspace scope.
3. **Given** an application update, **When** the user postpones or accepts it, **Then** the existing
   update-consent behavior and locally saved work are preserved without a remote-sync prerequisite.
4. **Given** available application assets and a genuinely new identity, **When** first use occurs
   offline, **Then** the first workspace and required starter records can be created and persisted
   locally without remote confirmation, and synchronize later.
5. **Given** a recovered identity with incomplete local data, **When** startup occurs offline,
   **Then** no replacement workspace is created automatically; existing local work remains usable,
   and discovery of missing workspaces resumes when synchronization becomes available.

### User Story 3 - Know what is available offline (Priority: P2)

The app prepares an agreed set of finance data in the background and distinguishes data that has
not arrived from a known local result. Preparation does not delay work already possible locally.

**Why this priority**: Persistent local storage alone does not guarantee that every needed record
has been downloaded.

**Independent Test**: Prepare the agreed scope, disconnect, and navigate to records not previously
opened; separately exercise a partial download and unavailable attachment.

**Acceptance Scenarios**:

1. **Given** online access, **When** preparation runs, **Then** it prepares all accessible finance
   records across all accessible workspaces, including records never opened, without broadening
   permissions or fetching real bank-provider transactions automatically. Attachment files download
   on demand.
2. **Given** interrupted preparation, **When** offline navigation requests unavailable data, **Then**
   the app explains local unavailability without declaring the remote record nonexistent.
3. **Given** a large preparation workload, **When** the user interacts with available data, **Then**
   preparation does not become a readiness gate.

### Edge Cases

- A genuinely new identity versus a recovered identity with an empty local replica.
- A usable workspace whose profile initialization marker or attribution link is missing.
- Remote writes pending, rejected, or of unknown outcome across reload, retry, and cancellation.
- Empty queries, partial relationship data, and offset pagination over incomplete replicas.
- Identity/workspace replacement, A → B → A navigation, and obsolete reports arriving late.
- Permission revocation on another device while this device is offline; downloaded data cannot be
  assumed erased and local authorization cannot establish current remote acceptance.
- Browser storage eviction, quota pressure, private browsing, and incomplete asset installation.
- Runtime asset version changes, multiple tabs on different application versions, and failed updates.
- Optional fake-data seeding with an empty local result and no remote service.

## Requirements

### Functional Requirements

- **FR-001**: Available local data MUST be the first basis for ordinary finance display and actions.
  No remote query, permission preflight, synchronization completion, or connection timeout may be
  required when the necessary local records and locally known permissions already permit the action.
- **FR-002**: Local readiness, remote freshness, local persistence, and remote acceptance MUST be
  distinct. Browser online status MUST NOT establish synchronization readiness or successful saving.
- **FR-003**: Ordinary saves MUST allow continuation after local persistence and synchronize later.
  Later rejections MUST remain observable and MUST NOT be described as successful remote acceptance.
- **FR-004**: Missing initialization provenance, optional seeding, attribution-only repair, and
  reconciliation MUST NOT block unrelated locally usable finance workflows. Required domain data
  and known permissions still constrain the specific actions that need them.
- **FR-005**: Empty local results MUST NOT authorize automatic replacement, access restoration,
  duplicate bootstrap, or destructive repair. Unavailable data and confirmed absence MUST remain
  distinct. A genuinely new identity MUST be able to create and persist its first workspace and
  required starter records offline. A recovered identity with incomplete local data MUST NOT
  automatically create replacement workspaces; remote discovery waits independently of locally
  usable work. The new-versus-recovered distinction MUST use supported identity provenance, never
  an empty query alone. Its SDK mechanism and concurrent-bootstrap safety require investigation.
- **FR-006**: Capability decisions MUST use the current identity, workspace, local membership/grants,
  and required records, and react to observed invalidation. They MUST NOT require remote freshness
  solely because local knowledge could be stale.
- **FR-007**: Unknown mutation outcomes MUST preserve operation identity and recovery information.
  Recovery MUST NOT blindly replay writes or freeze unrelated work while waiting for a remote answer.
- **FR-008**: A prepared application MUST support offline restart with no surviving app clients,
  including supported direct links and the complete runtime asset chain needed for local operation.
- **FR-009**: Application updates MUST preserve current consent, draft, local-data, and multi-tab
  behavior. Cached shell/runtime versions MUST remain compatible.
- **FR-010**: Background preparation MUST respect authorization and MUST NOT gate existing local
  usability. It MUST prepare all accessible finance records across all accessible workspaces,
  including records the user has never opened. Attachment metadata belongs to this scope; attachment
  file content downloads on demand. Retention of downloaded files and storage-pressure behavior
  require investigation; on-demand download does not promise availability before download completes.
- **FR-011**: Startup and interaction optimization proposals MUST distinguish first visit, repeat
  visit, offline cold restart, and update. Record measured benefit, browser support, failure behavior,
  and an adoption/rejection decision before committing to experimental optimizations.
- **FR-012**: Research MUST cover service-worker asset completeness, early delivery, startup overhead,
  navigation preload, static routing, compilation preparation, and earlier page-owned initialization;
  application workers MUST be evaluated against the work Jazz already performs off the main thread.
- **FR-013**: Research MUST distinguish verified SDK behavior from inference and unmeasured benefit,
  recording exact dependency versions and primary sources. Unsupported handoffs or background
  execution guarantees MUST NOT be assumed.
- **FR-014**: Conflicting active specs, contracts, plans, and memory MUST be reconciled with these
  principles before the corresponding implementation. Historical implementation findings MUST remain
  identifiable as history; do not label intended behavior as already implemented or verified.
- **FR-015**: Lower-risk local-usability changes MUST be delivered in focused review cycles before
  speculative runtime redesign. Existing authorization, resource ownership, idempotency, financial
  integrity, and update safeguards MUST be preserved. Investigations may precede the code they inform.
- **FR-016**: Automated coverage MUST include cold offline startup, an online but unresponsive remote,
  ordinary offline writes, partial replicas, observed access changes, and eventual rejection/recovery.
  Identify affected tests at implementation review; add/update/run them only after that review.

### Key Entities

- **Local availability**: The records and relationship facts present for one identity/workspace;
  availability does not imply remote completeness or freshness.
- **Persistence outcome**: Not started, locally persisted, remotely accepted, rejected, or unknown;
  each is supported by an actual observation.
- **Offline preparation scope**: The agreed finance records and attachment content to make available.
- **Startup scenario**: First visit, returning visit, full offline restart, or application update.
- **Investigation result**: Question, evidence/version, experiment, result, remaining uncertainty,
  and adoption decision; research completion is separate from implementation completion.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All agreed locally available finance scenarios complete before reconnection, with zero
  required remote answers, including a remote connection that never answers requests.
- **SC-002**: All agreed cold offline direct-link scenarios succeed after every prior app client has
  closed, using persistent local data rather than a warmed live session.
- **SC-003**: No partial-cache scenario automatically recreates or restores records from local
  absence alone; no unknown-outcome scenario blindly duplicates an operation.
- **SC-004**: Each optimization has a before/after comparison of time to usable finance data and
  interaction responsiveness under the same recorded device, data volume, and startup conditions.
  Numerical budgets are selected after baseline investigation; none are claimed by this draft.
  Baseline collection and budget selection MUST NOT delay the first local-usability corrections.
  Capture comparable pre-change evidence before changing any path whose speed will be compared;
  a broad benchmark program is not a prerequisite for correcting verified remote dependencies.
- **SC-005**: Every identified guidance conflict and investigation has an owner task and explicit
  disposition; no speculative optimization is represented as a verified performance improvement.

## Assumptions

- This feature preserves server-enforced permissions and the existing financial data model.
- Previously approved online-only sharing/permission administration and explicit bank-provider
  operations remain exceptions. They do not justify remote gates on ordinary finance use.
- Offline guarantees require previously available application assets and retained local storage;
  an unvisited site cannot execute offline and an evicted replica cannot supply missing records.
- Offline first-workspace creation for a genuinely new identity is approved product behavior.
  The provenance mechanism, concurrent creation protocol, and recovery details require investigation
  and design review; this decision does not approve a specific bootstrap algorithm or automatic repair.
- Existing native service-worker support and update consent remain the starting point. No Workbox
  migration, database replacement, speculative background bank sync, or worker migration is assumed.
- [research.md](research.md) captures technical evidence; [tasks.md](tasks.md) is a provisional backlog,
  not an execution-ready replacement for a reviewed technical plan.

## Clarifications

- **Q1 approved**: Prepare all accessible finance records across all accessible workspaces, with
  attachment files downloaded on demand (option 1). Background preparation must not block existing
  local usability. Retention/storage behavior remains an investigation, not an implicit guarantee.
- **Q2 approved**: A genuinely new identity can create its first workspace entirely offline. A
  recovered identity with incomplete local data waits for synchronization to discover missing
  workspaces without automatically creating replacements. Available local finances remain usable.
- **Q3 approved**: Measure representative devices and datasets before selecting numerical startup
  and interaction budgets. Do not delay the local-first fixes for that broader baseline investigation.
  Capture pre-change evidence for meaningful comparisons without making measurement a remote gate.
