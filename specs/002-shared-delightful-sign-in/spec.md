# Feature Specification: Shared Delightful sign-in

**Feature Branch**: `research/atproto-jazz-auth` (follow-up to merged PR #14)

**Created**: 2026-11-03

**Status**: Draft — product decisions and deployment qualification remain open

**Input**: One Delightful identity can sign into independently deployed apps, initially Finance and Clipper, while preserving each app's existing accounts, ownership, recovery and domain policies. Explore Jazz-native application storage with AT Protocol identity and independently optional, explicit social publication. This task authorizes specification and research only.

**Subsequent direction — 2026-11-03**: The user currently operates these apps for themselves and
requests proceeding with a working, data-preserving implementation. Target Jazz's merged
backend-owned authentication with AT Protocol identity. A reproducible pinned source build is
acceptable; do not require a published Jazz release before implementation or consumer adoption.
Follow [the implementation and data-preservation sequence](delivery.md). Existing focused-review,
implementation-before-tests, commit/publish authorization and live-data protection agreements remain.
The original specification-only authorization above records history, not a prohibition overriding
this later instruction. Publication of Clipper content remains a separate consumer slice.

## Direction and MVP boundary

The 2026-11-03 continuation selects an architecture to explore: Jazz remains the application
database and synchronization authority; AT Protocol supplies a candidate external identity and
an optional public publication destination. A PDS does not replace Jazz storage or its account
registry. The selected implementation direction is app-owned backend authentication; its exact
source build, hosting operator and deployed compatibility still require qualification.

| Consumer context | Identity use                                                          | Application storage                                       | Publication boundary                                                                                      |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Finance          | May use verified AT Protocol identity for shared sign-in              | Existing Jazz financial records and policies              | No social publication requirement or repository-write grant; identity use must stand alone                |
| Clipper          | May use the same verified AT Protocol DID through its own app mapping | Jazz-native notes, highlights and other app-owned records | User explicitly publishes selected notes/highlights as public records; app owns schemas and content rules |

Unpublished Clipper work stays in its existing app storage/access scope. “Keep in app” and
“Publish publicly” are the MVP choices; unpublished does not mean encrypted from infrastructure
operators or restricted from existing authorized workspace members. Permissioned publication to
selected recipients through AT Protocol Spaces, private PDS backup, and a Jazz–PDS storage bridge
are deferred. This deferral does not remove existing Jazz private-workspace requirements.
Public publication is independently adoptable and does not gate shared sign-in delivery. These
consumer cases constrain the shared boundary; they do not authorize either app's implementation.

## Hosting and deployment direction

Retain Finance and Clipper frontends on Netlify. Run each app’s backend-owned authentication and
Jazz sync boundary as a persistent service alongside its frontend. Select the service operator
through implementation qualification; no frontend move or new repository is required.

DLF remains a reusable library: it supplies sign-in/linking lifecycle, recovery/session contracts,
and reusable server integration helpers. Each consumer repository owns its server entry point,
configuration, routes, secrets and deployment. Each app deploys its own backend integration and
maintains independent sessions and Jazz permissions. A standalone login application, central DLF
authentication service, cross-app cookie or new repository is not required for this scope.

AT Protocol OAuth callbacks can use request-based Node hosting such as Netlify Functions, provided
state/session storage is durable and refresh coordination works across instances. This does not
qualify the entire Jazz sync backend for that host. The inspected Jazz implementation keeps HTTP
stream sessions in process memory and explicitly requires one backend instance or sticky routing;
ordinary stateless function routing is not assumed to satisfy that requirement. Prefer a persistent
backend for the combined boundary rather than splitting OAuth into another deployment without need.
See [hosting source evidence and limits](hosting.md).

The application backend and Jazz Core storage are separate deployment roles. A remote Core may
remain the storage authority if compatibility is demonstrated. Introducing the application backend
MUST NOT implicitly move, reset or replace existing storage; preservation and any migration follow
[the backup-first delivery sequence](delivery.md). No particular persistent service operator or
compatibility with the currently hosted Core is claimed yet.

## Required local-first behavior

The backend establishes identity and supports authorized synchronization; it does not make every
supported application read or edit an online request. After successful setup, a retained eligible
local account MUST reopen with locally available data, accept supported offline edits, and preserve
those edits across browser closure and restart. Reconnection synchronizes under existing domain
policies, distinguishing local durability from remote acceptance and rejection.

Initial external sign-in on a new device, new account linking and remote identity recovery require
connectivity. Expired backend/provider sessions or a provider, backend or Core outage MUST NOT by
themselves discard local data, create an empty replacement account, or prevent already-authorized
supported local work. Local continuation does not assert fresh remote authentication or override a
known account revocation, explicit logout or domain policy. Reauthentication can be required before
remote operations resume; retained local recovery authority remains subject to the reviewed link policy.

Local first is not a promise that every record or attachment has been downloaded. Consumers MUST
distinguish locally available data, unavailable content, loading/failure, and true empty results.
Public PDS publication is a separate explicit online operation; offline intent, local source saving
and confirmed public acceptance remain distinct. Finance has no publication dependency.

These are required outcomes, not claims already proven by source inspection. Qualify offline cold
restart after linking, durable offline edits, expired sessions, separate service outages, reconnect,
rejection/conflicts and recovery on the exact adopted build before calling the integration complete.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Preserve an existing local-first account (Priority: P1)

A person using Finance or Clipper locally explicitly connects shared sign-in to their current account, without losing their work or changing ownership.

**Why this priority**: Introducing sign-in must not strand existing users or create an apparently empty replacement account.

**Independent Test**: Start with a local-first account containing private records, link an external identity, restart and sign in again. The same app account and records remain accessible under unchanged permissions.

**Acceptance Scenarios**:

1. **Given** a current local-first account and an unassigned external identity in this app, **When** the user confirms linking after seeing the account and authority disclosure, **Then** shared sign-in resolves to that existing account; ownership and recovery remain intact.
2. **Given** external identity E already maps to account B in this app and the current local account is A, **When** linking is requested, **Then** the app reports a conflict, preserves both accounts and their data, and offers cancellation or an explicit, separately confirmed sign-in to B after transition safety checks. No merge or reassignment is offered in this scope.
3. **Given** a linking response is lost after submission, **When** the user returns, **Then** the outcome is unknown until reconciled against authoritative account mapping; no automatic account creation, replacement or repeated mutation is inferred from a timeout or empty local data.

### User Story 2 - Sign in across independent apps (Priority: P1)

A new user signs into one app and later uses the same Delightful identity in another app on a different origin. Each app retains its own account mapping and data policies.

**Why this priority**: This is the shared identity benefit, without coupling domain data or browser storage.

**Independent Test**: Use two separately deployed consumers with distinct Jazz app IDs and origins, initially empty browser storage, and the same external identity. Verify separate account mappings and independent permissions.

**Acceptance Scenarios**:

1. **Given** no retained app account and no existing mapping, **When** first sign-in succeeds, **Then** an account is established in this app only, with recovery and provider dependency accurately explained.
2. **Given** an established Delightful provider session from Finance, **When** the user chooses sign-in in Clipper, **Then** the provider may reuse that session according to its policy; Clipper independently resolves or establishes its mapping. Finance's storage and credentials are not inputs to Clipper.
3. **Given** a returning identity already mapped in Clipper, **When** sign-in completes on a fresh browser, **Then** that mapping is used rather than creating a duplicate; data discovery and availability are reported separately from authentication.
4. **Given** a retained local account, **When** shared sign-in is chosen, **Then** the user must explicitly choose preserving it through linking or accessing another account. Automatic provider admission must not bypass that choice.

### User Story 3 - Leave or change accounts safely (Priority: P1)

A user signs out or changes provider accounts without old work, credentials or delayed callbacks entering the next account's session.

**Why this priority**: Shared provider state makes accidental identity replacement more likely.

**Independent Test**: Exercise sign-out and account changes while writes, sign-in and linking are pending, including A → B → A and late provider callbacks.

**Acceptance Scenarios**:

1. **Given** pending work, **When** sign-out or account replacement begins, **Then** the existing owner coordinates settlement and resource release before admitting the next account. An unresolved outcome remains visible and correlated to its original account.
2. **Given** a successful local logout and failed provider logout, **When** the result is shown, **Then** the user sees partial completion and provider-session status; stale provider notifications cannot silently sign them back in.
3. **Given** an old identity generation, **When** its delayed operation returns after an account change, **Then** it cannot grant access or update the current account's state.

### User Story 4 - Recover and continue through interruptions (Priority: P1)

A user can distinguish existing app recovery from provider recovery and retain supported local use during outages.

**Why this priority**: Shared sign-in must preserve existing local-first guarantees without promising unavailable remote authentication.

**Independent Test**: Restore an existing local-first identity using its established recovery flow in the same app/environment; separately exercise provider recovery and outages.

**Acceptance Scenarios**:

1. **Given** an existing local-first recovery phrase, **When** recovery is explicitly completed in its original app/environment, **Then** the intended account is restored under existing ownership and cleanup rules. No phrase is sent to another app or the provider.
2. **Given** an external-only account, **When** recovery is requested, **Then** the supported provider recovery path and its limitations are disclosed; no local-first recovery phrase is fabricated or promised.
3. **Given** a qualified retained local session and a provider or registry outage, **When** the app opens offline, **Then** supported local work remains available; fresh sign-in, linking and remote authority claims remain unavailable or pending rather than being reported successful.
4. **Given** canceled sign-in, **When** provider work later completes, **Then** it cannot silently select another account. Already-issued registry work remains owned until its result can be reconciled.
5. **Given** an existing linked account and locally available records, **When** backend/provider sessions expire and all remote services are unavailable, **Then** offline cold restart preserves the selected account, supported reads and edits; those edits survive another restart without fresh sign-in.
6. **Given** durable offline edits, **When** connectivity returns and reauthentication is required, **Then** the app retains the edits while sign-in proceeds, synchronizes under the original account, and reports acceptance, rejection or conflicts separately without silent loss.
7. **Given** a referenced attachment not retained locally, **When** it is opened offline, **Then** the app reports unavailable content rather than an empty attachment or complete offline availability.

### User Story 5 - Use identity without social publication (Priority: P1)

A Finance user signs in with AT Protocol identity without exposing financial records or granting
the application authority to publish. A Clipper user can also sign in and keep all work unpublished.

**Why this priority**: Authentication must be useful independently of social participation.

**Independent Test**: Sign in to separate Finance and Clipper consumers without repository-write
permission, then create private sentinel records and restart. Neither consumer publishes them.

**Acceptance Scenarios**:

1. **Given** a qualified AT Protocol sign-in path, **When** Finance authenticates a user, **Then**
   it resolves its own Jazz account without requesting repository-write permission or writing
   financial data to a PDS, public feed or social profile.
2. **Given** a Clipper user who declines publication authorization, **When** they sign in and save
   a note or highlight, **Then** supported Jazz use continues and nothing is published.
3. **Given** the same verified DID with a changed handle or migrated PDS, **When** sign-in is
   repeated through the qualified integration, **Then** identity continuity is preserved; neither
   handle text nor hosting location creates a new app account. An unverified DID assertion fails.

### User Story 6 - Publish selected Clipper work deliberately (Priority: P2)

A Clipper user reviews a selected note or highlight, chooses public publication, and sees whether
the public write was accepted independently of whether the source was saved in Jazz.

**Why this priority**: Public sharing must not turn sign-in or ordinary editing into disclosure.

**Independent Test**: Keep two items unpublished, publish only one selected revision, then edit its
source and interrupt a later public write. Verify exact disclosed content and distinct outcomes.

**Acceptance Scenarios**:

1. **Given** an unpublished item, **When** the user confirms publication, **Then** they first see
   the exact public content, attribution, destination DID and disclosure consequences. Only that
   confirmed content is eligible for the public write under app-owned authorization rules.
2. **Given** a published revision, **When** the Jazz source changes, **Then** the public revision
   remains unchanged until another explicit publication action. A stale preview or changed
   destination requires a new confirmation; saving or syncing never publishes automatically.
3. **Given** Jazz persistence succeeds but PDS publication fails or its response is lost, **When**
   the result is shown or the app restarts, **Then** source persistence and public acceptance have
   separate statuses. Retained operation identity supports reconciliation without duplicate posts.
4. **Given** a published item, **When** the user requests removal from the publishing repository,
   **Then** the app reports that operation's confirmed, failed or unknown result and explains that
   third-party copies may remain. Source deletion, logout and permission revocation alone do not
   assert public removal, and removal does not delete the Jazz source.

### Edge Cases

- Two tabs/devices race to link the same external identity to different accounts; only an authoritative accepted mapping wins, with an explicit conflict for the other account.
- Linking the already-linked identity to the same account is distinguished from a conflicting account, subject to actual registry behavior qualification.
- The provider changes account while a token is being obtained or refreshed; reject stale credentials and invalidate prior scoped decisions.
- A link is accepted remotely but client opening fails; report linked-but-session-unavailable rather than assuming rollback.
- Provider session expiry, revoked credentials, account deletion, signing-key rotation, denied consent and blocked popups/redirects have distinguishable outcomes and supported retry paths.
- Storage eviction or an empty replica is not proof of an unmapped identity. Losing a provider account is not proof that app data is deleted.
- Offline logout cannot promise global remote revocation or erase another device's retained data.
- Preview origins, unexpected redirect destinations, wrong issuer/audience and malformed identity claims must not receive production authority.
- A handle changes owner or an account migrates PDS; identity continuity follows the verified DID, not a cached handle or server URL.
- Publication is declined, authorization expires, or PDS access fails while Jazz remains usable.
- Source content, source access, destination DID or account binding changes during review/publication; stale intent must not disclose a new revision or write as another identity.
- PDS accepts a write but Jazz cannot record its receipt; restart and another device must reconcile the same publication identity rather than blindly create a second record.
- A previously published source is deleted or unpublished locally; third-party public copies may persist and must not be described as private again.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Finance and Clipper MUST retain separate Jazz app IDs, registry namespaces, domain schemas and authorization policies. Shared provider sign-in MUST NOT imply a shared Jazz account UUID or data permission.
- **FR-002**: Shared identity MUST be represented by verified provider identity within an explicit environment, distinct from each app's account mapping. Email, display name and coincidentally equal UUIDs MUST NOT be used as proof of identity equivalence. Pairwise provider subjects MUST be accommodated or ruled out through verified configuration, without inventing an identity broker.
- **FR-003**: The user MUST explicitly authorize linking the currently selected account. First registration, returning login and linking MUST be separate intents; existing local-first work MUST NOT be silently replaced by automatic login-or-registration.
- **FR-004**: Successful linking MUST retain the original app account identifier, domain ownership, permissions and supported local-first recovery. Authentication MUST NOT be represented as migrating domain data.
- **FR-005**: A same-app mapping conflict MUST preserve both accounts, prevent silent merge, reassignment, ownership transfer or deletion, and disclose safe choices without exposing another person's private data. Mapping lookup and conflict handling MUST use supported authoritative Jazz behavior.
- **FR-006**: Shared sign-in MUST work across independent origins without shared local storage, direct sibling-cookie access, or app-to-app credential transfer. Recovery phrases, signing roots and bearer tokens MUST NOT be passed between consuming apps. Each app obtains its own provider-authorized credential through a verified supported integration.
- **FR-007**: Provider authentication, Jazz registry assignment, local client readiness, data discovery, local persistence and remote acceptance MUST remain distinct outcomes. Missing data and network failure MUST NOT authorize creation or replay.
- **FR-008**: Sign-in, linking, account replacement, logout and recovery MUST reuse the existing session/recovery ownership boundaries. A binding and generation MUST scope callbacks, subscriptions and decisions. Cancellation MUST invalidate admission intent without pretending an issued remote request was undone.
- **FR-009**: Pending domain operations MUST remain owned and correlated to the original account through settlement. Unknown outcomes MUST retain recovery facts, prohibit blind replay, and prevent a transition from being reported complete while its required safety obligations remain unresolved.
- **FR-010**: Offline behavior MUST preserve only qualified existing local capabilities; it MUST NOT claim fresh remote authentication, linking acceptance, remote revocation or provider recovery while unavailable. Outages MUST NOT manufacture replacement identities.
- **FR-011**: Recovery MUST distinguish provider recovery from existing local-first recovery and from data availability. Existing local-first secrets MUST stay transient and excluded from logs, URLs, persisted workflow snapshots and provider payloads. External-only accounts MUST disclose their actual recovery dependencies.
- **FR-012**: Ordinary and broader logout semantics MUST be explicit, including which app, provider session and other devices are affected and what cannot be confirmed offline. [NEEDS CLARIFICATION: Q2 — is ordinary logout app-local with a separate broader action, or intended to sign out every Delightful app?]
- **FR-013**: The first release MUST document its supported sign-in methods and provider/hosting ownership before implementation approval. AT Protocol identity is the first integration direction to evaluate. The selected direction retains Netlify frontends and uses persistent app backends. AT Protocol is the initial sign-in integration; existing local-first recovery remains. The persistent operator, exact source build and deployed integration must be qualified; additional external methods are deferred.
- **FR-014**: Production, development and disposable previews MUST isolate provider trust configuration, app registrations, Jazz app IDs, registry/storage scope, callbacks and test identities. Untrusted previews MUST NOT receive production credentials or identity/data authority. Preview teardown MUST revoke/remove its configuration without deleting production identities. Wildcard trust for arbitrary preview origins is prohibited.
- **FR-015**: DLF MUST expose reusable intent, lifecycle and typed outcome capabilities while delegating credential verification, registry assignment and persistence to supported SDK/provider boundaries. It MUST NOT create a duplicate identity registry, secret store or authentication protocol.
- **FR-016**: Apps MUST retain domain authorization and pending-write/drain responsibilities; DUI MUST retain generic presentation. Library use MUST NOT require Finance schemas, Clipper schemas or app-owned routes. User-visible messages MUST remain localizable and interactions accessible under existing rules.
- **FR-017**: Shared sign-in MUST disclose provider dependency and cross-app identity correlation. It MUST NOT claim that authentication encrypts domain data from hosts or grants data access to another app.
- **FR-018**: Qualification MUST use pinned SDK behavior and real registry/provider configuration; unsupported collision reconciliation, credential compatibility or durability MUST block the corresponding capability claim rather than introduce a custom exchange.
- **FR-019**: Jazz MUST remain the application persistence/synchronization authority. AT Protocol identity and optional publication MUST NOT require mirroring private application records to a PDS, replacing Jazz synchronization, or treating PDS acceptance as Jazz acceptance. Supported local work MUST remain independent of publication availability.
- **FR-020**: AT Protocol identity MUST derive from a verified OAuth flow and stable DID, with a documented mapping into the selected Jazz authentication boundary. Handle, PDS URL, browser-supplied DID or decoded access-token claims alone MUST NOT establish control. PDS migration MUST NOT change the logical app mapping. Raw AT Protocol credentials MUST NOT be assumed compatible with Jazz admission. A supported provider/backend integration and its operator must be qualified; DLF MUST NOT invent a token exchange or duplicate account registry.
- **FR-021**: Authentication and publication authorization MUST be separate capabilities and user intents. Finance MUST require no publication permission; Clipper MUST remain usable without it. Publication authorization MUST be limited to the required collections/operations and obtained through a supported consent flow. Sign-in, account linking, recovery, ordinary saves and background synchronization MUST NOT themselves publish content.
- **FR-022**: Clipper MUST own publication eligibility, public schemas, source attribution/references and content selection. Before issuing a public write it MUST bind explicit confirmation to an exact content revision, destination DID and current authorized app scope. Payloads MUST exclude unselected notes/highlights, surrounding private context, private workspace metadata, credentials and capability-bearing links. A source or destination change MUST invalidate unissued consent; issued writes retain their original owner until settlement.
- **FR-023**: Public publication MUST have its own retained operation identity, selected source revision, target record identity and receipt/reconciliation facts. Local intent persistence, Jazz remote acceptance, PDS acceptance and later public discovery MUST remain distinct. Unknown writes MUST be reconciled at the original target before retry; no blanket exactly-once or cross-service atomicity claim is permitted. A later Jazz rejection MUST NOT be represented as undoing a public write. Exact issuance eligibility and multi-device coordination require consumer design and qualification.
- **FR-024**: Publication MUST be a deliberate snapshot rather than continuous replication. Source edits require explicit republishing. Removal from the publishing repository MUST be explicit and report actual acceptance separately from source deletion; no action may promise erasure of third-party copies or restoration of secrecy for already-public content.
- **FR-025**: MVP publication MUST support remaining unpublished and explicit public publication without depending on AT Protocol Spaces. Restricted-audience publication, private PDS storage, end-to-end encrypted publication and bidirectional Jazz/PDS synchronization are deferred. Existing app storage permissions MUST remain enforceable; neither sign-in nor being unpublished is a new confidentiality guarantee.
- **FR-026**: DLF MUST keep reusable verified-identity, session and consent/capability boundaries independently adoptable. Clipper owns public-content models, publication workflow, durable journal and retry/removal policy; Finance owns financial models and has no publishing workflow. Generic publication infrastructure MUST NOT be added to DLF without separately evidenced reuse and review.

- **FR-027**: Frontends MUST be able to remain on Netlify while each consumer deploys its own persistent authentication/sync backend from its existing repository. DLF MUST provide reusable library boundaries without requiring a standalone login app, separate service repository or central shared credential service. Secrets and durable OAuth state/session storage remain server-side; refresh coordination MUST work across instances.
- **FR-028**: The selected host MUST support the exact Jazz build’s sync transport and session lifetime/routing requirements. Netlify OAuth callback compatibility MUST NOT be described as qualification of the complete Jazz sync service. Remote Core reuse MUST be verified independently and MUST NOT imply storage migration or replacement.
- **FR-029**: After setup and linking, supported offline reads and edits MUST use retained local data/authority without per-operation online authentication. Offline edits MUST survive browser closure and cold restart. Expired remote sessions and service outages MUST NOT alone erase local data, replace the selected account or discard edits; reconnect MUST preserve pending work and report remote outcomes separately. Fresh-device sign-in and new linking require connectivity; known revocation and explicit logout follow the qualified policy rather than being bypassed.
- **FR-030**: Consumers MUST expose actual local record/attachment availability and MUST NOT equate local-first storage with a fully downloaded workspace. Qualification MUST exercise cold restart, durable offline edits, expired sessions, provider/backend/Core outages, reconnect and recovery on the exact adopted build before completion claims.

### Key Entities

- **Shared identity**: Environment-qualified provider identity; verified issuer/subject semantics and subject stability are required. It is not a Jazz account ID.
- **App account mapping**: Registry-authoritative association between an external identity and a Jazz account within an app/environment; existing local-first identity may remain another route to that account.
- **Session binding**: One selected app account, dependency configuration, resource owner and generation. A replacement creates a new scope even when returning to the same account ID.
- **Transition outcome**: Confirmed success, failure, cancellation before issuance, conflict, partial completion or unknown acceptance; includes only nonsensitive correlation facts.
- **Environment**: Explicit production, development or disposable-preview trust boundary, with its own permitted registrations and storage scope.
- **AT Protocol identity binding**: Verified DID and supported authentication-boundary mapping; mutable handle/PDS discovery is separate metadata, never a replacement identity key.
- **Publication intent and receipt (consumer-owned)**: Explicitly selected source revision, approved public payload/destination, retained operation/record identity and observed public-write outcome. Contains no authentication secrets and is not a shared DLF domain schema.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In every qualified two-app scenario, one external identity resolves independently in both apps; zero records become accessible solely because both apps recognize that identity.
- **SC-002**: All existing-account linking and recovery scenarios preserve the original account identifier, record ownership and permissions, with zero silent account replacements or discarded records.
- **SC-003**: Every conflict, cancellation, outage and unknown-outcome case in the qualification matrix produces an explicit bounded outcome; zero uncertain operations are blindly replayed.
- **SC-004**: Every stale-generation and environment-isolation case rejects the obsolete or foreign authority; no secret appears in captured URLs, application diagnostics or persisted workflow snapshots.
- **SC-005**: Every supported logout and recovery journey reports its actual scope and completion status, including partial failures and offline limitations.
- **SC-006**: Every identity-only Finance and unpublished Clipper scenario performs zero PDS content writes and requires zero repository-write permissions while retaining qualified Jazz functionality.
- **SC-007**: Every publication scenario discloses only the confirmed revision to the confirmed DID; source saves, edits, account changes and synchronization produce zero unconfirmed public writes.
- **SC-008**: Every interrupted publication/removal scenario retains its original target and explicit outcome across restart; reconciliation creates zero duplicate records in the qualified scenarios and never claims deletion of third-party copies.

- **SC-009**: Every qualified post-link offline cold-restart scenario retains the original account and locally available data; supported edits survive a second restart with zero discarded edits or replacement accounts, including expired remote sessions.
- **SC-010**: Every reconnect scenario preserves original pending operations and reports actual remote acceptance, rejection or conflict; unavailable attachments are never reported as complete locally available content.
- **SC-011**: Each consumer can deploy its backend integration from its existing repository while its frontend remains on Netlify; transport and cross-instance OAuth/session qualification is recorded without requiring a new central login application.

## Assumptions

- This feature starts a separately authorized scope beyond foundation FR-006's deferral of automatic SSO. It does not reinterpret that historical scope as already implemented. Foundation recovery is app-scoped here; recovery material is never a shared-sign-in transport.
- Initial consumers are browser apps on independent origins. Native applications require separate qualification before any support claim.
- Shared sign-in and safe linking remain the first implementation scope. Explicit publication is an optional subsequent consumer slice; no consuming-app change, authentication/publication implementation, dependency upgrade or service provisioning is authorized by this specification task.
- Existing foundation review findings remain outstanding. Transition safety depends on actual settlement evidence, not an assumption that those findings have been fixed.

## Responsibilities and capability boundaries

| Owner                 | Responsibility                                                                                                                                                       | Boundary                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DLF                   | Reusable identity intent, safe linking/recovery orchestration, session lifecycle and typed outcomes; optional publication-capability separation                      | Reuse existing session owner; no second registry, credential transport or Clipper publication engine           |
| Consuming app         | App ID/environment, routes, domain data/policies, disclosure integration and domain write settlement; Clipper's public payloads, consent, journal and reconciliation | No shared identity implies domain authorization or public disclosure; Finance needs no publication integration |
| Jazz SDK and registry | Account handles, app-scoped assignments, link protocol, credential admission, runtime persistence/synchronization                                                    | Client source observations do not prove deployed registry behavior                                             |
| Identity provider     | Authentication, provider session, supported credentials and provider recovery                                                                                        | No ownership of app domain policies; app session hosting is consumer-owned                                     |
| DUI                   | Generic accessible presentation                                                                                                                                      | No identity policy or credential ownership                                                                     |

Public DLF capabilities must distinguish sign-in, link-current-account, recover, cancel/reconcile and logout, with read-only readiness/outcome observations. Provider credential acquisition stays behind an explicit adapter boundary; raw secrets are not UI or actor snapshot fields. Exact interfaces and statecharts belong to a later approved design, after provider and registry qualification.

## Deferred cross-app data access

Future access requires explicit authorization for a named requesting app, granting app/account, resource scope, operations, duration and revocation behavior. Identity correlation alone, matching email or a provider session is insufficient. App-owned policies must enforce least privilege and preserve auditability, consent withdrawal and offline revocation limitations. No cross-app grants, shared directory, data migration, account merging, token brokerage or speculative sharing platform is designed in this feature.

Explicit public publication is a separate consumer-owned export, not a private cross-app data grant.
Its opt-in boundary is specified above; it does not authorize another app to read the Jazz source.

## Implementation decisions and sequence

See [research](research.md) for pinned SDK evidence and provider candidates,
[AT Protocol integration research](atproto-research.md) for current code/spec findings and version
limits, [authentication feasibility](auth-feasibility.md) for the published-version comparison,
registry evidence and conditional recommendation, and [qualification](qualification.md) for required evidence. Provider/bridge choice,
persistent backend operator, domains/callbacks, stable DID-to-Jazz mapping, supported Jazz
admission, recovery availability and logout scope must be resolved before identity implementation
planning claims readiness. Publication additionally needs a separately reviewed Clipper design for
public Lexicons, exact source eligibility, consent, durable operation ownership, reconciliation and
removal. No public Lexicon or Bluesky feed integration is selected here. Provider compromise/migration
and unlinking require an explicit later recovery design; no unlink/delete/merge capability is implied.

The [single-user delivery direction](delivery.md) supersedes research recommendations to wait for
a published release or choose a separate JWT-provider bridge by default. Exact source/artifact
pinning, existing-data preservation and supported backend integration are implementation work to
complete and demonstrate. They are not reasons to defer the project awaiting upstream publication.
