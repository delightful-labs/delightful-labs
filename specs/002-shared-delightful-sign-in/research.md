# Shared sign-in research

Research date: 2026-11-03. Scope: source inspection and official documentation only; no authentication implementation, provisioning or runtime authentication qualification performed.

Continuation: the user selected exploration of Jazz-native storage with AT Protocol identity and
optional explicit public publication. See [AT Protocol integration research](atproto-research.md)
for fresh code/spec evidence, Finance/Clipper boundaries and the newer Jazz backend-auth candidate.
The alpha.59 findings below are retained as the PR's prior pinned-package inspection; they were not
reproduced in this continuation because no installed Jazz package was available in these worktrees.
Current upstream APIs differ and do not silently replace this baseline.

## Existing DLF contracts

The baseline is [foundation spec](../001-local-first-foundation/spec.md), particularly FR-005–FR-011 and FR-021, plus the adopted [constitution](../../.specify/memory/constitution.md) and [workflow ownership rules](../../.specify/memory/xstate.md). Foundation FR-006 deferred automatic SSO. This new user request starts that work as a separate feature; the historical foundation scope is not rewritten.

Public adapter evidence:

- [Session adapter](../../src/lib/backend/jazz/session.ts) supplies the configured session capability. [Startup](../../src/lib/backend/jazz/startup.ts) owns app-lifetime acquisition and attachment boundaries. Reuse them rather than create another identity/session singleton.
- [Readiness](../../src/lib/backend/jazz/session-readiness.ts) observes SDK readiness and retry; it is not an external identity or linking API.
- [Restoration](../../src/lib/backend/jazz/restoration.ts) delegates phrase parsing and restoration to supported SDK boundaries. [Recovery phrase adapter](../../src/lib/backend/jazz/recovery-phrase.ts) limits export to eligible local-first handles and scopes observation to the current binding/account.
- [Restoration machine](../../src/lib/machines/identity/restoration.ts) coordinates prepared host transition, transient secret lifetime and issued-operation ownership. Cancellation does not prove remote rollback.
- [Foundation tasks](../001-local-first-foundation/tasks.md) contain outstanding creation/settlement review findings. New sign-in cannot assume unknown-write cleanup or absent-row interpretation is already safe. No fixes are included here.

The present DLF public adapters do not constitute a shared provider/linking capability. The new scope must extend reusable behavior without duplicating SDK registry, credential persistence or session ownership.

## Pinned Jazz source findings

Installed package: `jazz-tools@2.0.0-alpha.59`, verified in `node_modules/jazz-tools/package.json`. The paths below are reproducible inspection targets in that pinned installation, not stable API promises. Classic Jazz documentation must not be substituted for these Jazz 2 contracts.

| Inspection target under `node_modules/jazz-tools/dist/` | Observed behavior | Implication / remaining evidence |
| --- | --- | --- |
| `accounts/local-first.js`: `accountAppId`, `localFirstAccountId`, `localFirstFactory` | UUID app IDs are normalized; other app IDs become UUIDv5 namespaces. Account ID is UUIDv5 of that app namespace and `jazz-account-founder-v1` plus NUL plus the minted local-first token's subject. | Confirms app ID **and signing subject** affect local-first IDs in this implementation. The subject comes from a native-minted identity token; this JS formula is deterministic identification, explicitly not proof of control. No promise of stable derivation across future SDK versions; no reason to transfer a root between apps. |
| `accounts/context.js`: `accountRegistryUrl`, `accountContextScope` | Registry endpoint is derived as `/apps/{normalized-app-id}/accounts`; handles are checked against configured app/registry scope. Copied raw account/auth configuration fields are rejected. | App-scoped mapping is supported by client source. Two deployed registries/app namespaces still need qualification; account UUID equality is not an identity or authorization contract. |
| `accounts/enrollment.js`: `registerJWT`, `loginJWT`, `loginOrRegisterJWT` | Enrollment extracts intended issuer/subject, rejects reserved external issuers, and invokes distinct registry operations. Comments place independent signature/issuer/audience verification in the core. | Credential compatibility requires configured registry/core evidence, not decoding a browser JWT. No assumption an arbitrary OIDC ID token is accepted. |
| `accounts/enrollment.js`: `linkJWT` | Obtains approving current-account token and external identity token; for a local-first account, first calls `found-local-first` and verifies matching account ID. Requests a link intent under approving authority, then accepts its nonce under external authority; validates resulting account ID equals the original. | Supported SDK linking exists. Founding and linking are multiple remote effects, not an atomic rollback promise. Conflict codes, races, nonce expiry, repeat acceptance and lost-response reconciliation require registry verification. |
| `accounts/registry-client.js` | Bearer-authenticated POSTs omit cookies and reject redirects; validates returned account UUID and exact expected issuer/subject; failures expose bounded registry error codes/status or timeout. | SDK-to-registry bearer use is not app-to-app credential transfer. Do not invent conflict-code names or a mapping endpoint not evidenced here. |
| `session/state.d.ts`, `session/state.js` | Public actions include local-first create/restore, JWT register/login/login-or-register/link, logout, retry and close. Session detachment uses `shutdown({ waitForSync: true })`; unknown teardown failures retain a private client owner. | Extend the existing owner and its app drain coordination. Shutdown is not proof all app-level unknown outcomes are reconciled. |
| `session/auth-provider.js`: `connectAuthProvider` | One connector per session; reconciles provider state using login-or-register, or logout when provider key is null. Its comment expressly requires manual `session.linkJWT` without this connector when linking an existing local-first account. Guards token acquisition against changing provider state; disposal does not itself undo issued work. | Direct mounting over a local account can select another account instead of linking. Null provider state can also log out local use. Integration must model the user's intent and the existing owner before enabling automatic admission. |
| `session/better-auth.js`, `.d.ts` | Structural Better Auth connector uses the provider session atom, requests `/token` through the supplied client's `$fetch`, and coordinates Jazz logout before provider sign-out. Better Auth implementation is not bundled by this interface. | Concrete supported client adapter evidence makes Better Auth a candidate, not a provider decision or proof of cross-origin deployment support. |
| `accounts/enrollment.js`: `exportLocalFirstSecret` | Secret export requires an issued handle with local-first issuer and retained local-first material. An externally authenticated handle does not automatically export the original local-first secret. | Preserve the existing recovery route/material; do not promise recovery-phrase display from an external handle or external-only account. Post-link recovery must be qualified explicitly. |
| `backend/request-auth.js` | Includes issuer/audience-aware verification and JWKS retrieval/validation; JWKS URLs require HTTPS apart from loopback development. | Evidence of verification machinery, not proof of the deployed registry's allowed issuers, audiences, algorithms, key rotation or outage policy. |

