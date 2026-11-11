# Feature Specification: Multiple workspaces

**Feature Branch**: `feature/multiple-workspaces`
**Created**: 2026-10-20
**Status**: Create-and-switch functionality complete and reviewed, including query-based selection and the follow-up code review fixes. Sharing and ownership administration remain future work.
**Input**: Start a spec for working with multiple workspaces, review existing specs and Jazz code, and identify the decisions needed.

## Review summary

The first release creates and switches between equivalent owned workspaces. One workspace is created automatically for a new user; it has no permanent special status. Names may repeat. Starter categories come from one maintainable definition; no accounts or transactions are seeded. Switching immediately discards unfinished transaction input without confirmation or draft retention.

Design this foundation for future shared accounts: scoped capabilities, additive role bundles and individual grants, narrow related-data visibility, full account history, and explicit invitation acceptance. Sharing includes transaction entry/editing, including other authors’ entries; deletion, catalog management, invitations, sharing delegation, and revocation are separately controlled. Do not offer a read-only sharing tier.

Future workspaces support multiple owners, accepted ownership offers, last-owner protection, unilateral owner removal with confirmation, voluntary departure, and reversible archive. Pending invitations lose validity when the inviter loses required authority; accepted access survives the inviter’s departure. Sharing and permission changes require server-confirmed online administration. These workflows are outside the first release; their constraints inform its design.

### Current scope and future decisions

- **D3 approved**: The URL identifies the active workspace independently per tab. Reloads, bookmarks, direct links, and browser history retain that workspace context. Canonical URLs use native page paths with `?workspace=<uuid>` (for example `/expenses?workspace=<uuid>`). `/settings/workspace` is the chooser/create page; unscoped entry automatically selects an accessible workspace, preferring the profile’s initial workspace and otherwise using a stable workspace-ID order. The chooser remains available for switching and creation.
- **Before sharing implementation**: Exact capability definitions and initial role bundles; grant/delegation authority; invitation delivery, verification and lifecycle; entry category/tag availability and management; archive/removal/rejoining details.
- **Before future sharing/ownership work**: Verify Jazz-enforced effective-capability and ownership invariants and align the constitution, MVP requirements, and schema with the approved future model. Existing role policies are not an implemented capability-administration system.

The requirements and approved future decisions below remain the product reference. [plan.md](plan.md) describes the completed architecture, [research.md](research.md) preserves useful SDK findings, and [quickstart.md](quickstart.md) describes validation. Deferred orchestration work remains in [008 tasks](../008-actor-orchestration/tasks.md).

## User Scenarios & Testing

### User Story 1 - Switch between separate finances (Priority: P1)

A user with access to multiple workspaces can select the intended workspace and work with its finances without changing login identity or mixing records.

**Why this priority**: Selection and isolation are prerequisites for every additional workspace.
**Independent Test**: Use two accessible workspaces with distinct accounts and transactions; switch between them while viewing, editing, and offline.

**Acceptance Scenarios**:

1. **Given** two accessible workspaces, **When** the user selects either, **Then** its name, accounts, categories, tags, transactions, and available actions correspond to that workspace alone.
2. **Given** unfinished transaction input or a bank operation in workspace A, **When** the user switches to B, **Then** unfinished transaction input is discarded immediately without confirmation and is never submitted to B, no further provider requests start for A, and transient unlocked credentials are released. Already-issued writes retain their original target and are not described as undone.
3. **Given** locally available workspace data, **When** the device is offline, **Then** selection, reads, and authorized local finance entry do not require remote confirmation.
4. **Given** loading, failed queries, or observed access loss, **When** selection is evaluated, **Then** the app distinguishes those outcomes from a confirmed empty workspace and prevents actions based on superseded observed access. Locally known membership and grants may permit ordinary work without remote freshness; see [013 local-first requirements](../013-local-first-startup/spec.md), FR-001–006.

### User Story 2 - Create a separate workspace (Priority: P2)

A user creates another named workspace for finances they want to keep separate from their existing workspace.

