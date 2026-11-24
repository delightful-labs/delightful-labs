# Start another Jazz-backed app

The Finance extraction exposes workflows rather than Finance's models. Use native app schemas and
permission rules in one app integration layer. The root package stays empty; import the relevant
subpaths. Use the pinned Jazz, XState, Svelte and DUI versions listed in package.json.

## Optional AT Protocol authentication

Keep browser/worker and server imports separate:

- `auth/atproto/workflow`: `createAtprotoWorkflow` owns authorization attempts,
  optional pre-authorization confirmation, cancellation and callback confirmation.
  Supply localized messages or typed descriptors. The host owns identity-scoped
  admission and must drain/close native resources before executing a redirect.
  `clearAtprotoAppSession` is one HTTP leaf for an owning identity workflow; it
  does not itself drain or mutate the Jazz session.
- `auth/atproto/server`: `createAuthRequestHandler` owns each HTTP request actor
  and completion receipt lifecycle. Configure an app-specific receipt cookie name
  and callback route. This is a Node/server entry and imports cryptography.
- `backend/jazz/auth`: `createAtprotoAuthServer` composes the pinned Better Auth,
  AT Protocol plugin and native Jazz adapter over the app's existing backend.
  `createJazzAuthHandlers` supplies native authentication/refresh hooks with
  device-account fallback. Apps supply lazy auth/backend acquisition and retain
  hosting, storage, audiences and environment ownership.
- `backend/jazz/auth-schema`: compose `tables` and `authPermissions` with native
  app definitions. All six authentication tables deny client CRUD. Generate and
  review native migrations; do not reset an existing store to adopt auth.

The server factory requires `{ origin, secret }` and a policy with `clientName`.
Use `cookiePrefix` to isolate app auth cookies on shared development hosts. Receipt
cookie names are configured separately. The default allowed and requested grant
is exactly `atproto`; publication permissions require explicit server policy.
Browser-requested scopes cannot expand the server's allowed grants. AT Protocol
identity reuse does not establish cross-app sessions or data access.

Better Auth and the provider plugin are optional peers. Declare the pinned versions
in consumers using the server entry; consumers of other DLF entries need not
install server auth. Do not import server entries from browser/worker graphs.

For recovery while an external app session is active, the restoration capability
accepts optional `clearProviderSession`. This must be a single I/O leaf. The
restoration chart validates the phrase and waits for host preparation before
invoking clearance, waits for its settlement through cancellation/shutdown, and
only then invokes native restoration. A clearance failure reports a failed restore
with native `mutation: 'notStarted'`. Apps decide from admitted identity facts when
clearance is required; normal guest recovery need not acquire a network dependency.

## Identity and application lifetime

Create one `createJazzStartupRegistry()` from `backend/jazz/startup` per browser application lifetime.
Call its `getJazzStartupBinding(config)` with your app's Jazz configuration (`initial: 'local-first'`),
then attach that owner through `createSessionStartupMachine` from `session/workflow`. Retain the
registry across layout remounts; attachments get distinct scope tokens. A changed environment needs
coordinated shutdown. Do not create a second session cache or await remote authentication first.
The host checks its browser/SSR boundary before asking the registry for a binding.

The coordinated worker upgrade adds `session/runtime`: an SDK-neutral actor for
acquisition, observation and graceful close, composed with the existing acquisition
chart. Native SDK references stay inside adapter closures; consumers receive bounded
observations and send commands. Its alpha.65 Jazz adapter is currently isolated in
Finance's [upgrade proof](../../../apps/finance/tests/worker-upgrade/README.md).
Identity/recovery commands and both apps' adoption remain open, so the active
alpha.60 integration above remains the current application path. Do not persist
runtime snapshots or treat actor stop as native close acknowledgement.

Recovery uses `recovery/svelte` or the lower-level `recovery/workflow`; explicit identity restoration
uses `restoration/workflow` and `backend/jazz/restoration`. `recovery/coordination` adds the existing
validate → request host drain → restore → check navigation facts → navigate sequence. Its host sends
`WORKSPACE_DRAINED` after its own resources settle. Navigation remains a supplied capability.

The coordinator's `session` input also accepts the library's `SessionRuntimeConnection`. Worker
hosts pass that connection directly; they do not recreate a Jazz `getSnapshot().account` facade.
Its navigation-facts leaf reads the current typed identity and requires an active runtime before
navigation. Existing SDK-shaped session callers remain supported. Navigation-only retry does not
repeat restoration. Keep phrase-bearing coordinator actors private and retain them through issued
native navigation; Window supplies only the native navigation effect. A private coordinator root
sets `reportTo` to its host actor; an invoked coordinator keeps using its parent by default.
The recipient receives the existing `RECOVERY_VALIDATED` / `RECOVERY_DRAIN_REQUESTED` notices
and sends `WORKSPACE_DRAINED` only after its own resources have settled.

