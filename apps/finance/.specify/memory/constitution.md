# Delightful Finance Constitution

## Core Principles

### I. Local-First Finance

Jazz is the durable application data and authorization layer. Reads and writes must remain useful offline; local writes are optimistic and synchronize when connectivity returns. Do not make ordinary finance workflows depend on a network round trip.
Locally available records and locally known permissions determine ordinary finance usability, even when a remote connection opens but does not answer. Keep local availability, remote freshness, local persistence, and remote acceptance distinct. Missing or partial local data does not prove global absence and must not trigger replacement, access restoration, or destructive repair. Observed identity, membership, grant, and workspace changes must invalidate affected capabilities. Previously approved online-only access administration and explicit provider operations retain their own requirements.

### II. Safe, Explicit TypeScript

Use strict TypeScript. Do not use `any` or TypeScript `as` casts. Do not write `switch` statements or `case` clauses; prefer discriminated-union narrowing, lookup records, or clear conditional expressions. Prefer `unknown` with narrowing, generics, `satisfies`, and typed adapters for under-typed third-party APIs. Model domain variants with discriminated unions and required variant-specific fields instead of loosely related optional fields.

### III. Financial Integrity

Represent money as integer `amountMinor` plus an ISO 4217 `currency`; never use floating-point amounts. MVP entry is USD, but persisted records retain currency. Transactions reference financial accounts by `accountId`, carry `organizationId`, and use a non-negative amount with an explicit kind. Keep user-assigned `bookedOn` distinct from Jazz audit timestamps.

### IV. Organization-Based Access

An organization is the tenancy boundary; a financial account is a ledger, not an identity or tenant. Scope business data to organizations and enforce access through Jazz permissions. Org owners/admins can access all org accounts. For members/viewers, `accountAccessMode` is authoritative: `all` grants access to all org accounts, while `selected` grants access only to explicitly granted accounts; no grants in `selected` mode means no account access. Members can write accounts they can access according to their grants; viewers are read-only. Account grants do not grant access without active organization membership. SimpleFIN Access URLs are provider credentials owned by the connecting user and scoped to an organization, not ordinary shared organization data. Persist or replicate them only as ciphertext protected by that user's passkey; keep passkeys and usable decryption keys out of application replicas. The same signed-in user may unlock the encrypted credential on their own compatible devices using the same synced passkey. Bind credentials to the user, organization, and connection; organization membership alone must not grant decryption access. Passkey possession does not replace application identity, membership, or account authorization checks. Local-first provider operations run on the client, directly or through a stateless CORS relay that does not retain credentials. Sharing credentials with other organization members requires a separately approved encrypted key-distribution, recovery, and revocation design; ordinary Jazz role permissions alone are not secret storage.

### V. Accessible, Internationalized UI

Use SvelteKit with Svelte 5, semantic HTML controls, and Paraglide JS for every user-visible string from the beginning. Keep the interface unstyled and wireframe-like unless the user approves a visual direction; do not invent colors, decoration, or custom visual treatments. Prefer native semantic HTML controls over bespoke controls. Presentation components must stay small and reusable, receive data and callbacks through props, and render independently of Jazz sessions, database queries, or XState actors. Keep Jazz subscriptions, dependency binding, and actor lifecycle wiring in the page or integration component, composing imported pure presentation components. Define complex workflows and reusable authorization/readiness decisions as focused machines under `src/lib/machines/`, composed through child actors. Extract helpers for genuinely reused logic rather than relocating each page script into a controller file. Simple presentation state belongs in pure components. Do not put rendered HTML in integration scripts that bind Jazz queries or XState actors; third-party UI controls and localization are allowed in presentation components. Do not create component files merely to relocate page templates. Do not use Tailwind. Use XState for multi-step workflows; use Svelte runes/stores for simple UI state. Preserve accessible interaction semantics.

### VI. Provider Secrets and Imports

SimpleFIN is optional, bring-your-own-key, and initiated by the user. Never persist, log, or replicate setup tokens. Before claiming a one-use token, verify that the selected passkey can encrypt and subsequently decrypt a harmless sample using WebAuthn PRF; successful passkey creation or sign-in alone is insufficient. Encrypt the claimed Access URL before persistence, and replicate only ciphertext and non-secret unlock metadata through Jazz. The password manager separately manages passkey synchronization. Require passkey user verification for each explicit credential-using operation; keep decrypted credentials and usable keys transient and release them when the operation ends or the user leaves or changes identity/organization. Never persist decrypted credentials or usable decryption keys, expose them in ordinary UI, or include them in logs or navigation URLs. Do not silently downgrade to plaintext storage on incompatible devices.

Transaction fetching occurs only after an authorized user explicitly presses Sync now and completes passkey verification. Startup, reload, network reconnection, timers, ordinary data changes, connection setup, and failed attempts must not fetch or retry transactions. Account discovery is a separate explicit, passkey-unlocked operation that must not fetch transactions. Claiming and fetching are client-initiated operations; a stateless relay may be used only where browser CORS requires it and must not retain or log tokens, Access URLs, or provider responses. Imported transactions carry provider provenance and a stable external identity for idempotency, including repeated imports from different devices.

