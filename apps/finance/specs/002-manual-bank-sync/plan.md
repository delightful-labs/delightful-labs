# Implementation Plan: Manual SimpleFIN Bank Sync

The specification and constitution govern this implementation. The previous device-local plaintext credential design is superseded.

## Architecture

Use WebAuthn PRF with required user verification and HKDF-SHA-256 to derive a nonextractable AES-256-GCM key. Verify an encrypt/decrypt sample using two separate assertions before claiming a setup token. Bind encryption to the signed-in user, organization, connection, credential ID, PRF salt, and format version using authenticated additional data. Persist only ciphertext and public unlock metadata in Jazz. Never store keys or plaintext credentials.

Keep XState orchestration, Jazz subscriptions, and authorization in the bank settings integration route. Use a props-only presentation component and Paraglide messages. Connection setup uses explicit XState states for passkey creation, waiting for the encryption-test action, encrypting the sample, waiting for the unlocking-test action, verifying the sample, waiting for final confirmation, and claiming/saving. Each waiting view has an explanatory button; the token form is hidden during setup. Cancellation and scope changes clear transient setup data. Claiming occurs only in the final confirmed state. Each credential-using operation obtains a fresh passkey assertion; Web Locks reject overlapping operations across tabs without queuing; scope changes and navigation abort work. No lifecycle event starts provider requests or retries.

Support SimpleFIN Bridge HTTPS endpoints through a stateless same-origin relay to handle browser CORS. Restrict destinations to bridge.simplefin.org, reject redirects, enforce same-origin requests, omit caching and credential/response logging. No server Jazz writes: the authenticated client enforces owner and membership checks and Jazz enforces writes.

Discovery is a separate explicit action using balances-only=1. Sync now fetches a bounded date window after passkey unlock. Default to an explicit Add account action using the discovered provider name and currency and bank kind, saving the account and mapping in one local transaction with deterministic IDs. Show optional existing-account mapping only when active local accounts exist. Normalize decimal strings exactly to integer USD minor units, omit pending/invalid/unsupported records, and use deterministic transaction row IDs scoped to organization and provider account identity so concurrent devices converge on one row. Preserve existing imported rows on repeats and failure.

## Delivery batches

1. Align artifacts and add credential validation/cryptography.
2. Add encrypted Jazz records and permissions, provider adapter and restricted relay.
3. Add bank settings XState workflow, presentation, localization and navigation.
4. After implementation approval, add unit and Playwright coverage and run relevant tests. Physical-device PRF synchronization validation remains required before declaring cross-device compatibility.

## Constitution check

Local-first ordinary finance is unchanged. Provider operations require explicit actions. No plaintext secret replication, casts, any, switch statements, invented styling, or automatic requests. Use additive schema changes and deterministic import IDs. Type checks and focused formatting run during implementation; tests await review per repository instructions.

## Approved demo-mode delivery cycles

1. Add optional static public environment configuration (default `false`), simulated
   provider responses, and a server-side relay guard. Keep provider signatures intact;
   use a reserved `.invalid` synthetic credential and validate responses with the
   existing provider schema. Retain production Bridge validation and forwarding.
2. After review, retain identical bank-page presentation and copy in both modes,
   retain real passkey/XState/Jazz behavior, and guard organizations against opposite-mode
   connections using a distinct deterministic demo connection ID. Remove the standalone
   demo route, component, navigation, messages, and diagnostics namespace.
3. After review, document activation, the `demo` token, and data persistence; replace standalone demo tests
   with bank workflow coverage and retain real-mode coverage. Add/run tests only after
   approval of their implementation. Verify zero demo provider requests, cancellation,
   mode mismatch rejection, persistence, mapping, and repeated-sync deduplication.

Each cycle is presented for review before the next begins. Demo mode requires a
separate organization and does not automatically delete persisted sample data.

Render a props-only viewport border component from the root layout, enabled by
`PUBLIC_SIMPLEFIN_DEMO`. Use a fixed 3px red border with pointer events disabled;
keep the bank view and copy identical in both modes.

Keep Jazz subscriptions and presentation composition in BankSyncIntegration.
Initialize the shared bank workflow there and supply controls to AppShell. Keep a single
workflow for page and drawer sync actions. Navigation and identity/workspace changes
continue to cancel work; mounting the integration must never start provider requests.

