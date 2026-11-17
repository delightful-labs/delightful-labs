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