## Foreground data

```ts
import { createQuerySubscription } from 'delightful-local-first/backend/jazz/data'
import { observeRows } from 'delightful-local-first/data/observations'

// In the component that owns the subscription and actor binding:
const notes = createQuerySubscription(() => app.notes.where({ workspaceId }))
// Inside its reactive observation, before the untracked actor.send:
const rows = observeRows(notes.current)
```

Use `createQuerySubscriptionOne()` for a single row. Both factories return the native SDK instance;
create it inside the owning component. They replace the former DLF subscription subclass exports.

`app` and `workspaceId` above belong to your app. Subscriptions use LocalFirst unless a caller
explicitly supplies a tier; native Svelte subscription disposal remains attached to the component.
Keep loading, error and available-empty distinct. `DataObservation<Row>` is the SDK-independent
revisioned snapshot contract. Copy changing row fields while building facts, preserving opaque
binding identities. A shallow row snapshot deliberately does not clone resource handles.

Worker-owned subscriptions can use `createBoundObservationLogic` from
`data/observation-workflow`. This is Finance's production observation lifetime,
also used by Clipper's library collection. Supply the native subscription leaf
and pure typed value/failure report projections. The actor admits callbacks while
invoked, withdraws callback admission before disposal, and releases the returned
subscription once. Startup subscription errors become the supplied failure report;
they never become available-empty data. An optional `disposalFailed` callback
preserves the host's existing cleanup-failure boundary; without it, disposal errors
are rethrown. Keep binding/generation in the reports and reject stale reports in
their owning chart. This adapter does not grant workspace access or acknowledge
domain-operation drain.

Hosts that certify native closure supply `disposalFailed` to the owner that will
consume the resource group's completion. Finance and Clipper both use this
explicit host-failure boundary: callback teardown can occur while its child is
stopping, so throwing from that callback alone does not certify failed host
closure. Keep the failure signal ahead of the group's completion and refuse
clean release or replacement when it has been observed.

Use `issueLocalWrite` and `persistLocal` from the named Jazz boundary where a statechart separates
issuing a write from observing local durability. A single-write leaf may use its native receipt
with a local wait. Never claim remote acceptance from that wait. Multi-step read/check/write or
transaction operations require their own resource-owning child machine; these helpers do not
supply authorization or make a sequence atomic. Do not automatically replay uncertain writes.

## Initialization, creation and selection

`workspace/initialization` accepts local/authority tier values and three app capabilities:
`discover`, `prepareInitial`, and a transaction actor. Discovery returns profiles with durable
initial-workspace provenance, accessible workspace records and whether authority is configured.
Preparation creates your app's immutable initial bundle. Transaction inputs/outputs are typed; the
actor must own acquisition, checks, staging, commit, settlement and rollback. Local provenance
finishes immediately. An empty cache alone cannot authorize bootstrap. Explicit authority discovery
remains necessary only for the existing provenance/bootstrap decision.

For a schema-enforced private root whose ID is the native identity, discovery may instead
return `canonicalRoot: { id, status }` without identity/workspace directory facts. Status
is `compatible`, `missing` or `incompatible`, based on the app's native root checks. The
initializer rejects empty/mismatched IDs, mixed directory evidence, incompatible roots and
prepared targets outside that same canonical ID. A missing canonical root may ensure only
that root locally; this mode does not authorize creating an arbitrary replacement workspace.
Apps using directory/provenance discovery retain the conservative authority behavior.
Qualify actual storage convergence before claiming the canonical mode is safe for an app.

A ready result includes `persistence` only when bootstrap issued a successful write. Keep
its native receipt for app-specific remote-status observation; an existing-root result has
no new receipt. Shutdown/cancellation during bootstrap retains the invocation until settlement
and cannot publish ready afterward, even if a noncancelable write leaf finishes successfully.
When the initializer maps that successful completion to closed/cancelled, it retains the
persistence receipt; a child's own interruption result is preserved verbatim. A concrete
bootstrap actor with a larger event protocol can supply its full event type as the factory's
last generic parameter; do not narrow its actor logic through a cast or an app supervisor.

`createWorkspaceStartupOwner` from `workspace/startup` owns initialization for one native
session binding. Supply the existing initializer and a pure provenance projection; actor input
captures the binding, initializer input and recipient. It publishes one
`WORKSPACE_INITIALIZATION_RESULT` with the original result and neutral `identityId` /
`initialWorkspaceId` provenance. The report can contain an unavailable or failed result;
receiving it is not workspace access or readiness. Provenance does not select a workspace.
Send `SHUTDOWN` and await its terminal `closed` or `unresolved` receipt before releasing the
binding. Pending initialization is drained without publishing an ordinary completion report
after shutdown. An earlier reported result does not acknowledge shutdown, and unresolved
settlement remains unresolved even when the result arrived before shutdown.

