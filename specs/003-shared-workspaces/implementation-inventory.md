# Shared workspace implementation inventory

Source baseline: fetched `origin/main` at `e7b8f5e7` (2026-11-23).
This updates the 2026-11-14 research against the merged production worker code.
It records source findings and the proposed ownership design; it does not claim
new runtime qualification or authorize publication or data changes.

## Changes since the original research

Finance now runs its application through `runtime/worker/application.worker.ts`,
`machines/runtime/worker-application.ts`, `worker-queries.ts` and `worker-forms.ts`.
Both apps use Local First's `backend/jazz/session-runtime` and `session/runtime`.
Clipper's `backend/jazz/account.ts` delegates SDK ownership to that shared native
adapter and supplies `createLibraryBinding`. Do not extract the old account host
or repeat the completed native-session work.

The installed dependency declarations now select Jazz `2.0.0-alpha.67` and XState
`6.0.0-beta.1`. Clipper web config uses `initial: 'device'`. The alpha.60 session
API observations in the original research are historical and must be rechecked
against the selected package before deciding bootstrap admission.

Two original extraction candidates are no longer production integration points:

- `apps/finance/src/lib/machines/workspaces/workspace-startup.ts` has no other
  production source caller found. Production `worker-forms.ts` invokes
  `workspaceInitialization` directly and coordinates seeding separately.
- `apps/finance/src/lib/machines/runtime/workspace-selection-attachment.ts` was
  unused outside its adjacent test at the baseline. Both are now removed after
  qualifying production use of the shared resource owner; moving that older
  wrapper alone would not have converged the running apps.

The old observation/drain files named in the original research are absent from
the current source. Use the production owners below as the baseline.

## Responsibility inventory

Paths in this table are relative to the monorepo root. “Extract” means extend or
compose the existing Local First owner and adopt it in both running apps, not
copy the entire Finance runtime into a library.

| Responsibility | Finance today | Clipper today | Shared destination and retained app bindings |
| --- | --- | --- | --- |
| SDK/session acquisition, identity changes and native binding invalidation | `runtime/worker/application.worker.ts` consumes shared native session/runtime APIs | `backend/jazz/account.ts` and worker host consume the same APIs | Already shared. Keep app config, namespace, capabilities and explicit extension authentication local. |
| Initial workspace discovery and bootstrap transaction | `machines/workspaces/workspace-initialization.ts` configures shared `workspace/initialization`; production invokes it from `machines/runtime/worker-forms.ts` | `machines/runtime/root-bootstrap.ts` reads/ensures its canonical library through `backend/jazz/library-binding.ts` | Extend the existing shared initializer with safe admission; replace Clipper's bootstrap chart. Apps supply reads, stable root/record intent, atomic writes and authorization. |
| Session-bound initialization lifetime, outcome forwarding and optional seed coordination | Production `worker-forms.ts` owns initialization invocation, shutdown and output; `workspace-startup.ts` is an older wrapper over the shared startup machine | `machines/runtime/application-readiness.ts` owns bootstrap, adoption and shutdown | Consolidate reusable production coordination into Local First, reconciling existing `workspace/startup` rather than adding another startup owner. Finance supplies optional seeding/integrity policy; Clipper needs no seed actor. |
| Workspace target input | `machines/workspaces/workspace-navigation.ts` resolves route/profile/transaction destinations; `worker-application.ts` receives route selection | Library target currently inferred from `identityId` | Shared lifecycle accepts an explicit target. Finance keeps URL and financial lookup rules; Clipper supplies its validated initial target. No new Clipper routing framework. |
| Selection, activation identity and scope replacement | `worker-application.ts` owns revisions, `SELECT_CONTEXT`, read binding replacement and stale report admission; shared selection API exists but is not wired into this production owner | `application-readiness.ts` owns account-bound library adoption/custody; no independent workspace selection | Reuse `workspace/workflow` and its lease contract in a shared composition. Extract remaining reusable attachment/replacement decisions from active Finance behavior. Review the older attachment chart as reference, not as proven production behavior. |
| Access observation | `runtime/worker/binding.ts` supplies workspace/membership/grant subscriptions; `worker-queries.ts` owns scoped observations and Finance projects eligibility | `library-binding.ts` checks private root ownership/version, and permissions enforce ownership | Apps supply access facts and policy. Local First owns common admission/invalidation decisions. Keep Finance membership/grants and Clipper private ownership in their schemas/policies. |
| Selected resource lifetime, invalidation and drain coordination | `worker-application.ts` and `worker-forms.ts` coordinate query/form replacement and closing | `application-readiness.ts` coordinates library binding and capture-library shutdown | Share scope correlation, immediate admission withdrawal and replacement/settlement ordering. Apps retain resource construction and native domain drain operations. Do not move article or financial workflows into the foundation. |
| Creation intent, transaction and uncertain settlement | Finance's `machines/workspaces/workspace-creation*.ts` consume shared creation/transaction APIs and supply domain writes | Bootstrap has a root write receipt; article writes have separate domain operation owners | Reuse current Local First creation/transaction custody APIs. Preserve exact admitted receipts. No second generic journal, transaction supervisor or Clipper-only bootstrap settlement owner. |
| Workspace content construction and cache scope | `runtime/worker/binding.ts` constructs workspace-filtered queries | `library-binding.ts` constructs records/library with `identityId` as library ID and an account-level current predicate | Apps construct domain capabilities for the admitted workspace lease. Split identity ID from workspace ID and include activation correlation in admission/results. Audit cache, search, draft, reader and publication paths. |
| Storage authorization and schema | Finance owns organizations, profiles, memberships and account permissions | `backend/jazz/permissions.ts` and generated schema own libraries and same-library child references | Remain app-owned. Audit account-ID assumptions, including highlight checks using `libraryId: session.user`. No common role enum or automatic shared database follows from sharing lifecycle. |
| Web/extension convergence | Finance has one web integration | Extension `account-worker.ts` uses the shared Clipper application worker with extension library/config and explicit connection confirmation | Both Clipper bindings consume the same Local First workspace resolution. Keep trusted extension connection confirmation and request continuation app-owned. |

## Shared ownership design

Compose existing Local First initialization and selection actors under a shared
workspace owner. Evolve `workspace/startup` if it can own this composition without
duplicating `workspace/workflow`; choose the public export during implementation
review. The owner receives session binding observations, explicit target requests,
target-specific access observations and domain resource drain receipts. It emits
bounded initialization provenance and selection reports. Native Db/session
objects remain behind native integration capabilities.