**Why this priority**: Multiple-workspace selection already exists; creation makes it usable without fixtures or developer intervention.
**Independent Test**: Create a workspace, add an account and transaction, and verify the original workspace is unchanged.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they create a valid workspace, **Then** it has its own identity, an owner membership, and required starter categories; the login profile is reused.
2. **Given** creation is interrupted or retried, **When** the user resumes the same attempt, **Then** it does not create duplicate workspaces or duplicate starter records.
3. **Given** creation fails or is rejected, **When** feedback appears, **Then** it distinguishes locally saved work from confirmed remote acceptance and preserves access to existing workspaces.

### User Story 3 - Work with other people (Future required functionality; outside first release)

An authorized manager grants another login identity access to a workspace with an explicit role and account scope.

**Why this priority**: Sharing is distinct from owning several workspaces and adds membership, identity-discovery, and ownership policy decisions.
**Independent Test**: Admit another identity, exercise approved sharing capabilities and selected-account permissions, then remove access and observe the result on another device.

**Acceptance Scenarios**:

1. **Given** admission is supported, **When** a recipient accepts access, **Then** the workspace appears under the recipient's existing login identity without importing its finances into another workspace.
2. **Given** a collaborator with selected accounts, **When** they open the workspace, **Then** their actions and readable finance records obey their role, account grants, and the selected-account privacy boundary in FR-015–018; selected mode with no grants provides no account access.
3. **Given** membership removal or a role reduction is observed, **When** old actions are attempted, **Then** newly unauthorized work is blocked and issued writes receive their actual outcomes. The app does not promise erasure of previously downloaded data from offline devices.
4. **Given** another user's bank connection, **When** workspace access is granted, **Then** no usable provider credential or decryption key is shared.

5. **Given** Checking is shared but Savings is not, **When** the recipient queries finance data, **Then** they can read Checking and its transactions, used categories/tags, and relevant attribution, but cannot read Savings, its transactions, unused catalog entries, or workspace-wide totals.
6. **Given** a summary includes shared and unshared accounts, **When** the recipient views totals, **Then** totals use only accounts they can access and disclose no hidden-account values or counts.

### Edge Cases

- Identical workspace names must not collapse separate identities; the selector needs enough context to distinguish them.
- A selected workspace disappears, membership is missing, or loading fails. A transient empty result must not create a replacement workspace or silently redirect an edit.
- Two devices create or initialize concurrently; retries and seeded categories must not duplicate an attempt.
- Several owned workspaces exist; bootstrap and account merge must not choose one arbitrarily or create another starter workspace on each launch.
- A direct transaction link belongs to another workspace or to one the user cannot access.
- Two tabs select different workspaces; selection and in-flight operations must not unexpectedly retarget one another.
- The last owner attempts to leave, is removed, or is demoted; conflicting ownership changes occur on separate devices.
- Access is removed while a device is offline. Cached visibility is not proof of current server authorization.
- A member profile link is missing; missing attribution must not grant access or break finance views.

## Requirements

### Functional Requirements

FR-015–025 and FR-029–037 describe approved future sharing, capability, ownership and lifecycle requirements. They inform the foundation but are not implemented by the completed create-and-switch release.

