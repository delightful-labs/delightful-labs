# Native Jazz session custody: actor boundary approved

The inactive alpha.65 caller port exposed a real development-mode compatibility
issue. Resolve this shared boundary before continuing the Finance/Clipper caller
port. Workspace SDK pins and active code remain alpha.60.

## Verified failure

Jazz alpha.65's public session is a plain object with an enumerable `db` getter.
That getter throws whenever no ready client exists, including signed-out startup.
XState 6.0.0-beta.1's development `freezeContext` recursively reads enumerable
properties of plain objects placed in context. Its installed `docs/context.md`
explicitly says to keep nonserializable resources outside context. Already
freezing the session does not help: the implementation still visits its children.

The existing shared acquisition owner stores the actual SDK session at
`context.acquisition.session`; the shared attachment chart and Clipper's realm
close chart also retain it directly. A signed-out session therefore fails before
the owner can service acquisition. This affects development startup and tests;
the production XState build does not run this freeze. Do not disable development
checks or infer production safety from the production-only browser fixture.

Evidence against main `2d1b5cd2`:

- The Clipper candidate passes strict types and its 46 application-readiness
  cases. Including the existing worker-host/root/sign-out cases gives 52 passing
  and 15 failing cases out of 67, with the signed-out fixture's `db` getter in
  XState's `freezeContext` stack. No domain-drain assertion was weakened.
- A separate Chromium diagnostic uses the **actual** alpha.65 SDK session, signs
  it out, then supplies that exact facade to the actual packed Local First
  acquisition machine. A development-condition Vite build reports owner status
  `error` and the native `session.db: there is no Db while the session is
signed-out` error. The diagnostic asserts that failure; its passing result is
  reproduction evidence, not successful integration.
- Artifacts: `finance-jazz-alpha65-8L5U5x` under the system temporary directory.
  Logs: `/private/tmp/finance-alpha65-clipper-latest-main.log` and
  `/private/tmp/finance-alpha65-real-sdk-owner-fixed.log`. The native diagnostic
  used temporary fixture controls, restored afterward; it did not patch Jazz,
  XState or workspace source. The maintained Clipper overlay/runner reproduces
  the development failure through its typed worker-host fixture.

The unchanged production native fixture was restored after that diagnostic and
all **21 cases pass**. An earlier run passed 20/21 and timed out during a fresh
Firefox browser launch before any fixture operation. Its isolated cold-restart
replay and the complete 21-case rerun pass with unchanged source/timeouts. Log:
`/private/tmp/finance-alpha65-native-confirmation.log`. This is separate from the
confirmed development-mode owner failure.

## Accepted direction

The user selected actor ownership and authorized implementation. Local First
owns the reusable session protocol and Jazz adapter; application workflows send
commands and consume observations/results. Keep the native SDK facade private
to that adapter. Statecharts own ordering, admission, retry and shutdown; the
adapter executes the selected native call. Native Jazz retains its own account
following and local-first behavior.

The first bounded implementation reuses the existing acquisition chart for
opening/retry/storage contention and adds the session actor's observation and
close lifecycle. Its acquired resource is a private record of native leaf
capabilities, whose closures retain the SDK facade; no getter returns that
facade to consumers. The session actor owns the acquisition child and observer.
Public observations contain status/identity/binding facts only.

Model: acquisition may succeed, fail or wait for storage availability. Close
during acquisition retains the issued open until it settles, then closes any
acquired resource without subscribing or publishing ready. While bound, a native
observer publishes scoped facts; close first requests/awaits observer removal,
then awaits actual SDK close. Failed observer removal or SDK close retains the
resource for explicit retry and cannot report clean closure. Forced actor stop
must never masquerade as native close. Existing application domain drains still
precede the actor's close request.

That foundation now passes its qualification below. Next route
create/restore/sign-out/recovery through its protocol and adopt it in both
workers. Keep the current alpha.60 applications unchanged
until their replacements are qualified. Finance's current native Svelte provider
is a legacy integration boundary to retire with the worker UI; do not build a
second SDK-shaped facade to satisfy it.

## First implementation and qualification

- `delightful-local-first/session/runtime` exposes the SDK-neutral
  `sessionRuntimeMachine`, bounded observation selector and native-resource
  contracts. The current slice supports acquisition, observation, retry and
  graceful close. It does not yet replace the applications' session callers.
- The existing acquisition chart is invoked as a child, preserving its retry,
  sharing and storage-contention behavior. Its new `CANCEL_WAIT` command can
  atomically release an availability wait; it never cancels an issued SDK open.
  This avoids a close/availability race without inspecting private child state.
- The Jazz-specific implementation exists only in the alpha.65 adapter overlay.
  It owns the native client loader, immediate local-first setup and SDK facade.
  Its closures expose selected native leaves to the actor, not a facade getter
  to applications. SDK-derived status, identity and binding facts are projected
  there; no SDK object enters machine context or consumer observations.
- Observer reports carry their invocation binding. Retired reports cannot
  restore availability after reobservation. Observation retry removes the old
  subscription before subscribing again and does not reopen/retry Jazz.
- Failed observer removal and failed SDK close remain retryable states with
  retained resources. Unexpected acquisition/observer-owner failure withdraws
  availability and cannot produce a clean close result. Forced stop is not a
  native close receipt. These runtime snapshots are ephemeral, not financial
  journals or restart credentials.

The complete Local First types pass, library Svelte checks report zero
errors/warnings, and packaging plus strict publint pass. All **234 affected
identity/backend tests** pass, including existing generated readiness/sign-out
campaigns, storage-wait cancellation, late SDK acquisition, retry, observer
replacement, cleanup failure and close settlement.

The isolated packed candidate passes strict adapter/fixture types, native Svelte
checks and **30 browser cases**. Nine new cases run the actor and actual SDK
inside a **dedicated Web Worker** in Chromium, Firefox and WebKit: device startup, signed-out startup,
and close while an actual acquired session is held before delivery. Each asserts
that development XState really froze its context, no Window exists in the actor
realm, native close completed exactly once, and a late acquired session was never
observed/published. Teardown awaits SDK, AccountStore and exact broker-host close
receipts. The Window supplies only the existing native broker host. The previous 21
production-build SDK/worker/IDB/Svelte cases remain intact; each development and
production build still emits exactly one broker asset.

Artifacts: `finance-jazz-alpha65-zx4f4n` in the system temporary directory;
`/private/tmp/finance-alpha65-worker-session-actor-awaited.log` records the complete
30-case Worker/production run. Earlier Window-only actor qualification remains in
`finance-jazz-alpha65-hIZcTw`. The Worker controls reuse the existing SDK fixture's
broker setup/command channel. Their reply predicates use `expect.poll`, which
awaits asynchronous replies; this Playwright version's `waitForFunction` treats a
returned Promise as truthy before its value settles. No timeout was increased to
hide that fixture bug. The final Worker proof retains all original 21 cases.

**Remaining:** the old Clipper caller overlay still passes 52/67 cases because
its 15 worker-host cases still retain raw SDK sessions. Keep that regression
visible until actual caller adoption; do not rewrite only its fixtures. Add the
session actor's identity/recovery commands using existing operation scopes and
application drains, then bind domain access inside the worker adapter and move
both consumers to the actor. No generic SDK proxy, per-call actor/grant population
or duplicate identity workflow is authorized by this boundary.

## Bounded sign-out command: implemented, application adoption pending

This records the first sign-out checkpoint. The current shared identity-change
protocol extends that same path; see the create/restore/recovery batch below.

Route the native SDK sign-out leaf through the existing session actor first.
The application's ordered sign-out chart retains provider sign-out, domain drain,
deadline feedback and its final identity refresh. The session actor accepts a
request correlated with the existing binding/attempt scope and caller actor,
plus the exact observed identity binding. Its statechart admits one operation,
rejects busy/unavailable/stale requests without native I/O, and reports one
settled result. The Jazz adapter rechecks the native binding immediately before
the SDK call. SDK rejection does not imply rollback.

The native observer remains owned throughout sign-out; public availability is
withdrawn until settlement. CLOSE during sign-out selects its stopping substate
and retains the original invocation. After settlement it removes the observer
and awaits SDK close. Do not add a request queue, replay cache, per-call actor
population or SDK-shaped facade. Restore/recovery secret lifetime and domain
binding adoption remain subsequent work using this same boundary.

Review further commands against the actual consumer's existing workflow before
extending this boundary. The alpha.66 audit does not authorize a general command
framework or compensating code for upstream SDK gaps. Native library behavior
and existing workflows take precedence over speculative coordination.

The caller review confirms that `createOrderedSignOutMachine` already owns
provider → session reobservation → native sign-out, deadline feedback and retained
invocations during shutdown. Clipper's `signOutInput` supplies those leaves. Keep
that workflow; the session actor adds only admission, one native invocation and
settled reporting. Neither application's callers are switched in this checkpoint.

The alpha.67 private adapter now implements the seven-line native leaf: read the
current native binding, refuse replacement, await `session.signOut()`, report
completion. SDK custody remains private. There is no new SDK patch, command
queue, SDK facade, provider workflow or per-request actor population.

Qualification: **34 affected shared tests** pass across session ownership and
existing ordered-sign-out suites. Full library types, changed production lint,
packaging, strict candidate adapter/worker-fixture types and **15 selected native
browser cases** pass. These include the previous nine development-XState Worker
ownership cases and six new sign-out cases across Chromium/Firefox/WebKit.
Stale requests cause zero native calls; successful sign-out publishes signed-out
facts; holding settlement while CLOSE arrives retains the original invocation,
reports once and awaits observer/SDK/AccountStore/broker teardown. The hold is
after actual SDK completion and tests application receipt/drain ownership; it
does not simulate an internally stalled SDK operation. Unit cases independently
hold/reject the native leaf. Development freezing remains enabled.

Artifact: `/private/tmp/finance-alpha67-signout-proof-pe072hlw`;
log: `/private/tmp/finance-alpha67-signout-native.log`. This focused batch reuses
the prior alpha.67 artifact and its dependencies, existing generated catalogs and
unchanged schemas/backend. It does not rerun or extend the earlier 325-case
foundation claim. The maintained fixture now contains 36 cases; this checkpoint
ran 15 and deliberately omitted 21 unaffected cases. Active pins remain alpha.60.

Next: connect actual worker callers and their existing ordered sign-out/drain
owners, then add the bounded recovery/restore commands needed by those callers.
Finance's legacy Svelte provider and Clipper's raw-session host must be replaced
at their real application boundary; changing only fixtures does not complete U2.

## App binding function: approved and implemented