BankSyncIntegration owns the app-scoped actor and integration queries. All pages
can access it with getBankSync(), subscribe to its snapshot, inspect operation phases,
and send typed events. Discovery results, availability, operation counts, and
transient work live in machine context. Authorization is a staged child machine;
operation actors perform focused I/O and the parent machine sequences them.
Keep the actor per application tree to avoid sharing state between SSR requests.

## Approved machine decomposition

The user-directed refactor moves reusable workflow definitions into
`src/lib/machines/bank-sync/`, superseding the earlier workflow-colocation guidance
for this integration. Keep the integration responsible for subscriptions, dependency
binding, lifecycle observations, localization projections, and presentation composition.

Use separate machines for authorization, setup, account creation/mapping, transaction
import, and provider operations, composed by one application-scoped root machine.
Invoke child machines directly so parent cancellation stops their work; do not manually
start authorization actors or bridge them back through promises. Actors perform focused
I/O. Import traversal, duplicate lookup, per-write authorization, and persistence have
explicit states. Pure normalization and reusable type/value helpers remain functions.

Hold Web Locks for each active setup step and each complete provider operation,
releasing them during explanatory setup waiting states. Pin operations to their initiating
identity/workspace. The root machine handles environment changes and invalidates stale
discovery data when credentials change. Infer the public actor/snapshot types from the
root machine. Preserve the current UI and all explicit-action boundaries. After review,
cover cancellation at each child boundary, setup/claim failures, scope/credential changes,
locking, mapping conflicts, partial imports, and repeat-sync idempotency.

## Explicit outcomes and metadata

Replace idle plus context.message/context.phase with a ready parent containing neutral,
success (complete/partial), cancelled, and failure substates. Failure reasons have their
own states and localized message keys in typed metadata. Keep action transitions on
ready so retrying does not require dismissal. Results persist until the next action or
identity/workspace change; ignore cancel events when there is no active workflow.

Put setup-view and loading metadata on the actual child states and remove phase events.
Observe invoked child snapshots so the global actor's subscription notifies all pages.
Use a Svelte readable subscribed directly to the actor, since child changes can leave
root snapshot identity unchanged. Rendering merges active metadata and translates it
reactively; no mirrored workflow flag or status-message lookup remains.

After implementation review, verify all failure substates, complete/partial success,
cancellation cleanup, outcome persistence, retry from each outcome, neutral connection
states, child-driven stepper/spinner changes, locale changes, and scope resets. Tests
must assert state transitions and visible behavior rather than context status strings.

## Machine-owned observed data and presentation descriptors

Forward raw subscription snapshots using OBSERVED. The root machine raises its
normalized environment/data event and updates context with scoped accounts, mappings,
and a last-sync summary. Its live observation adapter supplies the same canonical
permission and credential-readiness facts to child authorization actors. Keep result
classification and nullable count defaults within this model.

Use typed status descriptors in state metadata, including the disconnected prompt's
first-step label key. Setup metadata owns step progression; one shared step definition
provides localized labels. Expose selectBankView() as a pure selector over machine
context and active-state metadata. The global API exposes descriptors/data rather than
formatted status/outcome strings. BankSync translates them and formats dates, keeping
localization reactive without determining workflow outcomes. Integration code only
binds subscriptions, observations, lifecycle callbacks, and presentation props.

After implementation review, cover raw observation updates, permission/credential
readiness changes, saved result replication, missing results/default counts, workspace
isolation, step positions, and rendering descriptors across locale changes.

## Application readiness parent

Introduce an app-tree readiness actor with parallel session and organization-membership regions. It invokes the bank machine once, forwards raw observations, and accepts bank commands only while session and membership are ready; cancellation/reset remain available. Expose both parent and bank snapshots through Svelte context. Application readiness is created in the root layout before Jazz opens; the workspace readiness child owns bootstrap and organization selection once the SDK database is available. Do not infer remote sync connectivity from browser online status or configuration, and do not add unknown transport states. Preparation and authorization are composed as child machines.

## Preparation and authorization child actors