- **FR-001**: A workspace MUST remain the organization tenancy boundary. Selecting a workspace MUST NOT switch login identity, merge data, or move records.
- **FR-002**: Users MUST be able to select among their accessible workspaces using the existing Current workspace control. The selected workspace MUST be identifiable throughout scoped finance workflows.
- **FR-003**: Workspace-bound reads, writes, account filters, account ordering, pagination, forms, bank metadata, and pending synchronization presentation MUST remain associated with the correct identity and workspace. Selection MUST reset account filters and pagination; account ordering MUST retain its existing per-identity/per-workspace behavior.
- **FR-004**: Scope changes MUST prevent new work from stale workflows and clear transient credentials. Late results MUST NOT alter the replacement workspace. Issued writes MUST retain their original target and settle with truthful feedback.
- **FR-005**: Existing locally available finance workflows MUST remain usable offline. Locally saved changes MUST NOT be presented as server-approved membership or ownership changes.
- **FR-006**: Loading, unavailable data, access denial, query failure, and an accessible workspace with no accounts MUST have distinct outcomes. Missing query results alone MUST NOT establish revocation or authorize replacement creation.
- **FR-007**: Membership and account-scope authorization MUST apply independently of which workspace is selected, with sharing capabilities and privacy governed by FR-015–019. Existing viewer/read-only requirements require alignment with D13 before sharing implementation. UI visibility alone MUST NOT enforce authorization.
- **FR-008**: Workspace access MUST NOT grant another user's bank credential access. Selecting or creating a workspace MUST NOT trigger provider transaction fetching.
- **FR-009**: Profiles MUST remain login-identity data reused across workspaces. If sharing ships, admitted memberships MUST link the corresponding profile for authorized attribution.
- **FR-010**: Creation MUST validate a trimmed nonblank name and create a complete owner-accessible workspace with starter categories, without copying existing finances or replacing the login profile. Retrying one creation attempt MUST preserve its identity.
- **FR-011**: Account connection/merge MUST retain the explicit selection requirement when multiple eligible workspaces exist; ordinary workspace selection MUST never perform an import.
- **FR-012**: The first release MUST support creating and switching owned workspaces. Sharing is required for full functionality and MUST inform the initial design: tenancy, membership-based authorization, role/account scope, and shared identity profiles MUST support adding other members without replacing the workspace or migrating its finances into a different tenancy model. Admission and membership-management UI are deferred.
- **FR-013**: Workspaces MUST be equivalent in product behavior. The app MUST automatically create one initial workspace for a new user, but that workspace MUST NOT have permanent special status. Users MAY own multiple workspaces, and every workspace MUST support future sharing under the same membership and authorization model. Personal/business labels MUST NOT determine access or sharing eligibility. Startup and account merge MUST NOT rely on an implicit unique personal home.
- **FR-014**: The active workspace MUST be identified by the URL’s `workspace` query parameter using its stable UUID. Reloading, bookmarking, opening a direct link, and browser back/forward navigation MUST retain the intended workspace context. Separate tabs MUST be able to use different workspaces without changing one another. Route identity MUST NOT grant access or silently retarget unavailable-workspace links to a different ledger. Workspace selection MUST navigate to the corresponding native page with the workspace query parameter and run existing scope-change cleanup. The drawer and workspace-settings selectors MUST share the same switching command and preserve the current page, including workspace settings and identity pages; transaction detail/new-entry pages return to their corresponding list to discard unfinished input. After sign-in, workspace-less overview/list/settings entry MUST automatically select an accessible workspace. Prefer the profile’s initial workspace when it is in the accessible catalog; otherwise choose the first accessible workspace by stable workspace-ID order. An unscoped `/settings/workspace` visit MUST also acquire this scope once the catalog is available. An empty catalog MUST retain creation/restoration controls and resolve automatically when an accessible workspace arrives. An explicitly scoped unavailable link MUST NOT silently change ledgers. Legacy transaction details resolve their readable owning workspace. No synchronized global selection is used.

- **FR-015**: Selected-account access MUST expose only granted financial accounts, their transactions, and supporting information needed to understand those transactions: categories/tags actually used on readable transactions, relevant author attribution, and related attachments when attachment support ships. Workspace membership alone MUST NOT expose unrelated category/tag catalogs, unrelated profiles, the full membership list, bank connection metadata, or other workspace-level business records. Provide only minimal workspace identity needed to identify the shared context.
- **FR-016**: Summaries, balances, counts, and totals for a selected-account recipient MUST be derived only from their accessible accounts and readable records. Hidden-account information MUST NOT be disclosed through aggregates, related records, search, or direct record queries. This boundary MUST be enforced by data authorization, not only by hiding UI.
- **FR-017**: Selected-account recipients who can enter transactions MUST have an explicitly authorized set of categories/tags available for entry. Sharing an account MUST NOT automatically expose the entire workspace catalog. Access levels MUST distinguish using that set for transaction entry from creating categories/tags or managing the available set. Account write access alone MUST NOT grant catalog-management powers. The exact role/capability assignments remain a separate decision before implementing shared transaction entry.
- **FR-018**: User-facing language MUST distinguish **Share account** (selected-account access) from **Share workspace** (broader workspace access). Internally, selected-account access remains workspace membership plus explicit account grants; it MUST NOT copy the account into a separate tenant or grant ownership/admin powers. Sharing remains deferred from the first release, but its initial tenancy/authorization design MUST accommodate this privacy boundary.

- **FR-019**: Account sharing MUST grant the ability to view and add/edit transactions in the granted account; the sharing workflow MUST NOT offer a read-only access level. Category/tag creation and management remain separately controlled capabilities. This requirement does not by itself grant account-settings changes, transaction deletion, broader workspace administration, or catalog-management rights.

