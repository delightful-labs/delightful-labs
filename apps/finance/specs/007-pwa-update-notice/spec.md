# Feature Specification: PWA update notice

**Feature Branch**: No branch created.
**Created**: 2026-10-21
**Status**: Draft
**Input**: Add an in-app notification when a new app version is ready, with an action to activate it and reload. Defer checking for unsaved edits.

## User Scenarios & Testing

### User Story 1 - Apply an available update (Priority: P1)

Users who keep the app open can learn that a new version is ready and choose when to reload into it.

**Why this priority**: Users should be able to receive improvements without knowing to close every app window.
**Independent Test**: Open the production app, make an updated release available, and apply it through the notice without closing other app tabs.

**Acceptance Scenarios**:

1. **Given** an existing app session, **When** a newer version has finished downloading and is ready to activate, **Then** a non-modal notice says “A new version is available” and offers “Update and reload” and “Later”.
2. **Given** an update was already ready before the app opened, **When** the app starts, **Then** it presents the same notice.
3. **Given** the notice, **When** the user chooses “Update and reload”, **Then** the app activates the available update and reloads the requesting tab once into the new version.
4. **Given** first installation or no available update, **When** the app opens, **Then** it shows no update notice.
5. **Given** unsaved form edits, **When** the user chooses “Update and reload”, **Then** the update proceeds without checking those edits or requesting a separate unsaved-edit confirmation; unsubmitted values may be lost.

### User Story 2 - Continue working and update later (Priority: P2)

Users can dismiss the notice and continue their current activity without an automatic reload.

**Why this priority**: Announcing an update should not interrupt ordinary finance work.
**Independent Test**: Dismiss an available update, navigate between pages, and confirm the session continues without another notice for the same update until the tab is reloaded or reopened.

**Acceptance Scenarios**:

1. **Given** the notice, **When** the user chooses “Later”, **Then** the notice closes and the current page and its form values remain unchanged.
2. **Given** a dismissed update, **When** the user navigates within the app in that tab, **Then** the same update is not announced again during that page session.
3. **Given** a dismissed update that remains available, **When** the tab is reloaded or reopened, **Then** the app may present the notice again.
4. **Given** a different, newer update becomes ready during the same page session, **When** it replaces the dismissed update, **Then** the app presents a new notice.

### User Story 3 - Handle multiple tabs and update failures (Priority: P2)

Users receive understandable behavior when another tab applies an update or an update attempt fails.

**Why this priority**: Multiple open tabs must not prevent an explicit update or cause unexpected reloads elsewhere.
**Independent Test**: Apply an update with two tabs open, then separately simulate an activation failure and retry.

**Acceptance Scenarios**:

1. **Given** two app tabs, **When** one applies an update, **Then** that tab reloads once; the other tab does not automatically reload and offers a reload action to enter the new version.
2. **Given** another tab has already activated the offered update, **When** the user accepts the stale notice, **Then** the requesting tab reloads into the active version without trying to activate an unavailable update or becoming stuck.
3. **Given** an update attempt fails or does not complete, **When** failure is established, **Then** the app stays usable, reports that the update could not be completed, and offers a retry without repeatedly reloading.

### Edge Cases

- A release still downloading must not be advertised as ready; failed downloads leave the current app usable.
- Repeated update observations, rapid clicks, or simultaneous acceptance in two tabs must not cause duplicate notices or reload loops.
- A newer release can replace an offered release; accepting the notice applies the latest ready release.
- Offline status alone must not hide an already downloaded update. If applying it cannot complete, the failure behavior applies.
- Browsers without update support and development environments without the production worker must retain ordinary app behavior without an update notice or error.
- Closing all app tabs without accepting the notice retains the existing automatic update-on-next-open behavior.

## Requirements

### Functional Requirements

- **FR-001**: The app MUST announce a ready newer version through one non-modal in-app notice per tab, in the drawer directly above the online status, both when discovered during use and when already available at startup. First installation MUST NOT count as an update.
- **FR-002**: The notice MUST provide “Update and reload” and “Later” actions; downloading or detecting an update MUST NOT automatically reload an open tab.
- **FR-003**: Accepting an update MUST activate the latest ready version and reload the requesting tab once after activation, without requiring other tabs to close. Repeated acceptance while in progress MUST NOT start duplicate attempts.
- **FR-004**: Choosing “Later” MUST preserve current page state and suppress the same update notice across in-app navigation for that page session. A different ready release MUST be eligible for a new notice.
- **FR-005**: Tabs other than the requesting tab MUST NOT automatically reload when an update activates elsewhere. They MUST offer an explicit reload action once the version change is observed.
- **FR-006**: Update failures MUST leave the current app usable, provide accessible failure feedback and a retry action, and avoid indefinite in-progress feedback or reload loops. Planning MUST define a bounded completion timeout.
- **FR-007**: Update notices, actions, progress, and failure feedback MUST support keyboard and screen reader use and the app's localization conventions. The notice MUST NOT steal focus or request browser notification permission.
- **FR-008**: Updating MUST preserve locally saved financial data, authentication, and existing synchronization behavior. It MUST NOT clear application data or wait for remote synchronization before permitting an update.
- **FR-009**: This feature MUST NOT check for unsaved edits, block updating because of them, or add an unsaved-edit confirmation. Draft preservation and unsaved-edit protection are deferred; accepting the reload can discard unsubmitted values.
- **FR-010**: Existing public-shell caching boundaries and normal activation after all app tabs close MUST remain supported. Unsupported environments MUST continue working without update UI.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In supported production-browser scenarios, a ready update produces one notice within five seconds of the app observing its availability, including startup discovery.
- **SC-002**: A user can enter the ready version with one action from the notice, without closing other tabs; each requesting tab reloads exactly once per successful attempt.
- **SC-003**: Dismissing an update produces zero automatic reloads and zero repeated notices for that release during subsequent in-app navigation in the same page session.
- **SC-004**: In multi-tab verification, accepting in one tab causes zero automatic reloads in other tabs, which can each enter the new version through their own reload action.
- **SC-005**: Failure and retry scenarios leave the current app usable, and successful updates retain all previously locally saved financial records and the signed-in identity.

## Assumptions

- This feature extends the existing production PWA update behavior; it introduces no push notifications, installation prompts, release notes, or new visual design direction.
- Update availability follows the browser's existing discovery opportunities. Periodic polling, immediate deployment announcements, and a manual “Check for updates” action are outside scope.
- Dismissal is local to a tab's page session, not a persisted account preference or a dismissal shared across tabs.
- Existing authentication and local persistence provide continuity across reloads; this feature does not introduce a new data migration or backup mechanism.
- Unsaved-edit checking and draft preservation require a future feature. This scope deliberately permits a user-requested reload without those protections.
- Acceptance scenarios describe future verification. Implementation must be reviewed and approved before tests are added or run, following repository agreements.
