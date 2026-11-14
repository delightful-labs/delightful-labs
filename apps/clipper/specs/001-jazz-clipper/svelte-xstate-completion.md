# Svelte and XState cleanup completion review

The user authorized all remaining implementation, tests and multiple-component/
route changes together on PR #31 on 2026-11-14. This supersedes the original
one-component review batching for this change. No new dependencies, copy,
production deployment, merge or automatic retry of uncertain writes is authorized.

## Ownership and composition

| Responsibility | Owner and lifetime |
| --- | --- |
| Domain eligibility, statuses, translated workflow feedback, writes | Existing worker application/library machines; unchanged |
| Application/session/resource closure | Existing worker host and SDK; unchanged |
| Render observation | LibraryClient's native Svelte store contract; $client/$derived, synchronous first value and automatic unsubscribe |
| Page sidebar, navigation slot and page inertness | PageFrame; caller supplies a child snippet and may place the account control in reader navigation |
| Reader route identity, OPEN/CLOSE, final surface measurement | Reader route; captures the attaching client and releases before closing |
| Saved content, image children and syntax lease | SavedContent action; immutable content identity gates replacement |
| Footnote selection, preview, dismissal and focus return | ReaderFootnotes; scoped to the available reader snippet, cleared before content replacement |
| Drawer disclosure | DUI's public bind:open; route and settings drawer share explicit open/id instead of getDrawer traversal |
| Viewport observation | Component-owned Svelte MediaQuery; no manual listener or copied viewport state |
| Account integration context | Svelte createContext with a checked WorkerLibraryContext; provider getter follows the actual client |

PageFrame removes three repeated layout/style/inertness implementations without
moving domain work into a controller. It renders no extra content wrapper beyond
the former page frame. Reader navigation, saved content and settings remain
visibly composed in the route. Native focus methods are retained where they
perform focus rather than concealing disclosure state. AppShell observes its
current client's theme directly and releases that subscription on replacement.

Both drawers use the existing 48rem MediaQuery and false server fallback. CSS
continues to own geometry; JS needs the query for disclosure defaults/inertness.
Account defaults react only to breakpoint/reference changes; untrack prevents
manual closure from reopening it. Settings retain their disclosure on resize,
with modal inertness changing independently. Root SSR remains disabled.

## Saved-content attachment decision (E4)

The installed Svelte attachment API is appropriate for element-bound resources,
but a callback reading asset/image/callback props directly would dispose/recreate
its resource on unrelated updates. Keeping its function stable with inner effects
would still require separate content identity, image updates and exactly-once
native release. The existing bounded action already expresses those boundaries.
Retain it rather than replacing it with a fromAction wrapper or another controller.

Mounted tests now cover live image pending/failure/retry/ready transitions while
retaining the same paragraph, selection and surface lease, plus footnote reset
before actual content replacement/disposal. Reader route tests cover progress,
preferences/theme, content replacement and attaching-client teardown. Native
reader tests cover syntax highlighting cleanup, selection, footnotes, resizing,
final position and reload. Attachment syntax is an evaluated alternative, not a
migration quota.

## Bounded lifecycle simplification (D1–D4)

Operation: observe offline-shell registration for the component's lifetime.
States remain registration, watching (preparing/ready/waiting/failed/unsupported)
and retry/deadline admission. The component owns the actor; the browser owns the
service-worker registration. RETRY and native STATUS reports remain public;
deadline/settlement coordination remains private.

Before: unmount subscribed to a generic drain helper, sent SHUTDOWN, entered a
closed final state, then stopped the actor. This final state performed no async
settlement. After: unmount unsubscribes and calls actor.stop(). Remove this
boundary's SHUTDOWN command and closed state. Ordinary XState cancellation stops
invocations/timers and runs callback listener disposal. Late register resolution
or rejection cannot attach an observer or reopen admission after owner stop.

The browser register API has no AbortSignal parameter. Stopping this observer
does not cancel or unregister the browser-owned registration. Registration may
finish and prepare offline operation after the observing page leaves; that is
intended. The observer owns no SDK session, transferred broker/storage custody,
article mutation or final reader measurement. None needs draining here.

The pinned XState 6.0.0-beta.1 docs/index.md, agents.md, api-stability.json,
cancellation.md and lifecycle-and-errors.md establish invoked-child stop,
async-result cancellation and callback disposal. Nine registration tests include
late success/rejection, actual EventTarget listener disposal, no later report,
deadline disposal, retry and registration failure. The private-protocol test
retains public/private admission assertions with the new native stop contract.
Production offline tests exercise actual browser registration and first-install
failure/retry. They are separate from the platform-substitute unit cases.

