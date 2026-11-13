# Svelte/XState observation and lifecycle audit

Date: 2026-11-13. Initial A1–A4 findings for
[the simplification spec](svelte-xstate-simplification.md). This is source
research and a proposed pilot contract, not runtime qualification or approval to
remove a lifecycle boundary.

## Baseline and evidence limits

PR #24 is merged at `670fb720e15b15a4b308408c92301bd29a943561`.
Shell GitHub access fails DNS resolution. A connected GitHub comparison of
`eb0f615f5e9aad794d006afc018c68ddb640fcc1...main` showed no Clipper runtime,
DLF/UI source, dependency or shared engineering-guidance changes. Local runtime
inspection therefore applies to the current main baseline as observed.
The local research branch descends from the equivalent spec commit; it is not a
fresh fetched main checkout. Reconcile Git ancestry before publication.

PR #21's reader/layout changes are not in that main comparison. Current main
still mounts `integrations/Reader.svelte` from the reader route. Review PR #21
again before later reader work; do not mistakenly treat its route as current main.

Installed versions inspected: XState `6.0.0-beta.1`, XState Svelte
`6.0.0-beta.0`, Clipper Svelte `5.57.2`, patched Jazz tools `2.0.0-alpha.60`.
The XState Svelte peer range accepts these XState/Svelte versions. It is a
Finance dependency, not currently a direct Clipper web dependency.

The initial audit changed no product code, dependencies, policies or runtime
tests. The subsequent pilot implementation is recorded below. Previous isolated JavaScript probes covered basic selection and
cleanup only. Assertions below marked source-backed describe source behavior;
actual browser, type-inference and SDK interruption qualification remains pending.

## A1. Installed observation contracts

| Concern | Core `actor.select` | Installed Svelte `useSelector` |
| --- | --- | --- |
| Initial read | `.get()` projects the current snapshot. Subscribe establishes a baseline without replaying it. | Calls the selector at construction and rereads when the first store subscriber attaches. Svelte supplies the current value synchronously. |
| Equality | `Object.is` unless supplied. Comparison happens per selection subscription. | `===` unless supplied. `NaN` and signed zero differ from core semantics; choose comparison deliberately. |
| Subscription sharing | Each subscriber creates an actor subscription. | Svelte readable shares one upstream subscription while it has subscribers; last unsubscribe releases it. |
| Resubscribe | Recomputes baseline from the actor. | Rereads the fixed source after an idle interval; it does not reset the actor. |
| Error/completion | Forwards the observer's error and complete handlers. | Subscribes with a next callback only. Its store has no error or completion notification. |
| Source replacement | Selection closes over the original actor. | Selection closes over the original source; changing a component prop does not retarget it. |
| Lifetime | Observation never starts/stops the actor. | `useSelector` never starts/stops the source and calls no lifecycle hook. `useActorRef` starts immediately and registers `.stop()` in `onDestroy`. |
| SSR | Depends on the supplied actor and caller. | Reading/subscribing runs during SSR if the component does so. No worker is created by `useSelector`, but source getters must be safe. `useActorRef` starts during initialization, including SSR. |

The Svelte binding requires only the structural pair `getSnapshot`/`subscribe`.
Its public declaration infers selected values from the supplied source's actual
return type. This permits a DTO source without pretending the DTO is a machine
snapshot or adding actor control methods. The subsequent real-consumer type check
passes without casts after supporting the observer-object subscribe overload.

Selectors and comparisons must be pure and total over the DTO. The binding
does not turn a thrown selector into application error feedback. Its next-only
subscription would also omit an actual XState actor's error handler. Do not
generalize this worker adapter into a universal actor error-handling solution.

Clipper's `LibraryClient.subscribe` supplies the current view synchronously and
has no error/completion channel. Runtime failure is already delivered separately
to `Application.svelte`, which clears `library` and renders reload feedback.
Preserve that contract rather than inventing terminal DTOs in this refactor.

Source evidence: installed `xstate/docs/{index,agents,selectors,lifecycle-and-errors,
cancellation}.md`, `api-stability.json`, core `select` implementation, installed
`@xstate/svelte/dist/xstate-svelte.js` and `useSelector.d.ts`, and Svelte's
`src/store/shared/index.js`.

## A2. Observation and ownership map

Paths in this table are relative to `apps/clipper/apps`.