Share an identity-check machine across setup preparation, operation preparation, and authorization. Its transient states check session, identity availability, permission, initiating user/organization, and connection ownership. Preparation invokes this child, selects an existing connection or requires/generates one, and rechecks identity after asynchronous ID generation. Preserve the initiating connection baseline for subsequent checks. Setup and operation compose the successful scope with their own transient data.

Authorization invokes identity checks before and after its asynchronous work. Database actors only load scoped membership/connections; a separate ID actor generates the demo connection identity. Guarded transitions decide membership access, requested/existing provider mode, whether a connection check is required, ciphertext presence, and expected-ciphertext equality. Denials have explicit terminal states. Keep defensive type invariants at actor boundaries distinct from business decisions. Parent cancellation continues to stop invoked children.

After implementation review, cover missing/changed identity, connection ownership, existing/new connection preparation, cancellation during ID generation/query reads, mode mismatch, revoked/replaced ciphertext, and fresh membership denial. No tests are added or run before review.

## Account workflow decomposition

Keep accounts.ts as a command/provider routing machine invoking separate create, map, and unlink children. Creation validates values and generates its account identity; mapping receives an explicit existing-account destination; unlinking loads links and traverses per-write authorization and deletion states. Creation/mapping share a write machine that loads provider links, destination account, and destination links in focused query actors, checks eligibility/conflicts with guarded transitions, generates the link identity, authorizes, and commits. Atomic transactions must recheck current data and preserve idempotence because preflight machine checks alone cannot prevent concurrent writes. Keep the existing Result<undefined> interface to the operation parent. No UI changes.

After review, cover provider/command rejection, new and already-created accounts, missing/archived/foreign account destinations, duplicate provider links, destination conflicts, authorization loss, cancellation at query/ID/write boundaries, and per-link unlink traversal. Mapping directly invokes the shared write machine; creation invokes it after value validation and account-ID generation. No wrapper-only mapping machine is introduced.

## Transaction-processing children

The import parent loads and validates mappings/categories, then invokes one account-import child per provider account. Account children classify unmapped accounts, ambiguous mappings, and missing local accounts before traversing transactions. Individual transaction children parse provider data, reject pending/unsupported/currency-mismatched/invalid-amount/invalid-date/invalid-domain records through explicit omission outcomes, select income/expense and system category, generate deterministic IDs, authorize duplicate lookup, classify existing records, reauthorize writes, and persist. Missing categories remain failures. Counts aggregate from typed child outcomes and continue to publish IMPORT_PROGRESS. Preserve cancellation through invoked actor lifetimes and retain the existing operation-facing output.

Track finished-account counts and active-account progress separately so progress forwarding, successful child completion, and unexpected child failure do not lose or double-count work. After implementation review, cover each omission reason, missing categories/mappings/accounts, duplicate transactions, authorization loss, deterministic repeat imports, cancellation, multi-account progress, and failure after earlier successful writes.

## Observable bank availability

Invoke a persistent availability child from the bank root. Parallel access and credential regions classify session/membership scope/role and credential presence/version through guarded transitions. A controls region exposes sync visibility only when access and credentials are ready, hiding it throughout setup via explicit setup-start/end events. Keep the root environment observation interface for scope/credential invalidation, fed from child snapshots. Evaluate the same pure availability statechart with getInitialSnapshot for fresh security observations, avoiding stale cached permissions without duplicated conditional logic. Retain scoped data projection and saved-result formatting as a separate remaining review cycle.

The root retains the observed child snapshot for its pure command guards; this avoids duplicating capability conditions or reconstructing phases. The selector reads the child show-sync tag. After implementation review, cover each missing credential field/version, user/organization/role changes, credential replacement, setup visibility, visibility while operations are busy, and parity between live child observations and fresh security observations.

## Provider-account mapping presentation

The bank root owns a child actor for each discovered provider account. Each child classifies linked, broken, or unmapped status and traverses scoped local accounts to decide destination eligibility and whether an alternative destination exists. Presentation receives a typed mapping descriptor and eligible destinations, and only translates/renders them. Refresh these pure child actors when observed accounts/mappings or discovery results change; stop previous children so actors cannot retain another workspace data. Preserve the current UI and authoritative write-time validation.

