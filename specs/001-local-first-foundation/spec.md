# Feature Specification: Jazz-First Local-First MVP

**Feature Branch**: `spec/jazz-only-mvp`
**Created**: 2026-10-14
**Updated**: 2026-10-31
**Status**: Active Jazz-only MVP requirements. Identity/session slices and workspace selection have
subsequently been authorized, implemented, and adopted incrementally; see [current progress](plan.md).
The full MVP is not complete. This specification itself does not authorize additional unreviewed slices.

**Input**: Deliver a reusable foundation for new Delightful apps using Jazz for v1, informed by current Finance and DUI. Put database SDK access behind focused layers so another backend can be introduced later without making multi-backend support a release prerequisite.

## Scope and Decisions

This revision supersedes the October multi-backend MVP requirements. Jazz is the only required v1 backend. A useful foundation for building other apps is the release goal; a second backend, independent plugin distribution, a universal schema language, and cross-backend conformance are deferred.

The approved direction of a shared data interface is retained as a modest typed boundary over concrete consumer operations. V1 does not require portable schema declarations or a general query language. App-owned Jazz schema and permission definitions may live in explicitly identified backend integration modules. Ordinary app workflows and presentation must use the foundation boundary rather than importing Jazz. Future replacement may require new schema mappings, policy definitions, and data migration; source-compatible replacement is not promised.

Earlier decisions on explicit identity reuse, backend access disclosure, private workspaces, and optional transaction guarantees remain. Recovery and using the same identity on a second device remain required; v1 can satisfy second-device use through supported recovery rather than requiring an additional pairing protocol.

Incremental adoption is a v1 requirement. Existing apps may adopt individual compositions and
workflow/data boundaries while retaining their other infrastructure. Finance must not require a
whole-app rewrite, schema replacement, or data migration to start using the library. A focused
Finance integration will validate this boundary before interfaces stabilize; implementing it still
requires a separate instruction and the normal implementation review gate.

## User Scenarios & Testing

### User Story 1 - Start another app with reusable foundations (Priority: P1)

An app developer adds identity, workspace behavior, and typed reactive persistence without reproducing Finance's infrastructure or adopting Finance's domain model.

**Independent Test**: A small consumer with one app-owned record type creates, observes, edits, and deletes workspace-scoped records through the foundation.

**Acceptance Scenarios**:

1. **Given** a new consumer, **When** it configures Jazz through its integration boundary, **Then** it can use foundation identity/workspace flows and typed data operations without direct SDK calls in presentation or ordinary workflows.
2. **Given** an app-specific schema or policy, **When** it is registered, **Then** its SDK dependencies remain in named integration modules and its domain rules remain consumer-owned.
3. **Given** a future backend replacement, **When** a developer inventories dependencies, **Then** all direct SDK imports and backend-native contracts have documented integration owners; no claim of a proven replacement is made.

### User Story 2 - Establish, resume, and recover identity (Priority: P1)

A user starts with a local identity, resumes it after restart, protects recovery material, and explicitly restores the intended identity in another app or device.

**Independent Test**: Exercise new identity, returning session, recovery on separate browser storage, cancellation, invalid recovery material, and identity replacement.

**Acceptance Scenarios**:

1. **Given** a usable local session, **When** the app restarts while remote service is unavailable, **Then** available local work does not wait for remote freshness.
2. **Given** a recovery interaction, **When** the user reveals or submits sensitive material, **Then** it is transient, absent from logs/URLs, and cleared on dismissal, unmount, cancellation, or identity replacement.
3. **Given** an existing identity, **When** the user explicitly connects a second app or device through supported recovery, **Then** it restores that identity rather than silently replacing it. Identity restoration and remote data discovery have separate outcomes.
4. **Given** identity reuse in another app, **When** connection is offered, **Then** the interaction discloses native credential authority and access consequences before confirmation. Separate app views are not described as security isolation.
5. **Given** a failed or cancelled identity transition, **When** it settles, **Then** scoped resources are cleaned up and the user can retry without a false success or unintended repeated mutation.

### User Story 3 - Own and share workspaces (Priority: P1)

A user creates a private workspace, selects among accessible workspaces, and explicitly invites another identity into a shared workspace.

**Independent Test**: Use two authorized identities and an unrelated identity to exercise creation, selection, invitation, membership changes, and private-data denial.

