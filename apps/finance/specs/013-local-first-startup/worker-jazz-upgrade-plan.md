# Coordinated Jazz upgrade after PR #39

## Current candidate maintenance — November 18

The maintained runner now targets only alpha.67, with an explicit `--worker`,
`--schema` or `--clipper-schema` mode. Earlier alpha.65/66 commands and results
below are historical checkpoints. The alpha.65-only Clipper session runner and
its 1,175-line source overlay have been retired; the complete Clipper session
adoption gate remains open. Active workspace pins and production remain alpha.60.

New native adapter/worker implementations and qualification cases now live in
normal candidate source files, rather than added-file hunks. The candidate
worker entry replaces only the isolated build catalog. Newly added candidate
files refuse to overwrite maintained files, preserving the former patch conflict
check. Remaining patches still adapt modified alpha.60 source; they are debt,
not a new application compatibility API. At this cleanup checkpoint, patch text
dropped from 9,197 to 5,930 lines, including moved code rather than claiming all
those lines were removed.

Source assembly comparisons match the prior Finance, Clipper, fixture, adapter
and worker code byte for byte. The cleanup's alpha.67 checks passed 200 Finance
schema/permission/backup/restore, 42 worker/session, 30 actual Finance Worker/UI
and 59 Clipper schema/reading cases, including strict TypeScript and zero-warning
Svelte checks. The three-engine financial/offline/drain checks remain intact.
Those application checks include the concurrent workspace initialization
and distinct broker identity changes from `fdcaadb5`; the candidate worker entry
matches that commit's patched entry byte for byte.

