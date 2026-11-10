# Start another Jazz-backed app

The Finance extraction exposes workflows rather than Finance's models. Use native app schemas and
permission rules in one app integration layer. The root package stays empty; import the relevant
subpaths. Use the pinned Jazz, XState, Svelte and DUI versions listed in package.json.

## Identity and application lifetime

Create one `createJazzStartupRegistry()` from `backend/jazz/startup` per browser application lifetime.
Call its `getJazzStartupBinding(config)` with your app's Jazz configuration (`initial: 'local-first'`),
then attach that owner through `createSessionStartupMachine` from `session/workflow`. Retain the
registry across layout remounts; attachments get distinct scope tokens. A changed environment needs
coordinated shutdown. Do not create a second session cache or await remote authentication first.
The host checks its browser/SSR boundary before asking the registry for a binding.

Recovery uses `recovery/svelte` or the lower-level `recovery/workflow`; explicit identity restoration
uses `restoration/workflow` and `backend/jazz/restoration`. `recovery/coordination` adds the existing
validate → request host drain → restore → check navigation facts → navigate sequence. Its host sends
`WORKSPACE_DRAINED` after its own resources settle. Navigation remains a supplied capability.

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

`workspace/startup` coordinates that initialization actor and an optional app seed actor. Supply
`ready(result)` and error constructors. Foreground readiness is reported before optional seeding;
identity replacement and shutdown drain children. A no-op seed actor is appropriate when the app
has no sample-data policy.

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
validator's field issues and `messages` callbacks to translate feedback at render time. Complex
writes supply a persistence actor instead of a promise containing a hidden workflow.

`forms/svelte` attaches one controller with `observe`, the exact binding/policy options, dependencies
and optional diagnostics. `forms/lifecycle` drains before stopping. The presentation exports are
`forms/content`, `forms/feedback-view` and `forms/modal`. They accept typed views/callbacks/snippets,
with caller-owned labels. Import DUI's base CSS/theme at the application boundary; the foundation
does not impose a global theme.

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