- **FR-020**: Authorization decisions MUST evaluate capabilities within an explicit scope rather than hardcode role names. Roles MUST represent named combinations of capabilities; the model MUST support additional role combinations and individual capability grants to users without rewriting feature authorization around each role. Individual grants MUST require active membership and MUST NOT expand access beyond their explicitly granted workspace/account scope.
- **FR-021**: Role-derived and individually granted capabilities MUST use one effective-authorization model for both application decisions and enforced data permissions. Capability checks MUST preserve the selected-account privacy boundary. The first release need not provide role/capability administration UI, but its design MUST accommodate this model. Capabilities combine additively under FR-037. Exact capability definitions, role bundles, grant-management authority, and detailed revocation workflows remain to be specified.

- **FR-022**: Shared access MUST use an invitation requiring explicit recipient acceptance under their login identity. The inviter specifies the financial-account scope and capabilities offered; an unaccepted invitation MUST NOT grant finance-data access. Recipient verification, delivery, expiry, cancellation, and redemption rules remain to be decided. Invitation UI remains outside the first release.

- **FR-023**: A workspace MUST support multiple owners. An ownership change MUST NOT leave an existing workspace without an owner, including when owners concurrently leave, remove one another, or change ownership assignments. The last owner MUST NOT leave, be removed, or be demoted without another owner remaining. Ownership MUST govern ultimate workspace control and authority to grant powerful capabilities; an owner MAY remove another owner without the affected owner’s approval, provided at least one owner remains. The action MUST require clear confirmation explaining the loss of ownership/access. An existing owner MUST offer ownership, and the recipient MUST explicitly accept under their login identity before owner capabilities take effect. An unaccepted ownership offer MUST NOT count toward last-owner protection. Exact protected capabilities remain to be defined consistently with the capability model.

- **FR-024**: Collaborators MUST be able to leave a workspace voluntarily without another person’s approval. Leaving MUST end their workspace membership and effective access, including individual capability/account grants, without deleting existing finance records or attribution. The last owner MUST first establish another accepted owner before leaving. Access loss and offline-device limitations follow the existing revocation requirements; departure MUST NOT promise erasure of previously downloaded data.

- **FR-025**: An owner MUST eventually be able to archive a workspace instead of permanently deleting it. Archiving MUST retain existing finance records for authorized viewing, prevent new financial activity, and allow an owner to restore the workspace. Archiving MUST NOT bypass membership, capability, or selected-account privacy boundaries. Archive/restore implementation is deferred until after the initial create-and-switch release. Treatment of in-flight writes, queued offline changes, invitations, and non-financial administration while archived requires a lifecycle design before implementation.

- **FR-026**: Switching workspaces MUST immediately discard unfinished transaction input without a confirmation prompt. The app MUST NOT retain or restore transaction drafts per workspace, block switching for unsaved transaction input, or persist that input as a draft transaction. Already-submitted writes retain their original scope and settlement behavior under FR-004. Draft transactions are outside this feature and require a future product decision.

- **FR-027**: Every new workspace MUST receive the centrally maintained starter-category set and no financial accounts or transactions. Starter-category definitions MUST have one authoritative maintenance location shared by initial bootstrap and explicit workspace creation, with labels localized through the existing localization system. The current optional starter labels are provisional, not approved final wording. Changing starter defaults MUST affect future workspace creation without renaming, deleting, or reseeding optional categories in existing workspaces. Required system categories MUST be created during workspace creation, preserving idempotent creation/retry behavior independently of optional starter defaults. Workspace integrity MUST NOT check or automatically repair categories in existing workspaces.

- **FR-028**: Workspace names MUST NOT be unique. Creating, renaming, or accepting access to a workspace MUST allow a name already present in the user’s workspace list. Separate workspace identities MUST remain distinct regardless of matching names. Selection controls MUST provide enough additional context to distinguish same-named workspaces without exposing information outside the user’s access scope; duplicate names are disambiguated with workspace IDs.

- **FR-029**: Sharing a financial account MUST include its full existing transaction history and future transactions while the recipient’s access remains active. The sharing workflow MUST NOT impose a sharing-start-date cutoff. Supporting categories/tags, attribution, and attachments when supported remain limited to readable transactions under FR-015. Full history for a granted account MUST NOT expose any ungranted account.