| Stage | Decision and owner | Completion or interruption |
| --- | --- | --- |
| Unbound | Shared owner waits for an admitted native session binding. | A new binding starts initialization/target resolution; shutdown closes without domain work. |
| Resolving | Existing shared initializer owns local evidence, authority discovery, permitted bootstrap and exact transaction settlement. App adapters supply storage leaves. | Provenance informs the initial target; it never substitutes for current access. Replacement withdraws admission and retains outstanding settlement. |
| Selecting | Existing shared selection machine correlates target request and access observation. | A usable local target can activate independently of unresolved optional provenance repair/seed work. Missing authority never proves global absence. |
| Active | Shared selection owner issues the activation lease; app creates domain resources for that lease. | Identity/client/database/access/target changes invalidate admission immediately. Optional seeding stays independent. |
| Draining | Shared lifecycle retains the original activation and awaits the app's exact resource/transaction receipts. | Only settled drain permits replacement or release. Failure/unknown settlement remains explicit; timeout or actor stop cannot acknowledge drain. |
| Unavailable, failed or closed | Shared owner reports the chosen outcome with correlation. | Retry needs admitted evidence and retained intent; late results cannot reactivate an older activation. |

This is a responsibility model, not a mandate to add one new state per table row.
Preserve independently usable local content while provenance is unresolved. Keep
Finance's route/form-specific update behavior outside the shared scope decisions,
including updates that retain resources within one workspace.

## Implementation slices and removal criteria

1. Recheck alpha.67 native identity creation/restoration APIs and existing
   initialization transactions. Select a safe offline bootstrap admission that
   both apps can consume. Device identity kind alone is not fresh-creation
   provenance. Keep missing restored data conservative. Qualify canonical-root
   convergence if that alternative is selected; deterministic IDs alone do not
   establish transaction/conflict safety.
2. Consolidate the reusable initialization lifetime and neutral result reporting
   from Finance's production `worker-forms.ts` with existing shared startup.
   Finance adopts it first; remove the corresponding app-owned coordination.
   Clipper then replaces `root-bootstrap.ts` and bootstrap orchestration through
   the same API. Preserve Finance's independent seed and integrity workflows.
3. Wire the shared selection/lease lifecycle into Finance's production worker,
   extracting reusable scope replacement decisions while preserving routing,
   forms and financial drains. Qualify the actual production path. Remove the
   older unused attachment implementation if the replacement supersedes it;
   do not retain a second selector just for compatibility with old tests.
4. Have Clipper consume that same workspace owner. Change `createLibraryBinding`
   to bind content to workspace ID/activation separately from session identity.
   Replace workspace lifecycle decisions in `application-readiness.ts`, keeping
   account presentation, capture/library operations and extension sign-in local.
   Audit authorization and every direct record construction path before schema
   changes. Retire obsolete root/lease contracts after all consumers migrate.
5. Review remaining app differences against the inventory. Common fixes must
   require one library change; neither app should implement its own equivalent
   initialization/selection/replacement statechart. Move reusable regressions
   with the shared owners and retain domain integration coverage in each app.

For each implementation slice, review the complete affected statechart before
dependent tests, then qualify public/packed exports, both production worker
bundles and native persistence/authorization. Include fresh offline startup,
cold reopen, empty restored replica, concurrent initialization, replacement,
access loss, A → B → A late results, unknown settlement and web/extension
agreement. Existing source and historical test results do not establish these
guarantees for the proposed composition.

## First extraction and qualification

The first implementation slice moves the existing production
`workerWorkspaceSeed` lifecycle from Finance into `createWorkspaceSeedOwner`,
exported through Local First's existing `workspace/startup` subpath. Finance's
export is now a typed binding that supplies `workspaceFakeData` and maps the
neutral workspace ID to its organization input. The production forms owner
continues using the same input, events and terminal result.

This preserves the existing ownership model: wait for `INITIALIZED`, invoke
one seed actor, ignore duplicate initialization, forward `SHUTDOWN` once and
wait for the child's terminal output. Unknown settlement, child errors or
missing terminal output produce `unresolved`. Shutdown before initialization
closes without creating a seed actor. The input mapper is pure; domain decisions
and database operations remain inside Finance's existing seed chart. Clipper
does not acquire an optional seed owner when it has no seed work.

This is a bounded extraction of active startup coordination, not completion of
shared workspace adoption. The older shared startup API was retained for the
first review and retired after the replacement was qualified, as recorded below.
Native initialization admission and shared selection adoption remain open. No
storage policies, data, routes, product strings or credentials change.

The reviewed implementation files are:

- `packages/local-first/src/lib/machines/workspaces/seed-owner.ts`
- `packages/local-first/src/lib/machines/workspaces/startup.ts`
- `apps/finance/src/lib/machines/workspaces/workspace-fake-data.ts`

The user's subsequent “Continue” in response to the explicit implementation
approval/testing request authorized behavioral qualification of this slice.
That approval does not authorize publishing, commits, data changes or new copy.

Qualification now covers no work before initialization, one invocation despite
duplicate initialization, shutdown while waiting/running, late completion during
drain, repeated shutdown, unresolved settlement and child failure. Generated
coverage uses fast-check seed `20261123`, 100 runs and sequences of up to 20
initialization/shutdown commands. This is bounded coverage, not an exhaustive
concurrency proof. Missing child output remains defensively classified as
unresolved; tests use typed actors with valid terminal outputs.

- Local First seed-owner and existing startup suites: 14 tests passed.
- Finance seed-policy/binding and production worker-application suites: 90 tests
  passed, including retained initialization writes and unanswered authority.
- The packed-package consumer checks declarations, public export resolution,
  one seed invocation and retained drain, and builds a self-contained worker
  using the packed `workspace/startup` export.
- Finance and Clipper production builds passed, including their worker bundles.

The native browser seed/refresh regression passed twice, with seeding enabled
and disabled. It used an isolated checkout, its own dependencies and disposable
Finance data on port 5196. This verifies seed policy and reload without
duplication; it does not prove the outstanding fresh-offline/bootstrap or
restored-empty-replica requirements.

Static validation for this review slice: Node 24.22.2, frozen offline dependency
installation in the isolated checkout, library packaging with strict publint,
Local First and Finance type/Svelte checks, workspace dependency identity checks,
and scoped formatting/lint checks passed. Initial localization generation failed
to load its CDN plugins in the network-restricted sandbox; rerunning with network
access resolved the diagnostics. The browser server also required the normal
sandbox escalation to bind its disposable listener; a denied listener was not
counted as an application-test failure.

## Fixed-binding initialization ownership and qualification

Move initialization completion/reporting and drain interpretation from Finance's
production forms owner into a shared `createWorkspaceStartupOwner` exported by
`workspace/startup`. It invokes the existing app-configured initializer; it does
not replace initialization discovery/transactions or create another SDK owner.

The input captures one native binding, initializer input and report recipient.
The typed report retains the binding, original initialization result and neutral
`identityId`/`initialWorkspaceId` provenance. Provenance is not selected access.
The app supplies a pure provenance projection. Resource replacement remains
owned by the session/runtime: close the old startup owner before releasing its
binding or starting its replacement. No mutable request-update protocol is added.

| State | Owned work and output |
| --- | --- |
| Initializing/active | Invoke the existing initializer exactly once. |
| Initializing/closing | Forward shutdown once; keep the invocation alive until its own writes/drain settle. Suppress ordinary initialized reports after shutdown. |
| Settled | Publish the result/provenance once, keep it available until shutdown, and admit no second initialization. Seeding and domain integrity remain independent. |
| Closed | Return a terminal receipt with the retained result/provenance. |
| Unresolved | Return an explicit unresolved receipt for child failure, missing output or unresolved initialization settlement; do not acknowledge safe release. |