No conflicting active policy needs relaxation (D2): the shared guidance requires
settlement for issued effects that need it, and supports native observer cleanup.
The Clipper memory now distinguishes this qualified observer from application
closure. Removing ordinary observer ceremony is not permission to stop the
shared worker, SDK or transaction owners early.

## Remaining lifecycle dispositions

| Boundary | Disposition and evidence |
| --- | --- |
| UI subscriptions | Native Svelte unsubscribe; no shutdown or application ownership |
| Offline shell observer | Simplified to ordinary XState stop as above |
| Syntax worker/ranges | Retain standard actor stop and native disposers; no persistence protocol |
| Reader surface | Retain final measurement while old DOM exists, followed by worker persistence; native reader-position cases cover navigation/restart |
| Application worker transport | Retain orderly host closure before native Worker.terminate; terminating executing work cannot await issued effects |
| SDK acquisition | Retain late-resource owner: selected createJazzClient acquisition is not canceled by actor AbortSignal |
| SDK session | Retain awaited close. Installed session/state.js close is idempotent, detaches consumers, waits barrier/busy/logout, then awaits old client.shutdown |
| Native Db | Installed runtime/db.js shutdown is idempotent; optional waitForSync waits pending writes, then callbacks/abort/connection shutdown/runtimeSource.shutdown. This does not settle caller-owned acquisition or prove every transaction outcome |
| Transactions | Retain one owner through commit/local receipt or rollback; local and global waits remain distinct. Stop is not rollback or a durability acknowledgment |
| Account storage/Web Lock and broker | Retain issued-command and transferred-port custody until scoped native close receipts; queued-request cancellation does not undo issued commands |
| Detached transaction retention | Retain conservative refusal of clean close. A settled promise alone does not classify commit/rollback outcome. The permanent realm set remains conservative technical debt; do not remove it on the basis of its historical v5 rationale alone |

Source-backed asymmetry is intentional: ordinary UI observers use framework
cleanup; issued persistence/native session work keeps its actual owner. Existing
host tests cover cancellation during acquisition, delayed acquisition, close
failure, overdue close, late completion, storage/broker receipts and refusal of
clean closure under custody. Native worker tests exercise real transports/SDK.
No claim is made that every custom layer is minimal or that normal close proves
local or remote durability.

## Abrupt termination and qualification map

The added native Worker test waits for a real local write receipt, holds before
session.close, then calls Worker.terminate. A fresh worker reads that exact
operation offline without mutation replay. Reconnection/reload retains one saved
article. This proves the admitted locally durable case for worker termination;
it does not promise survival of unacknowledged or OS/power-loss writes.

Full browser-process restart with endpoints unreachable remains covered by
account and production offline shell suites. Native account-custody tests retain
unknown-write outcomes and reject a false clean-close acknowledgment; uncertain
writes are not automatically replayed. The new worker test and browser-process
restart checks address different native boundaries.

| Task | Concrete native coverage |
| --- | --- |
| B4 | discovery: duplicate Add Link/explicit Restore; invalid-source feedback; account: offline URL capture/restart and quiet background failure |
| C1 | discovery: validation clears on edit/Escape, keyboard chip selection/removal, article leaving tag filter and focus recovery |
| C2 | discovery: combined search/filter/tag/status/favorites/Trash, remote reindex, row-removal focus and offline tags/restart; mounted library pagination/editor continuity |
| E3 | account viewport/manual closure/inertness/Escape; reader drawer resize/Escape/focus; mounted listener disposal/remount |
| E4 | mounted live image/selection/content replacement; native syntax worker and reader-anchor/navigation tests |
| D4 | shell cancellation tests, worker host acquisition/close/custody tests, real production offline registration |
| D5 | new abrupt Worker termination/read-only reopen, account/reader/production offline full-process restart, account-custody unknown outcome tests |

## Verification record

Exact pins: Svelte 5.57.2, XState 6.0.0-beta.1, Jazz tools 2.0.0-alpha.60,
pnpm 10.28.0. There is no Clipper @xstate/svelte dependency or custom store adapter.
The isolated local runtime is Node 25.2.1; CI uses pinned Node 24.22.2.

30 mounted tests and nine focused shell tests pass locally; full coordinator,
web, service-worker and extension types pass with zero Svelte diagnostics. The
full local unit run had 837 passing tests but native server fixtures failed to
bind with EPERM (and their dependent timeouts); it is not a passing full run.
Do not retry restricted listeners or weaken those tests. The complete unit,
web/worker/offline/sample-data and packaged-extension suites run on PR #31 CI.
Final run links and outcomes will be recorded here and in the PR after completion.
