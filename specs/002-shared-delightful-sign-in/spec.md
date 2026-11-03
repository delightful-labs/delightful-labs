# Feature Specification: Shared Delightful sign-in

**Feature Branch**: `spec/shared-delightful-sign-in`

**Created**: 2026-11-03

**Status**: Draft — product decisions and deployment qualification remain open

**Input**: One Delightful identity can sign into independently deployed apps, initially Finance and Clipper, while preserving each app's existing accounts, ownership, recovery and domain policies. This task authorizes specification and research only.

## User Scenarios & Testing *(mandatory)*

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

### Edge Cases

- Two tabs/devices race to link the same external identity to different accounts; only an authoritative accepted mapping wins, with an explicit conflict for the other account.
- Linking the already-linked identity to the same account is distinguished from a conflicting account, subject to actual registry behavior qualification.
- The provider changes account while a token is being obtained or refreshed; reject stale credentials and invalidate prior scoped decisions.
- A link is accepted remotely but client opening fails; report linked-but-session-unavailable rather than assuming rollback.
- Provider session expiry, revoked credentials, account deletion, signing-key rotation, denied consent and blocked popups/redirects have distinguishable outcomes and supported retry paths.
- Storage eviction or an empty replica is not proof of an unmapped identity. Losing a provider account is not proof that app data is deleted.
- Offline logout cannot promise global remote revocation or erase another device's retained data.
- Preview origins, unexpected redirect destinations, wrong issuer/audience and malformed identity claims must not receive production authority.

## Requirements *(mandatory)*

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
- **FR-013**: The first release MUST document its supported sign-in methods and provider/hosting ownership before implementation approval. [NEEDS CLARIFICATION: Q1 — existing provider or hosting constraints, and required initial sign-in methods?] No provider is selected by this draft.
- **FR-014**: Production, development and disposable previews MUST isolate provider trust configuration, app registrations, Jazz app IDs, registry/storage scope, callbacks and test identities. Untrusted previews MUST NOT receive production credentials or identity/data authority. Preview teardown MUST revoke/remove its configuration without deleting production identities. Wildcard trust for arbitrary preview origins is prohibited.
- **FR-015**: DLF MUST expose reusable intent, lifecycle and typed outcome capabilities while delegating credential verification, registry assignment and persistence to supported SDK/provider boundaries. It MUST NOT create a duplicate identity registry, secret store or authentication protocol.
- **FR-016**: Apps MUST retain domain authorization and pending-write/drain responsibilities; DUI MUST retain generic presentation. Library use MUST NOT require Finance schemas, Clipper schemas or app-owned routes. User-visible messages MUST remain localizable and interactions accessible under existing rules.
- **FR-017**: Shared sign-in MUST disclose provider dependency and cross-app identity correlation. It MUST NOT claim that authentication encrypts domain data from hosts or grants data access to another app.
- **FR-018**: Qualification MUST use pinned SDK behavior and real registry/provider configuration; unsupported collision reconciliation, credential compatibility or durability MUST block the corresponding capability claim rather than introduce a custom exchange.

### Key Entities

- **Shared identity**: Environment-qualified provider identity; verified issuer/subject semantics and subject stability are required. It is not a Jazz account ID.
- **App account mapping**: Registry-authoritative association between an external identity and a Jazz account within an app/environment; existing local-first identity may remain another route to that account.
- **Session binding**: One selected app account, dependency configuration, resource owner and generation. A replacement creates a new scope even when returning to the same account ID.
- **Transition outcome**: Confirmed success, failure, cancellation before issuance, conflict, partial completion or unknown acceptance; includes only nonsensitive correlation facts.
- **Environment**: Explicit production, development or disposable-preview trust boundary, with its own permitted registrations and storage scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every qualified two-app scenario, one external identity resolves independently in both apps; zero records become accessible solely because both apps recognize that identity.
- **SC-002**: All existing-account linking and recovery scenarios preserve the original account identifier, record ownership and permissions, with zero silent account replacements or discarded records.
- **SC-003**: Every conflict, cancellation, outage and unknown-outcome case in the qualification matrix produces an explicit bounded outcome; zero uncertain operations are blindly replayed.
- **SC-004**: Every stale-generation and environment-isolation case rejects the obsolete or foreign authority; no secret appears in captured URLs, application diagnostics or persisted workflow snapshots.
- **SC-005**: Every supported logout and recovery journey reports its actual scope and completion status, including partial failures and offline limitations.

## Assumptions

- This feature starts a separately authorized scope beyond foundation FR-006's deferral of automatic SSO. It does not reinterpret that historical scope as already implemented. Foundation recovery is app-scoped here; recovery material is never a shared-sign-in transport.
- Initial consumers are browser apps on independent origins. Native applications require separate qualification before any support claim.
- Shared sign-in and safe linking are the first implementation scope; no consuming-app change, authentication implementation or service provisioning is authorized by this specification task.
- Existing foundation review findings remain outstanding. Transition safety depends on actual settlement evidence, not an assumption that those findings have been fixed.

## Responsibilities and capability boundaries

| Owner | Responsibility | Boundary |
| --- | --- | --- |
| DLF | Reusable identity intent, safe linking/recovery orchestration, session lifecycle and typed outcomes | Reuse existing session owner; no second registry or credential transport |
| Consuming app | App ID/environment, routes, domain data/policies, disclosure integration and domain write settlement | No shared identity implies domain authorization |
| Jazz SDK and registry | Account handles, app-scoped assignments, link protocol, credential admission, runtime persistence/synchronization | Client source observations do not prove deployed registry behavior |
| Identity provider | Authentication, provider session, supported credentials and provider recovery | No ownership of app domain policies; hosting/configuration remains undecided |
| DUI | Generic accessible presentation | No identity policy or credential ownership |

Public DLF capabilities must distinguish sign-in, link-current-account, recover, cancel/reconcile and logout, with read-only readiness/outcome observations. Provider credential acquisition stays behind an explicit adapter boundary; raw secrets are not UI or actor snapshot fields. Exact interfaces and statecharts belong to a later approved design, after provider and registry qualification.

## Deferred cross-app data access

Future access requires explicit authorization for a named requesting app, granting app/account, resource scope, operations, duration and revocation behavior. Identity correlation alone, matching email or a provider session is insufficient. App-owned policies must enforce least privilege and preserve auditability, consent withdrawal and offline revocation limitations. No cross-app grants, shared directory, data migration, account merging, token brokerage or speculative sharing platform is designed in this feature.

## Dependencies and decision gates

See [research](research.md) for pinned SDK evidence and provider candidates, and [qualification](qualification.md) for required evidence. Provider choice, hosting/operator, required methods, domains/callbacks, stable subject configuration, Jazz issuer/audience admission, recovery availability and logout scope must be resolved before implementation planning claims readiness. Provider compromise/migration and unlinking require an explicit later recovery design; no unlink/delete/merge capability is implied here.