Finance consumes the report only for its admitted binding and active lifetime.
It keeps seed/integrity forwarding as thin domain wiring. It waits for the startup
owner's terminal receipt rather than treating a previously reported result as
shutdown completion or inspecting the initializer child's private status.
Pending authority discovery can close without creating a replacement workspace;
issued writes remain owned by the original initialization transaction.

The older combined startup factory was initially retained during review. After
qualification and caller inventory, it was retired rather than transplanting
its Finance-shaped request/seed protocol into Clipper. Bootstrap admission,
selected resource leases and cross-app linking remain separate unresolved work.

The implementation now adds the shared report/provenance/receipt contracts in
`contracts/workspace-startup.ts`, the fixed-binding owner in
`machines/workspaces/startup-owner.ts`, its existing-subpath export in
`machines/workspaces/startup.ts`, and Finance adoption in
`apps/finance/src/lib/machines/runtime/worker-forms.ts`. Finance's forms owner
no longer invokes the initializer directly, examines its private status for
shutdown, or treats an initialization result as a closed-owner receipt.

One intentional settlement change needs behavioral review: an initialization
result already reported as unresolved now also prevents a later startup shutdown
from acknowledging `closed`. Previously Finance checked unresolved settlement
only if initialization completed during shutdown. Local First now owns that
interpretation for both timing cases.

The user approved qualification of this implementation with “continue” in
response to its review/testing request. Coverage includes result/provenance
correlation, single publication, unavailable/failed initialization independent
of local usability, shutdown before/after completion, unresolved results in both
timing cases, child errors, and suppression of late reports.

- Before retiring the older API, the startup-owner, seed-owner and older startup
  suites passed 24 tests.
  Startup generated coverage used seed `20261124`, 100 runs, both completion/
  shutdown orders, both known/unknown settlements and 1–5 duplicate shutdowns.
  This is bounded schedule coverage rather than a concurrency proof.
- Finance's production worker and seed-policy/binding suites passed 91 tests.
- The packed public API fixture passed declaration checks, result/provenance
  delivery, confirmed and unresolved shutdown receipts, and self-contained
  worker bundling through `workspace/startup`.

The tests exposed a host-level failure path: Finance discarded failed forms
snapshots while draining and could wait indefinitely for a closed receipt after
startup reported unresolved settlement. The worker's draining state now handles
a failed report from its admitted forms binding as `drainFailed`, retaining the
native session. Foreign-binding failures remain ignored. Both the retained-write
positive path and the unknown-before-shutdown failure path are covered through
the real Finance worker/form composition with controlled transaction receipts.

The first generated run also exposed an error in the test report sink: it counted
XState's initial event as an initialization result. The corrected sink admits
only `WORKSPACE_INITIALIZATION_RESULT`, preserving the original assertions. The
shrunk fixture is retained at
`packages/local-first/tests/reproductions/startup-owner-report-sink.json`.

Static review checks passed for this slice: shared library package/publint,
Local First and Finance type/Svelte checks (zero errors/warnings), scoped
formatting/lint, documentation links and diff whitespace checks. These results
complement the behavioral qualification above.

### Retired duplicate startup path

The caller inventory found no production user of the older combined
`createWorkspaceStartupMachine`. Its remaining references were the unused
Finance wrapper, their legacy protocol tests and a package-export fixture.
Removed the combined machine, unused wrapper, obsolete request/status contracts,
Finance reexports and tests tied only to that retired protocol. The supported
`workspace/startup` entry now exposes the two qualified production owners.

The replacement coverage stays at the active ownership boundaries: native
session readiness/replacement belongs to the shared session runtime; startup
result/drain correlation belongs to `startup-owner.test.ts` and Finance's actual
worker composition; optional seed lifecycle/policy belongs to `seed-owner.test.ts`,
Finance's binding suite and its seed-enabled/disabled browser regressions.
Historical research references to the retired API remain provenance, not advice
to recreate it. This private workspace package has not been published.

After retirement, the shared startup/seed/native-session suites passed 55 tests.
Finance's worker/seed suites passed 91 tests; packed exports, both production
builds, static checks and formatting/lint passed against this reduced API.
The native seed-enabled and seed-disabled browser
regressions both passed with the production startup owner before the unused
legacy path was removed; no executed browser path used that legacy API.

## Clipper canonical-root initializer adoption design

Clipper's current schema authorizes exactly one private root with
`id === ownerId === session.user` and `bootstrapVersion === '1'`. Retain that
canonical ID instead of creating a second workspace/provenance table or changing
storage policy. Missing replica evidence can ensure only that same root; it
cannot allocate a replacement ID. Native convergence and persistence still need
qualification for the new composition.

Extend the existing Local First initializer with optional canonical-root storage
facts: canonical ID and compatible/missing/incompatible status. Clipper supplies
those facts from its current root read without directory/profile or server facts. The shared
machine rejects mismatched/empty IDs, mixed directory evidence, incompatible
roots and prepared targets outside the canonical identity. Compatible roots
return locally without a write. Missing roots enter the existing prepare/bootstrap
path directly; Finance supplies no canonical facts and retains authority discovery.

Preserve the exact typed successful bootstrap receipt on the shared ready result.
Clipper uses it for its existing independent global-status observation; existing
local roots do not acquire a new-write or remote-acceptance claim. The app adapter
issues one canonical upsert and waits for that write's local receipt as one native
write leaf. It does not implement another read/check/write statechart or actor
supervisor. Shared initialization/startup/resource owners retain lifecycle decisions.

Unknown settlement cannot acknowledge clean shutdown or start a replacement
binding. Retain an issued receipt on failure and preserve it through unclean
application closure; the native host must continue to refuse clean release.
No automatic replay, new workspace controls, membership roles, schema migration
or changes to extension authentication are included in this slice.

Review the shared initializer changes, Clipper's thin bootstrap adapter and its
readiness projection before adding/running their behavioral tests. Required
qualification includes canonical existing/missing/conflicting facts, refusal of
different prepared IDs, Finance's partial-replica/authority behavior, interrupted
write settlement, native concurrent ensure/reopen, web/extension convergence
and existing offline first-use/cold-reopen scenarios.

The implementation now replaces Clipper's root bootstrap statechart with a typed
configuration of `createWorkspaceInitialization`, including one selected native
upsert/local-wait leaf. Clipper's application owner passes the admitted identity
explicitly, projects canonical conflicts into its existing presentation, and
uses the typed persistence receipt for existing sync feedback. It refuses clean
release on unresolved local settlement or unexpected initialization failure.

The shared initializer now retains closing/cancelling states through bootstrap
completion, including a child that cannot cancel an already issued atomic write.
It retains typed persistence on ready/settled interruption outputs. Bootstrap
logic accepts its concrete full event protocol via a defaulted generic parameter,
so Clipper's async leaf needs no cast or duplicate app-level supervisor; existing
Finance actor configuration keeps its current default command contract.

