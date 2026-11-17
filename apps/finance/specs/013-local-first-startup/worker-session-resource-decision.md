# Native Jazz session custody: decision pending

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

## Proposed supported solution

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

Before adopting the proposal, discuss it with the user as requested for uncertain
design choices. Then qualify real signed-out/starting/ready SDK sessions against
development XState, acquisition retry and interrupted attachment, same-account
and A → B → A replacement, and actual SDK close after domain drain. Keep the
production native restart/Svelte proof as separate coverage. U2 remains open.