- **FR-030**: Transaction-editing capability MUST permit editing readable transactions within the granted account regardless of who originally entered them, while preserving original author attribution. Editing MUST remain subject to current membership, account scope, validation, and workspace lifecycle restrictions. This capability MUST NOT implicitly include transaction deletion or access to another account.

- **FR-031**: Deleting transactions MUST require a distinct, explicitly scoped capability. Adding/editing capability alone MUST NOT permit deletion. The deletion capability MAY be included in a role bundle or individually granted under the effective-capability model; it MUST remain subject to active membership, granted account scope, and workspace lifecycle restrictions.

- **FR-032**: Inviting others to a financial account MUST require a separate scoped sharing capability. Account collaboration, transaction editing/deletion, or catalog management alone MUST NOT authorize onward sharing. An authorized inviter MUST NOT offer account access or capabilities beyond their own effective authorized scope. Invitations MUST still require recipient acceptance under FR-022. Granting the recipient permission to invite others MUST require separate, explicitly scoped delegation authority; possessing a sharing capability MUST NOT imply that authority or ownership. Delegation MUST remain within the grantor’s authorized account scope. Who can grant delegation authority, whether that authority can itself be delegated, and pending-invitation behavior after inviter access changes remain to be defined.

- **FR-033**: An unaccepted invitation MUST be invalidated if its inviter loses membership, account scope, invitation authority, or any grant/delegation authority required for the offered access. Acceptance MUST revalidate current authority and MUST NOT grant access from an invalidated invitation. The recipient MUST obtain a new invitation from a currently authorized person; later restoration of the original inviter’s access MUST NOT revive the invalidated invitation. This requirement does not determine revocation of already accepted grants.

- **FR-034**: Once an invitation is validly accepted, the recipient’s membership and scoped grants MUST remain independent of the inviter’s continued membership or authority. The inviter leaving or losing access MUST NOT automatically revoke the recipient’s accepted access. Recipient access remains subject to explicit authorized revocation, their own departure, and applicable workspace lifecycle restrictions. Invitation provenance MUST NOT become a continuing authorization dependency.

- **FR-035**: Removing another person’s access to a financial account MUST require a separate, explicitly scoped revocation capability. Invitation or sharing-delegation capability alone MUST NOT authorize removal. Account-scoped revocation MUST NOT remove workspace ownership, terminate access to unrelated accounts, or grant broader membership-administration powers. Owner removal remains governed by FR-023 and the approved ownership rules. Exact revocation authority boundaries and initial capability bundles remain to be defined.

- **FR-036**: Sharing and permission changes MUST require an internet connection and server acceptance before the app reports completion or grants new effective access. This includes invitations/acceptance, ownership offers/acceptance/removal, membership departure/removal, and role or individual-capability changes. The initial sharing design MUST NOT offer offline queuing of these requests. Pending or failed requests MUST NOT be described as completed; loss of connectivity during a request requires truthful pending/unknown outcome handling and reconciliation rather than blind replay. Ordinary authorized finance entry MUST remain local-first. Initial owner membership created atomically with a new owned workspace remains part of workspace creation, not the deferred sharing workflow.

- **FR-037**: Effective capabilities MUST be additive: combine capabilities supplied by applicable role bundles and individual grants within their authorized scopes. Explicit per-user denial overrides MUST NOT be supported initially. Removing an individual grant MUST NOT remove the same capability when another applicable role or grant still supplies it. To remove a role-provided capability, change the role assignment or bundle through authorized administration. Active membership, account-access boundaries, ownership protections, and workspace lifecycle restrictions remain mandatory constraints, not denial overrides.

### Key Entities