### What remains unverified

No deployed registry configuration or server implementation was established by this source inspection. In particular, do not claim that a collision produces a specific HTTP status/code, that login proves absence after a timeout, that repeat linking is idempotent, or that a lost link acceptance can already be safely reconciled. Implementation design must obtain supported authoritative behavior for these cases. If it cannot, linking remains unqualified rather than adding a DLF registry or custom credential exchange.

Provider subject semantics also need qualification: the same person may receive different subjects across provider clients. [OpenID Connect Core, subject identifier types](https://openid.net/specs/openid-connect-core-1_0.html#SubjectIDTypes) distinguishes public and pairwise subjects. A common login experience alone does not establish a globally equal issuer/subject pair; email is not a safe replacement key.

## Provider candidates, not a selection

| Candidate | Evidence relevant to evaluation | Hosting and unresolved dependencies |
| --- | --- | --- |
| Better Auth | Jazz ships the structural connector described above. Its [JWT plugin](https://better-auth.com/docs/plugins/jwt) documents a token endpoint and JWKS for external services, distinct from its primary session cookie. | Requires an operated auth service, supported database/session storage, keys, recovery delivery and lifecycle. Need to establish an appropriate supported central sign-in deployment for independent origins; the presence of `/token` alone does not prove it. |
| Auth0 | Official [SSO documentation](https://auth0.com/docs/authenticate/single-sign-on) describes an authentication-domain session reused by independently registered apps, distinct from application sessions. | Managed tenant, app registrations, domain/callback configuration, service terms/cost evaluation and accepted JWT issuer/audience/subject behavior. No pinned Jazz-specific connector verified; assess the generic supported JWT boundary. |
| Keycloak | Official [OIDC endpoint documentation](https://www.keycloak.org/securing-apps/oidc-layers) describes discovery, redirect authentication, tokens and logout. | Requires an operator or managed hosting, durable service storage, security updates, backups and recovery operations; app registrations and JWT compatibility remain to be verified. No pinned Jazz-specific connector verified. |

These are evaluation candidates, not interchangeable promises. The continuation prioritizes AT
Protocol identity; it does not select one of these providers or prove a supported AT Protocol
connector for any of them. Additional required methods, existing infrastructure, operating
responsibility and budget have not been supplied. AT Protocol may be integrated through a qualified
provider or a supported Jazz backend boundary; no extra provider is assumed necessary in advance.

[Better Auth security guidance](https://better-auth.com/docs/reference/security) describes host-only cookies by default and opt-in subdomain sharing. That does not solve independent-origin SSO. A supported provider-hosted authentication boundary must establish each app's session independently; this draft does not prescribe a token relay or custom exchange. Browser privacy restrictions mean third-party cookies or hidden iframes must not be the sole supported path.

Any later OAuth/OIDC integration must qualify exact callbacks, request/response correlation, replay protection and an appropriate supported authorization flow against [OAuth security best current practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). This research does not select a flow/library or invent one.

## Decisions required before planning readiness

1. **Q1, partially narrowed**: AT Protocol identity is the first evaluation direction. Hosting/operator constraints and any additional required first-release methods remain open. Qualify a supported identity-to-Jazz path, obtain the provider/backend/version decision, and establish operator and recovery responsibilities before implementation.
2. **Q2, asked**: App-local versus all-app ordinary logout. Distinguish requested scope from what online sessions, disconnected apps and provider APIs can actually confirm.
3. **Deployment gate**: Real app domains, permitted callback origins, environment registrations, issuer/subject stability, Jazz admission configuration and credential refresh/key-rotation behavior need evidenced decisions. No production or preview services are provisioned here.
4. **Recovery gate**: Document provider account loss, external-only account recovery and preservation of existing local-first recovery after linking. Unlinking, provider migration and account merge are not silently added to scope.

The spec stays draft until product questions are resolved; implementation planning additionally requires a viable provider/registry integration path. Runtime qualification occurs only in a later authorized phase.