For worker integrations that coordinate initialization separately, use `createWorkspaceSeedOwner`
from that same subpath. Supply the app seed actor and a pure `input(scope, workspaceId)` mapper.
Send `INITIALIZED` once provenance resolves; the owner invokes at most one seed and ignores
duplicate initialization. `SHUTDOWN` waits for the child's settlement and returns `closed` or
`unresolved`; it does not create a seed if shutdown precedes initialization. Keep schema writes,
feature flags and seed policy in the app actor. This owner is independent of foreground readiness.
Omit it when an app has no seed work; new integrations do not need a dummy seed actor.

For explicit additional creation, compose:

1. `workspace/journal`: choose an app-specific IndexedDB database name and payload parser. The
   record contains `key` and immutable `attempt`; use the same DB name/version on upgrades.
2. `workspace/creation-operation`: provide pure name validation/bundle preparation, the journal,
   an app reconciliation actor, and the persistence actor. Reconciliation checks your schema's
   complete expected bundle; native financial category checks are not part of the library.
3. `workspace/creation-persistence`: validates the attempt, reconciles locally, then invokes your
   atomic transaction actor. `workspace/creation/workflow` supplies reusable transaction ownership.
4. `workspace/creation-owner`: owns binding replacement, explicit retry/new commands and draining.
   Project the app's attempt into `WorkspaceCreationDialog` from `workspace`.

`workspace/workflow` supplies selection and resource-release ownership; compose your selected
resource actors underneath it. Routes and workspace URLs stay app-owned. Naming uses
`workspace/naming/workflow` with your own write capability. See the existing domain-free public
consumers under `fixtures/package-consumer/` for transaction, selection, naming and form examples.

## Scoped forms and profile composition

Use `forms/contracts`, `forms/readiness`, `forms/write`, `forms/submission` and `forms/workflow`
individually or compose a single-write operation through `forms/policy`. Schema validation only
requires `parseAsync`; it does not require Zod. Supply `validationIssues(error)` to normalize your
validator's field issues. Supply `defaultMessages` to the feedback/profile presentation,
not the workflow. The machine selects plain `feedbackDescriptors`; `forms/feedback` formats
those descriptors with the current locale and caller-owned messages. Complex
writes supply a persistence actor instead of a promise containing a hidden workflow.

`forms/svelte` attaches one controller with `observe`, the exact binding/policy options, dependencies
and optional diagnostics. `forms/lifecycle` drains before stopping. The presentation exports are
`forms/content`, `forms/feedback-view` and `forms/modal`. They accept typed views/callbacks/snippets,
with caller-owned labels. Import DUI's base CSS/theme at the application boundary; the foundation
does not impose a global theme.

For a Worker, `forms/worker` exports `createWorkerFormViewSchema(resultSchema, reasonSchema)`
to validate and project the public form view with native Zod. Consumer schemas own result/reason
shapes; opaque recovery checkpoints remain with the workflow and are removed from wire results.
Do not serialize SDK objects, functions or complete snapshots. `selectScopedFormObservation`
echoes the admitted observation at an explicit parent/report boundary, so a parent can reject
retired child views without inspecting private workflow state. Keep DOM/FormData extraction and
translation on Window, and validation, policy, submission and settlement in the worker actor.

`profile/workflow` assembles name/avatar forms with your schemas, local save adapters and image
processing actor. `profile/avatar` owns processing → validation → write → cleanup and interruption;
image resizing/cropping is a host/DUI platform capability. `profile/name-view`, `profile/avatar-form`
and `profile/avatar-view` provide presentation with caller-owned labels. Supply the cropper snippet
and file validator to the avatar form. No Finance modules, messages, image processor or schema are
required by these APIs.

## Scoped diagnostics

`diagnostics/logger` provides the scoped logger extracted from Finance:

```ts
import { createLogger } from 'delightful-local-first/diagnostics/logger'

const logger = createLogger('workspace', { enabled: debugEnabled })
logger.info('Selection changed', { generation: 2 })
```

The host supplies `debugEnabled` from its own configuration. Logging defaults to disabled, including
errors; no development-mode or process-global flag is read by the library. Each logger captures its
own enablement and optional `sink` with info/warn/error methods, supporting browser and server hosts.
Messages retain Finance's `[scope] message` prefix and structured details object. Importing the module
and creating a disabled logger produce no output. There is no log queue, store, remote exporter or
Jazz transport. This utility does not configure or duplicate Jazz runtime telemetry.