- **Workspace / Organization**: Independent finance boundary, with identity, name, kind, default currency, and ownership information.
- **Organization membership**: Association of a login identity and workspace, with role, account access mode, and profile reference.
- **Account grant**: Explicit account read/write access for a workspace member; never a substitute for membership.
- **Capability**: A specific authorized action with a workspace or financial-account scope.
- **Role**: A named bundle of capabilities; role names do not replace capability checks.
- **Individual capability grant**: An explicitly scoped capability assigned to a user independently of their role bundle, requiring active workspace membership.
- **Workspace selection**: The current navigation scope, separate from login identity, membership, and persisted finance data.
- **Invitation** (future sharing): An offer of scoped capabilities requiring explicit recipient acceptance before access is granted; recipient verification and lifecycle details remain undecided.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In all two-workspace acceptance scenarios, selection produces zero records or write targets from the other workspace.
- **SC-002**: Offline switching and finance entry complete before reconnection in every scenario where the necessary data is already locally available.
- **SC-003**: Scope changes during editing, bank operations, and pending writes produce zero retargeted submissions, additional provider requests from cancelled work, or false rollback claims.
- **SC-004**: Every completed creation has exactly one owner membership and one set of starter categories; repeating an interrupted attempt creates no duplicate workspace.
- **SC-005**: If sharing ships, every role/account-scope combination follows the approved access matrix, including zero account access for selected mode without grants.
- **SC-006**: A user with two accessible workspaces can select either with one selection in the existing selector, without logging out or reconnecting an account.

- **SC-007**: In selected-account sharing scenarios, unrelated account records, unused categories/tags, membership lists, bank connection metadata, and hidden-account aggregate values have zero unauthorized disclosures, including through direct data queries.

## Assumptions

- Explicitly approved decisions are recorded below. Remaining defaults and open design details are proposals, not approvals inferred from existing schema capabilities.
- Retain USD entry and current currency rules. Workspace-specific currencies and conversion are excluded unless separately requested.
- Aggregate reporting across workspaces, moving/copying accounts or transactions, workspace deletion, and encrypted bank credential sharing are outside the completed create-and-switch release.
- Keep existing UI presentation; no new visual direction is proposed.
- The create-and-switch release is implemented and has reviewed test coverage. Future features still require their own design, implementation review, and verification.
- [Research](research.md) records SDK evidence and its limits. This specification retains the approved product decisions; remaining sharing details must be resolved before implementing sharing.

## Decisions and compatibility

- **D2 approved**: Workspaces are equivalent, including the automatically created starting workspace. Current storage retains personal/business values for compatibility; they do not determine tenancy, selection or sharing rules.
- This decision supersedes the unique-personal-home assumption for this feature. Bootstrap now follows equivalent-workspace initialization. Future account-merge work must align the personal-only scope in `003-account-data-merge` with explicit eligibility/selection. It does not authorize importing shared or other members’ records; merge eligibility remains a separate policy decision.

- **D11 approved — Selected-account privacy**: Share the account and transaction-related supporting information, plus minimal workspace identity. Exclude unrelated finance/catalog data, full membership lists, bank connection details, and aggregates over hidden accounts. An explicitly authorized entry catalog remains to be designed for writers. This narrows existing workspace-wide category/tag, profile, and other member-readable policies; it is a target requirement, not a claim that current permissions already enforce it. Before implementation, align affected requirements/policies in `001-finance-mvp` and relevant authorization plans. The constitution's existing membership/role/account-grant rules remain in force.

- **D12 approved in principle — Catalog capabilities**: Different access levels control whether a recipient can enter transactions using the authorized account catalog, create categories/tags, or manage that available catalog. D13 removes read-only sharing from this product model. These capabilities need not each become a new named role. Exact mappings to existing roles/account grants and whether creation and assignment are separate permissions remain unresolved. No blanket creation/management access is inferred from account write access.

- **D13 approved — No read-only sharing**: Viewing and transaction entry/editing form the baseline account-sharing access level. Do not offer a view-only tier. Existing viewer roles and read-only account grants appear in the constitution and MVP requirements; align those artifacts before implementation rather than treating this future product decision as an implementation amendment. Handling legacy viewer/read grants remains a planning decision. Read-only states caused by unavailable data or denied access remain distinct from a shareable permission tier.

- **D14 approved — Capabilities and role bundles**: Define authorization around scoped capabilities. Map capabilities to roles as named combinations later; allow new combinations and individual user grants. Existing owner/admin/member/viewer checks are current implementation facts, not the target extensibility model. Before implementation, align constitution/MVP role-based requirements and plan how the installed Jazz policy language enforces effective capabilities. Capability administration UI is not added to the first-release scope by this decision.