| Boundary | Current observation | Owner and replacement contract |
| --- | --- | --- |
| Web layout → `web/src/lib/integrations/Application.svelte` | Native client callbacks publish account, recovery and library views. | Layout owns the application client; component cleanup requests close. A new library scope creates a new `LibraryClient`; failure/unavailability withdraws it. |
| Library page → `Library.svelte` | `onMount` copies complete `LibraryRender` into `$state`. | Page keys Library by `runtime.actor`. Library observes, does not own application teardown. |
| Library → `AddLink.svelte` | Same whole-view subscription; `canAdd` starts false until mount. | Explicit `{#key actor}` remounts the form for client replacement. Submit sends existing ADD intent and clears local draft. |
| Library → `ArticleTags.svelte` | Whole-view subscription plus separate row/tags/enabled props. | Lifetime is within the keyed Library; article key resets form presentation. Parent owns editor selection; worker owns tag mutation outcomes. |
| Reader route → `Reader.svelte` | Whole-view subscription, OPEN/CLOSE_READER and surface attachment. | Nested keys for client and route ID. Cleanup detaches DOM, unsubscribes and closes reader intent; it does not close the app session. |
| `runtime/worker/client.ts` | One port actor observation shared by the LibraryClient observer set. | Application client owns Worker/ports and termination. `getView` and notifications include pending-receipt `canOrganize` suppression. |
| `runtime/worker/serve-application.ts` / `host-machine.ts` | Host snapshots project bounded DTOs; separate sensitive recovery channel. | Worker owns app/account/session, close ordering and SDK resources. Reader revisions suppress retransmission of unchanged content. |
| Extension `App.svelte` | Reuses web Application with settings-worker factory. | Reuses the transport close protocol. Settings itself only renders a library link. |
| Extension `SignIn.svelte` / `account-client.ts` | Connection-view callback through a second port; primary client handles realm closure. | Adapter release closes its port and calls `window.close` only following primary client release. Not a LibraryClient selector consumer. |
| Older `Account.svelte` / `runtime/library-context.ts` | Direct main-thread actor construction and observation. | Search found only the older integration importing this context. No production consumer found in the scoped TS/Svelte search; do a fixture/export search before retirement. |

## A3. Proposed first pilot

Recommend the installed `@xstate/svelte@6.0.0-beta.0` binding, with explicit
approval before adding the direct Clipper dependency. The alternative is a
native `readable` adapter with initial read, source subscription, semantic
comparison and disposer. Both preserve ownership; the published binding already
implements the needed observation machinery and reduces app-maintained code.

Proposed helper in `runtime/worker/view-source.ts` (design sketch, not yet added):

```ts
import type { LibraryClient } from './client.js'
import type { LibraryRender } from './views.js'
import type { Observer } from 'xstate'

export function libraryViewSource(client: LibraryClient) {
  return {
    getSnapshot: () => client.getView(),
    subscribe: (observer: Observer<LibraryRender> | ((view: LibraryRender) => void)) =>
      client.subscribe((view) => {
        if (typeof observer === 'function') observer(view)
        else observer.next?.(view)
      })
  }
}
```

Proposed AddLink consumption:

```ts
const source = libraryViewSource(actor)
const canAdd = useSelector(source, (render) => render.canAdd)
const canOrganize = useSelector(source, (render) => render.view.canOrganize)
const restoreCaptureId = useSelector(source, (render) => render.view.restoreCaptureId)
const captureProblem = useSelector(source, (render) => render.view.captureProblemMessage, sameMessage)
const duplicate = useSelector(source, (render) => render.view.duplicateMessage, sameMessage)
```

`sameMessage` compares both `text` and `variant`, including undefined. Those
are all current `WorkflowMessage` fields. Locale changes that alter text must
notify. Keep the small comparator with the pilot unless another reviewed
consumer demonstrates a shared home; no generic equality library is needed.
Markup reads `$canAdd`, `$captureProblem`, etc. Commands still go to the original
scoped client. No new actor, global store, bus or custom selector engine.

Use existing keyed lifetimes; document the helper's fixed-source requirement.
Do not dynamically combine observation of old client A with commands to new B.
The initial selected canAdd will be the client's real value rather than false
until onMount. This is an intentional first-render correction requiring review.
Keep local draft cleanup with `onDestroy` if it is still needed after removing
the subscription's onMount callback; retain submit reset behavior unchanged.

Only the helper, comparator if separate, AddLink and necessary dependency/lock
entries belong in B1. Do not migrate other components or alter shutdown in this
pilot. Type-check generic inference against the real DTO without casts. Test
initial/resubscribe values, semantic equality, multiple subscribers, complete
unsubscription, account replacement and actual capture/failure behavior after
implementation review and test approval.

