# Svelte/XState observation and lifecycle audit

Date: 2026-11-13. Initial A1–A4 findings for
[the simplification spec](svelte-xstate-simplification.md). This is source
research and a proposed pilot contract, not runtime qualification or approval to
remove a lifecycle boundary.

Current implementation decision: use LibraryClient's existing Svelte-compatible
subscription directly. The initial adapter/binding pilot below is retained as
research history and superseded by the reassessment and adoption record.

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

## Capture feedback follow-up in PR #25

The user requested machine-owned status labels and one optional message per
display region. Add Link previously selected and rendered duplicate and error
messages separately, while the detailed extension status reconstructed precedence
across multiple metadata channels.

Capture states now share the `capture` channel. Each state owns its existing
localized `meta.name`, severity and whether that label is displayed in Add Link
(`meta.display`). Duplicate, invalid URL, failed, uncertain and rejected states
declare display eligibility. Idle, saving, local success, synced, canceled and
background processing remain quiet in the web region. Existing transitions own
which state is active; no new workflow or mirrored lifecycle flags were added.

The worker failure state declares detailed-status priority 1; explicit save
errors declare priority 2, preserving the previous extension precedence. The
background state forwards its child's ready-to-render message. One projector
reads these declarations using the existing stateFeedback primitive; it does not
infer labels from failure codes, receipt flags or unrelated workflow channels.
The web receives `captureFeedback`, the extension retains `captureMessage`, and
the narrow capture selector exposes `message`. Removed the old duplicate/error
message DTO fields. Add Link now has four selected stores and one conditional
StatusMessage render, with no local message selection or translation.

This change deliberately covers the capture display region. Tag-input native
announcements, list/empty feedback, reader loading and other independent workflow
regions remain separate follow-up work; no global status bus or one-message-for-
the-whole-app policy was introduced. Existing catalog wording is unchanged.

Follow-up checks: 57 tests pass across capture, discovery, worker view/client and
extension clip-machine suites. Assertions cover quiet progress/success, visible
duplicate and save errors, invalid URL retry/clear, shutdown withdrawal, parallel
worker/save failure precedence and the unchanged extension status contract.
Touched-source formatting and lint pass. The earlier browser-listener and pinned
Node runtime limitations remain; no new browser qualification is claimed.

## Reassessment: prefer the existing native Svelte store contract

The selector pilot established compatibility, but did not establish that an
XState-shaped adapter was necessary or the simplest UI boundary. Further review
found that LibraryClient already satisfies Svelte's documented observable-style
store contract: subscribe synchronously publishes the current LibraryRender and
returns an object with unsubscribe(). Svelte explicitly supports this return
shape; it does not require a function-only disposer for component subscriptions.