- **D3 approved — URL-based workspace persistence**: Native SvelteKit routes carry `?workspace=<uuid>`. Each tab follows its own URL. Stable IDs survive renaming; knowing an ID does not grant access. Unscoped finance entry selects an accessible workspace automatically, preferring the profile’s initial workspace with a stable workspace-ID fallback; unscoped transaction details resolve their readable owning workspace. No remembered device default or path-prefix rewriting is used.
- **D4 approved in part — Invitation with acceptance**: Grant shared-account access through an invitation accepted under the recipient’s login identity, rather than immediate direct addition. No email requirement, bearer-link scheme, existing-account-only restriction, or recipient-verification mechanism is implied.

- **D5 approved in part — Multiple owners**: Several people may share ultimate workspace control. Prevent removal, departure, or demotion of the last owner, including competing changes. Align the existing single ownerId field, owner-role policies, bootstrap behavior, and capability-based authorization before implementation. D15 permits unilateral removal with confirmation and last-owner protection; D16 requires acceptance of ownership offers.

- **D15 approved — Owner removal authority**: Any owner may remove another owner without that person’s approval, subject to last-owner protection and clear confirmation of the consequence. No unanimous-consent or affected-owner-approval requirement applies. D31 requires an explicit choice of retained collaborator access or complete workspace-access removal; no replacement capabilities are silently granted.

- **D16 approved — Ownership acceptance**: An existing owner offers ownership; the recipient must explicitly accept before receiving owner capabilities. This applies to promoting existing collaborators as well as inviting future owners. Pending offers confer no owner powers and cannot satisfy the requirement that an owner remain. Automatic ownership of the workspace’s creator during initial creation is separate from offering ownership to someone else.

- **D17 approved — Voluntary departure**: A collaborator may leave without owner approval. Leaving ends workspace access while retaining finance records. The last owner must first establish another accepted owner; pending ownership offers are insufficient. Account-only departure and any later rejoining behavior remain separate lifecycle details.

- **D18 approved — Reversible archive**: A workspace no longer needed is archived, preserving authorized access to its records while stopping new financial activity; an owner may restore it. Archive/restore is eventual functionality after the first release. Permanent deletion is not included. Read-only behavior of an archived workspace is a lifecycle restriction, not a read-only sharing tier.

- **D18a approved — Archived finance and administration**: Archived finance data is read-only: no transaction creation, editing, deletion, imports, or attachment changes. Authorized viewing, attachment downloads, and complete-workspace backups remain available under their respective permissions. Only owners may archive or restore a workspace. Archiving preserves memberships and permissions without adding or removing access; restoration resumes ordinary use under the permissions then in effect. Authorized access revocation, voluntary departure, and ownership administration remain available while archived, including last-owner protection. Archived workspaces are hidden from the default workspace chooser, with an Include archived option; authorized direct links remain usable and clearly identify the archived, read-only workspace. These are future product requirements, not claims about current Jazz enforcement.

- **D18b unresolved — Archive enforcement and pending writes**: Decide how archive/restore is enforced with Jazz, including offline devices, pending or already-issued writes, and reconciliation of activity around archive/restore. Requiring connectivity and server confirmation for archive/restore was proposed but was **not approved**; do not infer that requirement from FR-036's access-administration rules. Verify the SDK's actual authorization and synchronization behavior before choosing an enforcement design. Whether and how archiving can prevent disconnected writes or affect pending writes remains undecided; this specification makes no guarantee of immediate cross-device enforcement or rollback of issued writes.

- **D8 approved in part — Discard unfinished transaction input**: Workspace switching immediately discards unfinished transaction input, without confirmation or draft retention. There is no draft-transaction concept in this feature; revisit only if draft support is introduced later. This does not cancel or undo already-submitted writes. Direct links follow URL query scope under D3; account-filter/pagination reset and per-workspace ordering remain as specified.

- **D9 approved in part — Maintainable starter categories**: New workspaces include starter categories, with definitions easy to edit in one authoritative place. Current agent-created optional category choices/labels are provisional; inclusion does not approve their wording. No new account or transaction is seeded. Existing workspace customizations are not rewritten when defaults change. Duplicate names are allowed under D19; selectors disambiguate matching names with workspace IDs.

- **D19 approved — Duplicate workspace names**: Names are labels, not identifiers. Users may create, rename, or join same-named workspaces. Do not enforce name uniqueness; distinguish matching names in selection without conflating identities.