The user approved this shared extension to keep both apps similar and limit SDK
upgrade contacts. `createJazzSessionRuntime(config, bind)` calls an app-supplied,
synchronous construction function with the ready Db, identity ID/kind, opaque
binding and `isCurrent` predicate. It returns app capability functions, not the
Db, SDK session or live query rows. Construction must be inert: no subscriptions,
actor starts, acquired resources or I/O. Existing app charts still own readiness,
adoption, domain drains and resource release.

The native adapter reuses that constructed record for the exact user/client/Db
binding. Nonready observations invalidate the old binding; a later ready binding
gets a new record, including A → B → A. Each capability can use the adjacent
native `isCurrent` check. Construction errors follow the existing observation
failure path. There is no new fallback, SDK proxy, session getter or registry.

`createSessionRuntimeMachine<Capabilities>()` carries the typed record in ready
observations; the existing default machine remains available. The same selector
withdraws the record during mutation, close or observation failure. These are
worker-local capability records, never UI-thread view messages.

Clipper's existing account adapter now reuses `createLibraryBinding` for native
root access and library construction. Its current public capture function and
the constructed library reuse `createLibraryCapture`: the latter captures its
own admitted Db and liveness check rather than reading the old global registry.
Provider cookies/native proof handling are unchanged. Replaced responses are
cancelled and rejected. The alpha.65+ caller overlay exposes
`accountSessionRuntime` using the same builder and shared binding function.
**This constructor is not yet wired into the real worker host**; identity and
recovery commands and old raw-session startup/close replacement remain next.

Qualification for this batch:

- **34 shared tests**, full library types, packaging and changed-source lint pass.
- **72 active Clipper tests** pass: the existing 70 account/root/sign-out/worker
  cases and two new native binding/capture cases. Full Clipper Svelte/TypeScript
  checking reports zero errors/warnings. The extraction preserves shared-Db
  ownership and refuses stale access before network or writes.
- Alpha.67 compiles the actual candidate account constructor and extracted
  builder with strict types. The same two native binding/capture cases pass
  against its real disposable authority; this is not application-host adoption.
- **15 focused native browser cases** pass in Chromium/Firefox/WebKit. The
  development-XState actor invokes the binding function and reads actual Finance
  data through its returned capability inside a Worker. Records are withdrawn
  and retained native checks refuse the old binding after sign-out/close. The
  existing held-open/sign-out drain coverage remains intact; 21 unrelated native
  cases were omitted, and the larger schema/backend suites were not repeated.

Artifacts: `/private/tmp/finance-alpha67-bindings-0hii5wgh`,
`/private/tmp/clipper-alpha67-bindings-ow0swt3k`; logs:
`/private/tmp/finance-alpha67-bindings-native.log`,
`/private/tmp/clipper-alpha67-bindings-native.log`,
`/private/tmp/clipper-library-binding-native.log`,
`/private/tmp/clipper-library-binding-types.log`.
Native patches pass strict apply/whitespace checks; source formatting passes.
Active SDK pins remain alpha.60. All hosted Finance/Clipper/Foundation checks
passed for the preceding sign-out checkpoint `f464f7c1`.

The create/restore/recovery batch below supplies the next native operations,
reusing existing restoration validation and domain drains. Next replace
Clipper's startup/host-close custody of raw sessions with this actor and binding
constructor. Retire the corresponding old registry path on qualified adoption.
Finance should reuse this boundary for its worker-owned capabilities; retain the
legacy Svelte provider until the worker UI replacement rather than adding an SDK
facade to satisfy it. Do not turn the historical raw-session fixture green by
changing only mocks or disabling development freezing.

## Create, restore and recovery: implemented, host wiring pending

The session actor now uses one `CHANGE_IDENTITY` request/report path for create,
restore and sign-out. This replaces the unreleased sign-out-only protocol; there
is no compatibility alias or second execution owner. The operation discriminant
selects exactly one native `createDeviceAccount`, `restoreDeviceAccount` or
`signOut` call. Existing admission, scoped reports, observer ownership, busy
refusal and close-after-settlement states are reused. Signed-out observations
also carry an opaque binding, so an old signed-out request cannot create a new
identity after the session has moved through another binding.

Create is admitted from its captured signed-out binding. Restore is admitted
from its captured ready or signed-out binding; application validation and domain
drain remain prerequisites owned by the existing restoration workflow. The
adapter rechecks the binding immediately before issuing native I/O. Rejection
does not establish rollback or authorize replay.

The pending session state's input retains only scope, operation and recipient.
The validated credential goes from the entry event directly to the invoked
native leaf, without entering the long-lived session context or pending state's
input. The invocation remains sensitive and ephemeral: never inspect or persist
its input, command payload or the restoration workflow's secrets. Terminal
reports contain no credential. Native SDK custody remains in adapter closures.

Recovery reuses `createJazzRecoveryAdapter` and `createRecoveryPhraseMachine`.
The binding function receives their existing checked capability/source pair;
the candidate Clipper constructor includes that pair in its app capability
record. The recovery actor owns reveal/hide/clearing and its subscription, and
the native adapter owns SDK export/phrase encoding. No new secret-returning
session command or duplicate recovery workflow is added. Session observations
advance the existing recovery scope, and close invalidates it before native
disposal.

Qualification: **132 shared tests** pass across the actual session, restoration,
recovery and ordered-sign-out charts, including held/rejected identity changes,
stale signed-out admission and nonsecret pending state input. Full library and
selected unit-test types, packaging, strict candidate adapter/fixture/account
constructor types, changed-source lint and strict patch applicability pass.
**21 selected native cases** pass across Chromium/Firefox/WebKit. Six new cases
create an actual device identity in a Worker, reveal/hide through the existing
recovery chart, sign out and restore that same native identity. Old domain and
recovery bindings stay invalid after restoration. Held restore receipts retain
the original invocation and defer observer/SDK/AccountStore/broker close. The
hold follows SDK completion; unit cases independently hold/reject the native
leaf. Development XState freezing remains enabled. No phrase/key crosses the
fixture's Worker boundary. The maintained suite contains 42 cases; 21 unrelated
cases and larger schema/backend suites were not repeated in this batch.

Artifact: `/private/tmp/finance-alpha67-identity-jm5qlfv_`;
log: `/private/tmp/finance-alpha67-identity-native.log`. The prior Clipper
candidate artifact is reused for strict constructor checking. Active SDK pins
remain alpha.60; there is no new SDK patch behavior or production cutover.

Next: wire the actual Clipper worker account/readiness and realm-close owners
to this runtime, using existing application drain, restoration and ordered
sign-out charts. Preserve native SDK retry behavior from the existing readiness
adapter; the runtime's acquisition/observer RETRY is not that SDK operation.
Remove old raw-session custody on qualified adoption and keep the documented
legacy regression visible until then. Finance reuses the same binding/identity
boundary as its actual worker/UI callers move over. U2 remains open.

## Clipper host adoption qualified in the candidate

The actual Clipper candidate now starts the shared session root at its account
host boundary. Its attachment chart leases a native XState actor reference and
`actor.select()` readable; no SDK session, Db getter or SDK-shaped replacement
enters application context. The private Jazz adapter remains the sole SDK owner.
App capabilities come from the existing inert library binding function.

The existing application chart still owns domain drain, creation admission,
restoration and ordered provider sign-out. Their fixed invocation source is now
the shared `createSessionChangeMachine`: it sends a scoped typed command and
awaits the matching result, or invokes the current alpha.60 native leaf for
compatibility. It releases the command payload after dispatch, preserves issued
work through shutdown and reports unexpected session-owner failure. There is no
promise bridge, dynamic actor population, result registry or another SDK facade.
Readiness uses the same source for SDK retry. Native retry, failed acquisition
retry and failed observation retry remain separate routes in the owning chart.

Realm close invokes `sessionCloseMachine`, which requests close and observes
actual owner completion. Clipper retains application drain, acquisition/native
close deadlines, AccountStore close and exact broker receipts in their original
order. Late acquisition remains owned and is closed without observation. An
actor stop, failed close or failed owner cannot produce a clean close receipt.
The existing reference-acquisition chart remains temporarily for attachment
correlation; it cannot acquire another SDK session. Removing that chart is not
required for this adoption and is not part of this batch.

Qualification: **272 affected shared identity/backend tests**, full library types
and selected unit-test types pass. The actual candidate Clipper account and
workflow/host tests pass strict types and **69 tests**, including the 15 cases
that previously failed on the SDK getter. The native getter remains private and
is not read by the host. The active alpha.60 Clipper batch passes **72 tests**.
**21 focused native cases** pass in Chromium/Firefox/WebKit, now using the same
shared command and close invocations against real Jazz sessions inside Workers
with development XState freezing enabled. They cover startup, late acquisition,
create/recover/hide/sign-out/restore and close during held operation settlement.
The maintained suite still contains 42 cases; 21 unrelated cases were not rerun.
Strict patch application passes against the maintained sources.

Artifacts: `/private/tmp/clipper-alpha67-host-check/app` and
`/private/tmp/finance-alpha67-host-4eo19nnx/app`; logs:
`/private/tmp/clipper-session-host.log`,
`/private/tmp/clipper-session-host-native.log` and
`/private/tmp/finance-session-host-native.log`.
The first Clipper log includes 67 passing host cases and a sandbox listener
restriction; its two native binding cases pass in the separate authorized run.

The branch also incorporates main `f3827565` (the new Clipper publication
lifecycle and sign-in permissions). The candidate overlays retain the native
`publications` schema/permissions and forward the new OAuth authorization scope.
Native schema generation/check, strict candidate types, all 69 candidate tests
and all 72 active-SDK tests pass on the merged sources. The proof's dependency
inventory now includes main's two approved AT Protocol packages. This is scoped
host qualification; the earlier full retained-schema/permission matrix is still
historical evidence and must be refreshed for the new publication model before
coordinated SDK adoption.

This completes Clipper's candidate host-custody adoption, not the coordinated SDK
upgrade. Workspace pins and the active SDK patch remain alpha.60; this adds no
SDK patch behavior and changes no production destination. Next apply the same
shared actor/binding boundary to Finance's actual worker/UI integration. Preserve
Finance's independent workspace/restore Db ownership and all existing routes;
do not retain a legacy Svelte provider through an SDK-shaped facade. U2 stays
open until those actual consumers are qualified. U3–U5 and the later worker UI
and financial workflow slices retain their recorded gates.

## Finance session binding isolated from the restore chart

Finance's application chart no longer reads native SDK session snapshots or
registers native mutation-error callbacks directly. Its identity/readiness,
mutation-error subscription and workspace-restore capture live together in
`runtime/jazz-session-binding.ts`. It forwards transaction IDs, not SDK error
objects. The active alpha.60 adapter retains its real session; it does not
construct an SDK-shaped replacement or another session owner.