PR #51 is now merged into main and incorporated into PR #46. Commit `94cd21ae`
reconciles the Clipper candidate with the approved required Note document,
same-document Highlight policy and native migration history. A fresh alpha.67
verification passes all 61 schema/reading cases, including reopening the historical
alpha.60 production-schema store with its app identity retained. This resolves the
earlier handoff-document conflict and schema-overlay blocker. Full Clipper
session/backend adoption and coordinated SDK activation remain open; see the
[reconciliation evidence](worker-session-resource-decision.md#reconcile-merged-pr51-before-further-coordinated-sdk-work).

See the [current commands and source boundaries](../../tests/worker-upgrade/README.md).

## Historical baseline and qualification

Baseline: PR #39 merged at `fb380114` on 2026-11-16. Its final head `d8c0820e`
passed every hosted Finance, Clipper and foundation workflow. C1/C2 are complete.
`feat/jazz-native-session-upgrade` starts from that exact merge tree. Workspace
SDK pins, the active patch, application behavior and deployment settings remain
unchanged; the worker-only alpha.65 candidate below is an isolated fixture.
**Initial 2026-11-17 target: alpha.66.** At that audit npm `latest` selected
alpha.66; `alpha` selected alpha.60. Use explicit coordinated pins after
qualification. The [alpha.66 audit](worker-jazz-alpha66-research.md) records its
breaking schema/permission changes, 24 passing native lifecycle cases and a
reproduced late-close failure in the new immediate factory. Keep the supported
awaited factory in the approved private session actor; no new SDK patch.
The bounded worker/session proof now also passes on alpha.66; the separate
historical Clipper caller overlay remains unported/incomplete.

**Later November 17 refresh:** npm `latest` now selects alpha.67; `alpha` remains
alpha.60. The integrity-verified published package has unchanged backend,
namespace, typed-App and Db JavaScript compared with alpha.66. The retained-data
reader proof below now passes on both alpha.66 and alpha.67 with their matching
native binaries. Treat alpha.67 as the latest release candidate for the coherent
switch, after reviewing the remaining release delta and requalifying worker,
auth, shared-owner callers and the other affected gates. Do not rewrite the
qualified schema/permissions or add compatibility code for unchanged APIs.
The subsequent [alpha.67 requalification](worker-jazz-alpha66-research.md#alpha67-native-source-review-and-requalification)
now passes the same 200 Finance schema/restore, 30 worker/session, 57 Clipper
schema/reading, 30 auth and eight gateway cases. Native source review identifies
policy-ordering and enum-support fixes; the schemas/adapters and existing patch
bodies are reused unchanged. The unpatched cold-worker retention control still
fails, so the existing bridge remains necessary. Actual caller adoption, broader
restore/patch responsibilities, live workload admission and the coherent switch
remain open. No live pins are changed.

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

Before broadening U2's consumer ports, complete U3's alpha.66 schema/permission/
history foundation in isolation and rerun U1/session qualification on alpha.66.
Bounded SDK-neutral actor work can continue with the existing awaited acquisition
protocol. Do not redo application ports around alpha.65's removed authoring API
or switch to `startJazzClient` without reliable late-close failure propagation.
Keep adapters thin and reuse the existing workflows and native library behavior.
Record SDK gaps and defer them when product requirements permit; the late-close
finding adds no workaround task. Review the unadopted sign-out work before
expanding commands. Do not build a generic SDK command surface ahead of callers.

Treat cleanup as part of every upgrade slice: inspect the code being changed for
native replacements, reusable behavior and superseded adapters/fixtures. Record
the concrete removals or deferred findings in the existing handoff, and remove
replaced code when its replacement is adopted and qualified. Follow the
[continuous simplification requirements](worker-migration-tasks.md#continuous-simplification-during-implementation);
do not accumulate a second implementation alongside the selected native path.

- [x] **U1 — Qualify the existing persistent-worker bridge on alpha.66/67 in
      isolation.** The unpatched SDK already fails cold worker data retention.
      Adapt the existing patch's worker detection/Window-hook behavior to the
      changed source, adding no preparation callback or per-call owner. Run the
      actual Finance-schema save/edit/close/two-restart fixture with the shared
      IDB store and single-bundle build. Audit the other patch responsibilities
      separately: native device-account APIs do not establish joining-proof,
      extension-origin or offline-retry parity. Discuss any newly required patch
      behavior before implementing it. No workspace pin/backend destination changes.
      The [U1 qualification](#u1-isolated-worker-qualification) records the focused
      alpha.65 baseline and remaining full-patch/backend boundaries. The new
      [alpha.66 worker/session qualification](worker-jazz-alpha66-research.md#alpha66-persistent-worker-and-private-session-adapter)
      passes the same 30 native cases, private adapter types and Svelte checks
      after all 200 schema/restore cases. Existing bridge/adapter implementations
      are unchanged; native generated queries replace the worker's authoring
      import. An unpatched alpha.66 control loses the edited row on cold restart,
      so retain this bridge without extending it. Caller adoption and the other
      workspace patch responsibilities remain open.
      The alpha.67 repeat now passes the same 200 schema/restore and 30 native
      worker/session cases with unchanged implementation/patch bodies; its
      published unpatched cold-restart control still loses the edited row.
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
      The user chose an actor-owned boundary. Its shared acquisition/observation/
      close foundation now passes 234 affected tests and nine real development
      browser cases (30 native cases total). Identity commands and actual caller
      adoption remain open; the old Clipper overlay still fails 15/67 cases.
      U2 is not complete.
      U2b source review also found Finance's separate account-handle-based restore
      client. The user approved the shared application Db in the
      [resource ownership decision](worker-restore-session-decision.md).
      That boundary is now implemented and qualified on alpha.60 (1,928 unit
      tests and 107 restore tests). The alpha.65 caller port remains open;
      public user metadata cannot reopen the old independent client.
- [ ] **U3 — Establish alpha.66 schema/permissions and SDK history before broader
      caller adoption or persistent-backend startup.** Replace removed
      `defineApp`/callback permissions with the native authoring DSL and generated
      bindings/permissions JSON in isolation. Preserve Finance's prior/current
      restore definitions and permission overrides. Port Finance's 22 validation/
      amount/count transform columns through native named transforms. Clipper's
      qualified port keeps a native progress transform and uses native resume
      sets with its existing record codecs; do not restore the rejected nullable
      JSON-transform approach. The upgrader refuses the old TypeScript transforms.
      Actual alpha.60 validation passes but emits no required JSON. Reuse the
      disposable alpha.65 compiler output as a comparison baseline, not a live
      intermediate rollout or custom compatibility layer. Verify generated schema
      hashes, bundle identity and existing policy behavior.
      Both active apps use `migrations: 'none'`; alpha.65 rejects this on SQLite,
      remote and Vercel stores before opening them. Use the SDK's generated
      initial history/generation tools, preserving domain schemas, permissions
      and app IDs. Test fresh stores and disposable retained alpha.60 SQLite
      stores with records/identities/permissions. This is SDK schema history,
      not the excluded account-selection migration/fallback layer.
      **Finance authoring proof passes:** the maintained `--schema` experiment
      ports 22 columns to eight native transforms and replaces callback/raw
      policies with the native DSL. The stored-schema hash and permission bundle
      remain identical. Native initial history/generation, strict selected types
      and all 138 cases pass, including actual alpha.60 SQLite retention and a
      subsequent alpha.66 write/close/reopen. See the
      [qualified scope](worker-jazz-alpha66-research.md#finance-native-schema-foundation).
      Clipper, full Finance callers/legacy backup-restore experiments and the
      remaining backend/destination gates are still open. U3 is not complete.
      **Clipper authoring/reading proof now also passes:** all 22 stored tables
      and the permission bundle retain their identities. Native history/files,
      selected strict types and 57 cases pass, including native reading-set
      convergence after two replica restarts and retained alpha.60 SQLite data.
      Use native resume-position sets plus Clipper's existing record codecs;
      do not repair the SDK's nullable-transform behavior. The shared fixture
      rerun keeps Finance's 138 cases green. See the
      [Clipper qualification](worker-jazz-alpha66-research.md#clipper-native-schema-foundation).
      Full callers, Finance's historical backup/restore cases, browser-worker
      and backend/destination qualification remain; U3 is still open.
      **Finance backup caller now passes:** the current generated-query reader
      removes the old per-read schema override. Its 37 existing cases and a real
      alpha.60 v1 archive reopened/validated on alpha.66 bring the fresh schema
      proof to **176 passing tests**, with strict backup types and unchanged
      schema/permission identities. Jazz enforces exact Db/schema binding;
      generate historical archives with their own native old bindings instead
      of introducing compatibility code. The full restore workflow/browser
      harness, including staging, publication and drains, remains the next
      caller task; retained-file decoding alone does not qualify it.
      **Shared-Db restore browser slice now passes:** the existing charts run
      on alpha.66 with only public user metadata and row-type changes. Twelve
      Chromium/Firefox/WebKit cases bring the fresh combined proof to **188**:
      actual old-file restoration, exact amounts/attachment/source bytes,
      completed IndexedDB journal reuse after page reload without replay,
      cancellation, same-account replacement and A → B → A. These use memory
      data drivers, not persistent-worker qualification. The full historical
      suite, accepted-commit interruption/drains, conflict/cleanup recovery and
      broader policy/role checks remain open.
      **Accepted-commit drain/resume now also passes:** six additional cases
      cover cancellation/native identity replacement in all three browsers,
      holding real server responses after authority acceptance. Artifacts stay
      retained until settlement; resume uses the same destination and commits
      only activation without replaying financial writes. The unchanged existing
      probe is shared with the alpha.60 experiment, whose two original cases
      still pass. The fresh combined proof is **194 tests**, including 18 browser
      cases. Conflict/blocked-cleanup recovery, the broader policy/role matrix
      and remaining worker/session/backend/adoption gates stay open.
      **Bounded conflict/cleanup qualification also passes:** three browsers
      reject a real changed destination on resume without further Jazz writes,
      preserving both destination data and the prior IndexedDB journal evidence.
      Artifact cleanup failure remains blocked until the existing retry releases
      once without replay. The fresh combined proof is **200 tests**, including
      24 browser cases. No application-chart change is needed. Broader policy,
      rollback/restart/conflict/cleanup variants remain for full qualification;
      proceed with alpha.66 worker/session foundation before broader adoption.
- [ ] **U4 — Qualify backend authentication and destinations.** Replace the
      throwing `acceptLocalFirstAuth` stub with public `acceptDeviceAccounts`.
      Clipper's authenticated answer must include actual session expiry in Unix
      seconds. Qualify Better Auth against alpha.66's `~1.7.22` peer and the
      existing auth patch. Preserve Finance's existing core/Drive bindings and
      qualify retained-data access; naming equality alone is insufficient. The
      read-only inventory below identifies two matching destinations and one
      custom qualification destination that must stay out of rollout until its
      data-preserving path is verified. Clipper previews may use fresh cores.
      **Native gateway admission now passes:** reuse the existing eight-case
      Clipper suite, generated schema and two unchanged backend patch hunks.
      Unpatched controls prove that extension origins and device-account gateway
      lookup still need those existing hunks. Native signed-out responses are
      checked as 200 with `{ user: null }`; denied origins/private access remain
      refused. The removed local core guest-auth flag is not carried into the
      candidate; actual Vercel admission still needs qualification. See the
      [bounded backend evidence](worker-jazz-alpha66-research.md#native-gateway-admission-foundation).
      Better Auth/provider/session-expiry, retained destinations and full-patch
      gates remain open; U4 is not complete.
      **Better Auth/actual expiry now also passes:** the same proof's `--auth`
      mode runs all 29 existing Clipper auth cases plus one real backend-entry
      integration, with strict types and the eight gateway cases on Better Auth
      1.7.22. Admission uses actual Unix-second expiry and existing read-only
      session options; the native Jazz refresh hook owns renewal and forwards
      native cookies. Negative controls establish expiry/read-only requirements
      and the continued need for the unchanged one-line provider patch. No new
      session framework or dependency patch behavior is added. The source copy
      adopts native Vercel namespace configuration only to compile the real entry;
      no live destination/override is changed or qualified. See the
      [actual backend evidence](worker-jazz-alpha66-research.md#better-auth-and-real-backend-expiry).
      Keep U4/U5 open for retained destinations, broader caller/backend coverage
      and the coherent full-patch/dependency switch.
      **Retained snapshot metadata access now passes:** the approved temporary
      Sandbox reads all three existing Finance Drives through native read-only
      snapshot mounts. Each retains alpha.60 version, identity/trust metadata
      and a nonempty store. Cleanup stops only the inspection Sandbox. See the
      [cloud evidence](#retained-drive-inspection-source-preserving-access).
      This does not yet qualify alpha.66 financial rows/attachments or live
      workload admission; compare native readers on disposable copies next.
      **Native retained reads now also pass:** all 23 Finance tables, app identity
      and present binary values match alpha.60 on independent alpha.66 and
      alpha.67 copies of all three actual Drive snapshots. Production includes
      546 transactions and nonempty attachment/profile bytes. The Sandbox stops
      after 64.355 seconds; originals are not upgraded. See the
      [reader comparison](#native-reader-comparison-on-retained-snapshots).
      Live workload/OIDC admission and the custom core's native addressability
      remain open; matching reads do not complete U4/U5.
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

The original blocker below is resolved by the
[qualified Clipper host adoption](worker-session-resource-decision.md#clipper-host-adoption-qualified-in-the-candidate):
the actual host now retains the shared actor connection and all 69 candidate
tests pass. Finance adoption and the coordinated upgrade gates remain open.
The following records the initial diagnostic, not a current failing test.

`clipper-session.patch` originally staged the actual Clipper account host/contract and
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

The user selected the actor boundary in the
[decision record](worker-session-resource-decision.md#accepted-direction).
Its first shared acquisition/observation/close slice is implemented and qualified
there: 234 affected tests and 30 native browser cases pass, including actual
signed-out SDK sessions under development XState. The Jazz facade stays private
to the adapter, which also owns the native loader/immediate local-first setup.
Next implement identity/recovery commands and actual Finance/Clipper adoption;
the existing raw-session Clipper overlay remains a failing regression until it
is replaced. Keep native Svelte qualification as legacy-boundary evidence; the
worker UI receives bounded views instead of a Window SDK session. Do not fix only
the fixtures, disable development checks or add an SDK patch. Backend/schema/
extension qualification and the coordinated U5 switch remain open.

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

## Retained Drive inspection: source-preserving access

**November 17 refresh:** Vercel CLI 65.15.0 confirms the Finance project ID and
`apps/finance` root. Its Sandbox/Drive listings still show the same three names
and mount pairs. The preview and qualification Sandboxes are stopped; production
was running with its Drive attached at inspection time. These are observations,
not instructions to stop or detach it. Project environment metadata still lists
no variables and zero hidden production variables. No live store was opened.

`tests/worker-upgrade/vercel-names.mjs` now executes alpha.66's own `coreName`,
`driveName`, `perBranch` and removed-name refusal against these destinations.
Both default core/Drive pairs match exactly, including native `perBranch('mono')`.
The old custom qualification name is refused with the native explanation that
no namespace reaches it. The pure proof passes and writes
`vercel-name-qualification.json`; retained data remains explicitly unqualified.
No new application helper, namespace algorithm or SDK patch is added.

The installed Sandbox SDK and [Vercel's Drive documentation](https://vercel.com/docs/sandbox/concepts/drives#snapshots)
provide a smaller supported way to inspect retained data: a native `snapshot`
mount captures a point-in-time read-only view, alongside the original writable
mount. Existing production can continue running. This is a Drive snapshot, not
`sandbox snapshot --stop`, which would stop the source Sandbox.

The user approved the following bounded cloud action on November 17, and it
completed successfully: **one nonpersistent five-minute, one-vCPU Sandbox**,
with networking denied, no published ports, and all three existing Drives mounted
read-only. The executed command, from Finance after reconfirming the project:

```sh
vercel sandbox create \
  --name finance-alpha66-retained-inspection-20261117 \
  --project prj_XRyQmkRAdDV2xUZGPeXcFBSfgHVa \
  --scope mjamesderochers-projects \
  --vcpus 1 --timeout 5m --non-persistent --network-policy deny-all \
  --mount jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-production-data:/retained/production:snapshot \
  --mount jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-preview-mono-d7de34b1-data:/retained/preview:snapshot \
  --mount finance-alpha60-preview-qualification-data:/retained/qualification:snapshot
```

Native `sandbox copy` uploaded only
`tests/worker-upgrade/inspect-retained-drive.mjs` into that Sandbox, `sandbox exec`
ran `node /vercel/sandbox/inspect-retained-drive.mjs /retained`, and
`sandbox stop` completed in cleanup, all with the same explicit project/scope.
The final native listing confirms the inspection Sandbox is stopped and all
three mounts have mode `snapshot`. The script reads only
the native `app-id`, `version`, `trust` and `store` layout. Output is limited to
identity/trust presence, version, store file count and byte total; no private
values or financial records are printed or downloaded. A local disposable
layout containing the existing retained-store fixture passes this smoke check.
It does not assert row contents or schema compatibility.

The cloud probe succeeds for every destination. All report native version
`2.0.0-alpha.60`, a present/nonempty app ID and pinned trust metadata:

| Snapshot destination | Store files | Store bytes |
| -------------------- | ----------- | ----------- |
| Production           | 2           | 2,899,978   |
| `mono` preview       | 2           | 1,196,043   |
| Custom qualification | 2           | 1,212,427   |

These are counts and file sizes, not financial records or row counts. The
inspection session ran for **24.116 seconds**, with 2.07 seconds active CPU.
No original core was opened, started, stopped or upgraded by this probe; no
source Drive was mounted read-write, forked, renamed or deleted. Production
kept its existing independent writable mount. No deployment settings or pins
changed. Only the temporary inspection Sandbox was created and stopped.

Evidence: `/private/tmp/finance-snapshot-inspection.log`, SHA-256
`d15d7236c8b55a19ae9b808ac3d2e084b7c8abf1370b0638a6351ab85956444a`;
cleanup `/private/tmp/finance-snapshot-stop.log`; final stopped/snapshot-mode
confirmation `/private/tmp/finance-snapshot-final-state.txt`.

Alternatives considered: `Drive.fork()` creates an independent writable Drive
and remains available if a large compatibility run needs it, but adds a persistent
data copy and cleanup. An ephemeral scratch copy from a read-only snapshot is
enough for the bounded next checks. Running alpha.66 against an original Drive
is unsuitable for qualification: the SDK startup script installs the core,
updates the highest-version marker, may restart the core and publishes schema.
Calling that path a read-only query would be incorrect. Do not create a custom
copy/retention service or a naming patch for the unreachable destination.

**Next qualification, not yet run:** prepare old/new native readers on separate
disposable scratch copies from the same immutable snapshot view, preserving
app ID, rows, schema and attachment bytes. Report comparison results without row
contents. That result still does not establish live workload/OIDC admission;
qualify the intended deployment credential boundary separately. Keep the custom
qualification destination unchanged and excluded from rollout; the corrected
production backup handoff below does not move or reset it. U4/U5 stay open; no partial app pin switch is made.

## Native reader comparison on retained snapshots

The user requested continuing from metadata access to actual native old/new
reads. The bounded comparison now passes, using another one-vCPU nonpersistent
five-minute Sandbox, `finance-retained-readers-20261117`, with networking denied,
no published ports and native read-only snapshot mounts of the same three Drives.
Only package/test code was uploaded. Financial rows and private metadata values
were neither printed nor downloaded.

`retained-prepare.mjs` reuses the earlier Finance schema artifact: actual legacy
alpha.60 bundles and native generated candidate schema/permission bindings.
It preserves the proven stored-schema identity and prepares independent exact
alpha.60, alpha.66 and newly released alpha.67 installs with matching native
Linux binaries. Both newer readers use the same qualified generated source; no
schema rewriting, new migration, application wrapper or SDK patch is introduced.
The dependency graphs and frozen locks remain in the disposable artifact.

Each native reader copies the snapshot's `store` to a fresh writable scratch
directory, copies the retained outer `app-id` into that directory, and opens
`sqlite({ path: scratch, blobs: 'sqlite' })`. This preserves Vercel's native app
identity and inline blob storage without mounting an original Drive writable.
It checks SDK/native package version equality and the actual returned app ID,
then reads all 23 Finance tables using native `Db.all`, including audit fields.
Canonical comparison includes IDs, Dates, BigInts, every selected scalar/JSON
value and exact binary contents. Per-run HMAC digests use an ephemeral key kept
inside the Sandbox; only counts/table names/booleans leave the test. All scratch
copies, digests and the key are removed before stopping the Sandbox.

Every identity, row and binary comparison matches alpha.60 for **both** candidates:

| Snapshot destination | Rows across 23 tables | Binary cells | Binary bytes |
| -------------------- | --------------------- | ------------ | ------------ |
| Production           | 987                   | 6            | 1,127,923    |
| `mono` preview       | 92                    | 0            | 0            |
| Custom qualification | 36                    | 2            | 28,723       |

Production includes 546 transactions, five file parts containing 1,118,293
attachment bytes, and one profile binary value containing 9,630 bytes. The
qualification snapshot includes four transactions and two file parts. Preview
has two transactions and no attachment rows, so its empty attachment comparison
is not evidence of retaining nonempty attachments. This comparison covers
current returned rows, not every historical version or unsupported schema.

Before the cloud run, the fresh native alpha.60 fixture passed nine reader opens
and six version comparisons over all 23 tables, including maximum-safe minor
units and a five-byte attachment. An independent native update flips one byte
without changing row or byte counts; both row-content and binary comparisons
correctly refuse it. Initial local setup errors (a missing fixture category and
an incorrect schema-metadata iteration shape) were corrected before cloud work;
no app assertions or SDK behavior were weakened.

Cleanup stops the temporary Sandbox after **64.355 seconds** (18.96 seconds active
CPU). The final native listing confirms stopped status and all three mounts in
`snapshot` mode. No original core was opened for writes, started/stopped/upgraded,
or retargeted; no source Drive was forked, renamed or deleted. App pins and
deployment settings stay unchanged. The original archive emitted harmless macOS
extended-attribute warnings during Linux extraction; preparation now excludes
those attributes, verified separately without repeating the data run.

Evidence: `/private/tmp/finance-retained-cloud-comparison.json`, SHA-256
`13c1eea51e285b8f18137de0c4875847b47248a798d64aff295337a2f9fedd38`;
raw CLI log `/private/tmp/finance-retained-cloud-comparison.log`, SHA-256
`a7e347d8229d2f8365734d451523e5995b337d69e6729fb59597cb162acb27c5`;
cleanup `/private/tmp/finance-retained-compare-stop.log`; final state
`/private/tmp/finance-retained-compare-final-state.txt`. Repeatable preparation
artifact: `finance-retained-readers-GKzIwf`; local proof log:
`/private/tmp/finance-retained-repeatable-local.log`.

This qualifies **retained snapshot read compatibility**, not live deployment
workload/OIDC admission or a production schema/SDK rollout. The custom
qualification data is readable on copies but its original name remains outside
the native namespace form. Keep the qualification destination unchanged and outside rollout;
the corrected production backup handoff below does not require migrating it. Reuse these same readers if needed; do not
build a data-copy service, automatic replay or a naming patch. Finish live
credential/destination admission and actual consumer/worker qualification before
the coherent version switch. U4/U5 remain open.

## Production backup handoff and custom-core scope

The earlier historical-preview handoff was incorrect for the user's data. The
preview had a custom-core override configured, but that was not proof that it
contained the user's workspaces. The user opened it and reported that their
existing transactions were absent, then explicitly identified
`https://finance.delightfullabs.com` as the site showing those transactions.
Do not reuse the historical qualification-preview URL as their backup source.

The corrected owner handoff is
`https://finance.delightfullabs.com/settings/workspace`: select each owned
workspace, choose password protection and download its `.dlf` file. Keep files
and passwords locally; report how many workspaces were backed up. No recovery
phrase, password or archive needs to be sent in chat. If expected data is missing
or export is disabled, resolve that specific production identity/access issue
before claiming a backup. The user has now confirmed that the production backup
files are saved. This records their completed export; archive contents have not
been independently opened or restored by the agent. Files/passwords remain local
to the user. Continue the in-place upgrade qualification without waiting on
qualification-preview backups or preparing a replacement production core.

Current Vercel alias resolution confirms that domain targets a READY production
deployment, `dpl_WoqfZvJZjbd9xSz3Yc8MzRXNpAUG`. The user's confirmation establishes
which site holds their visible data; deployment metadata alone does not establish
ownership. No environment variables, deployments, cores or data were changed
while correcting the handoff.

**Production is an in-place upgrade.** Its existing core and Drive already have
compatible native names, and their retained snapshot reads pass on alpha.66/67.
The UI backup is additional preservation before upgrading; production does not
need a fresh core or workspace restore to solve the separate custom naming issue.
Preserve its existing destination, identities and data through the coordinated
SDK switch, with remaining workload/auth/caller gates intact.

The separate `finance-alpha60-preview-qualification` environment remains
unchanged and excluded from rollout. Its data ownership/retention needs have not
been established by the user's production login. Do not require them to back up
unfamiliar qualification workspaces, invent a naming workaround, or delete/reset
that core or Drive. The existing UI backup/restore approach remains available if
its data actually needs moving under a separately confirmed owner/source.

For such a move, restoration creates a new workspace owned by the restoring
identity. The released field allowlist excludes bank secrets, profile avatars
and operational jobs; memberships and bank metadata are inert references, not
live grants/credentials. Reconnect banks and re-establish sharing as needed.
That is distinct from preserving the existing production core in place.

## PR46 hosted checkpoint at d495c6da

Finance qualification and Foundation checks pass at the selected-editor commit.
Clipper run `44309598650` passes 11 packaged-extension cases and fails the first
clip in the account-restoration case because the toolbar never appears within
its existing 20-second assertion. The captured application/restoration charts
reach ready/restored/connected; connection-store notification separately reports
`Could not establish connection. Receiving end does not exist.` The trace does
not establish that this notification causes the missing toolbar. Preserve the
actual extension assertion and investigate its native background/content-script
handoff; do not attribute it to Finance's changes or call it fixed from a later
passing run. Ledger checkpoint `05ce9fb5` passed Finance, Foundation and Clipper.
The Finance ledger/editor commits change no Clipper product source. Full Clipper
extension qualification remains an activation gate.

## November 18 qualification: retained broker patch responsibilities

The full alpha.67 application upgrade remains unmerged. Native Clipper worker
qualification passes 27/32 cases after sharing the exact broker asset across
Window clients, application workers and fixture SDK consumers. Five existing
long-lived-broker cases fail: fresh joining proof, expired proof, forged proof,
wrong audience and wrong identity. The fresh joining worker clock is verified
independently; changing request interception did not resolve the failure.

Source inspection confirms alpha.67 still calls `acceptPeer` without the joining
peer proof. The native adapter uses the physical broker runtime’s original
`selfSignedClientProof`, which expires while the broker remains alive. The real
error is `token expired` at subscriber admission. Retry after offline edits also
hits `GracefulShutdownSyncError` because the SDK waits for remote synchronization
before replacing its failed connection.

These are two existing alpha.60 patch responsibilities, not a proposed new
application credential or call-owner layer. Their source is preserved at
`51b8e878:patches/jazz-tools@2.0.0-alpha.60.patch`. They were not included in the
initial alpha.67 bridge/backend/provider patch.

Approved disposition — November 19: the user approved porting both retained
fixes into the shared alpha.67 patch. Keep the scope below; no additional
application credential or retry layer is authorized by this decision.

1. Port the existing joining-proof path through broker bootstrap, the peer record
   and `acceptPeer`. Keep owner identity and audience fixed; let native
   `acceptSubscriberWithSelfSignedProof` verify signature and expiry. Maintain the
   published broker bundle and its readable source together. Add no token cache,
   renewal policy or application authorization implementation.
2. Port the existing retry shutdown option: explicit retry uses native local
   drain (`waitForSync: false`); sign-out and account replacement keep their
   existing synchronization requirement. The physical replica and pending writes
   remain native SDK responsibilities.
3. Qualify all five existing negative/fresh proof cases, offline edits across
   visible Retry, and both apps’ native session/binding cases before upload.

The alternative is to leave this upgrade unmerged until an upstream release
passes these requirements. Do not remove the existing negative tests or treat a
fresh-session worker fixture as long-lived broker qualification.

Implementation and local qualification — November 19:

- Both retained fixes are implemented in the shared patch, including the readable
  broker/native adapter, its declaration and the published broker bundle.
- Full Clipper worker qualification passes 32/32, including all five previously
  failing proof/offline Retry cases.
- Full Finance application-worker qualification passes 66/66 across three engines;
  SDK/session binding qualification passes 42/42.
- Finance units cover all 1,799 cases green; production PWA/offline passes 19/19.
  Local First native capture/export passes 20/20. Browser fixture repairs retain
  every original assertion’s purpose and introduce no app-level coordination.
- Final code-head hosted CI remains the merge gate. Preserve all concurrent PR
  commits and the normal worker integration; do not revert to the inactive
  foundation checkpoint.