**Acceptance Scenarios**:

1. **Given** a genuinely new identity, **When** it creates its first workspace offline, **Then** the workspace and required foundation records can persist locally without app-specific starter data becoming a readiness gate.
2. **Given** a recovered identity with incomplete local records, **When** no workspaces are locally visible, **Then** the foundation does not automatically create replacements or restore access from absence alone; discovery proceeds independently of available work.
3. **Given** an unrelated identity, **When** it requests private workspace records, **Then** storage authorization denies access regardless of UI visibility.
4. **Given** an invitation, **When** it is accepted, rejected, expired, or already used, **Then** the interaction reports the actual outcome and documented Jazz membership semantics without duplicate membership.
5. **Given** a workspace or observed access change, **When** current capabilities become invalid, **Then** affected work and subscriptions are invalidated and late results cannot expose the prior scope's data.

### User Story 4 - Use local data with honest operation feedback (Priority: P1)

A developer observes typed records and operation outcomes. Users keep working with available local records and locally known permissions while synchronization happens separately.

**Independent Test**: Create and edit data offline, close every client, reopen offline, reconnect, and separately exercise incomplete replicas, silent remote service, and rejected or uncertain operations.

**Acceptance Scenarios**:

1. **Given** sufficient local records and permissions, **When** an ordinary read or write occurs with no remote answer, **Then** it completes on local evidence without a remote preflight or sync gate.
2. **Given** a write reported as locally persisted, **When** every client closes and the prepared consumer restarts offline with retained storage, **Then** the change remains available.
3. **Given** unavailable or partially replicated records, **When** an observation updates, **Then** it distinguishes loading, locally empty, locally ready, unavailable, and error without claiming global completeness.
4. **Given** pending synchronization, rejection, or unknown settlement, **When** feedback is displayed, **Then** local acceptance, local persistence, connectivity, and remote acceptance remain distinct; unknown writes are not blindly replayed.
5. **Given** session/workspace replacement or disposal, **When** an old observation reports late, **Then** it produces no consumer update in the new scope and its resources are released.

### User Story 5 - Embed accessible shared interactions (Priority: P2)

A developer embeds account/recovery and workspace interactions using DUI while retaining app routes, screens, layout, and localization.

**Independent Test**: Embed the compositions in the small consumer and exercise keyboard operation, focus return, cancellation, translated messages, and operation feedback.

**Acceptance Scenarios**:

1. **Given** a consumer screen, **When** it renders foundation interactions, **Then** no foundation router, full app shell, Finance-specific page, or backend-aware presentation is required.
2. **Given** a multi-step interaction, **When** state changes or the user dismisses it, **Then** focus, accessible feedback, cancellation, and sensitive-data cleanup remain coherent.
3. **Given** existing DUI dialogs, inputs, status/loading controls, and button content, **When** compositions need those behaviors, **Then** they reuse available primitives. A genuinely missing primitive is documented for DUI review rather than duplicated.

### User Story 6 - Adopt one capability in an existing app (Priority: P1)

A Finance developer adopts one library capability, such as recovery presentation/workflow, while
keeping the app's existing Jazz session, other workflows, financial schemas, and permissions.
Further capabilities can migrate independently in later focused changes.

**Independent Test**: Integrate one agreed capability into Finance through a narrow host adapter;
exercise the adopted interaction and an existing unmigrated workflow against the same session,
then verify dismissal, identity replacement, and resource cleanup.

**Acceptance Scenarios**:

1. **Given** Finance's existing Jazz session, **When** one library capability attaches, **Then** it
   reuses that session through a documented adapter without creating a second identity, client,
   workspace bootstrap, or competing lifecycle owner.
2. **Given** partially migrated Finance, **When** library-backed and existing direct Jazz operations
   run, **Then** they coexist with Finance's existing schemas and authorization. Unmigrated modules
   need not adopt the library's data boundary as a prerequisite.
3. **Given** host-owned session/workspace resources, **When** the adopted interaction unmounts,
   **Then** it releases its own actors/subscriptions without shutting down host resources. Identity
   replacement follows one explicit coordinated invalidation/drain protocol across the boundary.