The actual restore controller now consumes `WorkspaceRestoreBinding`: the
borrowed application Db, captured identity, exact-current predicate and an
observation subscription. Its file scope no longer holds a Jazz session or
calls session APIs. Transactions, journal identity, destination selection,
cancellation, issued-write drain and artifact cleanup remain in the existing
charts. The native adapter captures the original account/client/Db and supplies
those leaves. The worker binding can supply its ready Db/current predicate and
actor selection through this same domain contract, without returning the SDK
session or Db to Window.

The alpha.67 schema candidate now changes the session API only in the new native
module, instead of patching the restore chart. Its native browser harness imports
the real binding from there. Strict candidate types and all **24 existing native
restore cases** pass across Chromium/Firefox/WebKit, including same-account and
A → B → A replacement, reload/journal recognition, issued commit drain,
conflict and failed cleanup. On alpha.60, Finance app/browser-test types and the
**nine directly affected native cases** pass (binding retirement, borrowed Db,
file-controller reload/cancellation/cleanup). All **1,928 Finance unit/native
tests** pass in the combined batch: 1,744 under the sandbox and the 184 cases
requiring native listeners in the separately authorized run. The other 98 cases of the
107-case restore matrix were not repeated. Full Local First static checks and
76 affected fixture tests also pass after the CI typing correction.