Five selected stores imply five DTO callbacks, but the existing client shares
one underlying port-actor observation. They filter UI notifications after worker
messages arrive; they do not reduce worker computation or structured cloning.
Do not claim a performance improvement from reduced source line count.

## A4. Lifecycle audit and dispositions

The following is an initial audit inventory. Unresolved SDK/native guarantees
are work for D1 qualification, not findings that justify deleting code now.

| Boundary/resource | Issued work / source-backed behavior | Standard stop gap and failure case | Disposition |
| --- | --- | --- | --- |
| UI observation | LibraryClient observer/port-actor subscription; unsubscribe removes observer and last observer releases the port observation. | None for merely withdrawing UI observation. Closing the shared resource would stop other consumers. | Simplify with useSelector; keep application lifetime separate. |
| UI transport / Worker | Client callback disposer closes ports, releases broker/storage adapters and calls Worker.terminate. Host emits CLOSED after its closing workflow. | Callback disposal is synchronous; it cannot wait for the worker to finish a write/session close. Immediate stop terminates executing work. | Retain an orderly termination boundary. Audit how many inner receipts it needs separately. |
| Application/library | Host sends SHUTDOWN, observes application closure, then proceeds to SDK/session close. | Stop can cancel child observation before final persistence outcomes arrive. Exact overlap with SDK detach barriers still needs comparison. | Retain pending proof; consolidation candidate, not permission for every child to implement shutdown. |
| SDK acquisition | DLF session-acquisition `open` invokes capability.open without forwarding AbortSignal; backend capability calls createJazzClient(config). RELEASE removes requesters without canceling opening. | Standard async cancellation cannot cancel this chosen leaf's underlying open. A late resource needs a close owner. | Keep a late-acquisition owner. Whether a host-wide registry is needed inside a single-use dedicated worker is unresolved. |
| SDK session close | Installed Jazz `session/state.js` close is idempotent via a shared promise; marks closed, detaches consumers, awaits barrier, busy operation/logout, then awaits old client.shutdown. Registered client releases its SDK lease; observed-client shutdown cleans subscriptions and db. | A callback returning `void session.close()` does not await this promise. Killing the worker prevents completion. SDK already owns parts of ordering that outer layers may duplicate. | Retain awaited close, investigate consolidation. Do not infer local or global durability from close alone; trace native db.shutdown next. |
| Reader surface | Surface host DETACH asks viewport actor for final position while DOM exists; worker bridge receives settled position and later disposal acknowledgments. | Immediate actor stop does not itself measure final DOM position or await subsequent persistence. | Keep final-position capture where required. Separate synchronous listener cleanup from position persistence; test whether every acknowledgment is necessary. |
| Account store / Web Lock | Scoped store owns pending operation callbacks; ledger records issued write receipt; close waits, dispose hands off. Native lock uses a held callback promise. | Aborting a queued lock request differs from releasing an acquired lock. An issued storage-port command may outlive its actor; early release permits overlapping updates. | Retain serialization/receipt evidence. Whether custody and transport-close proofs duplicate SDK barriers remains unresolved. |
| Broker bridge | Broker client tracks transferred ports/native open and scoped close receipt; host cleanup closes data port. | Stopping an observer does not undo a transferred port or settle already-posted native work. | Keep resource cleanup; consolidate request/close layers only with actual transfer/late-result evidence. |
| Transactions / local settlement | Clipper adapter begins transaction, commits to a WriteHandle, waits tier local separately; global receipt has its own wait. DLF transaction leaves record pending promises and do not forward AbortSignal. | Actor stop is not transaction rollback or local write acknowledgment; cancellation cannot erase an issued commit. | Retain one transaction owner through native settlement; do not replace local settlement with actor completion. |
| Detached transaction custody | DLF custodian hands acquisition/pending/commit receipts to a retainer on owner error/disposal. Clipper stores them in a realm-lifetime Set; hasDetachedTransactions remains true after promises settle. Existing test explicitly expects refusal of clean close. | Existing policy blocks close indefinitely rather than proving resolution. The custodian's source rationale cites an XState 5.33.2 child-orphaning issue, not the pinned v6 behavior. | High-priority requalification target. Establish current error/disposer ordering and actual native outstanding work, then decide whether to remove duplicate handoff or replace permanent retention with confirmed release. Neither is yet proven safe. |

Specific source trail (repository-relative):

- Clipper `apps/web/src/lib/runtime/worker/{client,host-machine,serve-application,
  scoped-account-store,account-write-custody,broker-channel}.ts`.