The user's subsequent `Continue` approved qualification of this implementation.
Clipper's bootstrap inputs and assertions now use the shared initializer contract;
the populated-startup browser regression observes the shared initializer's ready
result and verifies that opening existing data does not enter bootstrap.

Review-stage checks passed: Local First package/publint and source types, Finance
type/Svelte checks, Clipper application source-only type/Svelte checks, Clipper's
production build including its application worker, scoped format/lint, document
links and whitespace checks. The source-only Clipper configuration is generated
inside this isolated checkout's ignored `.svelte-kit` directory; it excludes the
pending bootstrap test fixtures and does not replace their qualification.

### Canonical initializer qualification (2026-11-23)

- Shared initialization/extraction/startup/seed suites: 35 tests passed.
- Finance initialization, production worker and seed suites: 104 tests passed.
  Warm initialization provenance, incomplete local replicas, authoritative discovery,
  cancellation, bootstrap conflict and rollback behavior remain covered.
- Clipper bootstrap/readiness/extension sign-in suites: 38 tests passed. Failed
  local receipts retain the exact write and refuse clean native release, including
  shutdown before or after failure. Noncancelable successful writes drain before
  closed/cancelled completion; shutdown retains priority.
- Native Clipper binding suite: 3 tests passed. Four concurrent owners using the
  same native Db converge on one canonical root; a fresh binding reopens without
  an ensure. This is not evidence for independently replicated concurrent tabs.
- Packed public consumers passed types, execution and self-contained worker checks,
  including existing/missing canonical roots through the public initializer export.
- Production offline shell suite: 6 targeted browser cases passed. First use works
  in Chromium, Firefox and WebKit. Abrupt worker termination/full offline restart,
  first-install failure/retry, and edits retained through two full browser restarts
  reconcile to an independent restored profile. App and authority endpoints were
  stopped for the cold offline checks.
- Native authenticated offline suite: existing and expired identities each passed
  two full browser restarts and reconnection/reconciliation (2 cases).
- Extension explicit sign-in and stale-account refusal passed. Account switching
  and capture into the restored web library passed on a diagnostic run. Its first
  run failed opening web account settings before restoration began; that navigation
  failure did not reproduce, so its cause remains unresolved. No timeout or
  assertion was weakened.
- Full Clipper web/extension checks, Local First library checks, Finance checks,
  production offline builds and extension production build passed.
- The populated-startup browser regression passed after its diagnostics were
  adapted to the shared initializer (1 case). Both shared libraries packaged
  successfully with strict publint; workspace peer links passed.