Callers select non-sensitive diagnostics. Never pass records, credentials, provider payloads,
unfiltered URLs or raw errors/messages/stacks. `DebugValue` restricts the TypeScript shape; it neither
redacts strings nor makes caller data safe. Sensitive actors must continue to exclude inspection.
Finance's existing machine sanitizer, inspector and environment defaults are separate integrations.

## Qualification before shipping

Test app-specific permissions and atomicity against the real backend. Confirm cold local reads and
locally acknowledged saves after closing every page/worker and reopening offline and with an
unanswered remote connection. Existing local records must remain usable while provenance, optional
seeding, reconciliation and remote freshness are unresolved. This milestone does not promise that
all records are downloaded, provide background acquisition, or add invitations/member management.

## Cleanup API changes

The extracted creation/initialization APIs now take host projections instead of Finance record
shapes, and single-write/profile form factories require explicit persistence guarantees. See
[the source migration guide](../specs/001-local-first-foundation/cleanup-review.md#compatibility-and-consumer-migration)
before updating a pinned consumer. `forms/zod` optionally supplies `zodFormIssues` to the existing
`validationIssues` callback; core form contracts remain validator-neutral.

## XState v6 implementation candidate

The library now pins the published, unpatched `xstate@6.0.0-beta.1` package.
Consumers do not need an XState patch. See
[implementation and qualification notes](../specs/003-verified-backup/xstate-v6-implementation.md).

Adopt a rebuilt artifact across complete connected actor graphs. Consumer fixtures
and native/browser behavior have not yet been qualified on v6. The vendored DUI
archive still needs alignment with the reviewed v6 DUI build before app rollout.

## Domain transaction composition

`transactions/workflow` composes a consumer's typed domain chart with the existing
DLF atomic transaction owner. Use `transactions/contracts` for generic attempt,
resource, child-spawn and receipt contracts. See [domain transaction composition](domain-transaction.md)
for the preparation/staging protocol, cancellation custody and extraction review
gate. The existing workspace-creation API remains available.

## Owned operation lifecycle

`lifecycle/operation/workflow` supplies a state-owned supervisor for concrete
capability-spawned children. `lifecycle/operation/contracts` preserves typed
input, output and supported child commands. See [owned operation lifecycle](owned-operation.md)
for distinct interruption/drain paths, native custody boundaries and the
consumer migration map and library qualification results. Qualify each consumer
against its actual compatible artifact before adoption.

## Scoped worker requests

`worker/request/workflow` and `worker/request/contracts` define one correlated
native request with a finite deadline and explicit unknown-effect outcomes.
See [scoped worker request lifecycle](worker-request.md) for the pinned consumer
comparison and required independent host-close handshake. This source review
unit has not been behaviorally qualified or adopted by a consumer.

The [bounded worker channel](worker-channel.md) composes those request actors under
one scoped owner. Import `createWorkerChannel` from `worker/channel/workflow` and
its contracts from `worker/channel/contracts`. Inject separately owned data and
control listeners; timeout never substitutes for the real host-close receipt.

The [worker effect drain](worker-effect-drain.md) observes the original effect's
quiescence receipt and the exact host-close receipt. Import its factory and types
from `worker/effect-drain/workflow` and `worker/effect-drain/contracts`. The parent
retains its lock and original unknown outcome until this chart returns proof.

## Finite native browser jobs

Import `createBrowserWorkerJob`, `BrowserWorkerJobInput` and
`BrowserWorkerJobResult` from `delightful-local-first/worker/browser-job`. Invoke
this chart from the existing operation owner. Supply the selected Worker factory,
request, reply decoder, optional transfer list and optional abort signal/clock.
Domain validation, permissions, deadlines and result mapping stay with the caller.
Clipper's image/extraction jobs and Finance's image editor/provider fetch use this
same lifecycle. Completed job snapshots clear their admitted input after release;
callers must likewise clear transient credentials from their own context.

The job completes only after removing its handlers and abort listener and returning
from native `Worker.terminate()`. CANCEL uses that same cleanup path. Failed native
cleanup blocks completion; actor stop is not a successful release acknowledgement.
Browsers supply no asynchronous process-exit receipt for these finite workers.
Persistent Jazz/application workers and financial write custody retain their own
real drain/close protocols. Do not start a job actor inside a promise leaf and
await it as an adapter for an old promise API.

## Selected resource ownership

Use [`workspace/resource`](workspace-resources.md) to compose the existing workspace
selector with one concrete app resource group and its actual shutdown receipts.
Keep identity/access observations outside selected content resources. The shared
owner coordinates leases and drain; domain schemas and operations stay in the app.