Artifacts reuse `/private/tmp/finance-alpha67-host-4eo19nnx/app` and the isolated
SDK60 checkout. Logs use `/private/tmp/finance-session-binding-` with
`{types,unit,native-unit,sdk60-native,alpha67-types,alpha67-native}.log` suffixes.
The pinned UI and SDK remain active; this is the Finance native-boundary step,
not a worker/UI cutover or completion of U2/C3–C5. Next bind the actual Finance
worker session and its first bounded read view through these capabilities.
The independent [unknown-save CI recurrence](worker-pr39-ci-offline-edit.md#pr46-workspace-settings-recurrence-at-42dfaf64)
remains open; successful restore checks do not establish a fix.

## First Finance Worker and Svelte read slice

The alpha.67 candidate now runs an actual Finance application Worker and renders
its workspace directory and selected accounts through Svelte. This implements
the first C3–C5 slice in the isolated candidate. The live alpha.60 layout still
uses its existing provider; production replacement and U2/U5 remain open.

Ownership and protocol:

- The real Worker entry constructs one shared session-runtime root, the existing
  IndexedDB AccountStore and broker client, and one Finance read host. The native
  Jazz adapter supplies inert query capabilities through its existing `bind`
  function. The native SDK/Db stays inside Worker closures.
- The Finance host owns waiting, selected reads, read failure and ordered close.
  Session-ready facts start LocalFirst directory/account subscriptions. A new
  identity binding immediately withdraws both lists. Each accepted workspace
  selection has a monotonically increasing revision and a fresh query binding;
  old A → B → A reports cannot repopulate the view.
- The wire has validated OPEN, SELECT_WORKSPACE and CLOSE commands, and bounded
  VIEW/FAILED/CLOSED replies. Views carry workspace ID/name and account
  ID/name/kind/currency only. SDK rows are projected/copied before entering
  XState. No raw session, Db, capabilities or actor snapshot crosses to Window.
- Window constructs native transport and the existing Window-only SharedWorker
  bridge. Svelte uses an ordinary readable store and the existing shared workspace
  selector/Table. Detaching the view only unsubscribes rendering; it does not
  stop the Worker. A malformed reply withdraws data and disables further view
  delivery, while retaining the native close-receipt listener.
- Close removes query subscriptions, awaits the existing session-close source,
  then closes the AccountStore and broker. Only the exact broker scope/request
  receipt allows final CLOSED and Window termination. Forced actor stop or failed
  SDK/store/broker closure cannot acknowledge success. A query-disposal failure
  enters `cleanupFailed`, which refuses subsequent close attempts rather than
  pretending an unreleased query was disposed. Disposal reports target the live
  parent directly: installed XState drops callback `sendBack` after callback stop.

Implementation files are `contracts/worker-application.ts`,
`machines/runtime/worker-application.ts`, `runtime/worker/{read-binding,client}.ts`
and `components/worker/WorkerAccounts.svelte`. The SDK67 entry is
`tests/worker-upgrade/finance-worker.patch`; it replaces the SDK60 import catalog
only in the isolated upgrade runner. Keep this single temporary version boundary
until coordinated SDK adoption; do not create a parallel SDK60 session adapter.
The shared workspace selector now uses its existing public directory type rather
than an SDK authoring row type; its runtime behavior is unchanged.

Both the Window bridge and native adapter use the same compiled broker asset.
The build alias lives beside the existing Wasm resolution in `tooling/jazz-wasm.ts`.
Use Vite's `?sharedworker&url`: plain `?url` copies an extra uncompiled broker and
breaks the one-asset contract. No SDK patch behavior or dependency is added.

Qualification: **13 real-actor host tests** cover selected-query replacement,
identity replacement, failed reads, late acquisition, held/duplicate close,
query disposal errors, forced stops and each close-resource failure. **Nine native
cases pass** across Chromium, Firefox and WebKit. Each engine renders/switches
selected rows, detaches/remounts the actual Svelte view while a native edit
continues, rejects malformed view recovery while still closing cleanly, and
retains local records/an edit through two complete browser-process restarts.
App/auth/Jazz endpoints are unavailable throughout those persistence cases.
Test-only seeding/edit controls are injected at the Worker binding import and
are absent from the product entry/protocol. Development XState remains enabled.
The emitted Window graph excludes native SDK code; the Worker graph excludes
Svelte and its SDK integration; exactly one broker asset is emitted. Selected
candidate TypeScript/Svelte checks pass with zero errors/warnings. The current
SDK60 checkout also passes full app/browser-test/worker-proof types, all **1,941
Finance unit tests**, all **12 maintained native Worker cases** and the existing
Worker bundle proof. That full batch includes the 13 new host cases; earlier
restore/backup/backend matrices retain their prior version/head qualification.

Logs: `/private/tmp/finance-worker-read-{unit,types,alpha67-native,sdk60-native,sdk60-build}.log`.
Candidate artifact: `/private/tmp/finance-alpha67-host-4eo19nnx/app`;
SDK60 checks use the independent `/private/tmp/finance-alpha67-worker-checkout`.
The maintained `--worker --sdk=2.0.0-alpha.67` runner includes this slice after
its existing schema/session proofs. Successful prior hosted Foundation, Finance
and Clipper checks at `4afb8984` do not close the independent unknown-save issue.

### Next: reuse Finance's write workflow and drain

The read host does not own writes yet. Do not add an async archive handler and
assume exiting its invoke cancels an issued save. Existing
`createAccountArchiveMachine` / `createAccountArchiveOperation` already own
canonical validation, membership/grant admission, scope replacement and issued
write drain through SHUTDOWN. Reuse those charts and their current-observation
contract; keep the original admitted Db/binding until settlement. SDK close must
follow their drain, just as in the existing Finance application. Do not rebuild
that policy in the Worker message listener or introduce a command-owner registry.

The account persistence leaves now live in `data/accounts.ts`, separate from
`data.ts`'s unrelated Svelte-dependent helpers. The existing `data.ts` exports
re-export those exact functions, keeping current callers, canonical account
validation and local-tier settlement unchanged. The three-engine read fixture
imports and executes the real archive leaf inside the Worker, then checks that
the subscribed row disappears; the product protocol still exposes no writes.
All nine native cases, strict candidate checks, full SDK60 app/browser-test types
and 42 existing account/data cases pass after this extraction. Logs:
`/private/tmp/finance-account-leaves-{unit,types,alpha67-native}.log`.

The remaining C6 work is domain-owner integration, not another persistence leaf.
Supply actual membership/grant/account facts inside the Worker;
never treat a rendered account row as write permission. Reuse existing account
presentation/action feedback rather than designing another financial form.
Balances, transactions, other forms, bank workflows, backup/restore UI, recovery,
remote acquisition, shell/routes and full application drain/parity remain before
Finance can use this runtime as its production replacement.

## Finance archive integration model

Implemented in the candidate: the real archive UI now sends the validated command
to the existing domain chart. Permission/duplicate/scope decisions and write drain
are unchanged. Both legacy and Worker views share the extracted archive button
and feedback components; the existing strings/icons are retained. A generic
invariant helper moved out of bank-sync so archive does not import unrelated
bank actor/SDK types. There is one implementation and the old bank export remains
compatible.

Full Finance static checks and **1,946 unit tests pass**, including 18 host cases.
All **12 native cases pass** across Chromium/Firefox/WebKit, including the actual
archive button, live row removal and success feedback, plus close while a native
archive receipt is deliberately held. That hold follows native local settlement;
unit cases independently hold the write leaf and cover duplicate admission,
A → B → A, viewer/foreign-grant refusal, stale commands, rejected writes without
replay and unexpected child completion. SDK close cannot begin until the original
archive owner completes SHUTDOWN. The runner reuses Finance's existing SVG plugin,
icon package and type declaration; no workspace dependency is added.

Logs: `/private/tmp/finance-worker-archive-{types,unit,full-unit,alpha67-native}.log`.
Production activation, account creation and the remaining forms/app integration
are still required; this does not qualify full Finance parity.

The next implementation reuses `createAccountArchiveMachine` as one fixed
host-lifetime invoked child. Workspace and native identity changes update its
observations without stopping it; an issued write retains its admitted native
binding through settlement. Native account, membership and grant subscriptions
supply copied facts inside the Worker. The existing chart owns validation,
permission admission, duplicate refusal, scope interruption and SHUTDOWN drain.

The validated ARCHIVE_ACCOUNT command includes the selected workspace revision;
the host refuses obsolete selections before forwarding to that existing child.
The wire contains only row action availability and bounded feedback. The existing
archive button/feedback presentation is shared by the legacy account view and
Worker view; no financial policy moves into Svelte.

CLOSE first sends SHUTDOWN to the archive child and waits for actual completion.
Only then may native session, AccountStore and broker closure begin. Query
failure can withdraw data while a write settles; it must not stop the archive
child. Forced child stop/failure cannot establish a successful drain. There is
no new operation registry, detached root actor or async message-handler write.

## Worker-owned account creation and form transport

Account creation now runs through the existing `createAccountCreationFormOptions` and shared
scoped form machine inside the alpha.67 application Worker candidate. The native binding closes
over its original Db and calls the single existing `data/accounts.ts` create implementation.
The real existing AccountForm presentation is reused: Window extracts FormData, forwards a scoped
command and renders the bounded view. Validation, duplicate names, membership admission, operation
results and settlement stay with the original worker-side form actors. Workspace default currency
is included in copied directory facts; no new wording, catalog generation or SDK patch is added.

The existing Local First form machine now selects plain message descriptors from state metadata.
Its public views no longer carry formatting functions. The Svelte feedback component supplies the
same callbacks and formats the selected descriptor using the current locale. A shared native Zod
view projection takes consumer result/reason schemas and strips private recovery checkpoints before
structured cloning. The worker retains those checkpoints; the wire is not a recovery journal.
Profile form wrappers and existing fixtures use this same presentation contract.

Resource model: each SDK binding owns one forms actor, with one fixed account-creation child.
The form child's states/effects remain unchanged. Its group owns active → closing → closed and an
unexpected-failure state; only actual child completion after SHUTDOWN produces closed output.
The host starts the SDK-bound group with native `enq.spawn`, observes it with `enq.subscribeTo`,
and explicitly retires its observer on completion. These supported APIs let the original native Db
remain bound through issued-write settlement. There is no per-call population, remote actor API,
SDK facade or separately started child root. A replacement SDK binding withdraws its views, drains
the old group, and only then creates the replacement. Workspace changes update owned observations;
public observation identity plus the workspace revision rejects stale child views.

Commands include both sessionRevision and selected workspace/revision. This rejects commands
rendered by an old native binding even when a replacement retains the same identity/workspace IDs.
Host CLOSE sends SHUTDOWN to archive and forms together; independent parallel XState regions
retain each completion. Neither region resets the other's acknowledgement. Only both completions
permit the existing SDK → AccountStore → exact broker receipt close sequence. Cleanup failures
cannot be overwritten by a late form completion, and unknown writes are never replayed.

Qualification: all **1,954 Finance unit tests**, including **25 host cases**, pass. Full Finance
static checks and shared library Svelte checks report zero errors/warnings. All **54 shared form
cases**, packaging/publint and the public consumer suite pass. The alpha.67 actual application
Worker/UI candidate passes strict types, zero-warning Svelte checks and **15 native cases** across
Chromium, Firefox and WebKit. These include account creation with TZS workspace defaults, existing
archive UI/held receipt closure, and a UI-created account retained through two complete browser
process restarts while app/auth/Jazz endpoints are unavailable. Unit cases also cover invalid and
duplicate names, read-only access, same-ID session replacement, held creation on SDK replacement,
no old feedback/replay, and simultaneous creation/archive settlement before native close.

Logs: `/private/tmp/finance-worker-creation-{types,unit,full-unit}.log`,
`/private/tmp/finance-form-transport-{library-types,library-unit,consumer}.log`, and
`/private/tmp/finance-creation-alpha67-native.log`. The maintained fresh upgrade runner also passes **200 native schema/permission/backup/restore
cases, 42 existing worker/session cases and the 15 actual Worker/UI cases** from published
alpha.67 SDK/Wasm tarballs and the built public packages. Its artifacts are
`finance-jazz-alpha67-v5E6pm` under the system temporary directory; log:
`/private/tmp/finance-creation-fresh-alpha67.log`. Production routes/pins and the remaining Finance features are not
activated by these results. Continue with the existing manual transaction workflow and its copied
reference facts, then the remaining domain/identity/provider/backup flows and coordinated rollout.

## Worker-owned manual transaction entry without attachments

The candidate now reuses `createTransactionEntryFormOptions`, its availability actor, staged
transaction/check/tag persistence and local-settlement/uncertain-outcome handling. The SDK-bound
forms group invokes one fixed transaction-entry child alongside account creation. Its active state
forwards copied workspace/member/grant/account/category/tag facts and scoped intents. Closing sends
SHUTDOWN to both children; independent parallel regions await both actual completions. Unexpected
child failure stays a failure. Replacement retains the original Db and issued effects until the
old group settles. No second transaction dispatcher, SDK patch or workflow copy was introduced.

Window reuses the actual TransactionForm and existing feedback for inputs, focus and FormData.
As in the existing integration, it mounts the form only when worker-owned readiness is ready, so
native defaults are present at mount. Attachments are absent in this first slice, as W15 specifies;
the existing form's optional attachment presentation defaults to enabled for all legacy callers.
Domain selectors choose writable accounts, categories/tags and defaults in the Worker. The existing
selection revision now scopes selected workspace plus income/expense context; no additional owner
or generation registry is required. SessionRevision separately rejects retired native bindings.

Native observations are consolidated under one fixed XState query owner. It owns six fixed native
subscription actors and running → failed cleanup, reusing one small callback implementation for
subscription/report/disposal. This replaces repeated observer and forwarding blocks in the host.
It publishes one bounded immutable fact report; it makes no financial/access decisions. A new
selection retains the same-session directory and withdraws selected account/member/grant/reference
facts. A new native session withdraws everything. Obsolete callbacks/reports are rejected by the
owned binding, and disposal failure goes directly to the live parent so stopping an observer cannot
drop its failure report. Actual synchronous unsubscribe still precedes native close.

All **1,961 Finance unit tests**, including **32 host cases**, and full Finance static checks pass.
The focused host/transaction batch passes 107 cases, including expense/income staging, invalid
amount/reference refusal, expense → income → expense command rejection, held local settlement on
host close, and SDK replacement without replay or old feedback. All **18 native Worker/UI cases**
pass in Chromium, Firefox and WebKit. The real forms save both transaction directions and cash
payment metadata; a UI-created account, expense and account edit survive two complete browser
process restarts while app/auth/Jazz endpoints are unavailable. Existing native archive/drain,
workspace switching, UI detach and malformed-view cases remain intact. Window/Worker graph and
one-broker checks still pass with development XState freezing enabled.

The fresh maintained `--worker --sdk=2.0.0-alpha.67` run also passes all **200 schema/permission/
backup/restore** and **42 existing worker/session** cases before those 18 application cases.
The runner copies the current source and shares one native query-import rewrite for TypeScript
and Svelte callers. The actual browser slice uses the application's native Vite/Bundler TypeScript
resolution; the SDK/session/Node proofs retain NodeNext. Pica is the exact existing workspace
version, added only to the proof's dependency inventory, with no workspace dependency change.
Artifacts: `finance-jazz-alpha67-SLh38i` in the system temporary directory. Logs:
`/private/tmp/finance-worker-transaction-{types,unit,full-unit}.log`,
`/private/tmp/finance-transaction-{alpha67-native,fresh-alpha67}.log`.

Production routes/pins and full Finance parity remain open. Continue with worker-owned balances
and bounded ledger views, then remaining domain/identity/provider/backup flows and coordinated SDK
activation. Hosted Finance and Clipper passed at the prior account-creation checkpoint. Foundation's
format failure was corrected at `01ed521c`; the separate unchanged UI native swipe case failed once
in CI and passed its focused local reproduction with tracing. That does not establish a product
fix or a clean hosted Foundation run; keep checking the next CI result.

## Worker-owned balances and bounded ledger projection

Extend the same fixed query owner with one native transaction/tag observation for the selected
workspace. Keep both directions in that Worker snapshot so the existing exact account-balance
calculation can use all transactions while the ledger selects the current direction. Reuse the
existing filter/date-grouping/pagination behavior in worker-side pure projections. Native category
and tag observations include archived names for historical records; the existing form selectors
continue to offer only active references, avoiding duplicate native subscriptions.

The host owns filter and requested-page facts. Scoped filter/page intents use the existing session
and selection revision; they never issue financial writes or start another SDK owner. Scope
replacement withdraws ledger/balances with the other query facts. Query failure retains the existing
failed-read behavior and does not stop issued financial effects. Pending native reads are loading,
not zero balances. Send at most 25 visible transaction rows, whole-day totals and the metadata that
presentation needs; do not send the unbounded transaction snapshot to Window.

Separate the existing TransactionList's pagination calculation from its reusable rendering so the
Worker can supply the selected page directly. Preserve the existing controls/labels, native links,
focus and locale formatting. Date grouping uses exact bigint totals and the existing bigint money
formatter, keeping totals safe when several individually safe amounts exceed Number precision.
Existing callers use the same extracted paging helper until their own worker adoption. No new
catalog, dependency, data migration, layout design or SDK patch is required.

Qualify live balances after expense/income, date/currency/text filtering, page bounds and whole-day
totals across page splits, stale intents/reports, exact large sums, and native retained ledger data.
Continue existing no-replay and close/replacement checks. Account ordering/sidebar preferences,
transaction details/edit routes and complete app activation remain separate parity work.

Implemented and qualified in the candidate. The shared list is split into a pure rendering view
and its existing legacy paging wrapper. Window receives at most 25 minimal rows, visible metadata,
whole-day bigint totals and filter choices. Native queries, search, grouping, exact balances and
page selection stay in the Worker. Missing reads remain unknown; observed empty reads yield zero.

Qualification: **1,965 Finance units** (including **33 host cases**), complete Finance static
checks with zero errors/warnings, and **21 native application cases** across Chromium, Firefox and
WebKit pass. Native cases exercise real SDK writes, live balances, page changes, memo search without
sending memo text to Window, whole-day totals, local retention and shutdown. The fresh maintained
Jazz alpha.67 run also passes **200 schema/permission/backup/restore** and **42 worker/session**
cases before those 21 application cases. Two existing full-application pagination browser cases
pass against the legacy wrapper, covering URL/history/filter resets and full-day totals across
pages. Shared form static/unit/public-consumer checks and Core lint pass after the presentation-only
feedback export fix. Hosted CI must still be checked independently.

Fresh artifact: `finance-jazz-alpha67-Kh1iTf`. Logs:
`/private/tmp/finance-ledger-{fresh-alpha67,alpha67-native,legacy-pagination}.log` and
`/private/tmp/finance-feedback-presentation-{types,unit,consumer}.log`.
Production activation, details/edit and remaining Finance parity stay open.

## Earlier accessor proposal (superseded)

Keep the mutable SDK facade outside immutable chart context, under the **existing
session owner's lifetime**. Retain only a typed accessor to that exact facade
where a chart needs custody; the accessor returns the handle and makes no
lifecycle decisions. Continue to pass native session observations/events and use
the current scoped acquisition, attachment, domain-drain and close protocols.

For example, replace the internal payload `session: Session` with
`readSession: () => Session` at retention boundaries. Do not create a second SDK
facade, registry, RPC layer, actor population or application-owned class. Audit
the shared acquisition/attachment charts and both apps' retention points together;
changing only the Clipper test fixture would conceal the production-source issue.
Public `selectAcquiredSession` can keep returning the exact native facade.

The alternatives are less suitable: patching Jazz's getter introduces another
SDK patch; disabling XState's checks hides unsafe resource traversal; replacing
the existing owner with Svelte ownership does not cover the worker lifetime.

Qualify real signed-out/starting/ready SDK sessions against
development XState, acquisition retry and interrupted attachment, same-account
and A → B → A replacement, and actual SDK close after domain drain. Keep the
production native restart/Svelte proof as separate coverage. U2 remains open.

## Worker-owned selected transaction editing

Keep one selected transaction ID in the application's existing context selection. Opening or
leaving an editor advances the same selection revision, withdrawing old views and rejecting stale
form commands. The existing query owner invokes one native selected-row subscription alongside its
reference observations; an absent selection starts no detail read. Copy the selected transaction,
check and tag references without fetching attachment bytes. Pending, missing and failed reads remain
distinct observations and use the existing form availability policy.

Invoke a third fixed form under the SDK-bound forms owner using the existing edit form options and
transaction submission chart. It owns draft comparison, validation, authorization, staged writes,
settlement, scope interruption and unknown outcomes. Drain all three form children before native
session replacement/close. No new save implementation or call-owner population is needed. The
ordinary edit form shares the existing TransactionForm presentation and sends only scoped intents;
Window receives one bounded initial-value projection, never SDK rows or a query API. Transfer and
attachment controls remain pending their existing workflow adoption; this slice cannot activate the
production replacement. Qualify expense/income edits, unchanged/reset behavior, stale selected-row
reports and intents, reference loss, pending-write scope replacement and native offline retention.

Selected editing is implemented in the candidate with the existing edit policy/save chart,
one additional fixed form and one metadata-only native detail observation. The shared form UI also
renders observed read-only values. Selected IDs, reference snapshots and scoped commands withdraw
on context replacement; all three forms drain before native SDK close. The ledger keeps its page
when opening/leaving a detail in the same workspace/direction.

Qualification: all **1,966 Finance units** (34 host), complete
Finance/browser-test types and static checks, and **27 actual worker browser cases** pass. The native
matrix covers expense/income/check editing, unchanged/reverted drafts, repeated edits, account moves
and edited transactions through two offline process restarts. Ledger checkpoint `05ce9fb5` passes
all hosted Finance/Foundation/Clipper workflows.

The check/account-move operation also failed once on WebKit before native error instrumentation,
matching the partial-result shape of the separately retained alpha.60 hosted failure. A later full
27-case run and eight bounded WebKit diagnostic samples pass; they do not establish a fix. Retain
that failure as an open activation blocker. Fixture-only XState inspection now reuses the existing
sanitized error projection, extracted unchanged from environment-bound logging so it can run in a
Worker. It never exports actor snapshots, draft data or credentials. No automatic retries, timeout
changes or financial recovery behavior were introduced. Logs:
`/private/tmp/finance-worker-edit-{static,tests-types,full-unit,native,diagnostic}.log` and
`/private/tmp/finance-worker-check-move-probe.log`.

## Worker-owned native workspace initialization

Reuse Finance's existing finite workspace initialization chart under the SDK-bound workflow owner,
alongside the fixed forms. It captures the native Db and identity once for that SDK binding, reads
local profile/workspace markers first, and requires confirmed authoritative emptiness before initial
creation. Empty or missing offline reads never authorize a replacement workspace. Initialization is
independent of foreground account/ledger usability; known local data remains usable while an optional
authority read is unanswered. Do not add a second startup policy or seed fake data in this slice.

Retain the initialization child through scope changes. SDK replacement/close sends its existing
SHUTDOWN command and waits for its finite terminal outcome alongside the three forms. Completed
initialization is a fact, so shutdown does not send commands to a completed child. Unexpected child
failure uses the existing failed-drain path. Publish only a bounded startup observation, keeping
native resources/results in the Worker. Root routes/chooser behavior and retry presentation remain
with the later shell integration; this chart does not infer a selected workspace from partial rows.
Qualify warm marker reuse, unknown/empty offline reads, initial creation with an actual native
authority, no duplicate initialization on workspace selection, interrupted native writes and close.

Implemented and qualified. A real native authority exposed a candidate configuration bug: the
broker's UUID was also used as Jazz's app scope. Window now creates a dedicated host UUID for
broker messages/close receipts; SDK scope remains the configured canonical endpoint/namespace.
The native authority accepts that device proof without relaxing origin or authentication checks.
The existing shared broker and SDK patch are unchanged. The candidate entry overlay only changes
which host ID it passes to the broker. AccountStore binding still uses the native SDK app scope.

All **1,968 Finance units** (36 host), full Finance static/browser-test checks, and **30 native
application cases** pass. The new three-engine cases initialize a workspace against actual Jazz
without fixture writes, create an account through the UI, stop the authority, and retain the same
workspace/account/profile marker after a complete browser-process restart. Existing cases preserve
known local usability, edits, pages and drain behavior. Host tests prove that an unanswered authority
read does not block finance, workspace changes do not restart initialization, late reads do not create
workspaces after closure, and issued initialization writes settle before SDK close.

A fresh maintained alpha.67 run from published SDK/Wasm packages and packed libraries passes
**200 schema/permission/backup/restore**, **42 worker/session**, then those **30 application** cases.
Artifact: `finance-jazz-alpha67-6UPXKy`. Logs:
`/private/tmp/finance-worker-startup-{static,test-types,unit,full-unit,native,fresh-alpha67}.log`.
The active alpha.60 app is unchanged. Identity UI, shell/chooser navigation, optional seeding,
initialization retry presentation and remaining domain/provider/backup parity remain open.

## Existing recovery dialog with worker-owned key export

Reuse Local First's recovery dialog and private UI interaction actor unchanged. Opening/hiding the
dialog, focus and clearing its displayed phrase remain UI responsibilities. The Worker publishes
only device-account availability; the existing native SDK adapter validates scope and exports/encodes
the key in the Worker after an explicit reveal. Bind its public source/capability contract to the
existing worker client rather than moving a Jazz session or SDK crypto onto Window.

Use one native MessageChannel for each explicit resource-free key read, with a validated session
revision and a bounded private result. Ordinary Finance views, inspected actor state, logs and
persistent stores never carry the phrase. The client validates replies and closes its port; the
Worker closes the reply port on either outcome and rejects retired/closing SDK bindings. The
shared dialog's existing hide/unmount/scope-change behavior clears sensitive UI state. No registry,
SDK patch, data migration or new localization is needed. This does not authorize restoration or
sign-out before domain drains; those remain the next identity-write slice. Qualify no startup
export, explicit reveal/hide, UI detachment, scoped failure and close during reveal across engines.

Implemented using the existing public Local First recovery integration, UI actor, dialog and
messages. The UI adapter maps the Worker's availability/revision observations into that existing
contract; the SDK adapter performs the actual scoped export/encoding in the Worker. A private
MessageChannel carries each explicitly requested result, with no generic request registry. Replies
are validated, stale/closing bindings are refused, and both reply ports are released. The shared
UI actor remains private and clears its phrase on hide, detach, scope loss and close. Finance's
ordinary Worker view and inspected financial actor tree never contain the phrase.

All **1,969 Finance units** (37 host), complete Finance/browser-test static checks with zero
warnings, and **33 native browser cases** pass. New three-engine cases assert zero startup exports,
explicit reveal, same-key repeat reveal, no phrase in public Finance views, clearing on hide and
UI detach/remount, and close during reveal. The same 33 cases pass through the incorporated
readable-candidate source assembler. The candidate worker entry matches the tested entry byte for
byte; the retired worker-entry patch stays deleted. No SDK patch or public shared implementation
changed. Logs: `/private/tmp/finance-worker-recovery-{combined-static,test-types,unit,full-unit,native,combined-native}.log`.
Startup's preceding fresh qualification remains 200 schema/restore + 42 session + 30 application
cases at `finance-jazz-alpha67-6UPXKy`; the extended 33-case application run uses that same native
artifact. Restoration/sign-out, complete shell navigation and remaining parity/activation stay open.

## Next foundation: one restartable SDK-bound financial group

Before identity writes, move the existing archive chart into the same SDK-bound workflow group as
initialization and the fixed forms. Keep its existing observation, permission, write and settlement
logic. The group forwards its public report and rejects an issue against replaced SDK/selection
facts. It closes archive in a fixed parallel region alongside its other children.

Remove the permanent archive child and duplicate archive-close region from the application root.
The root then drains one financial group before SDK closure; a later identity operation can drain
that group and create a fresh one after settlement. This avoids adding another identity-specific
archive lifecycle or restarting the whole application/SDK owner. Preserve stale-command/report
refusal, same-ID SDK replacement, receipt-held archive shutdown and known local usability.

Implemented and qualified without changing archive policy or persistence. Its existing binding
correlation is retained: completion refreshes the observation, so object-reference correlation
would incorrectly discard its result. The application now drains one SDK-bound group, and that
group drains archive, initialization and the three forms together. Same-ID SDK replacement waits
for a held archive receipt, creates a fresh group, and publishes no old feedback or replay.

All **1,970 Finance units** (38 host), full browser-test types, zero-warning Finance static checks
and **33 native application browser cases** pass. Native cases retain receipt-held shutdown,
selection/access replacement, offline restarts and the recovery dialog. Logs:
`/private/tmp/finance-worker-financial-group-{static,unit,full-unit,test-types,native}.log`.
This is the foundation for restoration; it does not activate the candidate or change SDK pins.

## Private restoration through the existing session actor

At the actual Worker host boundary, create one private finite Local First restoration actor per
explicit restore request. Never inspect or persist that actor, its phrase, parsed credential or
native session commands. Reuse its phrase parser, validation, preparation permit, native session
change child, cancellation and terminal output. Keep one active operation reference and a monotonic
attempt within the session-host binding; no per-financial-call registry or replacement SDK wrapper.

Register only the operation's non-secret scope/reference with Finance before starting it. Validation
may fail without draining Finance. On its existing PREPARE request, Finance withdraws admission and
queries, advances the public revision, and drains the SDK-bound financial group. Grant PREPARED only
after that group's actual terminal receipt. During mutation, SDK observations cannot restart domain
work. On the private actor's terminal output, observe the existing SDK connection and create a fresh
financial group even if a recoverable failure retains the same SDK binding. Cancellation during the
drain retains that drain before resuming; close takes precedence, cancels the private workflow and
uses the SDK owner's existing issued-mutation drain before storage/broker closure.

Window forwards an explicitly submitted phrase directly to the host decoder, clears the input,
and renders bounded progress/error facts through the existing LoginForm. No phrase enters the
ordinary Finance command schema, public snapshots or financial inspection tree. Reuse existing
localized copy. Qualify invalid phrases without mutation, no automatic retries, same-ID recovery,
restoration of existing remote finance, delayed financial receipts, close/cancellation, stale
completion refusal and persistent offline restart. This remains an isolated candidate until the
remaining parity and activation blockers have been resolved.

Implemented using the existing Local First restoration and private session actors. All **1,978
Finance units** (46 host), full Finance/browser-test types with zero static warnings and **39
native application cases** pass. New three-engine cases restore a real account from a different
browser profile, recover its existing workspace/transaction, and retain that identity and transaction
after a full process restart with the authority stopped. Invalid phrases clear the input without
changing identity. A held archive blocks the mutation; UI detachment/remount does not lose custody.

Native alpha.67 `session/state.js` calls `shutdown({ waitForSync: true })` before account replacement.
With pending writes and an unreachable authority it returns `GracefulShutdownSyncError` and keeps
the old client usable. The fixture now captures that exact sanitized native error at the I/O leaf,
without inspecting private actor input or context. Finance resumes with a fresh financial group,
withdraws old feedback and never retries the restore automatically. This native refusal is preserved;
there is no forced shutdown, data reset, SDK patch or application sync workaround. Ordinary local
finance and cold-reopened restored identities remain available offline.

Host cases cover invalid input, drain-before-mutation, same-binding SDK rejection and resume,
cancellation while draining, SDK replacement during validation, repeated signed-out observations,
selection revision during the drain, stale terminal output and close during an issued native restore.
Logs: `/private/tmp/finance-worker-restoration-{static,test-types,unit,full-unit,native,native-final}.log`.
Hosted Finance, Foundation and Clipper all pass at preceding checkpoint `cef5aa4b`; the earlier
intermittent check/account-move and extension-toolbar failures remain recorded, not declared fixed.
Sign-out/new-account commands, complete shell/navigation and remaining domain/provider/file/backup
parity and coordinated activation are still open. Active SDK pins and production routes stay unchanged.

## Next shell foundation: reuse the recovery coordinator's navigation

Actual source inspection finds no Finance sign-out or explicit new-identity screen. Automatic
native account creation is already part of startup. Do not add new sign-out/create UI or make
new commands a Finance parity gate. Earlier follow-up lists overstated that scope. Existing
workspace chooser, route/default selection and post-recovery navigation are the next required flow.

Reuse Finance's workspace-navigation chart and Local First's session-recovery coordinator. The
latter already separates successful restoration from navigation failure and navigation-only retry,
and retains issued navigation during shutdown. Its navigation-facts leaf currently accepts only
the legacy `getSnapshot().account.id` shape. Add the library's own typed SessionRuntimeConnection
as an input variant and normalize that observation in this one leaf; preserve legacy callers and
all existing state transitions. A non-active runtime must never qualify as a ready identity just
because it retains an old observation. No SDK facade, SDK-shaped proxy or new navigation workflow
is needed. Qualify actual session-actor identity facts, refusal during closing/replacement and
navigation-only retry without another identity mutation before wiring the Worker/Window navigation
capability. Native goto/history stays a narrow Window effect; route/eligibility decisions stay in
the existing Worker-owned charts. Production routes remain untouched while shell parity is built.

The additive coordinator connection is now qualified: **1,249 Local First units**, full library
static checks, strict package validation and existing public consumer checks pass. Finance's
existing readiness/navigation plus worker ownership tests pass (**165 cases**), with zero static
warnings. All **42 actual native worker/session browser cases** pass against the updated built
coordinator. The native fixture now exercises a navigation failure and a navigation-only retry
through its real Jazz session connection, and verifies no identity mutation was repeated. Its
navigation callback is deliberately a fixture leaf; native Window goto is the next integration.
No coordinator lifecycle or legacy caller behavior changed. Logs:
`/private/tmp/finance-worker-recovery-connection-{unit,full-unit,static,package,consumer,native,finance-static,finance-unit}.log`.
Hosted Finance, Foundation and Clipper also pass at restoration checkpoint `7778311e`.

### Native post-recovery navigation integration model

Create the existing `sessionRecoveryMachine` directly as the private root at the actual Worker
host boundary. Its optional explicit report recipient reuses the existing parent-report protocol
without adding a wrapper actor. Finance receives only non-secret attempt notices and terminal
facts. Attempts are monotonic within this fixed Worker/session host; terminal/error reports also
carry the captured host binding. The coordinator clears its request after invoke input is bound,
owns its existing active/closing/terminal behavior, and retains issued Window navigation through
SHUTDOWN. Raw phrases, credentials and private snapshots never enter Finance's inspected tree.

A native MessageChannel carries each selected Window navigation and its bounded success/failure
reply. There is no generic RPC registry or queue. The existing `WorkspaceNavigate` capability is
injected at the client boundary; the SvelteKit host will supply native goto, and browser fixtures
supply actual history effects. Window observes the relative URL and reports it as a typed Finance
fact; popstate/router observations invalidate stale origin intent. Window rechecks expected origin
adjacent to the native effect. UI detach leaves the application/client alive.

The private coordinator owns restoration versus navigation-failure classification. Retain its
non-secret navigation retry facts so retry creates a navigation-only coordinator and never repeats
SDK mutation. Finance close drains financial work and the private identity/navigation owner in
parallel before SDK/storage/broker close. A private owner failure releases that dead owner's wait,
withdraws admission and uses the SDK owner's existing actual-mutation drain; never await a dead
actor or report its uncertain result as a settled success. Qualify origin change, failed navigation,
navigation-only retry, UI detach and close while the native navigation receipt is held.

Implemented with the shared coordinator directly, using its additive optional `reportTo` input.
There is no extra Finance recovery wrapper machine. Existing invoked consumers keep their parent
recipient. Finance holds only the private actor reference, non-secret notices/results and typed
current URL facts. Navigation-only retry uses the retained result facts and the same shared chart.
The Window transport performs one injected native navigation and returns a bounded receipt; the
Worker keeps that receipt alive through close. Transport failure withdraws retry/restore capabilities.

Qualification: **1,982 Finance units** (50 host), **1,250 Local First units**, full Finance/library
static and browser-test types, strict package/public-consumer checks, formatting and denied-warning
lint pass. All **39 native Chromium/Firefox/WebKit application cases** pass with the direct private
coordinator. The strengthened real-authority recovery case exercises redirect failure, the existing
Try again control, a navigation-only retry, changed-origin refusal, close while a Window navigation
receipt is held, actual history effects, and retained transactions after an offline process restart.
The final permission-withdrawal adjustment also passes the three native malformed-view/clean-close
cases; its final native types pass after applying the same query import port as the maintained runner.
Earlier full Finance compatibility checks used the isolated installed package copy; this final run
explicitly injects the newly built coordinator into that copy as well as the alpha.67 native artifact.

Logs: `/private/tmp/finance-worker-navigation-{static,full-unit,test-types,unit,native-final,fault-final,fault-final-types,core-unit,core-static,core-package,core-consumer,core-consumer-runtime}.log`.
The preceding native worker/session matrix remains **42 passing cases**, and hosted Finance,
Foundation and Clipper all pass at checkpoint `198a57c5`. Current-head hosted CI is checked separately.
Full workspace chooser/default/legacy-route handling, shell preferences and remaining domain parity
are still open. Native history capability qualification does not claim complete SvelteKit shell
integration or production activation. No SDK patch, active pin, catalog or production route changed.

### Workspace navigation drain before reuse

Actual SvelteKit 3 source/types show `goto` returns its completion promise and has no AbortSignal
option. WorkspaceBootstrap checks its signal/origin before invoking native goto; aborting the
XState promise actor after that call cannot cancel the navigation. The existing workspace navigation
chart currently takes SHUTDOWN directly to final, even with that invocation outstanding.

Before Worker reuse, retain the existing navigating invoke in an active/closing compound state.
SHUTDOWN enters closing, refuses further observations/selection/retry and waits for the selected
native promise to fulfill or reject before final close. Both results settle an interrupted UI effect;
neither retries navigation. Keep resource-free profile/legacy lookup interruption unchanged.
This also improves the legacy caller's shutdown behavior; it does not change normal routing policy,
SDK ownership or production routes. Existing transaction view-transition hooks resolve their
onNavigate barrier before navigation completion, and bank beforeNavigate does not await a workspace
drain, so these inspected hooks do not introduce a navigation/drain dependency cycle.

Implemented and qualified: all **1,984 Finance units**, zero-warning Finance static and complete
browser-test types pass. Held native-navigation success/rejection cases prove SHUTDOWN waits and
refuses newer selection/retry/observation commands. Existing legacy lookup cancellation stays
covered. Three actual SvelteKit browser flows pass using an isolated memory authority: sole-workspace
canonicalization/reload, both workspace selectors, and unavailable scope/legacy detail resolution.
Logs: `/private/tmp/finance-worker-workspace-navigation-{unit,full-unit,static,test-types,browser}.log`.

SvelteKit's actual client also rejects superseded navigation tokens before applying the old route
(`navigation aborted` checks in `client.js`). Keep that native latest-navigation behavior; do not
add a producer queue or per-call navigation owner. This change only retains the chart's current
navigation invocation during explicit shutdown. Full Worker route observation and reuse remain next.

### Worker-owned workspace route observation

Reuse the existing workspace-navigation chart as another fixed child of the SDK-bound workflow
group. The native binding supplies its real Db and the existing Window navigation capability.
Group observations contain current route, identity, directory and locally observed access facts;
the child retains default-workspace/profile and legacy transaction lookup policy. It publishes its
existing generation/status report, and the group drains it before SDK replacement/close.

Window's router supplies typed pathname/search/hash observations with the same monotonic selection
revision already used by the client. The Worker parses workspace/transaction context and makes
navigation decisions; native goto/history remains Window-only. A route observation is required
before routing starts, allowing existing bounded feature consumers to attach without inventing a
route or triggering navigation. This is missing input data, not a second SDK owner or runtime flag.
Explicit workspace navigation and retry commands are scoped to current session/selection. The UI
receives only bounded navigation status/presentation facts and uses existing scope notices/copy.

Keep current routing policy, late empty-directory/default resolution, denied explicit scope and
legacy-link behavior. Use native Svelte navigation supersession rather than add a custom producer
queue or per-call owners. Qualify native default entry, directory changes, explicit switch, denied
scope, legacy details, actor replacement/drain and existing low-level feature consumers. Full shell,
URL/filter/back-forward parity and production activation stay separate until their checks pass.


Implemented and qualified: **1,989 Finance units**, including **55 host cases**, zero-warning
Finance static checks and complete browser-test types pass. **42 native application cases** pass
across Chromium, Firefox and WebKit. Native history observes the actual worker-selected default,
late directory arrival, explicit workspace switch, denied scope and legacy transaction lookup;
close retains an issued Window receipt. Focused host coverage also proves same-ID SDK replacement
waits for that receipt and an explicit current retry restarts failed subscriptions without replay.
Existing feature consumers without route observations retain their prior behavior.

Latest hosted Finance/Clipper qualification passes at `ea2dddc9`; Local First's full check exposed
an incorrectly narrowed test-root type in the new explicit-recipient recovery test. `2c1430af`
changes that annotation to the native concrete actor type; full Local First static/type checks and
all 12 recovery tests pass. Earlier library-only checks excluded the test file; full config is now
included for this correction. Runtime code is unchanged by the correction.
Logs: `/private/tmp/finance-worker-routing-{static,test-types,full-unit,unit,native}.log` and
`/private/tmp/finance-worker-routing-core-{full-static,full-types,unit}.log`.

Next: reuse existing `q`/date/category/currency and strict positive page URL parsing; preserve native
replace/push and back/forward observations. The shell is not activated until remaining parity is
qualified. Do not add another router, session, navigation queue or SDK patch.


### URL filters and browser history

Reuse the legacy transaction list's pure URL parsing in the existing filter module. Both the
legacy Svelte integration and Worker consume the same `q`, start/end, category/currency and
strict positive safe page semantics. An observed route remains the source of the Worker list
selection; default routing must retain a directly requested page until records arrive.

When a routed consumer requests a page/filter change, the Worker selects a destination using
existing query helpers and sends one NAVIGATE command to its fixed navigation child. Native
replace semantics match existing shallow list updates; filter changes remove page. Only a later
Window route observation changes the Worker selection. Non-router feature consumers retain their
bounded direct commands. No second router, custom history stack, request owner or optimistic URL
state is introduced. The existing navigation child owns failures/retry/close settlement.

Window reports browser popstate and router observations using the existing monotonic revision;
closing clients must retain their closing status and still accept the terminal close receipt.
Qualify direct page/filter URLs, replacement history, back/forward, stale intents, invalid page
values, and preservation of unrelated query/fragment values before shell integration.


Native typing qualification found that reusing blocking workspace navigation for a filter update
unmounted the search control in all three engines (42 existing cases pass; the three new typing
cases fail). Add `navigating.updating` beside the existing active/closing states. It owns the same
native invocation and drain but reports `updating`, preserving content while replacing history.
Worker-generated list updates select this state; workspace/default routing retains blocking
`active`. Changed identity/route observations still reenter assessment. This is a real distinct UI
outcome in the existing chart, not an optimistic cache or second navigation owner.


Qualified URL/history implementation: **1,998 Finance units** (62 Worker host cases) and all
**45 native Chromium/Firefox/WebKit application cases** pass. Focused native typing/focus and
back/forward checks pass independently in all three engines. Eight existing pagination cases
and three actual SvelteKit workspace-navigation cases pass after extracting the shared parser
and making newer explicit navigation requests reenter the existing invocation. Current static,
complete browser-test types and native candidate types pass with zero warnings.

Filter-only observations retain the same query binding; workspace, kind or selected-detail
replacement still withdraws and rebinds it. Window retains the last bounded rendering until the
Worker classifies the route. The monotonic route revision rejects older reports, and stale command
headers cannot mutate the Worker. Native popstate registration is idempotent and is released with
the host. Pure history updates preserve content; failed updates still use the chart's existing
failure path. Root state does not claim the URL changed before Window reports it.

Logs: `/private/tmp/finance-worker-url-{unit,static,test-types,full-unit,native-final,legacy-browser,legacy-navigation}.log`;
the diagnosed three-engine input-unmount failure remains in `finance-worker-url-native.log`, and
the focused corrected cases are in `finance-worker-url-native-focused.log`.
Next: shared shell account selection/order and remaining feature parity. No production cutover.


### Reconcile merged PR51 before further coordinated SDK work

Latest main `1de0ea1a` contains the approved Clipper production lineage repair. It was merged
without changing its active schema/policies; both implementation handoffs were retained. The
isolated Clipper authoring port now preserves required `notes.documentId`, requires its Highlight
to share the same document/library, and discovers the exact existing native migration/snapshots.
No new SDK patch, data reset or application migration was added. Finance's qualified source is
unchanged by this reconciliation.

The legacy fixture first runs the alpha.60 native validator to build its migration index. It seeds
both the current reading store and the actual historical production `8a5130d42577` SQLite store
with alpha.60. Alpha.67 then opens the historical store through native generated bindings and
retains its app ID. This avoids using the new backend's rejected raw-schema configuration for old
fixture setup. The direct native text-range producer also removes an unnecessary parse/type
adaptation in a test; JSON imports and permission-file shape follow the SDK's native contracts.

A **fresh published alpha.67 proof passes all 61 native cases**, strict selected types (now including
migration and annotation tests), native generation and generate --check. The SDK's own
`artifactIdentity`/`identityDifferences` comparison confirms both schema versions
`8a5130d42577` and `5734b944387b` and bundle `be225472245b…` are exactly unchanged.
Existing policy checks include required document and cross-document Highlight refusal, reading
convergence, retained alpha.60 dates/sets and local notes after restart.
Artifacts: `/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha67-GDSK2h`;
log: `/private/tmp/clipper-pr51-native-schema-final.log`.
Earlier failures remain in `clipper-pr51-native-schema.log` / `clipper-pr51-native-tests.log`.

Alpha.67's stock upgrader source still refuses computed/transform markers (`dist/upgrade/index.js`);
Clipper's legacy reading columns contain those markers. Keep the already bounded native authoring
port and native transform declarations. Do not patch that SDK refusal or invent a general migration
framework. Full Clipper session/backend/provider adoption remains a separate gate.


### Shared shell account selection

The existing Worker application owns the current account-selection mask (`null` means all,
including later accounts; an empty list means none). Scoped checkbox/all commands update that
fact only for the current SDK/selection and observed accounts. Workspace/SDK replacement clears
it; filter/page/detail changes within the workspace retain it. Selection changes reset pagination,
using the existing navigation child to remove a routed page parameter. No SDK requery or separate
actor is needed for this pure selection fact.

Reuse the existing WorkspaceBootstrap selection calculation in `filters/finance-filters.ts`.
Ledger projection applies the account mask before text/date filtering, grouping and totals;
account balances remain totals across their full known ledger. Publish the empty-selection fact
for the existing list's no-accounts presentation. The Worker admits no financial operation through
this mask; native grants and existing financial charts retain authorization.

Extract the drawer's existing checkbox/balance/order presentation as a pure reusable component,
so legacy drawer and Worker view render the same native controls. This is shared presentation,
not a new shell/router or duplicate set of checkboxes. Existing ordering controls remain bound to
their legacy chart; the Worker ordering/persistence port remains the next distinct operation.
Qualify all/none/individual masks, balances, query retention, page reset, added accounts, stale
commands, workspace/SDK replacement and native checkbox interaction before broad shell adoption.


Qualified: **1,999 Finance units** (63 host), zero-warning full/native static and complete browser
types, **48 actual Chromium/Firefox/WebKit application cases**, and **13 existing account-order /
pagination browser cases** pass. Native checkbox interaction proves per-account filtering, the
existing no-accounts message, full known balances, page reset, inclusion of later accounts in all
mode, and workspace reset. Host coverage also proves unknown/stale command refusal and same-ID
SDK replacement reset without recreating subscriptions.

Account creation retains its existing independent controls. The shared account-selection component
renders the prior native checkbox/balance/order markup; ordering capability is present for the
legacy drawer and awaits its Worker port. New transaction defaults prefer selected writable
accounts; edit defaults retain the record's own account. Account selection only requests a native
URL replacement when there is actually a page parameter to remove.
Logs: `/private/tmp/finance-worker-account-selection-{unit,static,test-types,full-unit,native-final,legacy-browser}.log`.
The new scenario's corrected checkbox/visible-row assertions are independently covered in
`finance-worker-account-selection-native-focused-final.log` before the complete 48-case pass.


### Routed transaction detail intent

The existing root receives a session/selection-scoped OPEN_TRANSACTION intent (UUID or null for
return to list). It computes the existing transaction page path and list query and sends NAVIGATE
to the same SDK-bound navigation child; Window reports the resulting route before the selected
editor changes. Keep the low-level selectTransaction method for consumers with no router and bind
the routed UI to the explicit navigation method. These are distinct intents, not an SDK fallback.

Share the existing list URL read/write semantics in a pure route module. Legacy list links,
Worker-projected link presentation and Worker navigation use the same q/date/category/currency/page
mapping. Do not import financial filtering/aggregation into Window. Native modified/new-tab links
must carry the same query context as ordinary click intents. Back/forward restores the observed
list/editor/page; a stale editor command never navigates a replacement selection.

Reuse the existing navigation invocation, native supersession and drain. No new routing actor,
request registry or SDK boundary is needed. Qualify actual detail-link hrefs, native navigation,
back to list, browser back/forward, filtered page retention and stale command refusal before
claiming routed detail parity. This model is the next independent implementation while account
order storage choice is pending.


Implemented routed detail intent: **2,000 Finance units** (64 host), **51 real Worker application
cases** across Chromium/Firefox/WebKit, zero-warning full/native static and complete browser-test
types, and **eight existing SvelteKit pagination cases** pass. The new three-engine case verifies
actual link hrefs and native history through detail → browser Back → Forward → Back to List.
A direct requested page 99 remains in links/history while the rendered data correctly clamps to
page 2; the bounded ledger view now retains that requested-page fact separately from its current
page. Filter and account-selection behavior remain covered in the complete native matrix.

SDK replacement derives a fresh selection from the stored observed route, retaining its ID/filter /
page intent while clearing record metadata and creating a new detail subscription. Missing data
remains blocked/loading; previous editor data and commands cannot survive the new SDK revision.
Routed OPEN_TRANSACTION refuses stale headers and unknown/not-current-kind record IDs before
navigation. The low-level non-router selection method remains unchanged.

URL readers/writers now share `domain/transaction-list-routes.ts`; Window uses its pure link
formatter without importing financial filtering/aggregation. The existing navigation child still
owns the single native effect and receipt. No new navigation actor, request registry or SDK patch.
Logs: `/private/tmp/finance-worker-detail-routing-{static,test-types,unit-final,full-unit,native-types,native-focused,native-final,legacy-browser}.log`.
Initial extraction/import and loading-placeholder assertion failures remain in the earlier unit
logs; all final checks above pass.

At the preceding checkpoint, account-order persistence awaited a separate storage decision.
The user has now explicitly approved IndexedDB with no migration; the implementation and
qualification follow below. Full shell, ordinary settings/classification/transfers,
provider/attachments/backups and activation remain open.


### IndexedDB account-order ownership — approved

The user approved IndexedDB with no migration for account-order preferences. Do not read or
migrate the legacy localStorage preference. Keep the existing ordering machine as the fixed editor
child; its accepted MOVE increments a data revision. A small persistence coordinator observes that
child, serializes selected writes, and coalesces later moves to the latest revision after the
current transaction settles. Edit/done/boundary eligibility remains in the existing machine.

The coordinator owns waiting, reading, ready, saving and unavailable states. Scope observations
carry a key derived from identity/workspace and active account IDs; the native store additionally
binds the existing server/scope/environment namespace. New scope while I/O is pending withdraws
its ordering view, waits for that operation, then reads only the latest scope. Same-scope account
changes preserve editing and append new accounts through existing orderAccounts. Read/write
failure keeps session ordering usable without automatic retry or blocking unrelated finance.

Invoke this coordinator as a fixed SDK-group child. SHUTDOWN during reading/saving retains the
native invocation until settlement, flushes the latest accepted moves if another write is needed,
then completes without replay; the SDK group waits for that
receipt before replacement/close. Native operations each own one short IndexedDB connection and
transaction, acknowledge at transaction completion, then close it. There is no Window bridge,
per-call registry, persistent database cache, Jazz schema change or SDK patch.

Project bounded ordered IDs and edit/move capabilities through the existing group view. Root
orders account rows and writable transaction defaults; edit defaults retain their own record.
A fresh entry form waits for the preference read/fallback so its initial native select uses
the stored first account; unrelated lists, balances and edit forms remain usable.
Window reuses AccountSelection and forwards scoped EDIT/DONE/MOVE commands. Qualify rapid moves,
scope/SDK replacement, shutdown with held I/O, fallback, native restart persistence, namespace /
workspace isolation and unchanged legacy ordering before uploading.


Implemented and qualified: **2,013 Finance unit tests** (67 Worker host), **57 actual native
Worker/Svelte browser cases** across Chromium/Firefox/WebKit, and **13 existing SvelteKit
ordering/pagination cases** pass. Full application and complete browser-test types plus native
candidate types/Svelte diagnostics pass with zero warnings. The 10 focused persistence cases
cover native receipts, coalescing, latest-intent flush before workspace change/close, scope
replacement, A → B → A and read/write failure without automatic retry. Host cases cover stale
commands, withheld entry defaults, SDK-group replacement and native write drain before SDK close.

Native UI cases verify shared controls and boundary refusal, unchanged checkboxes, ordered defaults
on a fresh entry, workspace isolation and real IndexedDB namespace separation. The retained-data
case saves an order that differs from the native name sort, closes the whole browser process,
reopens offline, edits an account, restarts again and retains both order and financial edits.
Changing order does not erase a transaction draft already being edited; a fresh draft uses the
new default. The first browser attempt exposed an invalid test assumption about replacing an
existing draft and tried moving an already-first account upward. The corrected cases retain the
existing draft behavior and actually move the later account; all final native checks pass.

No legacy preference migration, SDK patch or production activation was introduced. The next
foundation is to bind the existing full shell to Worker projections/commands, keeping Window
responsible for DOM, drawer/focus/viewport, route observations and native navigation. Remaining
account/grant/settings/classification/transfers/provider/attachment/backup parity, coordinated
SDK adoption and W20/W21 remain open. The intermittent financial check/account-move failure
remains an activation blocker; a passing matrix does not establish its cause or fix.

Logs: `/private/tmp/finance-order-final-checks.log` (static/types/full units + legacy browser),
`/private/tmp/finance-order-native-final.log` (complete 57-case native matrix),
`/private/tmp/finance-order-native-focus.log` (nine targeted three-engine cases), and
`/private/tmp/finance-order-drain.log` (10 persistence cases).

### Full-shell reuse preparation

Reuse AppShell and its existing drawer components rather than creating a second layout. First
make its current host supply the observed pathname and footer snippet. WorkspaceBootstrap already
owns route observation and the bank integration, so it can render the same AppDrawerStatus in
that snippet without changing its lifetime, DOM, labels or behavior. AppShell keeps only native
DOM/disclosure/viewport behavior and the existing data/intent props. This removes its SvelteKit
page singleton and full bank actor requirement before a Worker caller is introduced.

Narrow drawer account/workspace inputs to the existing AccountSelection/WorkspaceSelector props;
these controls require bounded display records, not complete SDK rows. QueryContent needs only
isLoading and an error value (null means no error), so give that presentation shape its own type
instead of importing a Jazz subscription type. Keep the existing loading/failure selection and
markup. Verify the legacy shell through strict types and existing ordering/pagination browser
cases. This preparation does not enable the Worker shell or claim provider/PWA/route parity.

Shell preparation passes full zero-warning Svelte checking, complete browser-test TypeScript
checking and all **13 existing ordering/pagination browser cases** in the isolated alpha.60
checkout. `/private/tmp/finance-shell-reuse-checks.log` retains the result. The preceding
2,013-unit / 57-native-browser result belongs to the account-order checkpoint; no full-suite
rerun is claimed for this presentation-only cleanup. Actual Worker shell mounting, route-link
binding, responsive keyboard/focus coverage and the remaining feature parity are still next.

### Worker-bound shared shell — implementation model

Bind the existing AppShell directly around the isolated WorkerAccounts composition, replacing
its standalone workspace/selection/order controls. Preserve the current Worker root, scoped
commands, forms, persistence and native navigation receipts. This is a presentation connection,
not a new routing chart or SDK owner. WorkerAccountCreation forwards AccountForm's existing
trigger snippet so the drawer uses the same form owner and modal.

Window's existing client exposes a read-only native URL observation alongside the Worker view;
observeLocation/observeRoute/popstate and native navigation settlement update it. The shell uses
that URL for current-link presentation and the existing inherited-workspace links. The Worker
continues to classify route observations and own selection/default/legacy/access decisions.
AppShell supplies its existing navigation-spacer snippet to children so PageLayout preserves the
menu space without a second layout. Existing legacy children keep their current behavior.

The host may supply its footer snippet; bank/PWA footer adoption remains with the corresponding
remaining features and complete-app gate. The isolated candidate is still inactive in production.
Native fixtures exercise the actual drawer/forms and use a fixture-only native anchor navigation
adapter where SvelteKit would normally handle same-origin anchors. Modified/new-tab links remain
native. Expand disclosures using native UI interactions before existing feature cases; qualify
mobile focus/dismissal, desktop selection/order, current/scoped links, native history and remount
without changing feature assertions, retries or timeouts. Build audits continue rejecting SDK or
financial projections in Window and Svelte modules in the Worker.

Status reports must include the remaining-work list, as explicitly requested by the user.


Shared shell connection is qualified: **2,013 Finance units**, **63 actual Worker/Svelte browser
cases** across Chromium/Firefox/WebKit, **22 existing SvelteKit navigation/order/pagination cases**,
zero-warning full/native static and complete browser-test types, and formatting pass. The actual
candidate now renders the shared AppShell/PageLayout/drawer controls; there is no second layout,
router, SDK owner or new state machine. Native scope inheritance, current links, back/forward,
remount, account creation/selection/order, mobile dismissal/focus/resize and retained drafts pass.
Build audits still reject SDK/financial projections in Window and UI modules in the Worker.

The first complete run exposed a callback header bug (passing the full view into the selection
transport's strict header spread) and a remount fixture that attempted its picker inside a closed
Settings disclosure. Selection callbacks now send only sessionRevision/selection, and the fixture
opens the native disclosure before the unchanged assertion. All six affected cases pass focused
verification, followed by the complete 63-case pass. The runner now reports native cases as they
finish instead of withholding all progress until the end. Existing SVG plugin declarations are
included for the reused drawer logo, rather than adding a declaration workaround.

Logs: `/private/tmp/finance-worker-shell-native-qualified.log` (complete 63 cases),
`/private/tmp/finance-worker-shell-native-corrected.log` (six diagnosed cases),
`/private/tmp/finance-worker-shell-final.log` (2,013 units and 22 legacy browser cases), and
`/private/tmp/finance-worker-shell-static-qualified.log` (final static/browser types).
Hosted Finance/Foundation/Clipper qualification is green at preceding head f14ea015; this new
shell commit needs its own hosted result. The shell uses the Window client's observed native URL;
actual production SvelteKit route mounting, page-specific feature parity and provider/PWA footer
adoption remain open, together with the known partial financial-save blocker and activation gates.

### Classification reuse before worker binding

Category/tag create/archive policy already lives in the management availability and scoped-form
charts. Their route components still duplicate domain form construction and directly bind the
SDK leaves. Extract the four existing native writes to data/classification.ts (matching the
existing accounts leaf boundary) and re-export them from data.ts. Extract category and tag form
option factories, retaining the same management charts, schemas, intents, authorization/scope
checks, archive result names and local settlement. Both existing routes consume those factories;
the future SDK-bound Worker group will consume the same factories instead of copying the route
logic. SDK reads stay at the existing observation boundary; this preparation adds no subscription,
form workflow, SDK patch or activation. Existing management policy and classification browser
flows are the behavioral checks. Worker projection of counts, archive capabilities and forms
remains a separate binding step after this reuse is qualified.


Cleanup within this slice removes the management policy's generated immediate-function wrappers,
unused native-event union and archive-ID helper. A native XState choice retains the exact branch
order and outcomes, with all conditions visible in the chart. No permission/reference/duplicate
check is removed, and no new policy layer is added. Review and test the real existing management
chart and both existing classification routes together before using these factories in the Worker.

Classification reuse/cleanup passes **all 2,013 Finance units**, all **16 existing classification
browser cases** (category/tag management, permissions, loading, historical counts and transaction
tag integrations), full zero-warning Svelte/browser-test types, and formatting. In the isolated
alpha.67 artifact, both factories and native classification leaves pass strict selected types,
and the existing **24 management policy cases** pass. That last result is a native source probe,
not qualification of a Worker classification UI, which remains next. Logs:
`/private/tmp/finance-classification-reuse-checks.log`,
`/private/tmp/finance-classification-reuse-full-unit.log`, and
`/private/tmp/finance-classification-reuse-native.log`.

The user explicitly requested deletion and simplification throughout the remaining work. This
slice removes 92 lines from the management chart while preserving its branch order and behavior;
both existing route controllers now bind reusable form options instead of repeating domain
construction. Keep reviewing remaining custom protocols, adapters and defensive scaffolding
against actual callers and native library capabilities before extending them.