The disposable native test server initially required elevated listener permission;
the authorized rerun passed. No application data, production authority, credentials,
schema policy or dependency versions were changed. `origin/main` was fetched again
and remains `e7b8f5e7` (PR #54), the implementation baseline.

Remaining acceptance work includes independently replicated concurrent startup,
unanswered connections/partial replicas/later permission rejection, and the
neutral startup report/selection/access lease adoption still listed above.
Canonical-root qualification does not claim those remaining lifecycle requirements
are complete, nor does it establish cross-app membership or database linking.

## Clipper shared startup owner adoption

The next focused implementation binds Clipper's existing initializer to
`createWorkspaceStartupOwner`, the exact factory used by Finance's production
worker. The app adds no startup supervisor or persistence workflow. It supplies
the initializer and a pure ready-result-to-provenance projection.

Clipper's startup operation is finite: initialize the admitted native binding,
receive its neutral report, request startup closure, then consume the terminal
receipt before opening content. Finance retains its owner until its worker's
shutdown because its optional seed/integrity consumers use the report during
that lifetime. Both integrations use the same shared initialization/report/drain
implementation; app-owned domain consumers determine their required lifetime.

Ownership and admission states:

- `bootstrapping` invokes the shared owner with the admitted root, native identity,
  recipient and unique adopted-binding object. Only a report for that exact
  adoption requests closure. Reusing an identity/native binding after another
  adoption cannot admit an earlier report.
- `settling` waits for the shared owner's terminal receipt after acknowledging
  the report. Account replacement and shutdown change only the admission
  destination here; they must not send another command to a child that may have
  completed while its terminal notification is queued.
- `replacing` and `stopping` preserve their existing priority and wait for the
  same receipt. Reports arriving after interruption cannot reopen the library.
- Terminal `closed` output retains the exact initializer result and persistence
  receipt. Existing/create/conflict/failure presentation remains Clipper-owned.
  Unresolved output, absent initialization or unexpected owner failure refuses
  clean release and retains an issued write where available.

Changed implementation files are `root-bootstrap.ts` and
`application-readiness.ts`; the shared factory and Finance binding do not change.
No content schema, storage permissions, native connection policy, product copy,
selection/lease API or extension sign-in policy changes belong to this slice.

The user reviewed this implementation and approved qualification with `continue`.
Required
qualification includes ready/create/conflict output, foreign/earlier-adoption
reports, shutdown/replacement before report and between report/terminal receipt,
unresolved settlement and unexpected initializer failure. Existing native
offline/restoration/extension regressions must be rerun for the new composition;
the preceding qualification only covers the earlier direct-initializer binding.

Review-stage checks passed for this binding: full Clipper web/extension type and
Svelte checks (zero errors/warnings), production web/worker build, scoped
format/lint and whitespace checks. No behavior tests for this slice have been
added or run at that review checkpoint. The latest fetch still resolves
`origin/main` to `e7b8f5e7`.

Qualification now includes 47 passing Clipper bootstrap/startup/readiness/extension
sign-in tests and 10 passing shared startup-owner tests (including the existing
100-run generated settlement/shutdown campaign). The new race fixtures inject
interruption after the shared report is acknowledged and before the queued
shutdown completes. They cover shutdown and account replacement, foreign reports,
and A → B → A with the same native account but a different adopted-binding object.
Existing unknown-write and native-session-failure drain cases also pass through
the new shared owner.

The first race fixture used a retired XState inspection event and did not fire.
It now uses the installed v6 actor-topology/transition protocol and correlates
actor references rather than reading an unsupported field. The tests retain
their intended interruption interval and assertions; no production workaround
or timeout increase was introduced. Full Clipper web/extension checks pass with
the corrected fixtures. Native browser qualification follows below.

The new shared startup composition passed all 8 targeted production offline
browser cases: Chromium/Firefox/WebKit first use, abrupt worker termination and
cold offline reopening, first-install retry, retained annotation edits over two
browser-process restarts, and existing/expired authenticated identities over two
offline restarts with reconciliation. The extension production build passed;
all 3 account-switching, explicit sign-in and stale-account browser cases passed
on their first run in this qualification. The earlier direct-initializer slice's
navigation failure did not recur; this does not establish its original cause.
The populated-library restart browser regression also passed (1 case), including
existing-root readiness without another bootstrap, bounded rendering, lazy search
and direct reader access. This slice therefore passed 57 targeted unit/generated
tests and 12 browser cases, plus full Clipper type checks, production builds,
scoped format/lint and whitespace checks.

These checks use disposable profiles/authorities and isolated generated output.
No production data, schema permissions or dependencies changed. Shared selection,
access leases and the independent-replica/connection/permission scenarios remain
open as recorded in the feature specification.

## Selection integration continuation

The qualified initializer/startup implementation was committed as `090e33b5`
after the user's explicit `Commit and continue` instruction. The subsequent
[selection integration design](selection-integration.md) traces Finance's active
`SELECT_CONTEXT`, retained read/form bindings and full domain-drain protocol.
It identifies the prerequisite identity/access/resource split, the existing DLF
selector to reuse, and the shared receipt boundary both apps must consume.
The first small source extraction below prepares that boundary. It does not
introduce an unused selector, silently reinterpret route revisions as leases or
claim that changed observations acknowledge native resource drain.

### Shared observation lifetime

Finance's production `worker-queries.ts` contains the callback lifetime used for
all 15 query subscriptions, including identity, directory and target-access facts.
The new DLF `data/observation-workflow` export extracts its active-callback guard,
subscription ownership and disposal-failure boundary. Finance now supplies typed
value/failure reports and its existing `reportDisposalFailure` callback. Clipper's
library collection consumes the same factory in place of its separate subscription
callback. Native schemas, subscription construction, fact decoding and report
correlation remain app-owned.

The resource model is one invoked callback actor per native subscription. It
admits source values/failures while active, marks callback admission withdrawn
before calling disposal, and releases the returned subscription. Synchronous
subscription-construction errors report failure through the same typed path as
native read failures. Disposal errors use Finance's existing host failure signal;
Clipper initially retained its existing thrown-disposal-error behavior. Qualification
below replaces that insufficient host boundary with Finance's explicit failure
signal. Late source callbacks
after disposal cannot publish into the parent. There is no new selection policy,
session owner, operation supervisor, retry, polling or available-empty fallback.

Source files for this batch are the shared factory/public export and the two
production consumer bindings. The selection integration design and app integration
guide record the boundaries. The identity/access/content-owner split and actual
selection-lease adoption remain subsequent work.

The user's `Make a PR so we can keep track and continue` instruction approved
continuing qualification of the reviewed extraction. Required checks
include synchronous/asynchronous publication, absent subscription, startup/read
failure, late callbacks during/after disposal, exactly-once disposal and disposal
failure propagation, plus actual Finance query and Clipper collection behavior.
Packed export and native browser qualification are required after review;
previous initializer/startup results do not qualify this extraction.

Review-stage checks passed: both shared libraries packaged with strict publint,
DLF library checks, full Finance and Clipper web/extension checks (zero errors and
warnings), both app production builds, workspace peer links, scoped formatting/
lint and whitespace checks. No behavior tests were added or run at that review
checkpoint. The extraction was subsequently committed as `a2d3479e` and pushed
with the qualified startup work into [draft PR #55](https://github.com/delightful-labs/delightful-labs/pull/55).

The shared observer tests pass 6 cases, including a 100-run generated callback/
disposal campaign. The packed consumer passes public types, actual execution,
and self-contained worker bundling through the published export map. Finance's
84 production-worker tests pass, including subscription construction failure,
retired A → B → A callbacks, native read failure and disposal-error refusal.

Clipper qualification exposed a pre-existing host boundary gap: a throw during
collection callback teardown did not surface as a library-root error. The actual
account host must receive failure before consuming the library's completion.
Clipper now supplies that explicit host-failure callback just as Finance does;
the account owner checks it before continuing restoration or replacement and
returns an unclean drain instead. The shared observer factory remains unchanged.
The library's report-before-completion test and all three account-host shutdown/
restore/replacement failure cases pass. No new product copy or native session
supervisor was introduced. Current Clipper library/readiness coverage passes
65 tests. Native browser qualification and final checks follow this change.

Final local qualification passed:

- The complete DLF suite: 1,318 tests. Hosted CI exposed one missed notebook
  initializer expectation; it now checks the exact successful persistence receipt
  added by the shared initializer contract. No assertion was weakened.
- Finance's 84 worker tests and Clipper's 65 collection/readiness tests, plus the
  packed public observer consumer's types/execution/worker bundle.
- Finance's 4 production-worker browser cases: cold reads/saves with an unanswered
  connection, cold offline operation, an established connection that stops
  answering, and actual permission rejection following local success.
- Clipper's 8 production offline cases, 3 extension account-convergence cases,
  populated-startup regression and full 22-case account browser spec. Local
  account tests retain the original assertions and timeouts.
- Both app type/Svelte checks, production builds and scoped formatting/lint.

On the initial pushed head, hosted web CI failed 11 account cases, largely at
the root-sync status assertion. Its focused and full local reproductions passed;
the hosted cause remains unresolved. CI now retains failure traces and uploads
the web test-result artifacts, using the existing pinned artifact action. This
adds diagnostics without changing tests, retries, timeouts or pass criteria.
The PR stays draft while that hosted qualification and the selection/lease work
remain open. Hosted results and local qualification must be distinguished.

### Hosted failure follow-up

On `6ecbf452`, Foundation checks passed; Clipper worker/offline/extension jobs
passed, but the web job still failed. Its retained trace identifies a Vite full
reload in the first account case and several changing dependency hashes. The
new `workspace/initialization`, `workspace/startup` and `data/observation-workflow`
imports were absent from the existing explicit prebundle list. They are now
included. The full 22-case account spec passed from a cleared dependency cache in
this isolated checkout, including its unchanged zero-full-reload assertion.

Finance's workspace, startup, authentication, permission and application-1 browser
jobs passed. The application-2 artifact showed a single transfer-total assertion
with no expenses in the current period. Its fixture is dated October 25, while
the overview defaults to the latest 30 days: the row fell outside that range on
November 24 UTC while still appearing in the local November 23 range. That test
now selects an explicit October period through the existing UI before asserting
the same $1.00 total. The targeted native browser case passed. These are narrow
configuration/fixture corrections. Hosted requalification on `2d128916` passed
all Foundation, Clipper and Finance workflows, including both previously failing
browser jobs. This qualifies that pushed head, separately from the access-owner
extraction below.

## Finance access-observation boundary

The next source extraction follows the three-file batch listed in
`selection-integration.md`. `worker-workspace-access.ts` now owns the existing
profile, directory, target workspace and membership observers. It receives an
admitted native binding/target, retains the existing cached identity/directory
inputs, publishes a correlated facts selector and distinguishes unknown/null
rows from failed reads. It issues no workspace lease or eligibility verdict.

`worker-queries.ts` composes those facts with its remaining financial content
reads. It checks the access facts' binding before consumption and preserves the
existing aggregate read-failure behavior and combined query-view contract. The
Finance event projection over DLF's observation factory is shared by both groups
through `worker-query-observation.ts`; there is no duplicated subscription or
disposal lifecycle. Financial schemas, native query construction and policy stay
in Finance. The original `FinanceWorkerReady` type export is retained.

This is a source ownership boundary, not yet a lifetime cutover. The current
query owner still invokes the access group. The future shared selection host
will place it outside selected content resources so permission loss and unknown
access remain observable while content drains. Forms, startup/seed controllers,
route retention, financial writes and their native drain acknowledgements have
not changed in this batch.

The user approved qualification of the displayed source extraction with
“continue” after the implementation-review handoff. Required
qualification includes cached profile/directory startup, global/no-target reads,
unknown and denied target facts, read/construction failure propagation, disposal
failure, foreign bindings and old callbacks after A → B → A. Existing Finance
worker, workspace, permission, native offline/authority and retained-form tests
must qualify this new composition rather than relying on the earlier flat query
owner's results.

Source-stage verification passed: Finance source checks (zero Svelte errors or
warnings), test-fixture TypeScript checks and the production build. These are
static/build checks only; behavior qualification is recorded separately below.

Qualification after review passed:

- 102 Finance worker tests. The 18 added cases cover cached/global access facts,
  unknown versus absent target evidence, all four subscription construction/read/
  disposal failure sources, foreign bindings and retired A → B → A callbacks,
  parent content withdrawal and nested access-disposal failure during host close.
- 49 production browser cases across `multiple-workspaces.e2e.ts`,
  `permissions.e2e.ts` and `workflow-completion.e2e.ts`, including selection,
  observed membership loss, native authorization, retained forms and offline saves.
- Four production startup cases with disposable native authorities/profiles:
  cold browser restart offline, cold restart with an open unanswered connection,
  an established connection becoming unanswered and real later permission rejection
  after a locally successful save.

No retries, longer timeouts or weakened assertions were required. The shared DLF
implementation is unchanged in this slice. Its previously qualified observation
factory remains the subscription/disposal owner for both app consumers. New-head
hosted checks remain separate from these local results.

## Finance access/content observation lifetimes

The user's instruction to continue through the night, including tests, authorizes
implementation and qualification for the remaining PR work. It supersedes the
per-slice test-review pause for this task; commit/PR tracking authorization remains
in force. This does not authorize merging or production deployment.

The application ready state now invokes access observations outside its nested
financial reading/read-failed states. The financial query owner contains only
its eleven content subscriptions. A pure projection combines their facts with
the access owner's public facts; subscription and disposal behavior still comes
from the existing shared DLF implementation.

Same-workspace route changes restart only financial reads through a private
self-coordination event. Workspace/native replacement establishes a new access
binding as well as a new read binding. Explicit retry, restoration settlement,
cancelled restoration and sign-out continuation also establish fresh access
attachments, including when the SDK returns the same identity binding. Financial
read failure releases financial subscriptions and retains live access observations.
Read/construction/crash failures withdraw affected command admission; teardown
failure still prevents clean native release.

The existing worker suite now has 104 passing cases, adding real ownership checks
for retained access through content changes and live access after financial read
failure. The same-binding failed-restoration test also rejects an old access token
against the reopened observer. The 49 workspace/permission/form browser cases
passed. Four cold/native startup cases also passed: offline restart, cold open
but unanswered connection, an established connection becoming unanswered and
real later authority rejection after local persistence. The final source and
test-fixture type checks passed with zero Svelte errors/warnings; formatting and
whitespace checks passed. Hosted qualification must be checked for the new head.

The session-bound forms owner is unchanged. Financial operation drain/identity
controller separation and actual DLF workspace lease adoption remain required;
this observation-lifetime prerequisite does not claim those are complete.

## Identity controller group extraction

`worker-identity-controls.ts` now owns the existing startup, optional seed,
workspace creation, profile-name/avatar and navigation children. Its public
selector reports only identity facts and its observed lifecycle. It preserves
Finance's profile schemas, creation binding, navigation generations, startup
provenance and each child's exact supported shutdown/result protocol. The shared
DLF startup/seed implementations are unchanged.

`worker-forms.ts` composes this owner with its financial children through the
existing combined public view. It forwards typed identity commands/observations,
consumes initialization facts to update financial integrity, and waits for one
aggregate identity-close receipt alongside the existing financial receipts.
A failed identity group or unresolved startup/seed result cannot acknowledge clean
native close. The child still has the combined forms owner's lifetime in this
extraction; lifting it outside the leased financial group remains the next step.

The 105 worker tests pass, including a new production-parent test holding a
profile save across host close. Native SDK/store closure waits for the issued
save and the identity group's real aggregate receipt. Existing held startup,
unknown settlement, navigation, restoration and financial drain cases also pass.
Final source and test-fixture type checks passed with zero Svelte errors/warnings.
Formatting/whitespace checks passed. Native qualification passed 62 browser cases:
49 workspace/permission/profile-form cases, four cold/offline/unanswered-authority/
later-permission-rejection cases, and nine native worker cases across Chromium,
Firefox and WebKit (initialization/offline marker reuse, navigation drain and held
archive before native close). All retained their existing assertions/timeouts;
no retries were needed. New-head hosted qualification remains separate.

## Financial controller resource group

`worker-financial-controls.ts` now owns the financial domain children and their
existing parallel drain receipts. It consumes initialization as a typed fact and
has no startup, seeding, profile, workspace-creation or navigation children.
`worker-form-dependencies.ts` derives narrower identity and financial dependency
sets; the financial owner cannot access those identity controller dependencies.

`worker-forms.ts` is now a composition of the two groups, retaining the current
worker command/view contract and refusing file/transfer resources through the
existing fallback paths. It forwards observations and initialization facts,
classifies active child failures, ignores successful terminal snapshots until
terminal receipt handling, and waits independently for both aggregate receipts.
No domain write, role, validation or persistence policy was rewritten.

All 107 worker tests pass. One new case holds a profile save and financial archive
simultaneously, settles the financial group first, and proves native SDK/store
closure still waits for the identity receipt. Existing forced child completion,
unknown startup settlement, held creation/archive, restoration and navigation
cases pass. Source and test-fixture type checks pass with zero Svelte diagnostics.
The other new case catches an older financial success being published under newer
workspace observations. Financial public reports now pair the view with its exact
observation; the facade only consumes a currently correlated pair. Temporarily
removing that guard made the regression fail with the old workspace's success
visible three times under the new scope. The corrected full worker suite passes.
The corrected source passed 62 native browser cases: the 49 workspace/permission/
form cases, nine worker cases across Chromium/Firefox/WebKit and four cold/offline/
unanswered-authority/later-permission-rejection cases. Final source and test types,
formatting and whitespace checks passed. This is not yet shared lease adoption;
new-head hosted qualification remains separate from local evidence.

## Shared selected-resource owner

`workspace/resource` now exports `createWorkspaceResourceOwner`, with public
contracts under `workspace/resource-contracts`. It invokes the existing shared
selector for one fixed native attachment and one concrete app resource actor.
The app supplies pure input/view/failure/receipt projections and a typed shutdown
command. Both source and public consumers retain complete concrete event/input/
snapshot/output types without assertions or XState patches.

The owner enforces exact-lease command admission, withdraws it on invalidation,
issues resource shutdown once, retains the exact selector drain token and waits
for real settlement before replacement. Pending selection stays with the existing
selector. Shutdown wins pending replacement. Active failed/crashed resources,
missing/unresolved output and selector failure cannot fabricate clean release;
live unresolved resources stay invoked. Unexpected but demonstrably released
completion reaches the selector's explicit-retry failure path. Public reports
retain correlated scope/lease/receipt facts and never expose an old resource view
as a new activation.

Qualification passed: all 1,340 DLF tests across 66 files, including 22 new cases
and 100 generated pending-request schedules (seed 20261124). The controlled
resource records commands during drain and every shutdown delivery, so its own
refusals cannot mask owner defects. Real parent bursts cover immediate selection/
access invalidation followed by a retired command. Selector crash, unsolicited
closure, missing/unknown receipts and retained live failed resources are covered.
An owned-payload case proves refused commands release exactly once before
selection, during invalidation/closing and under unresolved custody; admitted
commands reach the resource instead. A parent burst preserves host-close priority
after unsolicited resource completion. Apps supply payload cleanup through the
optional queued refusal leaf.
Full source/Svelte/test types pass with zero diagnostics; scoped formatting/lint,
package/publint and complete public consumers pass. The new public producer also
passes from an actual packed package, including concrete command type refusals,
execution through held replacement/close and self-contained ES-module workers.

This shared owner is not yet adopted by production apps. Finance must bind its
financial/resource group first and remove the corresponding manual decisions;
Clipper must then consume the same implementation. Native app qualification and
remaining independent-replica canonical startup proof remain required.


## Native observation release receipts

DLF's existing `createBoundObservationLogic` now has an opt-in explicit `RELEASE`
command and `released(input, outcome)` projection. The native callback withdraws
admission before disposal, calls the disposer once, and publishes a receipt only
after actual return. Acquisition/disposal failure reports unresolved custody;
forced stop never publishes clean release. Existing stop-only consumers retain
their prior behavior. The packed consumer executes both clean and failed receipts.

Finance's eleven content observers use this same implementation. Their query
owner retains invocations while consuming each unique binding/source receipt,
withdraws rows during release, preserves close priority over read-failure drain,
and distinguishes failed reads with released resources from unresolved cleanup.
Its input now requires only the eleven content capabilities. Identity/access
observers remain independent. The production application still owns this query
group directly pending its move into the shared leased resource.

Qualification: 113 Finance worker/query tests pass (107 existing worker cases and
six query release cases). They cover all eleven native disposer calls before
completion, read failure, acquisition/disposal faults, missing/foreign/duplicate
receipts and a real parent failure/close burst. Source and test types pass with
zero Svelte diagnostics. All 62 native Finance browser cases pass: 49 workspace,
permission and form cases; nine worker cases across Chromium/Firefox/WebKit; and
four cold/offline/unanswered-authority/later-rejection cases. No retries or timeout
changes were needed. DLF adds six observation cases, including 100 generated
release/stop schedules (seed 20261126). All 1,346 DLF tests across 66 files pass.
Final complete source/Svelte/test types, package/publint, complete public and
packed-consumer execution, scoped lint/formatting and workspace links pass.

## Concrete Finance workspace resource composition

`worker-workspace-resources.ts` combines the existing financial controller owner
and content query owner for one immutable workspace lease. It waits for matching
binding/target observations before constructing either child. Financial controllers
outlive subordinate route-read replacement; old queries must return actual release
receipts before the latest route reads can start. Shutdown wins pending route
replacement and waits for both terminal receipts. Query disposal failure, financial
failure or unsolicited child completion retains unresolved custody and live
siblings. The public projection retains exact observation/read correlation.

Five new concrete-actor cases pass alongside the existing worker/query coverage
(118 cases total). They prove matching observation admission, retained financial
identity across query replacement, ignored retired callbacks, real cleanup before
clean closure, disposal failure and live sibling retention after unsolicited
financial/query completion. Full Finance source/Svelte/test types pass. This group
is not yet wired into the production native composition; its production and native
qualification follows with shared lease adoption. The fixture constructs the same
public financial-group producer instead of reading framework implementation fields.

The public DLF resource producer also distinguishes its full actor event type from
its externally sendable command type. The latter excludes XState internal events;
it cannot replace the full invocation type because the pinned actor scope retains
that internal protocol. The checked packed consumer includes a real internal event
and rejects attempts to send it through the lease envelope. No casts or framework
patches are used.


## Finance production lease adoption

`worker-forms.ts` now invokes the shared DLF resource owner, with identity controls
alongside it. The owner invokes the concrete financial/query resource group for
an admitted lease; `worker-application.ts` no longer invokes content queries or
restarts them directly. Native access observation remains outside that group.
The native producer supplies the eleven existing content capabilities and its
current cleanup-failure boundary. Apps still own domain policies, writes and
financial drain receipts; no domain statechart moved into the generic owner.

Public content facts are consumed only for the current native binding, actual
public forms lease, target, read binding and locally allowed access. Revocation
withdraws rows and views immediately. Same-workspace route reads retain both the
lease and financial controllers. Unknown access allocates no content resources,
while profile/creation/navigation remain usable. A known, permitted explicit
workspace no longer waits for the directory response; unscoped catalog resolution
and read/access failures retain their own gates. Startup feedback likewise remains
independent of financial construction.

A correlated sent-observation record prevents queued old child reports from
resending an already-issued observation. The first integration run exposed that
amplification; the corrected original URL-read regression and complete affected
suite pass. Loading reports retain existing forms only within an unchanged lease.
Cleanup failure has priority over later failed group reports. The obsolete unused
selection-attachment wrapper and its private tests are retired in favor of the
qualified shared owner and production-parent coverage.

Qualification passes: 161 worker/query/navigation cases, complete source/Svelte/
test types with zero diagnostics, scoped formatting, and all 62 native Finance
browser cases. Native coverage includes 49 workspace/permission/form cases, nine
worker cases across Chromium/Firefox/WebKit, and four cold/offline/unanswered-
authority/later-permission-rejection cases. No retries, longer timeouts or weaker
assertions were used. Existing held-write A → B → A coverage now proves no pending
workspace constructs before the original receipt, then only the latest A starts.
New parent cases exercise unknown/partial catalog evidence, same-workspace lease
retention and revocation/regrant with held writes and rejected retired facts and
lease commands. Full Local First formatting also passes after correcting the
new public documentation example's indentation, the sole failure in the previous
head's hosted Foundation run; hosted Finance and Clipper passed on that head.

This establishes production Finance lease/resource ownership. Activation origin
correlation for delayed UI/worker requests remains explicitly tracked in
`selection-integration.md`, alongside Clipper adoption and independent-replica
native qualification. The feature and draft PR remain incomplete until those
requirements are satisfied. Production build qualification is recorded below.

Final qualification after retiring the obsolete wrapper: all 1,840 Finance unit
tests across 138 files pass, along with the production build, final source/test
types and workspace dependency links. The targeted 161 cases and native 62-case
run above retain their separate scope. Shared library runtime source is unchanged
in this adoption slice; its full formatting check passes with the documentation
example correction.

## Finance command activation origin

Financial transport commands now carry the originating native forms attachment
revision and DLF lease epoch. Route/session revisions remain separate. Missing or
retired activation facts cannot authorize a command after same-route revocation,
regrant or same-binding forms reattachment. Window-owned ledger navigation and
private backup/bank admission use the same correlation. Identity commands remain
available without a financial lease. Native transfer requests retain the actual
lease object, and request/cancel replies use the actor's unique native session ID
instead of its reusable child name.

The access owner retains already-known, matching local membership on same-binding
forms retry; fresh native bindings and targets inherit no access. Real null/failure
observations still withdraw admission. Parent tests cover repeated lease epochs
across distinct attachments, refusal cleanup of owned file/secret capabilities,
and retired native requests against the actual bound database.

All 1,855 Finance unit tests across 139 files pass. Native qualification passes
85 cases: 69 application/permission cases including pagination and transfers,
12 worker cases across Chromium/Firefox/WebKit, and four cold/offline/unanswered-
connection/later-rejection cases. The real-client activation regression compares
old and fresh commands with the same current route metadata and verifies actual
native archive calls and persisted rows. The sample-batch handoff test now checks
that B stays blocked until A's held write settles and never displays A's progress;
native row counts still prove the write was not retargeted. This corrects the sole
Finance hosted failure on `209a2905`; Foundation and Clipper passed on that head.
Source/Svelte/test types and scoped formatting pass. Clipper lease adoption and
independent-replica qualification remain open.

## Clipper explicit native target and ongoing access capability

`createLibraryBinding` now separates identity and workspace inputs; the production
account producer passes the canonical identity ID explicitly. Native root queries,
records and library construction use the workspace input. A local native root
subscription supplies ongoing allowed/unknown/denied facts and a distinct error
callback for the upcoming shared resource-owner integration. Its disposer does
not own the underlying identity client. Application readiness does not consume
this capability yet, so this slice does not claim production lease adoption.

All 75 affected library/readiness/native-binding/worker-binding cases pass,
including two new real-policy fixture cases: unknown empty-root evidence becomes
allowed after actual local persistence without a startup report, and a different
explicit target never falls back to an existing identity root. Full coordinator,
web, service-worker and extension type checks pass with zero Svelte diagnostics.

## Clipper explicit collection release receipt

The production library now opts into the existing DLF observation `RELEASE`
protocol. Its collection lifecycle consumes only the original capability's
receipt after shutdown, then joins that receipt with the existing domain drains.
Repeated shutdown issues one disposal. Terminal output is explicitly released or
unresolved; unresolved output retains the original capability. The readiness host
requires the released output before restoring, replacing or closing cleanly.
This reuses Finance's observation receipt semantics without adding a second
resource-disposal implementation.

All 1,016 Clipper unit tests across 154 files and full coordinator/web/service-
worker/extension type checks pass. Tests cover missing and unrelated receipts,
failure without an optional diagnostic callback, subscription acquisition failure, exactly-once
disposal and held writes that outlive collection release. All 38 native browser
cases pass: 22 account cases, the complete 12-case production offline suite, one
populated-startup case and three extension offline/restoration/teardown cases.
Both offline production builds and the extension build pass.

The first development browser run remained waiting when a stale isolated
Vite cache supplied the pre-receipt DLF observer. Inspection confirmed the cached
bundle lacked `RELEASE` handling while the installed package contained it.
Removing only this worktree's generated cache produced the passing cold 22-case
run; no receipt gate, assertion or timeout was weakened. Production bundles use
the current implementation and pass separately. Shared lease adoption remains
open and follows this qualified terminal-receipt boundary.

## Clipper production lease adoption

Clipper now consumes the same DLF resource-owner factory as Finance. Its native
library resource acquires one app-owned capability and invokes the existing
capture/reader/search/image/write library. DLF owns selection, exact lease
admission, invalidation, replacement sequencing, drain tokens and unresolved
resource custody. The app controller keeps native root-access observation outside
that lease and joins its actual disposal receipt with shared-owner completion.
The immutable input binds a native account and fresh attachment; the explicit
canonical target is supplied separately by the native access capability.

Readiness no longer maintains a mutable set of adopted bindings or the
LIBRARY_BOUND/ADOPT/LIBRARY_ADOPTED handshake. Bootstrap retains only its immutable
attachment, and selected library construction waits for ongoing allowed evidence.
Identity or workspace changes invalidate even a reused native binding object.
Recovery remains identity-bound and is retained across library changes when its
native capability/source are unchanged. Existing native session closure remains
outside library selection.

Web intents, tag editing, reader-surface offers and extension saves capture their
original exact lease in a native command capability. They use the shared owner's
command envelope and never upgrade old commands to the latest selection. Refused
reader offers acknowledge their existing Window resource owner, including when
the original controller is already closed. Missing/failed access and issued writes
do not authorize a replacement. Unresolved release retains the live controller,
blocks restore/replacement/clean SDK closure and uses existing cleanup-failure
feedback. The extension's confirmed-account requirement is preserved.

Qualification: all 1,023 Clipper unit tests across 155 files pass, plus 75 focused
integration cases. The subsequent native-refusal/diagnostic edge changes pass 43
owner/readiness cases. All 38 native browser cases pass on the new production
composition: 22 account, all 12 production offline, one populated startup and
three extension offline/restoration/teardown cases. Both offline production builds
and the extension build pass. The new resource subpath is prebundled for cold
development startup. Source/type and scoped formatting qualification follow below.

This closes production adoption, not the remaining independent-replica,
unanswered-authority, partial-replica and later-rejection acceptance work. The
full feature and draft PR remain open. Hosted Foundation and Clipper passed on
`9d474314`; Finance passed its application shards but its workspace shard timed
out in the shared-workspace profile-edit case, which is retained for reproduction.

Final Clipper production-adoption qualification: full coordinator/web/service-
worker/extension type checks pass with zero Svelte errors or warnings; scoped
formatting, lint and diff checks pass. The final held-write/refused-surface and
native diagnostic changes pass the 43 owner/readiness cases. No timeout, retry or
weaker native assertion was introduced.

## Independent native canonical startup

The new `workspace-startup.spec.ts` qualifies the production Clipper initializer
with two independent native browser replicas, not multiple actors over one Db.
A third disposable context provisions the identity without running application
bootstrap, then closes its SDK session. Each empty replica restores that identity
into its own context/store. A barrier holds both actual native root reads at
missing before either initializer may write. Both production initializer actors
then persist the same canonical root locally; both exact global write receipts
settle. Independent remote-tier queries each return exactly one root with the
original identity ID, owner and bootstrap version. The test passes against a real
disposable authority; source/test types and scoped formatting pass.

This proves the concurrent missing-root case for Clipper's canonical adapter.
It does not substitute for partial-replica, unanswered-connection or later
permission-rejection cases, nor claim all native schedules are explored.