4. **Given** a focused adoption change, **When** it is reviewed or reverted, **Then** unrelated routes,
   domain workflows, and persisted data do not require migration. Session, workspace, UI composition,
   and data access adoption are not an all-or-nothing bundle.
5. **Given** a proposed stable interface, **When** adoption evidence is reviewed, **Then** one small
   Finance integration demonstrates the boundary; a minimal new consumer alone is insufficient proof
   of incremental adoption. Full Finance migration remains outside the release requirement.

### Edge Cases

- New identity versus recovered identity with an empty or partial replica.
- Remote service unreachable or connected but never answering.
- Repeated startup, identity replacement, A → B → A workspace changes, and late reports.
- Local persistence failure, later authority rejection, and unknown write outcome after interruption.
- Offline invitation administration or recovery requiring unavailable remote data.
- Revocation learned after offline work; already disclosed data cannot be promised erased.
- Browser eviction, quota failure, unavailable runtime assets, and multiple tabs.
- An SDK upgrade changing persistence, permissions, query behavior, or recovery semantics.

## Delivery priority: finish existing Finance extraction

The 2026-11-02 user direction is to extract all remaining reusable foundations already implemented
in Finance before adding features missing from Finance. Follow [the extraction inventory and
acceptance boundary](finance-extraction.md). This includes existing scoped operation/form ownership,
typed data observations/mutations, initialization/provenance, remaining creation recovery and profile/
identity integration. Financial rules and native schema mappings remain consumer-owned. Invitations
and member administration remain MVP requirements, but are sequenced after this extraction milestone.
The next app must not wait for new collaboration features or a complete Finance rewrite.

