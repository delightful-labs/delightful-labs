# Feature Specification: Explicit workflow and view state

**Feature Branch**: No branch created; authored on `main`.
**Created**: 2026-10-18
**Status**: Implemented and automated verification passed; combined review pending
**Input**: Incrementally improve XState workflow and view ownership, using account-data-merge as a reference. Reduce scattered visual conditions and expose business decisions in statecharts instead of hiding workflows in functions.

## User Scenarios & Testing

### User Story 1 - Safely archive accounts (Priority: P1)

Users see account archive actions appropriate to their current access and receive clear progress and results.

**Why this priority**: A bounded first slice establishes a pattern for readiness, permission, persistence, and feedback.

**Independent Test**: Review and, after implementation approval, verify archiving independently of other forms.

**Acceptance Scenarios**:

1. **Given** account/access observations are loading, **When** the page renders, **Then** it shows loading rather than treating missing facts as denial or empty data.
2. **Given** a ready workspace, **When** access is evaluated, **Then** only eligible accounts offer archive, and a direct action request cannot bypass the same policy.
3. **Given** an accepted archive request, **When** it settles, **Then** feedback identifies the affected account and accurate success/failure; repeated submission while busy starts no second operation.
4. **Given** an active request, **When** identity, workspace, binding, record availability, or permission changes, **Then** no further unauthorized work starts and issued writes are reconciled without claiming they were undone.

### User Story 2 - Understand blocked editing (Priority: P2)

Users can distinguish loading, missing workspace, read-only access, missing prerequisites, and editable forms across account creation, category/tag management, workspace/profile editing, and transaction entry.

**Why this priority**: Disabled controls and absent forms alone do not explain how to proceed.

**Independent Test**: Deliver and verify each editing surface separately, preserving existing validation and finance rules.

**Acceptance Scenarios**:

1. **Given** transaction entry, **When** observations arrive, **Then** the view distinguishes no workspace, no usable account, no applicable category, read-only access, and readiness with appropriate explanations or existing recovery actions.
2. **Given** an editable form, **When** permission is lost, **Then** displayed capabilities and acceptance of new submissions change together.
3. **Given** invalid input, denied access, changed scope, or persistence failure, **When** the request ends, **Then** feedback distinguishes the applicable outcome instead of treating every outcome as a generic save error.

### User Story 3 - Use consistent form behavior (Priority: P2)

Users receive consistent submission, validation, progress, reset, and outcome behavior across forms, including when access or scope changes while a form is open.

**Why this priority**: Shared form behavior must support the domain workflows instead of leaving policy and lifecycle decisions in page callbacks.

**Independent Test**: Verify the shared form contract with one representative integration before adopting it in other forms one review cycle at a time.

**Acceptance Scenarios**:

1. **Given** a blocked or busy form, **When** submission is requested through either the UI or its workflow event interface, **Then** both paths follow the same capability policy and start no disallowed operation.
2. **Given** a submitted form, **When** validation, authorization, or persistence determines its result, **Then** the view receives the corresponding typed feedback and available actions without reconstructing them from raw errors or several independent flags.
3. **Given** an in-progress form, **When** reset, reopen, dialog close, scope replacement, or teardown occurs, **Then** the reviewed lifecycle policy determines whether work continues or cancels, preserves accurate issued-write outcomes, and isolates stale results.
4. **Given** two forms with different business rules, **When** they share form mechanics, **Then** each still applies its own domain authorization and preparation before persistence.

### User Story 4 - See coherent bank views (Priority: P3)

Users see bank setup and operation views with appropriate actions while previous sync results remain independently understandable.

**Independent Test**: Verify setup, discovery, mapping, manual sync, cancellation, and restricted views without changing provider behavior.

**Acceptance Scenarios**:

1. **Given** a setup/operation step, **When** the view updates, **Then** messages and actions correspond to that step without contradictory modes.
2. **Given** previous sync results, **When** another operation starts or fails, **Then** historical results remain distinct from the current operation.
3. **Given** reload, reconnection, or ordinary observation updates, **When** the view changes, **Then** no transaction fetch begins without existing explicit user action and verification.

### User Story 5 - Reveal and clear recovery data (Priority: P3)

Users reveal, confirm saving, and hide their recovery phrase with feedback tied to their current identity.

**Independent Test**: Verify this lifecycle independently of account connection or data merge.

**Acceptance Scenarios**:

1. **Given** a hidden phrase, **When** reveal succeeds or fails, **Then** one corresponding view appears and confirmation applies only to that revealed phrase.
2. **Given** a revealed phrase, **When** it is hidden, identity changes, or the owner unmounts, **Then** transient phrase/confirmation data is cleared and late results cannot reveal the old phrase.

