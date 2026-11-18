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
