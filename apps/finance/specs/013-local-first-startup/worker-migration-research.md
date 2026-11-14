# Finance application-worker code research

Research date: 2026-11-13. Baseline: monorepo `main`
`eb0f615f5e9aad794d006afc018c68ddb640fcc1` (PR #20).
GitHub's branch API and local `origin/main` agreed on this SHA. Shell fetch
failed because DNS was unavailable; the exact verified commit was already local.
Research uses a separate worktree on `research/finance-worker-foundations`.

Status: source research and proposed task breakdown, not implementation or
runtime qualification. No dependencies were installed, tests/builds run, user
servers/storage accessed, or production changes made. The Finance feature
selector remains unchanged. Earlier import completion and worker deferral remain
historical records; this request authorizes renewed research/planning.

Read with the [ownership specification](xstate-v6-migration.md),
[salvage review](../../../../specs/002-monorepo-agent-guidance/finance-worker-pr67-review.md),
and [ordered tasks](worker-migration-tasks.md). The source PR was checked through
GitHub: #67 remains open/draft at the same reviewed head, `8ac042576360d82a21c64a643eab97f09e4bdf7c`.

The follow-up [Local First/Clipper reuse review](worker-foundation-reuse.md)
identifies existing library APIs to consume and four concrete native foundations
to extract from Clipper into Local First. Shared extraction and Clipper adoption
precede Finance integration; domain policies remain app-owned.

## Subsequent storage decision (2026-11-13)

The user selected a custom IndexedDB AccountStore in Local First, accessed by
the worker. The [W03 design](worker-native-custody-design.md) and current backlog
supersede this source review's assumption that permanent Window account storage
requires a new native lease service. The split-lifetime finding below explains
the old design's risk; direct IDB transactions remove that steady-state boundary.
The user explicitly excluded legacy identity migration, source cleanup,
fallback/dual writes and old-version/rollback compatibility code.
R1 and broker/generation extraction remain applicable; permanent storage RPC and
remote-lock custody are no longer required extractions.

## Findings that determine dependency order

### 1. Current startup and domain ownership are still in Window

[`+layout.svelte`](../../src/routes/+layout.svelte) creates the application
readiness root and renders `JazzSessionProvider`. It obtains a retained startup
owner from [`runtime/jazz-session.ts`](../../src/lib/runtime/jazz-session.ts).
The shared [`Jazz startup registry`](../../../../packages/local-first/src/lib/backend/jazz/startup.ts)
retains the session-acquisition owner across layout attachments.

Moving `createActor` alone is insufficient: the session acquisition, restoration,
readiness dependencies and their consumers must acquire worker-compatible
bindings. Preserve the retained-owner lifetime and distinguish layout detach
from runtime shutdown. Do not use a second Window session to satisfy old routes.

### 2. Storage foundations exist but are not connected to startup

Finance has a bounded/validated
[`host protocol`](../../src/lib/runtime/worker/host-protocol.ts),
[`host client`](../../src/lib/runtime/worker/host-client.ts),
[`Window primitive host`](../../src/lib/runtime/worker/window-host.ts), and
[`independent close channel`](../../src/lib/runtime/worker/host-drain.ts).
[`bindWorkerAccountStorage`](../../src/lib/runtime/worker/account-store-storage.ts)
binds those capabilities; [`createWorkerAccountStore`](../../src/lib/runtime/worker/account-store-facade.ts)
adapts an already-owned account-store actor to the SDK. Production-source searches
find definitions and internal foundation references, but no application startup
that activates this tree.

Retain the existing namespace and legacy-selection behavior. The host validates
fixed storage/broker capabilities and FIFO request sequences; it is not a domain
runtime. Its messages are not an application intent/projection protocol.

### 3. Native lock custody is the first safety prerequisite

[`account-store-operation.ts`](../../src/lib/machines/runtime/account-store-operation.ts)
invokes [`account-store-lock.ts`](../../src/lib/machines/runtime/account-store-lock.ts)
with a supplied native lock manager. Unknown writes enter drain/retained states
before release. [`account-store-legacy.ts`](../../src/lib/machines/runtime/account-store-legacy.ts)
also owns a native lock for earlier-key cleanup.

These charts support cooperative draining. They do not, by themselves, prove
safety after abrupt termination of their realm. If locks are acquired in the
worker while writes execute later in Window, worker death can release the lock
before a queued storage message executes. The current Window host has no
per-acquisition native lease identity attached to write admission.

Resolve that split explicitly before activating the AccountStore: native custody
must outlive every possible host write, including after worker loss. PR #67's
Window lease design is a candidate to evaluate, not an assumed clean cherry-pick.
Cover primary and earlier keys, lock ordering, cancellation during acquisition,
old-lease writes after reacquisition, and a competing tab. This is a future
activation requirement, not a newly demonstrated bug in current production.

### 4. Reuse shared lifecycle contracts; do not duplicate the foundation

Local First already exports worker
[`request`](../../../../packages/local-first/src/lib/contracts/worker-request.ts),
[`channel`](../../../../packages/local-first/src/lib/contracts/worker-channel.ts), and
[`effect-drain`](../../../../packages/local-first/src/lib/contracts/worker-effect-drain.ts)
contracts and their machines. They distinguish unissued from uncertain effects,
bound pending requests, and require an independent native close receipt.

Finance's inactive client still implements pending requests/timeouts itself.
Reconcile it with these contracts before adding another lifecycle layer. Promote
only demonstrated reusable gaps to Local First; Finance owns its schema,
authorization, account selection and financial operations.

### 5. The Jazz worker-host mechanism is already in the workspace

[`pnpm-workspace.yaml`](../../../../pnpm-workspace.yaml) applies the shared
[`Jazz alpha.60 patch`](../../../../patches/jazz-tools@2.0.0-alpha.60.patch).
It includes worker runtime detection, `browserWorkerHost`, broker opening,
generation handling and related recovery changes. Older spec references to
copying separate vendored artifacts are historical.

Do not plan a new patch as a prerequisite. Prove the exact current build works
through Finance's storage/session namespace and worker entry. A matching account
ID/database name does not establish use of the same persistent replica. Clipper
is a reference, not Finance acceptance evidence.

### 6. The shared data helper is a Svelte integration, not a worker adapter

[`backend/jazz/data.svelte.ts`](../../../../packages/local-first/src/lib/backend/jazz/data.svelte.ts)
imports native `QuerySubscription` classes from `jazz-tools/svelte` and creates
subscriptions in the owning component. Finance's accounts, transactions and
workspace integrations use it directly.

Worker-owned subscriptions need non-Svelte SDK bindings with explicit ownership,
failure and disposal. Keep queries and permission decisions worker-local; expose
bounded domain views rather than forwarding arbitrary database queries from UI.
Prove a real production bundle early so Svelte/provider imports cannot silently
enter the worker graph, as happened in PR #67.

### 7. Current UI contexts cannot cross realms

[`runtime/workspace.ts`](../../src/lib/runtime/workspace.ts) and
[`runtime/bank-sync.ts`](../../src/lib/runtime/bank-sync.ts) expose live actor
references/snapshots. [`BankSyncIntegration.svelte`](../../src/lib/components/banks/BankSyncIntegration.svelte)
follows child references and subscribes to them. Workspace attachment dependencies
include functions, a database handle, and navigation callbacks.

Keep those actor/resource relationships inside their owner realm. Define a
Window connection exposing serializable views and validated commands, with
runtime/attachment generation and scope identities. Internal object-identity
leases may remain internal; do not attempt to structured-clone them into an
equivalent cross-realm authority. UI-supplied IDs never establish authorization.

### 8. Forms need a transport and feedback boundary before feature migration

The shared [`form controller`](../../../../packages/local-first/src/lib/integrations/forms/controller.svelte.ts)
both extracts DOM `FormData` and creates/subscribes/shuts down the scoped domain
form actor. Finance's [`wrapper`](../../src/lib/forms/forms.svelte.ts) delegates
to it. Account creation and transaction entry supply database bindings,
observation functions, write functions and navigation callbacks.

The shared [`ScopedFormView`](../../../../packages/local-first/src/lib/contracts/scoped-form.ts)
can contain `feedbackLabels`, whose entries contain functions; it is not a wire
DTO. The shared machine selects those labels, and Finance injects Paraglide
functions through [`form-dependencies.ts`](../../src/lib/forms/form-dependencies.ts).

Retain the existing domain workflow, but separate DOM collection/presentation
from worker-owned validation, capability decisions and submission. Define a
cloneable projected form view and machine-selected message descriptors, rendered
with Finance's existing locale-reactive wording. Do not copy Clipper's worker-
rendered localization convention into Finance or move policy into presentation.
Qualify any shared API adjustment against existing consumers.

### 9. Shell data and balances should move before page-by-page features

[`WorkspaceBootstrap.svelte`](../../src/lib/components/workspaces/WorkspaceBootstrap.svelte)
owns organization/account/transaction-summary queries, computes balances using
[`calculateAccountBalances`](../../src/lib/domain/account-balances.ts), binds
workspace readiness and bank observations, and combines account-order preference
storage with interaction state. Many pages consume the contexts it provides.

Split this integration by responsibility. The worker owns data, access, balance
aggregation and domain observations. Window retains shell interaction, route
observation and a narrow preference-storage primitive where needed. Preserve
account-order edit/done/move behavior and exact bigint money semantics. Avoid
sending every transaction to Window merely to calculate a displayed total.

### 10. Files, provider credentials and native UI require selected adapters

[`BackupSubmission`](../../src/lib/backup/submission.ts) and restore requests in
[`workspace-restore.ts`](../../src/lib/machines/workspaces/workspace-restore.ts)
use realm-local `WeakMap` entries and method-bearing handles to keep passwords
out of actor snapshots. Posting these objects cannot carry their authority or
hidden payload. Transfer/clone bounded input through a private scoped submission
channel and recreate one-use handles inside the worker. Define cleanup for
cancellation, rejection, late arrival and worker loss. Never log secret payloads.

[`passkey.ts`](../../src/lib/integrations/passkey.ts) combines
`navigator.credentials` calls with crypto operations. Keep WebAuthn/user gestures
in Window, and explicitly design the lifetime and correlation of sensitive
results; a move must preserve PRF preflight and per-operation verification.

[`simplefin-worker.ts`](../../src/lib/integrations/simplefin-worker.ts) already
uses a disposable worker and disposes it on terminal paths, but constructs its
endpoint using `window.location.origin`. Its worker entry trusts a TypeScript
message annotation rather than decoding input. Preserve the disposable request
boundary initially; provide a host-bound endpoint and validate request admission
before creating its actor.

Image editing and photo cropping use DOM canvas; image processing uses Pica and
`createImageBitmap`. Qualify worker-compatible processing separately rather than
assuming every canvas or dependency can move. Native canvas display/picking stays
with UI; pixel transformations, encoding and hashing belong off-thread wherever
supported, behind explicit capability boundaries.

### 11. Packaging and diagnostics have useful foundations to extend

[`worker-assets-manifest.ts`](../../tooling/worker-assets-manifest.ts) already
adds emitted worker assets to the build manifest. The
[`service worker`](../../src/service-worker/index.ts) precaches public assets and
keeps data/auth outside runtime caching. Extend and qualify the actual application
worker's nested JS/Wasm chain, cold offline launch and user-approved update flow.

[`inspection-projection.ts`](../../src/lib/diagnostics/inspection-projection.ts)
already strips context/input/output/errors and projects sanitized actor topology.
Keep projection at the worker boundary and bridge only bounded sanitized events
to the Window-owned inspector surface. Do not send raw inspection events.

The Finance workflow currently filters push events to `master` while the verified
research branch is `main`; reconcile the intended default-branch CI trigger as
part of baseline qualification. This source observation does not establish that
PR checks are missing or that any particular hosted run failed.

## Planning consequences

The earlier high-level sequence remains useful, with three changes:

1. Build a worker-safe import/packaging proof early, alongside custody design;
   a full session proof depends on custody and actual SDK wiring.
2. Make query ownership, actor/context projection, form transport and feedback
   descriptors explicit foundation tasks before migrating feature integrations.
3. Move shared shell observations and balance calculation before ordinary page
   migration; prototype private submission/native adapters early enough to avoid
   redesigning transport after forms have moved.

No performance improvement, browser support, crash safety or production parity
is established by this review. Each requires the acceptance evidence in the task
checklist. Do not infer deployability from previous unit counts or source review.