### Edge Cases

- Missing observations versus empty results; subscription failures and retries.
- Permission/scope changes during validation, immediately before persistence, and after a write is issued.
- Duplicate events, stale child results, replaced bindings, and unexpected child failures.
- Navigation, cancellation, shutdown, and non-abortable writes during teardown.
- Accounts/categories becoming unavailable while a form remains open.
- Locale changes while feedback is visible; browser online status differing from actual remote confirmation.

## Requirements

### Functional Requirements

- **FR-001**: Each delivered surface MUST expose relevant readiness, access, operation, and outcome states, with an explanation when users cannot proceed.
- **FR-002**: Displayed action availability and acceptance of requests MUST follow the same current capability policy. Authoritative write-time protections MUST remain.
- **FR-003**: Requests MUST remain bound to their intended identity, workspace, record, and dependencies where applicable. Scope changes MUST prevent new work under stale assumptions.
- **FR-004**: Workflows MUST distinguish applicable success, denial, invalid input, scope change, cancellation, partial completion, and failure. Partial completion applies only where actual partial work is possible.
- **FR-005**: Cancellation/shutdown MUST stop scheduling new work, settle or reconcile issued effects according to actual guarantees, and release resources before completion. Late events MUST NOT override shutdown/cancellation or affect replacement operations.
- **FR-006**: Presentation MUST receive explicit view choices and actions rather than reconstructing business readiness, authorization, or result classification from unrelated facts.
- **FR-007**: Existing finance semantics, local-first behavior, accessibility, localization, and provider consent/credential rules MUST remain. Current operation and historical results MUST stay distinct.
- **FR-008**: Recovery phrases MUST remain transient and identity-bound and be cleared on hide, identity replacement, and owner teardown.
- **FR-009**: Each slice MUST document its model/file scope before effects, present implementation for review, and add/run relevant automated coverage only after approval of that implementation.
- **FR-010**: Shared form behavior MUST own submission acceptance, validation/progress feedback, and applicable reset/reopen/cancellation semantics. An external disabled flag MUST NOT be the sole protection against disallowed events.
- **FR-011**: Each form's domain workflow MUST own authorization, preparation, scope-change decisions, and persistence outcomes. Shared form mechanics MUST support composition without embedding every entity's business rules or hiding those rules in a generic save callback.
- **FR-012**: Shared form presentation MUST receive typed feedback and capabilities; consumers MUST NOT repeatedly interpret raw errors or combine lifecycle flags to decide which actions or result view apply.

### Key Entities

- **Observed scope**: Identity, workspace, dependency binding, loaded records, and access facts.
- **Capability**: Whether an action is currently allowed and the reason when unavailable.
- **Request/result**: Intended operation target and classified outcome, separate from historical results.
- **Review cycle**: Focused model/implementation review followed by approved verification.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every delivered surface has acceptance coverage for every applicable blocked reason and terminal outcome, with a visible explanation for blocked reasons.
- **SC-002**: Every approved permission/scope-change scenario starts no new unauthorized operation and attributes no result to replacement scope.
- **SC-003**: Duplicate-submission scenarios have at most one active operation; interruption scenarios never report unconfirmed persistence as completed or committed writes as undone.
- **SC-004**: Existing actions remain available to eligible users and relevant approved regression checks pass before a slice is marked verified.
- **SC-005**: Every slice records model review, implementation review, and verification separately; documentation/type checking alone never establishes completion.

## Assumptions

- Behavior-preserving architecture refactor with clearer blocked/error feedback; no visual redesign or access-policy changes.
- The merge branch is a reference, not a dependency to merge wholesale. Its unfinished importer/coordinator is outside scope.
- Account archiving is first. This spec does not authorize a site-wide implementation batch.
- No new persisted domain schema, provider operation, or unsupported connectivity observer is assumed.
- Simple input/disclosure state, optional display fields, formatting, and pure transformations may remain outside workflow models.
- Technical direction and progress tracking are in [delivery.md](delivery.md). Detailed implementation tasks follow reviewed design.

## Authorized completion and combined review

The user subsequently requested finishing the remaining XState work including
implementation and tests while away, with review of the combined result afterward.
This explicitly authorizes the remaining delivery slices, larger related file
scope and test execution without the earlier per-slice pauses (FR-009/SC-005).
It does not authorize commits or changes to finance/provider/security policy.
See remaining-work.md for the concrete models and review.md for the combined guide.
