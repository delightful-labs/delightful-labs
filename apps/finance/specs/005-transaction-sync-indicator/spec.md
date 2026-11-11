# Feature Specification: Transaction waiting indicator

**Feature Branch**: No branch created.
**Created**: 2026-10-19
**Status**: Draft
**Input**: Show only a waiting icon in the transaction list, tracking pending synchronization across navigation and reloads. Hover and screen reader text must match.

## User Scenarios & Testing

### User Story 1 - See transactions waiting to sync (Priority: P1)

Users can identify locally created transactions that have not yet been confirmed remotely, without delaying offline entry.

**Why this priority**: A saved local transaction can still need synchronization.
**Independent Test**: Create a transaction offline, open its list, reconnect, and observe the indicator until remote confirmation.

**Acceptance Scenarios**:

1. **Given** a locally saved income or expense awaiting remote confirmation, **When** its list item appears, **Then** it has one waiting icon with hover text and screen reader text both reading “Waiting to sync”.
2. **Given** a waiting item, **When** remote acceptance is confirmed, **Then** its waiting icon disappears without a page refresh.
3. **Given** bank-imported transactions, **When** they are saved locally, **Then** the same waiting and confirmation behavior applies; provider fetching remains explicitly user initiated.
4. **Given** an offline device, **When** a transaction is created, **Then** local saving and navigation finish without waiting for remote confirmation.

### User Story 2 - Keep waiting information across visits (Priority: P2)

Users retain accurate waiting information when navigating away or reopening the app on the same device.

**Why this priority**: Leaving a page must not erase evidence of an unconfirmed write.
**Independent Test**: Save offline, navigate away, reload, and return to the transaction list before reconnecting.

**Acceptance Scenarios**:

1. **Given** a tracked waiting item, **When** the user navigates away or reloads offline, **Then** the item still shows its waiting icon on return.
2. **Given** acceptance occurred while the page was closed, **When** the app obtains remote confirmation after reopening, **Then** it clears the waiting icon.
3. **Given** confirmation is unavailable, **When** the device remains offline or a confirmation query fails, **Then** the tracked item remains waiting; elapsed time or missing query results do not establish rejection or success.
4. **Given** a different signed-in identity or workspace, **When** its list opens, **Then** another identity's tracking data cannot affect that list.

### Edge Cases

- A rejected creation can disappear from the ordinary transaction list. Stop treating an explicitly rejected write as waiting and use the existing failure-feedback mechanism; retaining failed transaction copies is outside this feature.
- A delayed observation from a previous session must not change a replacement session's indicators.
- If a newer write for the same item is tracked, an older confirmation must not clear its waiting indicator.
- Multiple tabs must reconcile shared tracking information without duplicate indicators or one tab clearing another's unconfirmed write.
- If tracking persistence fails, preserve ordinary transaction saving and report the tracking limitation through existing feedback; do not silently promise reload recovery.
- Clearing the current identity's local application data also clears its tracking data.

## Requirements

### Functional Requirements

- **FR-001**: Show one non-interactive waiting icon for each tracked, locally saved transaction awaiting remote confirmation, in both income and expense lists.
- **FR-002**: The icon MUST have identical localized hover and screen reader text: “Waiting to sync”. It MUST remain understandable without color or animation.
- **FR-003**: Track manual creations and bank-imported creations without waiting for network access to finish local saving.
- **FR-004**: Preserve pending associations across route changes, tab closure, and reload on the same device, scoped to application environment and signed-in identity, with each item linked to its workspace.
- **FR-005**: Remove a waiting indicator only on evidence of acceptance of the tracked creation, or explicit rejection ending that pending attempt. Connectivity, elapsed time, and an absent remote row MUST NOT be treated as acceptance or rejection.
- **FR-006**: Recover confirmation for pending creations after reopening, including writes accepted while the app was closed. Confirmation failures MUST leave unresolved tracking pending.
- **FR-007**: Handle observed rejections through existing failure feedback and clear their pending tracking. Do not claim complete historical rejection recovery when evidence is unavailable.
- **FR-008**: Reuse existing synchronization behavior. Status observation MUST NOT replay finance writes or trigger provider fetching.
- **FR-009**: Session replacement, concurrent tabs, and stale confirmations MUST NOT clear unrelated or newer pending writes.
- **FR-010**: Show no Synced or Error status icons. Absence of a waiting icon MUST NOT be presented as proof that an arbitrary existing transaction is synced.

### Key Entities

- **Pending synchronization record**: Device-local association between a finance transaction, its write identity, application environment, signed-in identity, workspace, and unresolved confirmation.
- **Remote confirmation**: Evidence that the tracked creation was accepted remotely; distinct from local saving and network availability.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every tracked offline creation in manual-entry and import scenarios displays exactly one waiting icon on its next list render, including after offline reload.
- **SC-002**: Every confirmed tracked creation loses its waiting icon on the next rendered update without manual refresh.
- **SC-003**: Hover and accessible text match exactly for every waiting icon in each supported locale.
- **SC-004**: Reload, identity/workspace replacement, concurrent-tab, and stale-confirmation scenarios produce zero false acceptance claims or unrelated indicator removals.
- **SC-005**: Tracking introduces zero additional provider fetches or replayed transaction creations; offline saving still completes before reconnection.

## Assumptions

- This replaces the earlier three-status proposal with a single waiting indicator. “Waiting” includes both queued work and synchronization in progress.
- Initial scope covers transaction creations, matching current manual-entry and import workflows. Adding edit/delete tracking is outside this feature.
- Existing untracked transactions do not receive guessed waiting statuses. Previously confirmed rows need no new positive status display.
- Tracking is device-local; global visibility into another device's pending writes is outside scope.
- Existing failure feedback is reused; a retained failed-item list and retry controls are outside scope.
- Planning must establish recovery using the installed synchronization service's supported public capabilities. Changes to that service or reliance on private internals are excluded.
- Implementation review precedes adding or running unit and browser tests, per repository working agreements.