The Finance extraction milestone is now merged (library PR #10 and Finance PR #45). Invitation
redemption is the active post-extraction slice. Its client/server workflow boundaries and disposable
native permissions are qualified separately; native transactional reads, concurrent redemption and
real bearer verification remain gates before an endpoint or UI. Track completion and outstanding
MVP work in [tasks.md](tasks.md); this progress does not narrow FR-008.

## Requirements

### Functional Requirements

- **FR-001**: Jazz MUST be the sole required v1 database SDK. A second backend and backend marketplace/plugin ecosystem MUST NOT gate release.
- **FR-002**: Database access MUST pass through focused typed boundaries for session/identity, workspaces/access, and app data observations/mutations. SDK imports, native handles, schema definitions, and policy definitions MUST remain in documented backend integration modules, not ordinary workflows or presentation.
- **FR-003**: Consumers MUST own domain schemas and rules. V1 MUST cover typed records, explicit ID references, create/read/update/delete, and reactive workspace-scoped observations. Equality/null/range/AND filtering, sorting, and bounded lists remain the initial supported query needs; exact expression and execution limits require design against a concrete consumer. No universal schema/query compiler is required.
- **FR-004**: Unsupported operations or guarantees MUST fail explicitly before dependent work. No wrapper may silently weaken authorization, durability, or transaction semantics.
- **FR-005**: Identity establishment, local resumption, explicit recovery, second-device identity reuse, and session transition cleanup MUST be supported through documented Jazz mechanisms. Separate device invitation/QR pairing and passkey mechanisms are not independently required v1 features.
- **FR-006**: Explicit same-backend identity reuse across apps MUST disclose credential authority and native data access. Automatic SSO, cross-backend identity portability, a shared app directory, and cross-app data request/approval workflows are deferred.
- **FR-007**: Private and invited shared workspaces MUST enforce access at storage boundaries. Membership labels MUST reflect implemented Jazz policies. Finance's organization/account grants, viewer roles, and provider-secret rules MUST NOT become generic foundation requirements without separate approval.
- **FR-008**: Workspace creation, selection, naming, invitation, and authorized membership changes MUST have explicit outcomes. Ordinary local work MUST remain independent of online-only access administration.
- **FR-009**: Ordinary reads/writes MUST use available local data and locally known permissions without waiting for remote freshness. Observed identity, membership, grant, and workspace changes MUST invalidate scoped decisions.
- **FR-010**: Local availability, completeness, persistence, connectivity, and remote acceptance MUST remain separate observations. Empty local results MUST NOT authorize automatic bootstrap, replacement, repair, or access restoration for a recovered identity.
- **FR-011**: Advertised local durability MUST survive a cold offline restart with retained storage. Later rejection and unknown settlement MUST remain observable; preserve operation identity and recovery facts without blindly replaying uncertain writes.
- **FR-012**: App-required atomic local persistence and authority-validated transactions MUST be explicit, separately supported guarantees. V1 need not offer both universally; consumers requiring an unavailable guarantee MUST be rejected. Subscription visibility and offline/concurrent limitations MUST be documented independently.
- **FR-013**: Startup, scoped readiness, identity transitions, workspace transitions, and multi-step operations MUST use composed XState workflows. Model states, decisions, ownership, cancellation, partial outcomes, failure, retry, and cleanup before effects; promise actors perform leaf operations and MUST NOT hide orchestration in helpers or transaction callbacks.
- **FR-014**: Integration components MUST own SDK subscriptions, dependency binding, and actor attachment/lifecycle. Pure presentation MUST receive typed data and callbacks and MUST NOT call SDKs or actors. Simple presentation state may remain local.
- **FR-015**: Svelte 5 compositions MUST reuse DUI presentation and support consumer localization through the project's Paraglide direction, semantic controls, keyboard access, meaningful focus/dismissal, and nonduplicated status announcements. Consumers retain routes/layouts; no decorative visual redesign is approved.
- **FR-016**: A minimal consumer with an app-owned record type MUST demonstrate the shared layers, identity/recovery, workspace access, reactive data, and offline behavior without Finance domain dependencies. Full Finance migration and a second product app are not v1 prerequisites; the focused adoption validation in FR-021 is required before interface stabilization.
- **FR-017**: Preparation MUST NOT block already usable local work. The foundation MUST expose partial availability and configurable consumer acquisition needs without promising all records are downloaded. Consumer hosting owns service-worker assets/update consent; generic binary storage and a background acquisition engine are deferred.
- **FR-018**: Before implementation, the revised plan MUST pin compatible SDK/UI/toolchain versions, define layer contracts and supported transaction/permission behavior, document SDK escape hatches, and identify relevant tests. Implementation tests MUST only be added/run after user review and approval of the implementation they cover.

- **FR-019**: Identity/session integration, workspace behavior, individual UI compositions, and data access MUST be independently adoptable through documented entry points and narrow typed adapters. An existing consumer MUST NOT need to replace its entire infrastructure, schemas, or permission model to adopt one capability. The revised plan MUST distinguish any genuinely required dependencies from optional compositions.
- **FR-020**: The library MUST support attaching to a host-owned Jazz session through its backend integration boundary. Ownership of shared session/client and workspace lifecycle MUST be explicit and singular. Library-owned resources MUST have scoped cleanup; detaching an interaction MUST NOT stop host-owned resources. Scope changes and identity transitions MUST coordinate invalidation/drain without competing owners. Existing unmigrated SDK integrations MAY coexist during migration; FR-002 applies to the adopted boundary and newly library-backed workflows, not as a prerequisite rewrite of untouched consumer modules.
- **FR-021**: Before public interfaces stabilize, one separately authorized, focused Finance integration MUST validate coexistence, existing-schema compatibility, session reuse, scoped cleanup, and identity-change coordination. The initial slice SHOULD be recovery presentation/workflow unless design review identifies a smaller representative boundary. Full Finance migration, financial-domain extraction, and data conversion MUST NOT be required. This specification update authorizes no Finance code changes.

### Key Entities

- **Identity/session**: Local identity binding, explicit recovery/connection, and session lifetime.
- **Workspace/membership/invitation**: Collaboration scope and storage-enforced access with native outcomes.
- **App record/reference**: Consumer-owned typed domain data and explicit record identity.
- **Observation**: Scoped result plus availability/error facts and a disposal lifetime.
- **Operation outcome**: Local acceptance/persistence and later remote settlement, including rejection or unknown outcome.
- **Backend integration**: Documented owner of SDK-specific configuration, schema/policy mappings, handles, and leaf operations.

## Success Criteria

- **SC-001**: One minimal consumer completes all agreed identity, workspace, and record scenarios without Finance models or foundation-owned routing.
- **SC-002**: A source dependency audit finds zero direct Jazz imports in ordinary consumer workflows and presentation; every remaining import has an identified backend integration owner.
- **SC-003**: All agreed locally usable read/write scenarios complete with zero required remote answers, including a silently unresponsive remote.
- **SC-004**: Every write acknowledged as locally persisted in acceptance scenarios survives closing all clients and reopening the prepared consumer offline with retained storage.
- **SC-005**: All private-workspace denial scenarios reject unrelated identities at the storage boundary; all scope-transition scenarios reject stale updates and release obsolete subscriptions.
- **SC-006**: Recovery in separate browser storage restores the intended identity; every cancellation/failure scenario avoids false success and clears transient secrets.
- **SC-007**: Every required interaction can be completed with keyboard input, consumer-supplied localization, and no duplicate operation announcements.
- **SC-008**: V1 acceptance requires only Jazz. Every unsupported guarantee, incomplete-replica scenario, and uncertain-write scenario produces an explicit outcome without silent downgrade, replacement, or duplicate replay.

- **SC-009**: One focused Finance adoption completes its agreed behavior while an unmigrated workflow continues using the same host session and existing data, with zero required schema/data migrations or unrelated route rewrites.
- **SC-010**: In all focused-adoption teardown and identity-change scenarios, shared resources have exactly one lifecycle owner, adopted subscriptions/actors are released or rebound appropriately, and closing the adopted interaction leaves the host session usable.

These are future acceptance criteria, not claims of verified foundation behavior.

## Assumptions and Deferred Scope

- The original scope revision authorized specifications only. Later explicit instructions authorized the delivered identity/session and selection slices and their Finance integrations. New capabilities still require their own authorization; package publication and merging are not implied by implementation work.
- Jazz works as the current Finance backend; that is extraction evidence, not proof that all foundation capabilities are implemented or every SDK flow is qualified.
- Future replaceability means containing coupling and documenting mappings. It does not promise zero-cost migration, identical backend features, or a stable third-party plugin contract today.
- Separate pairing protocols, additional authentication methods, DXOS qualification, independent backend packages, cross-backend conformance, and schema portability are later work.
- Clipper revival, financial workflows, bank sync, credential encryption, image editing, generic file replication, and broad background preparation remain outside this MVP.
- Offline restart requires previously available app assets and retained storage. Offline operation does not establish fresh authorization or erase data already disclosed before revocation.

## Reference Evidence and Planning Handoff

Reviewed local snapshots on 2026-10-31: Finance `8ff72f6`, DUI `9bc5405`. These are the supplied checkouts, not a claim of a fresh remote fetch.

- Finance uses `jazz-tools@2.0.0-alpha.59`, XState, Svelte 5, and Paraglide. Its vendored DUI archive is `0.0.25-details-animation`; the DUI checkout additionally exports `ButtonContent`. Matching package version numbers do not prove matching archive contents.
- Finance's `src/lib/machines/identity/{session-startup,recovery-phrase}.ts`, `components/identity/AccountRecovery.svelte`, and `components/workspaces/WorkspaceSelector.svelte` demonstrate typed workflow/view separation and explicit secret handling. Its workspace machines distinguish creation, persistence, reconciliation, integrity, and navigation; extract reusable ownership patterns rather than financial defaults.
- Finance's `.specify/memory/{xstate,jazz}.md` and spec 013 research record local/remote distinctions and SDK-specific cold-query, permission, acquisition-cost, and worker-persistence limitations. Broad preparation and worker storage sharing MUST NOT be inferred from the existence of local persistence.
- DUI's `src/lib/index.js` and implementations provide Dialog, Popover, Button, ButtonContent, StatusMessage, LoadingScreen, LoadingSpinner, Select, Textarea, Checkbox, and FieldFeedback. ButtonContent supplies icon/loading content; workflow state remains outside DUI. Existing primitives remove any need to invent replacement dialogs or status controls for this scope.
- Existing `research.md`, `ui-discovery.md`, `design-review.md`, `data-model.md`, `contracts/foundation.md`, `qualification.md`, and `quickstart.md` preserve earlier investigation/design. Their multi-backend contracts, package layouts, older SDK examples, and qualification gates are historical proposals, not the current MVP implementation authority. Reconcile useful portions in a new reviewed plan before implementation; do not execute the old plan.

- The revised technical plan must define independent adoption entry points, host-owned versus library-owned lifecycle contracts, and a focused Finance validation slice before interface stabilization. This supplements the minimal new-consumer demonstration rather than replacing it.
