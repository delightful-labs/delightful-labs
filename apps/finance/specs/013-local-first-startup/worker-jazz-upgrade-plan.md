# Coordinated Jazz upgrade after PR #39

Baseline: PR #39 merged at `fb380114` on 2026-11-16. Its final head `d8c0820e`
passed every hosted Finance, Clipper and foundation workflow. C1/C2 are complete.
`feat/jazz-native-session-upgrade` starts from that exact merge tree. Workspace
SDK pins, the active patch, application behavior and deployment settings remain
unchanged; the worker-only alpha.65 candidate below is an isolated fixture. The npm
package-tag endpoint was rechecked: `latest` is alpha.65; `alpha` still selects
alpha.60. Use explicit coordinated pins after qualification.

The branch subsequently merges main `5e78a349` (PR #45's website/deployment-control
fixes). No SDK, Finance schema, Local First implementation or native fixture
changes came from that refresh. All 23 current monorepo tooling tests and the
six-context guidance check pass. All seven PR paths classify as verification/
documentation inputs under the updated deployment selector.

The latest refresh includes main `2d1b5cd2` (PR #49's Clipper sharing-preview
work). The candidate checks use that updated domain graph; no SDK pins or active
session integration changed in the refresh.

The [release audit](worker-jazz-release-research.md) remains the implementation
evidence. Qualify this boundary before building C3–C5's application worker/read
slice, so its SDK integration is written once.

The user resolved the preview-data decision: **fresh preview cores are acceptable
for Clipper, but not Finance**. Finance must retain access to its existing data
in previews and production. Clipper's approval does not authorize production data
resets or a Finance destination change.

## Foundation-first execution