Initial lost-passkey recovery is reconnection using a new setup token and passkey, preserving imported finance data. Do not promise old-credential recovery through application sign-in, a newly created passkey, or password-manager account recovery. Disconnecting prevents new requests as devices observe the change; invalidating a credential already decrypted or copied requires provider-side revocation. Encrypted storage does not protect a credential from malicious application code while unlocked or from a relay handling the request. Verify compatibility on actual supported devices and distinguish locally synced passkeys from phone/QR flows before declaring cross-device support. Sharing with other organization members, additional recovery methods, and backup passkey enrollment remain subject to separate approved designs.

### VII. Additive, Queryable Domain Design

Keep provider/check-specific data in dedicated related tables when it needs to be queried; avoid sparse columns and generic JSON blobs. Evolve Jazz schemas through additive fluid migrations where practical. Keep the schema and permissions ready for grants, attachments, batches, and SimpleFIN before their full UI ships.

### VIII. Tested Application Code

Every application feature and production code path must have appropriate automated unit tests and end-to-end coverage in Playwright. Unit tests cover domain logic, validation, state machines, permission helpers/adapters, and edge cases; Playwright tests cover user-visible workflows, authorization outcomes, and offline behavior where feasible. Add or update tests in the same change as the code. A feature is not complete until its tests pass.

### IX. Explicit State and Actor Ownership

Model complex behavior as a statechart before implementing effects. Sequential business checks and
state derived from two or more conditions MUST be reviewed for guarded transitions or child-machine
ownership. Wrapping a branching workflow in `fromPromise` does not make its decisions part of the
statechart. Use focused promise/callback actors for I/O and platform resource adapters; compose
multi-step decisions through invoked or spawned machines rather than manually starting actors and
bridging them through promises.

Use finite states for lifecycle, readiness, capabilities, and terminal outcomes. Keep context for
observed facts, counters, resource payloads, actor references, and typed results; do not mirror the
active state with phase/stage/message fields or independent booleans. Determine each outcome once,
then use it for persistence and parent results. State metadata may carry localization descriptors;
presentation translates, formats, and renders machine-owned choices. Simple input and disclosure
state remains local. Pure transformations and defensive type invariants may remain functions.
Retain transaction-time invariant checks where atomicity requires them.

Give shared workflows an application-tree owner that exists before initialization. Keep session,
workspace, authorization, and credential readiness explicit and model only observable facts. Keep
local readiness separate from remote connectivity; omit connectivity state when no supported
observer exists. Shutdown MUST cancel active children and finish resource cleanup before stopping
owners. Reset, cancellation, and shutdown states take precedence over late completion/error events.
Actor stopping alone is not a substitute for domain cleanup. Review teardown ordering in framework
hooks, not just ordinary cancel-button transitions. Follow `.specify/memory/xstate.md` for practical
design and review guidance.

## Technology Constraints

- App: SvelteKit 3, Svelte 5, TypeScript, Jazz (`jazz-tools` v2).
- UI: semantic HTML controls, native Svelte CSS, CSS variables; no Tailwind.
- Complex UI flow: XState with `@xstate/svelte`.
- Localization: Paraglide JS; English is the initial locale, and no visible strings are hardcoded in components.
- Installable shell: native SvelteKit service worker and a web app manifest. Cache public page shells and assets only; keep Jazz data/auth/sync out of runtime caching. Workbox is deferred.
- Native wrappers are deferred.
- GitHub organization/URL namespace: `https://github.com/delightful-labs/`.

## Development Workflow and Quality

- Spec Kit artifacts in `.specify/` and `specs/` are the project source of truth; the inherited plan file is a migration reference/scratchpad.
- Before implementation, keep requirements, technical plan, and task checklist aligned. Resolve consequential ambiguity in the spec before building dependent features.
- Every application feature and production code path needs appropriate unit and Playwright end-to-end coverage. Do not run tests until the user has reviewed and approved the exact implementation being tested.
- Use Prettier for formatting. Keep formatting configuration in the repository and do not reformat unrelated files.
- Work incrementally: complete one focused task per review cycle, using a small related set of files (typically 4–6 implementation files). Multiple routes/components may change together when the task requires it. Discuss larger batches before proceeding; do not spread a change across dozens of files without explicit authorization. Present the change and wait for review before starting another task.
- Do not add timestamps such as `createdOn`/`updatedOn` where Jazz system audit fields already provide them.

## Governance

This constitution governs implementation and supersedes conflicting project conventions. Amend it when a deliberate architectural decision changes, and update dependent specs/plans in the same change. Each feature plan must state how it complies with the principles above.

**Version**: 2.4.0 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-16