- **D20 approved — Full account history**: Account sharing includes all past and future transactions during active access. Date-limited sharing is not included. This expands neither the recipient’s action capabilities nor access to other accounts, and it does not override revocation/offline-cache limitations.

- **D21 approved — Collaborative transaction editing**: A collaborator with transaction-editing capability may edit entries by other people in the granted account. Original author attribution remains intact. No author-only editing restriction or separate edit-others capability is required; D22 makes deletion a separate capability.

- **D22 approved — Separate transaction deletion**: Add/edit permission does not imply delete permission. Transaction deletion is a separate scoped capability that roles may bundle or authorized managers may grant individually. Deletion retention/undo behavior and grant-management authority are not decided by this choice.

- **D23 approved — Explicit onward sharing**: Inviting others is a separate account-scoped capability, available to authorized collaborators rather than owners alone. Invitations cannot exceed the inviter’s own authorized scope/capabilities and require acceptance. D24 requires separate sharing-delegation authority; D25 invalidates affected pending invitations after authority loss, while D26 preserves already accepted access.

- **D24 approved — Separate sharing-delegation authority**: Invitation capability alone cannot grant onward-sharing capability. An authorized user needs separate scoped delegation authority to give a recipient permission to invite others. No automatic delegation of the delegation authority itself is implied.

- **D25 approved — Pending invitations follow current authority**: Loss of the authority required for an offer invalidates its unaccepted invitation. Require a new invitation rather than preserving the original offer as a snapshot of old authority. Recheck authority at acceptance; concurrent acceptance/access changes need an authoritative design. D26 separately preserves already accepted grants when the inviter loses authority.

- **D26 approved — Accepted access is independent**: Validly accepted access belongs to the workspace’s authorization model, not to a continuing chain through the inviter. It persists when the inviter leaves or loses authority, until explicitly revoked or otherwise ended under the recipient/workspace lifecycle. This differs deliberately from D25’s invalidation of unaccepted invitations.

- **D27 approved — Separate account-access revocation**: Permission to invite does not imply permission to remove someone else’s accepted account access. Revocation is its own scoped capability, independently assignable through the capability model. It does not supersede workspace-owner protections or authorize removing unrelated workspace access.

- **D10 approved — Online access administration**: Sharing and permission changes require connectivity and confirmed server acceptance; no offline request queue is offered initially. This does not alter local-first transaction entry or the first-release workspace-creation bootstrap. Network interruption after submission must not be mistaken for rejection or cancellation of an already accepted change.

- **D28 approved — Additive capabilities**: Roles and individual grants contribute capabilities additively. No explicit denial overrides initially. Removing one source does not remove capability supplied by another source; administration must report resulting effective access accurately.

- **D29 approved — Owner account access**: Workspace owners MUST retain access to every financial account in their workspace. Selected-account restrictions apply to other collaborators, not owners. Workspace lifecycle restrictions, including the approved archived-finance read-only behavior, still apply to owners; ownership does not bypass financial validation.

- **D30 approved — Explicit ownership boundary**: Granting transaction editing, sharing, access administration, or other ordinary capabilities MUST NOT confer ownership. Ownership remains a separate explicit offer-and-acceptance relationship under D16, with initial creator ownership handled by workspace creation. Before sharing implementation, reconcile the existing single `ownerId`, owner memberships, bootstrap, and enforced permission policies with accepted multiple ownership and the scoped-capability model; current storage and fixed-role checks MUST NOT be treated as already satisfying this future design.

- **D31 approved — Access after owner removal**: Removing another owner's ownership MUST explicitly specify whether the affected person retains identified collaborator access or loses workspace access entirely. Show the resulting access before confirmation. Retained collaborator capabilities MUST be explicitly selected or identified; removal MUST NOT silently grant replacement access. Existing owner-removal authority, confirmation, last-owner protection, and online access-administration requirements remain applicable. This resolves D15's previously open question about retained lower access.

- **D32 approved — Live role bundles**: Changes to a role's capability bundle MUST apply to everyone currently assigned that role. Before confirmation, show the resulting effective-access changes, including contributions from individual grants and other applicable role assignments. Individual grants remain additive under D28; removing a role-provided capability MUST NOT remove the same capability supplied independently. Role-bundle editing requires authorized online access administration under FR-036; exact bundles and bundle-management authority remain deferred.
