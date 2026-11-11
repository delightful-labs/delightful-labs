# Remaining workflow adoption

The user authorized finishing the XState work including tests while away and
reviewing the combined result afterward. This supersedes the earlier per-slice
review/test pauses and permits the larger related batch. No commits authorized.
Requirements checklist: 14 checked, zero unchecked. The prerequisite script points
to the older active 002 feature; this work explicitly uses this 004 directory.
No implementation extension hooks exist. Existing ignore files cover generated
Node/build/test artifacts; no new tool or dependency is needed.

## Model before effects

All form consumers compose scoped owner -> submission -> single-write -> domain
assessment -> focused existing persistence effect. Owner handles validation,
create/edit mode, duplicates, reset, scope and shutdown; single-write retains
issued non-abortable writes until settlement. Domain assessment is reused for
visible readiness and fresh pre-write authorization. Typed views remain props-only.

The reusable write base gains an optional pure assessment projection of validated
request values into observation facts. This lets a domain policy assess the exact
archive target, selected transaction references or avatar action without adding
entity rules to the generic lifecycle. Scope is still checked against raw fresh
observations; SDK permissions and canonical validation remain authoritative.

Category/tag management share the existing editing permission predicate. Assessment:
checking -> sessionUnavailable | selectWorkspace | loadFailed | loading | readOnly
| unavailableReference | protectedRecord | ready. A matching membership identity
is required. Archive intents select a current, unarchived row; system categories
are protected. Tag creation accepts a null category or an active same-org category.
Readiness changes never fabricate rollback of an issued archive. Rows' archive
capabilities use the same policy assessment. Forms retain separate actor owners.

Profile assessment: checking -> sessionUnavailable | loadFailed | loading |
profileUnavailable | ready. Scope includes identity/profile/database. Name editing
compares normalized displayName against the observed profile. Avatar editing
accepts a selected upload or removal only when an avatar exists; shared edit mode
keeps a pristine upload disabled. Resizing remains canonical async validation;
fresh ownership is assessed afterward. Selected files clear on accepted revision
changes/scope replacement/settled success. Object URLs retain native cleanup.

Transaction assessment: checking -> sessionUnavailable | selectWorkspace |
loadFailed | loading | noAccounts | readOnly | noCategories | referenceUnavailable
| ready. Membership/grants select writable accounts (existing canWriteAccount),
categories match active workspace/kind and are unarchived. Exact validated
transaction intent is rechecked immediately before persistence, including currency,
organization/kind and writable account. Kind is part of scope. Existing validation,
integer money/check details/tag behavior and transactional persistence remain.
No-account UI retains AccountCreation; other blocked states get explanations.

Bank presentation projects existing availability/setup/operation chart decisions
into a discriminated mode (restricted/setup/connected, with recovery eligibility
only on connected), typed setup step and operation activity. It removes independent
show flags from presentation props. Historical lastSync remains an independent
payload. No provider effects, consent rules, passkey policy or event acceptance
changes; reconnection/reload never schedules a fetch.

Recovery phrase owner: hidden -> revealing -> revealed.unconfirmed/confirmed;
reveal failure -> failed; HIDE clears data and returns hidden. OBSERVE compares
identity plus exact account binding; replacement clears and cancels reveal.
SHUTDOWN clears and finalizes. Invoked export/phrase conversion has onError;
stopped late results cannot reveal old secrets. Confirmation is accepted only in
revealed states and is cleared on hide/replacement/failure/shutdown. Integration
uses explicit lifetime teardown before stopping; presentation receives one typed
view. Sensitive phrase never enters logs/persisted artifacts.

## File batches and verification

Finish account-creation tests first. Then category and tag policy/contracts/shared
feedback plus their route/forms/lists; profile policy and account route/forms;
transaction policy/integration/form; bank contract/selector/presentation/integration;
recovery machine/contract/integration/presentation. Keep each batch coherent and
verify types before moving on. Add focused domain tests and browser regressions
for each, leveraging existing permission/offline suites and shared lifecycle tests.
Run unit/types before browser servers to avoid shared Jazz environment regeneration.
Record actual results and limits in tasks.md; no static check counts as runtime
verification. Preserve existing styles and stable submit labels.

## Implemented shared refinements

`createSingleWriteFormOptions` composes the existing shared lifecycle for category,
tag, profile and transaction consumers. `FormFeedback`/form-messages share props-only
localized blocked/outcome rendering. Archive row IDs are projected through the same
resource-free policy chart used for request assessment (getInitialSnapshot).

Profile avatar uses shared `resetOnSuccess` and the controller's `changeValues`
adapter for controlled inputs. On success, raw Files are released and fields
rebuild while saved feedback remains. Presentation effects track derived scalar
revisions, not whole actor views. A native selection callback reports user changes;
programmatic success reset does not masquerade as fresh input.

## Observation delivery correction

Browser verification exposed that Jazz's QuerySubscription preserves row/array
identity when applying deltas. Passing only `.current` into an untracked actor
send did not subscribe the integration effect to inserted rows or changed fields.
The transaction owner could remain in noAccounts after a locally persisted insert.

Integrations now use the shared observeRow/observeRows adapters inside their
reactive observation readers. These read and snapshot row fields before sending
to actors, preserve null versus undefined and keep opaque database bindings intact.
This applies to the new domain forms plus existing workspace/archive/bank wiring
so revisioned facts cannot silently mutate beneath an assessment. Unit snapshots
cover in-place changes; browser coverage checks first-account replacement offline
and a same-row membership-role revocation without another input/submit event.

Transaction fields mount when the model reports ready, after initial options and
permissions are available. The shared workflow owner stays mounted throughout
loading/blocked/settling states. This preserves native Select default initialization
and avoids an empty initial category becoming a permanent blank selection. Blocked
and interrupted feedback remains outside the fields; only the field presentation
is conditional. Permission loss still settles the owned operation.