- Clipper `apps/web/src/lib/{backend/jazz/transaction,reader/surface-host,
  reader/surface-viewport}.ts` and `runtime/worker/host-custody.test.ts`.
- DLF `src/lib/machines/{identity/session-acquisition,workspaces/creation-transaction,
  workspaces/transaction-custody,forms/lifecycle}.ts` and
  `src/lib/backend/jazz/{startup,session}.ts`.
- Installed Jazz `dist/session/{create-jazz-session,state}.js`,
  `dist/web/registered-jazz-client.js`, `dist/runtime/client-registry.js`, and
  `dist/observed-jazz-client.js`.

SDK source inspection confirms asynchronous close and some overlapping owners.
It does not establish crash safety, remote acceptance or the necessity of every
custom layer. D1 must trace the pinned native database shutdown/transaction
contracts and qualify current XState error/cleanup ordering before a removal.

## Pilot implementation and qualification

The user approved the proposed `@xstate/svelte@6.0.0-beta.0` dependency on
2026-11-13. B1 is implemented for review: the adapter and message comparator
reside in `runtime/worker/view-source.ts`; AddLink reads five selected stores and
captures the same fixed client for commands. Its parent already keys by client.
Removed the complete-view `$state`, `$derived` projections and manual subscription
setup/disposal; retained draft cleanup and existing form behavior. This is finer
observation, not a source-line-count or worker-performance improvement claim.

Dependency installation used the local cache with no downloads. Lockfile changes
are limited to Clipper's new direct dependency; unrelated peer-key normalization
was discarded. No lifecycle policy or protocol changed. The user reviewed the
pilot and authorized tests and a PR on 2026-11-13. The audit remains evidence for
a separate bounded lifecycle change.

The first product type check rejected the callback-only design sketch: the
binding's structural constraint includes the observer-object subscribe overload.
The implemented adapter now supports both forms with the public `Observer` type,
without assertions or erased DTO types. This corrects the earlier probe's limited
JavaScript-only compatibility evidence. The proxy has no terminal channel to
forward; application failures still withdraw the client through its existing owner.

Pilot static checks: touched-file Oxfmt write/check, adapter Oxlint,
`monorepo:check-links`, local document links and diff whitespace passed.
After correcting the observer overload, Svelte check reported no diagnostics for
AddLink or its adapter, but the full command failed on one existing AppShell
`SkipControl` import. Checked-in UI source still exports SkipControl while the
generated installed UI package exports SkipLink/SkipButton: this is local
source/generated-artifact drift, not a pilot change. Shared generated artifacts
were not rebuilt because existing user-server ownership could not be inspected.
The available shell uses Node 25.2.1, outside the required 24.22.2 baseline;
repeat qualification with the pinned runtime in an isolated environment.
No behavior tests were added or run before implementation review.

After test approval, a disposable worktree at
`/private/tmp/clipper-selector-validation` received its own frozen offline install
and matching UI/DLF package builds. Both package builds and public export lint
passed; Paraglide reported an unavailable remote plugin but completed generation.
No existing checkout's generated artifacts or server were rebuilt or stopped.

`pnpm clipper:check` then passed the coordinator, full web Svelte/service-worker
types and extension Svelte checks, with zero Svelte errors or warnings. The
earlier SkipControl artifact mismatch does not occur with matched packages.
`pnpm monorepo:check-links` passed in the isolated checkout too. The same Node
25.2.1 qualification limitation remains; CI uses the required 24.22.2.

Six new tests in `runtime/worker/view-source.test.ts` and six existing tests in
`runtime/worker/client.test.ts` pass (12 total), including in the isolated
checkout. They use the real UI client and Svelte binding with a fake native
Worker. They cover initial values, unrelated updates, resubscription, shared
subscription release, observer-object compatibility, receipt suppression,
message text/severity/removal, replacement bindings and ownership of shutdown.
Existing client tests cover failure/detach withdrawal and late close receipts.
These are not browser or domain-worker account-replacement proofs.

Attempted existing `account.spec.ts` cases selected by
`starts locally without signup|background extraction stays quiet|Add Link persists article objects|Add link modal focuses`.
Only disposable fixture origins were remapped to 5198/5199. Playwright's web
server failed before any case ran: `listen EPERM: operation not permitted
127.0.0.1:5198`. This is an environment restriction, not a failed product
assertion. B4 remains unchecked. Still run those account cases plus discovery's
duplicate/restore and invalid-source cases on the pinned runtime in CI or an
environment that permits local listeners. No offline/crash or broader lifecycle
qualification is claimed for this observation-only pilot.