After review, cover linked/broken/unmapped descriptors, account removal/archive, other-provider destination exclusions, current-destination handling, empty/sole-current/alternative destination lists, refreshed discovery, and actor cleanup on disconnect/reset/workspace changes.

## Canonical operation outcomes

Classify successful syncs with guarded transitions after final authorization: omitted transactions or provider errors select partial success; otherwise select complete success. Separate recording states pass literal typed persistence descriptors to one write actor. Terminal complete/partial/failed/cancelled states build discriminated outputs. Remove providerErrorCount and partial booleans computed independently in actor output/persistence. The root routes typed outcomes rather than decoding cancellation from an error string. Preserve discovery/mapping/disconnect success without writing sync history and preserve failure-recording authorization/cleanup.

Discovery provider errors are classified by a guard before summary projection; no promise actor hides that decision. After review, cover complete/partial persistence-output parity, provider-error-only partial syncs, omitted records, persistence failure, failed-outcome authorization loss, cancellation, discovery errors, and non-sync operations leaving sync history untouched.

## Setup baseline and persistence decisions

Replace the baseline promise with a child machine that loads the current connection, then separately checks ciphertext and status against the initiating baseline. Reuse it before every setup operation. A separate persistence child chooses insert/update with a guard and invokes focused write actors. Remove Flow.stage: keep the baseline/trace separate from a structurally discriminated resource payload (passkey, sample, sealer, or envelope), and pass the exact resource required by each effect. These payload shapes represent data, while the setup machine remains the sole lifecycle owner. Preserve scope authorization, lock boundaries, error mapping, explicit actions, and cleanup.

After review, cover ciphertext-only/status-only baseline changes at every setup boundary, insert/update selection, persistence failures, token clearing after claim, resource replacement after encrypt/verify/seal, cancellation, and terminal cleanup. Existing setup locks and authorization checks remain in place.

## Saved sync history

Invoke a persistent history child alongside availability. It receives the scoped selected connection, checks connection/time presence, and selects succeeded/partial/failed or absent through guards. State entry builds the localized outcome descriptor and count defaults; absent clears the summary. bankData only projects scoped accounts/mappings. The root observes the history child and forwards selected connection updates from availability without starting provider operations. Initialize root observations from one raw source read to avoid inconsistent initial scope snapshots.

After review, cover missing connection/time/outcome, each saved outcome, null count defaults, observed result changes, preservation during a new operation, and clearing on workspace/user changes. History observation must never cause provider requests.

## Coordinated lifecycle fixes

Move application readiness ownership to the root layout before Jazz opens. Invoke session startup/observation there; attach a workspace-readiness child when SDK queries can bind to a database. That child owns workspace creation, organization selection, membership readiness, and bank lifecycle. Components forward raw SDK/query observations and selection callbacks without previous-user flags or organization fallback decisions.

Use explicit application/workspace/bank shutdown transitions. A component detach requests shutdown of its own workspace actor; the parent waits for the bank to cancel active children and finish cleanup before releasing the workspace. The root actor is manually owned to avoid framework auto-stop preceding cancellation. Queue replacement attachment while an old workspace shuts down. Add typed setup terminal results and prioritize shutting-down/resetting/cancelling branches on child completion and errors. Availability controls own restricted/setup/connected/active-setup presentation tags; the component renders these tags without combining credential/workflow flags. This coordinated change intentionally spans layout, integration, machines, and context types to address all five approved review findings together.

After review, add focused coverage for teardown while holding a sealer or unlocked credential; terminal payload cleanup before parent completion; startup/retry/session replacement; workspace bootstrap and personal/first/no-organization selection; queued replacement attachments; stale detach notifications; visibility across access/setup/credential changes; typed setup outcomes; and unexpected child errors during reset, cancellation, and shutdown. Browser integration coverage must verify parent/child subscription rendering and SDK fallback transitions. Existing workspace-bootstrap helper tests remain unchanged until the approved test migration.

Pass the existing WorkspaceBootstrap browserOffline observation to the bank integration and presentation. Apply offline setup rendering and Sync now disabling in presentation, with localized explanatory text and accessible descriptions in both the bank view and sidebar. Keep browser connectivity distinct from Jazz delivery status.
