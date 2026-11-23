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
- `apps/finance/src/lib/machines/runtime/workspace-selection-attachment.ts` has
  only its adjacent test as a consumer found in the app. Production
  `worker-application.ts` handles `SELECT_CONTEXT`, scope revisions and resource
  replacement directly. Moving this older machine alone would not converge the
  running apps.

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

### Shared observation lifetime (implementation review pending)

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
Clipper retains its existing thrown-disposal-error behavior. Late source callbacks
after disposal cannot publish into the parent. There is no new selection policy,
session owner, operation supervisor, retry, polling or available-empty fallback.

Source files for this batch are the shared factory/public export and the two
production consumer bindings. The selection integration design and app integration
guide record the boundaries. The identity/access/content-owner split and actual
selection-lease adoption remain subsequent work.

Review this extraction before adding/running behavior tests. Required checks
include synchronous/asynchronous publication, absent subscription, startup/read
failure, late callbacks during/after disposal, exactly-once disposal and disposal
failure propagation, plus actual Finance query and Clipper collection behavior.
Packed export and native browser qualification are required after review;
previous initializer/startup results do not qualify this extraction.

Review-stage checks passed: both shared libraries packaged with strict publint,
DLF library checks, full Finance and Clipper web/extension checks (zero errors and
warnings), both app production builds, workspace peer links, scoped formatting/
lint and whitespace checks. No behavior tests were added or run for this new
extraction pending implementation review. These changes remain uncommitted after
the qualified startup commit.