- [x] **U1 — Qualify the existing persistent-worker bridge on alpha.65 in
      isolation.** The unpatched SDK already fails cold worker data retention.
      Adapt the existing patch's worker detection/Window-hook behavior to the
      changed source, adding no preparation callback or per-call owner. Run the
      actual Finance-schema save/edit/close/two-restart fixture with the shared
      IDB store and single-bundle build. Audit the other patch responsibilities
      separately: native device-account APIs do not establish joining-proof,
      extension-origin or offline-retry parity. Discuss any newly required patch
      behavior before implementing it. No workspace pin/backend destination changes.
      The [U1 qualification](#u1-isolated-worker-qualification) records the focused
      proof and the remaining full-patch/backend boundaries.
- [ ] **U2 — Adapt Local First's session boundary and both consumers together.**
      Use `initial: 'device'`, `localFirst: 'now'` with the public client loader,
      `user.accountId`/kind/identity, `exportDeviceKey()`,
      `restoreDeviceAccount()` and `signOut()`. Use `JazzProvider` for the current
      Window-owned applications. Delete Finance/Clipper's explicit SDK-upgrade
      leaves and corresponding opaque-account plumbing. Keep the existing
      session owner, stale binding checks and domain drains; do not create a
      Window SDK session for the future worker UI.
      **In progress:** U2a's selected shared adapters pass public-package/native
      qualification below. The native Svelte/Finance recovery candidate also
      passes its focused qualification. Clipper's inactive caller port now passes
      types and 46 startup tests, but expanded worker-host coverage exposed the
      [native session custody decision](worker-session-resource-decision.md).
      Resolve that shared development-mode failure before finishing either
      consumer's caller port. U2 is not complete.
      U2b source review also found Finance's separate account-handle-based restore
      client. The user approved the shared application Db in the
      [resource ownership decision](worker-restore-session-decision.md).
      That boundary is now implemented and qualified on alpha.60 (1,928 unit
      tests and 107 restore tests). The alpha.65 caller port remains open;
      public user metadata cannot reopen the old independent client.
- [ ] **U3 — Establish SDK schema history before persistent-backend startup.**
      Both active apps use `migrations: 'none'`; alpha.65 rejects this on SQLite,
      remote and Vercel stores before opening them. Use the SDK's generated
      initial history/validation tools, preserving domain schemas, permissions
      and app IDs. Test fresh stores and disposable retained alpha.60 SQLite
      stores with records/identities/permissions. This is SDK schema history,
      not the excluded account-selection migration/fallback layer.
- [ ] **U4 — Qualify backend authentication and destinations.** Replace the
      throwing `acceptLocalFirstAuth` stub with public `acceptDeviceAccounts`.
      Clipper's authenticated answer must include actual session expiry in Unix
      seconds. Qualify Better Auth against alpha.65's `~1.7.22` peer and the
      existing auth patch. Preserve Finance's existing core/Drive bindings and
      qualify retained-data access; naming equality alone is insufficient. The
      read-only inventory below identifies two matching destinations and one
      custom qualification destination that must stay out of rollout until its
      data-preserving path is verified. Clipper previews may use fresh cores.
- [ ] **U5 — Switch and qualify the workspace coherently.** Update SDK, matching
      Wasm/native core, library peer and existing patch bindings as one reviewed
      change; preserve one compatible SDK identity per consumer. Run library
      types/packed consumers, both apps' types/unit/build checks, Finance's native
      worker and product/offline/recovery/permissions cases, and Clipper's worker,
      extension, auth and production/offline cases. Include offline retry,
      identity changes, interrupted startup, pending writes and actual close.
      Client-only success does not qualify a Vercel backend or application cutover.

U1 can proceed independently of the retained Finance destination work. U2–U4 form one
coordinated compatibility change; U5 must not publish a partially upgraded graph.
After this checkpoint, implement C3/C4/C5's one worker-owned read view, then C6's
existing financial workflow. Do not build more alpha.60 integration glue that the
native alpha.65 API will replace.

An initial `git apply --check` against the pristine published alpha.65 package
finds four files whose alpha.60 patch hunks need rebasing: `runtime/context.d.ts`,
`runtime/native-runtime/browser-shared-worker-connection.js`, `session/state.js`
and `worker/jazz-broker-worker.js` under `dist/`. No hunks were applied. Textual
applicability of the other files is not behavioral qualification. The check log
is `alpha65-existing-patch-check.log` in the research artifact directory.

## U1: isolated worker qualification

The [reproducer](../../tests/worker-upgrade/README.md) reuses the maintained Finance
native fixture/schema and the public Local First store/broker/build package in a
temporary project. Exact SDK and Wasm versions are both `2.0.0-alpha.65`;
the downloaded SDK's SHA-512 integrity is checked before patching. The candidate
carries only the existing worker-host responsibility into six files. The new
store-deletion leaf also needs to await its now-asynchronous generation reader
and broker constructor; no new capability or naming algorithm was added.

The complete clean setup, strict fixture type check and **15 native cases pass**
in Chromium, Firefox and WebKit:

- Three Window SDK controls remain independent of the worker hooks.
- Three actual worker SDK cases retain the same identity and Finance expense
  through two full browser-process restarts. They save 1,234 minor units, edit to
  5,678, reopen offline, edit to 9,012 and verify that second edit after another
  restart. Every cycle verifies SDK/store/broker close receipts.
- Six retained IndexedDB cases cover canonical bindings, profile isolation,
  concurrent serialized updates, close and offline full-process restarts.
- Three new cases reject the immediate client loader, verify no native broker
  open/generation read occurred, close the acquired store/channel, then reopen
  and close the actual SDK successfully.

Alpha.65 emits its one broker asset under `assets/`; the former fixture's
`_app/immutable/assets/` restriction initially stopped setup before any cases ran.
The overlay now discovers the emitted hashed broker by name and still requires
exactly one. The other initial setup failure was an unsupported pnpm pack flag;
the reproducer uses the CLI-supported configuration flag. Neither is relabeled
as a browser/SDK data failure. Formatting-only overlay changes were removed and
their emitted JavaScript equivalence and strict types verified.

The clean run's artifact directory is
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha65-0RQp9f`;
the external run log is `/private/tmp/finance-alpha65-bridge-clean.log`.
Recorded tooling: Vite 8.3.4, Vitest 4.1.11, Playwright 1.64.0, TypeScript 6.0.3,
XState 6.0.0-beta.1, Svelte 5.57.2 and Zod 4.1.11. The script captures installed
versions and the generated lock for each run. Both final overlays also apply
cleanly to pristine inputs.

This qualifies the focused persistent-worker bridge, not all of alpha.65 for
either app. The rest of the existing SDK/auth patch, native construction/failure
paths, identity switching, schema history, extension and backend/core behavior
still need U2–U5 qualification. No existing Finance store, credentials, namespace
or deployment was changed. The application worker/read view remains C3–C5 work.

## U2a: shared native-session adapter qualification

The isolated candidate now ports the existing Local First recovery/restoration
adapters without opaque `AccountHandle` values or `exportLocalFirstSecret`.
Recovery observes the existing native session, exports through
`exportDeviceKey()`, and admits only a ready device user. Its captured binding
checks both the session facade and public user object before export; account-ID
equality alone cannot preserve a stale scope. Invalidation releases the adapter's
observation without signing out or closing the host session. Restoration keeps
its existing session binding/attempt contract and calls `restoreDeviceAccount()`.

Alpha.65's `session/jazz-session.js` caches the public user for the same underlying
account and replaces it for a replacement handle. The new native tests verify
that behavior, including replacement with the same account ID and A → B → A.
This is a version-qualified public-observation boundary, not an assumption that
user IDs uniquely identify every attachment. SDK keys and phrases stay inside
the disposable Worker; reports return booleans only.

The existing readiness adapter compiles unchanged after its status contract adds
the SDK's `starting` observation. This forwards a native fact, not another
application lifecycle. No SDK session, subscription manager or workflow owner is
created by these adapters.

The reproducer compiles the selected source adapters/contracts against alpha.65
and packages them into a temporary Local First tarball. The tests use ordinary
public package exports. Strict declaration/fixture types and the full **18-case
native suite pass** in Chromium, Firefox and WebKit, including all 15 U1 cases.
The three new cases exercise phrase/native-key equivalence, same-account scope
replacement, live replacement before observation, A → B → A retirement,
sign-out/reopen, native readiness notifications, getter failure, replaced-session
and foreign-adapter rejection, pure invalidation and denied restoration after
binding invalidation.

The final clean run uses Finance's installed OpenTelemetry API 1.9.1 throughout
the temporary dependency graph. A range-only first attempt resolved 1.10.0 and
produced incompatible SDK peer warnings; the runner now reads the installed
version and enforces it through pnpm's native override. No workspace dependency
was changed. The remaining alpha.60 library peer warning is expected for this
partial candidate, not whole-library compatibility evidence.

Artifacts: `/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha65-KuzinX`;
log: `/private/tmp/finance-alpha65-u2-qualified.log`. The source overlay is
`tests/worker-upgrade/session-adapters.patch`. Both source patch applicability and
added-source whitespace are checked with Git's patch parser; diff-context tabs
are patch data, not indentation changes to application code.

U2b's caller source review found another material boundary: Finance's workspace
restore opens and drains its own database using the opaque account handle.
Alpha.65 removes that public handle and the old top-level `createDb` entry.
The [decision record](worker-restore-session-decision.md) proposes reusing the
application session's Db under the existing financial restore/drain charts,
records the alternative and names the native tests required. The user approved
this ownership change. It now uses the application's captured Db on alpha.60,
with transaction/commit binding checks and the existing drain/journal ownership.
Strict types, 1,928 unit tests and all 107 restore tests pass, including native
replacement during an accepted write awaiting acknowledgement and resume without
replay. The decision record contains the exact scope and remaining alpha.65
qualification; no additional SDK session or patch was introduced.

U2b's native Svelte boundary is now qualified in isolation. Alpha.65's context
supplies a readable store and bound actions, not an imperative `getSnapshot()`.
The candidate narrows recovery's input to the two public methods it actually
needs (snapshot observation and device-key export). Finance binds those methods
to native Svelte `get(store)` and the SDK's bound action. The existing recovery
actor and UI retain scope/secret cleanup; no second session, subscription manager
or application lifecycle is introduced. The candidate uses the actual Finance
integration and packed Local First/DUI components under native `JazzProvider`,
with SDK operations and initial publication, transition, sign-out, reopen,
external-provider unmount and close as the acceptance boundaries. Strict adapter,
fixture and Svelte checks pass, as do all 21 native cases (the previous 18 plus
one framework case per browser). The active alpha.60 component/library are
unchanged by this source overlay.

Next, adapt Finance's layout/session preparation and Clipper's account
host/callers and retire their SDK-upgrade phases. Alpha.65 imperative subscribers
receive notifications without a snapshot argument or initial delivery. Its
`getJazzSession()` Svelte context already supplies a readable store with bound
actions and initial publication: existing `fromStore(getJazzSession())` callers
do not need an extra `sessionState()` wrapper. Preserve actual domain
initialization and drains. Those remaining consumers and the coherent SDK switch
are not implemented; schema/auth/retained-data gates still apply.

## U2b: native Svelte session boundary

The isolated runner now packs both existing public Local First and DUI outputs,
copies Finance's actual `RecoveryPhraseIntegration.svelte` and existing locale
runtime, applies the inactive consumer overlay and builds a native Svelte page.
It uses alpha.65's real `JazzProvider`, native readable context and bound actions;
the actual shared recovery actor/view render and clear the phrase. There are no
mock sessions, copied recovery machines, new session owners or SDK patches.

Recovery's source type requires only the public snapshot getter and device-key
export. A native SDK facade supplies these directly; a Svelte provider instance
supplies `get(store)` and its SDK-bound export action. The binding stays within
that provider instance. When porting replaceable external session props, key the
provider by that session: the inspected SDK captures one session per instance
and owns withdrawing/acknowledging its rendered client frame during replacement.
Do not retarget an existing view binding to another session or create a Window
SDK owner for the future worker UI.

The three new browser cases verify initial scope publication, native-key/phrase
equality, clearing an open phrase during same-account restoration, the native
`loading` snippet, sign-out/reopen, provider unmount/remount and SDK close.
Provider mount leaves the AccountStore read count unchanged; unmount clears the
phrase while leaving the externally owned session ready. Explicit disposal must
close the native SDK, unmount the UI and finish the AccountStore close receipt.
Phrase comparisons happen inside the browser and return booleans only.

The clean run passes all **21 native cases**, retaining the existing worker,
IndexedDB, loader-failure and restart tests. Strict declaration/fixture types and
Svelte checks pass with zero errors/warnings. SDK and Wasm are alpha.65, Svelte is
5.57.2, the existing installed plugin/checker versions are 7.3.1/4.7.6, and
OpenTelemetry API remains 1.9.1. The runner reads exact installed versions using
`pnpm list`, because the plugin does not export its package manifest. All source
overlays now use Git's added-source whitespace checks before application.

Artifacts: `/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha65-5gK1Bv`;
log: `/private/tmp/finance-alpha65-svelte-proof.log`. The complete Finance/Clipper
caller port and persistent backend upgrade remain unqualified on alpha.65.

## U2b: Clipper startup caller and resource-custody blocker

`clipper-session.patch` stages the actual Clipper account host/contract and
readiness chart while the workspace remains on alpha.60. Native startup uses
`localFirst: 'now'`; only web startup adds `initial: 'device'`. The extension's
existing-account admission remains intact. Public user metadata/device methods
replace the removed opaque-account APIs and hardcoded issuer classification.

The existing Local First acquisition owner retains SDK startup. The application
waits on `starting`/`transitioning`, adopts the exact user/client/Db binding, then
runs its existing domain bootstrap. The separate SDK preparation actor/state,
optional capabilities and thin-client retry bookkeeping are removed, reducing
production code by 86 net lines. Library adoption, root write settlement,
stale bindings, restoration, ordered sign-out and shutdown retain their owners.

The isolated runner now checks Clipper in its own temporary package, retaining
its installed dependency versions (including Zod 4.6.7 and Vitest 4.1.8) instead
of substituting Finance's versions. It reuses the same SDK/Local First tarballs
and the maintained Clipper Vitest configuration. Strict types and all 46
application-readiness tests pass. Expanded root/sign-out/worker-host coverage
passes 52 of 67 cases: the other 15 fail when development XState traverses the
new native session's throwing `db` getter. The actual SDK/browser diagnostic
confirms the same acquisition-owner failure. This candidate is **not qualified**.

The [decision record](worker-session-resource-decision.md) contains the exact
failure, evidence, supported solution and alternatives. Discuss keeping the
native handle outside immutable context within the existing owner before
implementation. Do not fix only the fixture, disable development checks or add
an SDK patch. This shared foundation correction precedes the remaining Finance
layout/startup port and further Clipper adoption. Backend/schema/extension
qualification and the coordinated U5 switch remain open.

## Native Vercel naming: additional code proof

Executed actual alpha.60 and alpha.65 JavaScript exports without constructing a
Sandbox or contacting a backend. Inputs are the existing Clipper
`jazz-core-name.test.ts` project/branch fixture. Compared alpha.60's
`defaultCoreName` and Clipper's current `jazzCoreName` with alpha.65's `coreName`,
`perBranch`, `driveName` and `refuseVercelName`.

| Case                         | Observed result                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default production           | `namespace: 'production'` selects the same core and `<core>-data` Drive; the fixture's Drive name is 53 characters.                                               |
| Default preview              | Native `perBranch(branch)` produces the old SDK's default preview core name.                                                                                      |
| Clipper's shortened override | Its `clipper-preview-…` name is outside the new required `jazz-<project>-<namespace>` form. No namespace reaches that same core.                                  |
| Long preview Drive           | Alpha.65 allows 128-character Sandbox names and natively truncates/hashes the Drive name to 64 characters. The tested preview works without Clipper's workaround. |

This supports removing Clipper's custom preview hashing helper after adopting
native namespaces. The user permits Clipper previews to start with fresh data
where the old version used a custom override. Old cores/Drives stay untouched;
their contents do not move automatically. This approval does not extend to
Finance. Preserving access to a non-addressable Finance destination needs a
supported retention path; do not default to another SDK patch or a data-copy layer.

Evidence: `/private/tmp/finance-jazz-release-research/core-name-compatibility.json`.
The inputs, functions and outcomes above keep the handoff independent of temporary
files. Source: [alpha.65 Vercel store](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.65/packages/jazz-tools/src/backend/vercel-store.ts).

## Read-only Finance destination inventory

The connected Vercel account identifies `delightful-finances`, project
`prj_XRyQmkRAdDV2xUZGPeXcFBSfgHVa`, in `mjamesderochers-projects`, with
`finance.delightfullabs.com` among its domains. The paginated Sandbox and Drive
listings each return exactly three records with no next page. No core was
started, created, renamed, attached or deleted; no data or settings were changed.

| Existing core                                                 | Existing mounted Drive                       | Alpha.65 namespace comparison                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-production`            | Same name plus `-data`                       | `production` yields the exact same core and Drive names.                                                                   |
| `jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-preview-mono-d7de34b1` | Same name plus `-data`                       | `preview-mono-d7de34b1` yields the exact same core and Drive names.                                                        |
| `finance-alpha60-preview-qualification`                       | `finance-alpha60-preview-qualification-data` | No namespace reaches this custom name. Preserve both and defer this destination's rollout until retained access is solved. |

The comparison executed the actual alpha.65 `coreName` and `driveName` functions
against the observed project/core/Drive names, without opening a backend. It
establishes name identity for the first two rows, not schema, auth, row or
credential compatibility. Retained-store tests remain required. Do not silently
redirect the qualification destination to an empty replacement.

The project-level environment listing returns no variables and zero hidden
production variables. This does not establish the absence of historical
deployment-specific overrides; inspect those when a particular destination is
upgraded. Keep Finance's local SQLite path and browser account selection unchanged
until their independently qualified SDK integration is ready.

Sanitized metadata and executable comparison results are in
`finance-core-inventory.json` and `finance-core-compatibility.json` under the
research artifact directory. No secrets or application records were read.