Primary references: [Svelte store contract](https://svelte.dev/docs/svelte/stores#Store-contract),
[external reactivity](https://svelte.dev/docs/svelte/svelte-reactivity#createSubscriber),
and [XState Svelte selectors](https://stately.ai/docs/xstate/v6/svelte/selectors).
Installed Svelte src/store/utils.js normalizes object/function unsubscribers;
src/internal/client/reactivity/store.js manages component subscriptions/cleanup.
The installed useSelector implementation creates a Svelte readable around its
source. It supplies useful equality filtering, but that alone does not establish
a benefit over native component reactivity for this render-data boundary.

Comparison:

| Option | Assessment for the current client |
| --- | --- |
| Current libraryViewSource + useSelector | Works and is tested, but adds an observer-object compatibility layer and dependency solely to observe data already consumable by Svelte. |
| Add getSnapshot and observer overloads to LibraryClient | Removes the separate file but retains the adaptation. This client publishes render DTOs, not machine snapshots; no demonstrated need for actor-facing observation methods here. |
| Subscribe directly with $client and derive fields with $derived | Preferred next design. Reuses the existing public subscription contract, current-value delivery and native Svelte cleanup. No extra source, selection engine or main-thread domain actor. |
| Introduce a readable, rune bridge or createSubscriber | Supported options when the producer lacks a compatible contract; currently another layer without a demonstrated need. |

Isolated experiment: changed only the disposable checkout's AddLink component to
read the existing client through $client. Replaced the four useSelector calls
with $derived expressions, removed the source adapter and binding imports, and
kept the same fixed client for commands and observation. Full web svelte-check
passed with zero errors/warnings. The installed compiler also emitted zero
warnings, generated native store_get and setup_stores cleanup, and imported no
XState Svelte binding. No production files or PR implementation were replaced
by this experiment; the isolated checkout now contains the alternative component.

Recommended revision: retain worker-owned XState machines, typed intent and
bounded render DTOs; subscribe directly to the scoped client in Svelte. Retain
machine-owned optional status labels from the feedback cleanup. Remove the
pilot-only wrapper/binding dependency if no other Clipper consumer needs it.
Keep XState's Svelte binding for actual component-owned or shared UI actors where
its API is useful. Do not create another actor to mirror the domain actor.

The key lifetime still matters: account replacement withdraws the old scoped
client and the existing keyed component remounts. UI subscription disposal must
not close the application Worker. SSR must not create the worker, and failures
must still withdraw its view. Initial-value, resubscription, replacement and
shutdown-ownership tests should be retained/reworked for the direct contract.

Object identity still changes across worker messages. Native $derived primitive
values suppress downstream updates when unchanged; object-valued messages may
invalidate even with equal fields. That does not by itself prove extra DOM work
or a performance regression. Do not claim either approach faster without actual
component measurements. If needed, optimize ready-view publication/identity at
the UI boundary after measuring; no global deep comparison or custom transport
subscription language is justified. Worker emission and clone costs are upstream
of either frontend observation approach and require separate measurement.

This revises A3's earlier recommendation based on the stronger contract evidence.
The previous JavaScript/selector tests remain valid evidence for the pilot, not
proof that its additional layer is preferable. Native DOM/browser behavior and
the pinned Node runtime remain qualification gates before adopting the alternative.

## Native subscription adoption

The user authorized adoption of the reassessed design. Add Link now reads the
same fixed scoped client through `$client`, with four `$derived` fields. Removed
view-source.ts, sameWorkflowMessage and Clipper's @xstate/svelte dependency/importer
entry. Finance keeps its independently used binding. LibraryClient, worker
protocols, command admission, keyed account lifetimes and state-owned status
metadata are unchanged. No replacement observation layer was introduced.

Replaced the six adapter tests with five mounted Svelte tests in
client-view.svelte.test.ts using the actual client and a fake native Worker.
The test-only NativeView component uses ordinary `$client`/`$derived` syntax.
It verifies initial render, updates, unmount/remount, a single subscription for
multiple field reads, unsubscribe-object cleanup exactly once, receipt-based
suppression, changed and cloned feedback with stable DOM node identity,
replacement bindings and separation from application/worker shutdown.
These are jsdom component tests, not full native-browser or domain-worker proofs.

The component suite has a dedicated config using the already installed Svelte
Vite plugin and jsdom. The default Node unit config excludes that suite; the
standard test:unit script runs both suites, avoiding duplicate execution or
uncompiled .svelte imports. No new test dependency was added.

Validation in the isolated checkout: frozen offline installation and workspace
links pass; 51 affected Node tests and five mounted Svelte tests pass (56 total).
Full coordinator, web/service-worker and extension type checks pass with zero
Svelte errors or warnings, including the new component test fixture/config.
Touched-source formatting/lint and diff whitespace checks pass. Existing browser
listener restrictions and Node 25 versus pinned Node 24 qualification limits
remain. The earlier adapter test results are historical, not the final design.

## Tag feedback review batch

PR #25 merged at 676e0f209da02297582ddd063b56f9b8a11066d6; comparison with its
final head reports identical trees. The follow-up branch is
refactor/clipper-tag-feedback.

Tag validation already has one XState owner: tagFormMachine's invalid state
supplies the localized optional message. ArticleTags nevertheless used that
message as a fallback in DUI's synchronous addedMessage callback. That can reuse
a retained validation error for a different native selection announcement.
The prepared change removes this fallback and the manual snapshot subscription.
It reads $client.tagForm directly and binds observations/commands to the same
scoped client, whose parent Library already has a keyed lifetime.

The XState message still feeds the existing field error directly. DUI's
stateless localized added/removed/duplicate formatters remain generic native
widget presentation, not domain outcome selection or durable-save confirmation.
No new machine, catalog wording, dependency or shared DUI API was introduced.
The native widget still announces editing immediately; this change does not
establish that an editing announcement proves worker validation or persistence.
A different controlled-announcement contract would require a supported DUI API
and qualification across its consumers rather than another Clipper workaround.

Focus recovery, tag normalization, membership intents and RESET on editing/
dismissal are retained. Affected validation includes tag-form invalid/RESET,
subscription initial/update/unmount and account replacement, stale field-error
isolation from chip announcements, readonly admission, and discovery browser
cases for validation/edit/Escape, Unicode duplicates and tag removal/filtering.
The user approved this batch's tests and separate PR after implementation review.

Validation: 12 affected Node tests (tag form, discovery, worker client) and eight
mounted Svelte tests pass. Three new component tests mount the actual ArticleTags
and DUI TagInput with a controlled LibraryClient view source. They cover a delayed
worker reset retaining an old validation error, error clearing, native unsubscribe
cleanup, Unicode duplicate feedback without a membership write, readonly
admission and RESET/onclose delivery. A new actor test covers refused selections
retaining validation/revision and the next admitted selection clearing the error.

The stale-error component test was also run against the original ArticleTags:
it fails specifically because the status contains Enter tag instead of the selected
tag announcement. The fixed component was restored afterward. Component setup
provides only jsdom's missing dialog open/close methods and restores their original
descriptors; it does not claim native modality, browser focus or popup geometry.
The existing component configuration now uses the app's already-installed SVG
plugin and inlines DUI/icon imports so it can mount the real widget, not a mock.

Full coordinator/web/service-worker/extension type checks pass with zero Svelte
errors/warnings. Touched-source formatting/lint and whitespace checks pass.
Validation used the isolated checkout with matching UI/DLF artifacts; local Node
25.2.1 remains different from pinned CI Node 24.22.2. The existing environment
denies local server listeners, so native discovery browser cases remain for CI
or a listener-capable environment. No new browser result is claimed for this PR.

## Library native-subscription migration

PR #26 merged at beb844218ba4f30925ea762a096f171fae6ae5a5; comparison with its
final head reports no tree changes. The next branch is
refactor/clipper-library-subscription.

Library now captures the page's keyed client once and reads its view, filter
state, pagination and selected tag article through native $client subscriptions.
Removed the manual onMount subscription, copied snapshot and fallback reads.
All intent callbacks and child clients use that same captured scope. Since a
LibraryClient always has an initial view, removed the transient empty render
gate. This changes first-render timing, not library readiness/admission policy.
The source diff includes markup outdent from removing that gate; structural
markup, styles, focus callbacks and worker-owned data/feedback remain intact.

The existing pagination reset key, row-removal focus bookkeeping and dedicated
tagArticle fallback remain. An article leaving the visible list while its tag
editor is open still uses the separately published tagArticle. No UI actor,
new state, message mapping, dependency or generic observation layer was added.

Six new tests mount Library with its real child components and an account
navigation context fixture. They cover initial projection; query, status,
favorite and tag-filter intent wiring; projected filter updates/search retry;
pagination/new-row focus; filtered-out tag-editor continuity/heading focus on
close; late old-client data/unsubscription; and trash-to-empty-list heading focus.
These jsdom tests substitute only missing dialog/popover methods. They do not
qualify native popup visibility, modal focus return or actual worker persistence.

The focused Node capture/discovery/client suites pass 36 tests; the mounted
suite passes 14, including the six new Library cases. Source formatting, test
lint and diff whitespace checks pass. The isolated checkout preserves existing
user services/data; local Node 25.2.1 and native-listener restrictions retain the
previous qualification limits. Native browser checks remain for CI before C2
can be marked fully qualified.

Full coordinator/web/service-worker/extension type checks also pass with zero
Svelte errors or warnings. The only type-check correction during development was
explicitly narrowing the test's open-dialog query before calling close; no type
assertions or production API changes were needed.

## Reader route native-subscription migration

PR #21 merged at ea460e9d999de55f9cc215f8a17bf20d85089aa4 after its native
qualification passed. It moved reader composition into the SvelteKit route and
removed integrations/Reader.svelte. PR #28 now applies the observation cleanup
to that route and keeps the merged layout, drawer, focus and scrolling fixes.
The user's conflict-resolution request retains the implementation/testing/PR
update authorization for this bounded adaptation.

The reused route observes a single LibraryClient through native $client reads.
An effect captures the current worker client and route ID, sends OPEN, and records
that exact UI binding. Its cleanup releases the surface, sends CLOSE_READER to
the captured owner and clears the binding. The derived client is immediately
unavailable when either identity changes. This replaces the manual snapshot,
subscribe/unsubscribe and getView fallback without copying worker workflow state.
The binding records that OPEN was sent; the worker retains command admission,
loading, reader generation, late-result rejection and persistence ownership.

The render DTO exposes the existing library context readerId. Reader content and
feedback are rendered only when it matches the route. A cached prior route's
content cannot attach during initial observation. This uses the route ID rather
than the reader payload's document ID; direct reads also work without a visible
list row. Surface attachment continues to use reader.document.id, and organization
falls back to the route ID. Native observation begins only after OPEN has been
sent for that exact client/URL, preserving the original surface ordering.

Each DOM surface retains its actual client owner with its native detacher.
Content replacement, route changes and account replacement release that lease
and send DETACH to the client that attached it. Repeated DOM/effect cleanup does
not detach a new client's surface. Footnotes and headings remain UI concerns.
No selector wrapper, new dependency, UI copy or worker shutdown change is added.

Eight tests mount the actual reader route with its real children. Six retain the
original cases for initial/loading/available projections, route correlation,
direct reads, correct surface document identity, archive/preference intents,
DOM/selection continuity, content replacement, unavailable teardown and close
ordering. Two new cases reuse the same route across clients, unavailable context
and new bindings, and change route IDs on one client. They verify subscription
cleanup, stale data/feedback rejection, OPEN-before-attach and exact surface
ownership. The fixture supplies worker/account contexts and reactive SvelteKit
page state. Narrow jsdom media-query/dialog/popover substitutes still do not
establish native viewport, modal/popover or final-position persistence guarantees.

All 25 mounted Svelte tests pass. The 76 affected Node tests cover the library,
reader drain, experience, viewport/surface and worker client. Checks use the
isolated checkout and matching rebuilt UI/DLF artifacts after a frozen offline
install. Local Node remains 25.2.1 rather than pinned CI Node 24.22.2. Local native
listeners and Chromium launch are denied, so native qualification runs on CI.
C3 remains unchecked until that evidence is recorded for this adaptation.

The reused-route account replacement regression fails against the pre-migration
route because the incoming client receives DETACH around OPEN while old DOM is
being released. The scoped surface owner fixes that cross-client cleanup. The
restored route passes all eight cases. Full coordinator, web, service-worker and
extension type checks pass with zero Svelte errors/warnings. Touched source
formatting, lint, peer-link and whitespace checks pass.

## Retire the superseded Window account integration (C4)

PR #28 merged at `f3cc946a3e6bbd89dd367191c0ccec3fb859ca15` with all checks
passing. Its [Clipper qualification run](https://github.com/delightful-labs/delightful-labs/actions/runs/43546948705)
completed the web, worker, production offline, sample-data and packaged-extension
suites on pinned CI Node 24.22.2. This closes the pending native reader evidence
above; jsdom results alone still do not prove native behavior.

The remaining older `integrations/Account.svelte` created the application actor
on Window, subscribed manually and provided `runtime/library-context.ts`. A full
repository search of source, tests, fixtures, config, package exports and dynamic
import patterns found no consumer of that component. Its context had only that
provider and no `useLibrary` consumer. The private web package exports neither.
The active layout already imported `integrations/Application.svelte`; renaming
its local `Account` alias to `Application` makes the actual boundary explicit.

Remove only the unused component and context. The active application opens its
worker client from `onMount`; `worker/host-machine.ts` owns the application
readiness machine, and `host-observation.ts` observes its library/recovery bindings.
The extension runtime and sign-in machine also consume these application APIs.
Those machines, selectors, native cleanup, fixtures and tests remain required.
The historical extension-startup review remains a record of the older design.
This cleanup adds no workflow, lifecycle policy, dependency or user-facing copy.

Local validation: complete Clipper coordinator, web, service-worker and extension
type checks pass with zero Svelte errors/warnings. Touched Svelte formatting,
lint and whitespace checks pass. No new behavior tests are added for removal of
unreachable code. Existing CI qualifications cover the active worker application;
local validation used Node 25.2.1, while CI uses pinned Node 24.22.2.
