# Finance worker migration: foundation-first tasks

## Current handoff — November 18

The maintained isolated candidate targets **alpha.67**; the active app remains alpha.60.
Use the [current resource/implementation record](worker-session-resource-decision.md) and
[maintained candidate runner](../../tests/worker-upgrade/README.md) before older version-specific
entries below. Candidate source cleanup and all concurrent PR46 updates are preserved.

Qualified worker slices now include native SDK/session/storage custody, account creation/archive,
income/expense entry and selected editing, exact balances and bounded filtered ledger pages,
workspace initialization, recovery-key display and **private account restoration and native post-recovery navigation**. Archive,
initialization and forms share one restartable SDK-bound group. Recovery reuses Local First's actors;
raw phrases never enter Finance's inspected state. Actual cross-profile restoration recovers existing
transactions and survives a full offline process restart. Pending offline uploads preserve Jazz's
native account-switch refusal and resume ordinary Finance without retrying.

Latest local qualification: **1,998 Finance units** (62 host), zero-warning static/browser types,
and **45 actual Chromium/Firefox/WebKit application cases**. The preceding fresh artifact also
passes 200 schema/restore and 42 worker/session cases. Shared recovery coordination accepts the typed session connection and an explicit private-root
recipient; **1,250 Local First units** pass. Hosted Finance/Foundation/Clipper pass at
`198a57c5`. Worker routing now reuses the existing workspace-navigation chart, with native default/switch,
denied scope, legacy details and navigation drain qualified. Shared URL filters/pages, non-blocking native
history replacement, input focus and back/forward are also qualified. W12/W16 remain partial: full shell
parity and account selection/order precede
remaining settings/classification/transfers, provider, attachment and workspace/archive UI parity.
W20/W21 and coordinated SDK/backend/Clipper adoption remain open; an isolated slice is not activation.
The intermittent check/account-move failure remains an explicit activation blocker.
Finance has no sign-out or explicit new-identity screen; do not add those as parity work.
Automatic native identity creation is already qualified at startup.

## Historical qualification snapshots

**2026-11-17 release update:** target alpha.66 for the coordinated upgrade.
The [actual-code audit and revised order](worker-jazz-alpha66-research.md)
retain the private session actor and awaited SDK factory, and move the isolated
schema/permission/history foundation ahead of broader caller adoption. All
alpha.65 results below retain their original version scope; active pins remain
alpha.60. Alpha.66's new immediate factory passed 24 native lifecycle cases but
lost a late-resource close failure in a separate source-level reproduction, so
it does not replace Finance's awaited acquisition/close protocol.

The isolated Finance alpha.66 authoring slice now passes strict selected types,
native generation/history and **138 tests**, including retained alpha.60 SQLite
records and another native write/close/reopen. Schema and permission identities
remain unchanged. The [qualified scope](worker-jazz-alpha66-research.md#finance-native-schema-foundation)
keeps Clipper, broad caller/backup/restore adoption and the remaining upgrade
gates open. Active app dependencies and source stay alpha.60.

Clipper's isolated native schema/reading port now passes the same pipeline with
57 cases, unchanged schema/permission identities, actual two-replica offline
convergence and retained alpha.60 SQLite reading data. It uses native resume
sets and existing record codecs instead of repairing nullable SDK transforms.
The [qualified scope](worker-jazz-alpha66-research.md#clipper-native-schema-foundation)
keeps full adoption and the remaining upgrade gates open; Finance's 138 cases
also pass after the fixture reuse.

The next Finance checkpoint extends the schema mode to **176 passing tests**:
the prior 138, all 37 existing backup cases and one real alpha.60 v1 archive
independently opened/validated on alpha.66. The candidate reader drops its
previous-schema override and uses current native generated queries. Historical
archives are generated under their own old SDK/schema, preserving exact amounts,
IDs and attachment bytes without a compatibility layer. See the
[backup evidence](worker-jazz-alpha66-research.md#finance-backup-caller-and-retained-archive).
The full restore workflow/browser harness remains next; staging/publication and
identity/write-drain qualification are still required before adoption.

The shared-Db restore slice now passes **12 native browser cases**, four each in
Chromium/Firefox/WebKit; the combined Finance alpha.66 proof passes **188 tests**.
It retains the existing charts and ports only public user metadata/row types.
Real old-file restore, exact attachment/source bytes, journal reuse after page
reload without repeated writes, cancellation, same-account replacement and
A → B → A pass with development freezing enabled. See the
[restore evidence](worker-jazz-alpha66-research.md#finance-shared-db-restore-browser-slice).
The next restore gate is interruption after authority acceptance, pending-write
drain/resume without replay, conflict/cleanup recovery and broader policy/role
checks. Memory-driver browser success does not qualify persistent-worker storage.

Accepted-commit interruption/drain now passes six more real-browser cases:
cancellation and native replacement in Chromium/Firefox/WebKit, with responses
held after authority acceptance. The same journal resumes without replaying the
financial write; release waits for settlement. The combined proof passes **194
tests**, including 18 browser restore cases. The original alpha.60 pair also
passes using the same extracted test probe. See the
[drain evidence](worker-jazz-alpha66-research.md#accepted-commit-interruption-and-drain).
Conflict/blocked-cleanup recovery and broader policy/role coverage remain open,
along with the worker/session and coordinated adoption gates.

The next bounded recovery checks also pass across all three browsers: a real
changed destination refuses resume without writes or journal-evidence replacement,
and failed artifact cleanup retains custody until retry releases once without
repeating Jazz commits. The combined proof passes **200 tests**, including 24
browser restore cases; the application charts remain unchanged. See the
[conflict/cleanup evidence](worker-jazz-alpha66-research.md#destination-conflict-and-artifact-cleanup-retry).
Broader policy/role and rollback/restart/conflict/cleanup variants remain open.
Return to the alpha.66 worker/session foundation before broader caller adoption;
memory-driver restore success does not qualify persistent worker ownership.

The alpha.66 worker/session foundation now passes **30 native cases** after the
200 schema/restore checks, with strict private-adapter/fixture types and native
Svelte checks. The same SDK bridge, actor and recovery adapters need no behavior
changes. Full-process offline Finance save/edit retention, actor lifetime with
development freezing, and SDK/AccountStore/broker close pass in all three browsers.
An unpatched control retains identity but loses its edited row after cold restart;
keep the existing bridge, with no new patch behavior. See the
[worker qualification and cleanup findings](worker-jazz-alpha66-research.md#alpha66-persistent-worker-and-private-session-adapter).
The old Clipper caller overlay remains incomplete; actual shared-owner adoption,
backend/auth, retained Finance destinations and full-patch parity remain open.

Current direction, 2026-11-16: implement the approved
[simpler native-worker design](worker-simple-design.md). Do not extend the F4
grant/call population or add its inbox. Keep W01–W21's product/parity requirements,
but start with one existing broker connection and a real SDK vertical slice.
The retained real-SDK/IndexedDB fixture passes all 12 native cases after C1 removes
the obsolete grant/call scenarios; saves and two cold browser reopens remain
covered in Chromium/Firefox/WebKit. The WebKit failure was duplicate
worker-entry evaluation; Finance and Clipper now use the same Local First
single-bundle ES-module build settings. See the
[cause and qualification](worker-webkit-startup-research.md). The latest proposed
sequence is the bounded unused-prototype cleanup below, a coordinated SDK upgrade
using the [alpha.61–65 research](worker-jazz-release-research.md), then the planned
worker-owned UI read slice. Keep live behavior until its replacement is qualified.
The shared-helper extension-origin regression is corrected and all 12 extension
browser cases pass locally. All hosted Finance, Clipper and foundation checks
pass at the final C2 head `d8c0820e`. PR #39 is merged at `fb380114`.
The next branch starts at that exact tree and follows the
[coordinated SDK compatibility plan](worker-jazz-upgrade-plan.md) before C3–C5.
Fresh preview cores are approved for Clipper only. Finance must preserve access
to existing preview and production data; its destination inventory and retention
gate are recorded in that plan.
U1's isolated alpha.65 worker bridge now passes strict types and 15 native
Finance SDK/IDB cases across Chromium/Firefox/WebKit. Workspace pins and the
active patch remain alpha.60; full shared-session/backend qualification is next.
U2a's shared native recovery/restoration/readiness candidate now passes strict
types and all 18 native cases. [Its qualification](worker-jazz-upgrade-plan.md#u2a-shared-native-session-adapter-qualification)
records the scope guarantees and remaining Finance/Clipper caller adoption; U2
remains open until those consumers are adapted and qualified together.
U2b's source review found Finance's independent workspace-restore database also
depends on the removed opaque account handle. Its
[ownership proposal and qualification gates](worker-restore-session-decision.md)
now record the user's approval and the shared application Db implementation.
On alpha.60, strict types, 1,928 unit tests and all 107 restore qualification
tests pass, including actual native identity replacement with a pending write
and journal resume without replay. The alpha.65 consumer port remains open;
this does not complete U2 or qualify an SDK/backend data upgrade.
U2b's isolated native Svelte/recovery slice now passes strict types, zero Svelte
warnings and all 21 native cases, including the actual Finance recovery UI under
`JazzProvider` in all three engines. [The qualification](worker-jazz-upgrade-plan.md#u2b-native-svelte-session-boundary)
records its per-provider scope and remaining layout/Clipper host/startup work.
Clipper's inactive native startup caller now passes types and 46 startup tests
and removes 86 net production lines. Expanded worker-host coverage exposed
XState development traversal of the new SDK session's throwing `db` getter;
an actual SDK/browser diagnostic confirms it. The
[resource-custody decision](worker-session-resource-decision.md) now records the
approved actor boundary and its first implemented acquisition/observation/close
slice. It passes 234 affected tests and 30 native browser cases, including nine
actual SDK/development-XState cases. Identity/recovery commands and actual caller
adoption remain next; the raw-session Clipper overlay still fails 15/67 cases.
Keep application domain drains, and do not add an SDK patch or hide that failure
in a fixture. U2 remains open, and active alpha.60 behavior is unchanged.
The approved shared app-binding extension is now implemented: the private Jazz
adapter supplies the ready Db/identity to an inert app construction function,
and the generic session actor publishes only its returned capability record.
Clipper's active account adapter and candidate constructor reuse one extracted
root/library/capture builder. Shared types/tests, active Clipper tests/full types,
alpha.67 candidate constructor/native tests and focused three-engine Worker
checks pass. [Exact boundary and next batch](worker-session-resource-decision.md#app-binding-function-approved-and-implemented).
The shared create/restore/sign-out path and reused recovery capability now also
pass 132 shared tests and 21 focused native cases, including an actual Worker
create → recover/hide → sign-out → same-identity restore and close during a held
restore receipt. [Current command contract and exact evidence](worker-session-resource-decision.md#create-restore-and-recovery-implemented-host-wiring-pending).
Clipper's actual candidate worker host now uses the shared actor connection,
identity-change source and close invocation. Strict candidate types, all 69
Clipper candidate tests, 72 active-SDK Clipper tests, 272 shared identity/backend
tests and 21 focused three-engine native cases pass. This clears the prior 15
raw-SDK getter failures without weakening development freezing or adding an SDK
facade. [Current ownership and exact evidence](worker-session-resource-decision.md#clipper-host-adoption-qualified-in-the-candidate).
Next port Finance's actual worker/UI callers to that same boundary, retaining
its independent workspace/restore Db and application domain drains. U2 remains
open; pins stay alpha.60 and the coordinated U3–U5 gates still apply.

Finance's application/restore charts now take identity, mutation observation and
borrowed-Db restore bindings through one native session module. Its restore
controller consumes domain capabilities instead of a native session. The
alpha.67 port changes that module, preserving the chart; all 24 candidate native
restore cases and nine directly affected alpha.60 native cases pass.
[Exact binding boundary and remaining worker adoption](worker-session-resource-decision.md#finance-session-binding-isolated-from-the-restore-chart).
The first actual Finance Worker/Svelte read slice is now qualified on the
alpha.67 candidate: workspace selection and accounts render through bounded
views, with 13 host tests and nine three-engine native cases covering stale
bindings, failed disposal, UI detachment, malformed replies and offline process
restarts with retained edits. [Implementation and next write boundary](worker-session-resource-decision.md#first-finance-worker-and-svelte-read-slice).
C3–C5 are implemented for that isolated slice; production activation/full caller
parity and U2/U5 remain open. The existing UI still owns its alpha.60 session.

Prior results below retain their historical scope; no replacement runtime cutover
has been qualified.

## Seven-item simplification checklist

This is the complete cleanup list proposed to the user on 2026-11-16. C1/C2 are
implemented; C3–C7 retain their remaining scope. Recording or completing cleanup
does not authorize a dependency upgrade or production cutover. This checklist is the
current cleanup handoff alongside the selected simpler design. W01–W21 below
retain their product/parity requirements, not the abandoned implementation plan.

- [x] **C1 — Delete the abandoned grant/call architecture.** Audit non-test
      imports, then remove confirmed-unused `worker-grant-owner` and
      `worker-sdk-call-owner` machines/contracts, `sdk-call-binding`, grant
      binding/protocol/adapters, and their bespoke fixtures. Remove obsolete
      population/inbox tasks rather than implementing them. Keep the shared
      broker/channel/close APIs and port-custody behavior used by both apps.
      The [C1 audit and qualification](#c1-unused-grantcall-removal) records the
      removed dependency group and retained persistence coverage.
- [x] **C2 — Remove the old Window account-storage bridge.** Audit the unused
      `host-client`, `window-host`, `host-drain`, account-store facade/storage
      adapters, selection namespace and legacy account-store machines as one
      dependency group. Retire their Window/localStorage selection and migration
      machinery. Use the shared worker-accessible IndexedDB AccountStore and
      preserve the user's no-migration/no-fallback/no-dual-write decision. Do not
      confuse the obsolete selection bridge with the still-required Window
      broker hooks or delete the active application's SDK storage by implication.
      The [C2 audit and qualification](#c2-unused-window-account-storage-removal)
      records the removed dependency group, tooling and retained tests.
- [ ] **C3 — Replace the import catalog with the real application worker.**
      **Candidate read slice implemented; production activation pending.**
      The active alpha.60 `application.worker.ts` reports factory types rather
      than running Finance. During cleanup, remove build-proof requirements that keep abandoned
      components present. During the read slice, replace the catalog with the
      actual worker entry. Keep meaningful emitted-graph checks for UI isolation,
      SDK/Wasm assets, self-contained worker output and public package boundaries.
- [ ] **C4 — Give the session lifecycle one owner.** The candidate read host uses
      the shared owner; remaining Finance workflows/drains and production callers
      still need adoption. Reuse Local First startup/
      acquisition and the native Jazz session, with one Finance application
      worker/session owner. Use the newer SDK's immediate local-first startup
      and public session operations after a coordinated upgrade is qualified;
      remove the redundant SDK-upgrade/opaque-handle plumbing identified in the
      release research. Window forwards commands/views and narrow browser effects;
      it must not maintain a matching application/domain lifecycle. Preserve real
      domain drains, identity binding, startup interruption and shutdown outcomes.
- [ ] **C5 — Move one read-only Finance view before adding infrastructure.**
      **Candidate accounts view implemented and qualified; live route replacement
      pending.** The view is an accounts list scoped to the selected organization. Send only the bounded
      fields Svelte renders through a small validated command/view union. Keep
      ordinary Svelte subscription/rendering; do not send complete XState
      snapshots or build a generic remote Jazz/actor API. Qualify identity/scope
      replacement, late views, unsubscribe and offline restart.
- [ ] **C6 — Move one existing financial workflow intact.** The candidate now
      uses the existing archive workflow through the actual UI, including scoped
      permissions, feedback and issued-write drain; 18 host cases and 12 native
      cases pass with all 1,946 Finance units. Production activation and the
      remaining forms/app integration stay open.
      **Account creation also implemented:** its original scoped form/policy and
      actual AccountForm UI run against the Worker. Shared message descriptors
      replace callback-bearing views; native Zod strips private checkpoints from
      wire results. One SDK-bound forms owner drains before replacement, and
      session plus workspace revisions reject stale commands. All 1,954 units
      (25 host), 54 shared form cases, public consumers and 15 three-engine native
      cases pass. See the [form transport and resource model](worker-session-resource-decision.md#worker-owned-account-creation-and-form-transport).
      **Manual entry also implemented in the candidate:** existing transaction
      policy/staged persistence and real TransactionForm now save income/expense
      without attachments. One query owner replaces duplicated observer/forwarding
      blocks. Both fixed forms drain before SDK replacement/close. All 1,961 units
      (32 host) and 18 native cases pass, including retained UI-created expenses
      through two offline process restarts; the fresh 200-schema/42-session proof
      also passes. [Current transaction/query ownership](worker-session-resource-decision.md#worker-owned-manual-transaction-entry-without-attachments).
      **Balances and ledger also implemented in the candidate:** reuse existing
      filters, exact bigint grouping and shared list rendering. Native Worker
      queries project at most 25 rows; Window sends scoped page/filter intents.
      All 1,965 Finance units (33 host), 21 three-engine native cases and the
      fresh 200-schema/42-session proof pass. Two existing full-app pagination
      cases preserve legacy behavior. [Ledger ownership and qualification](worker-session-resource-decision.md#worker-owned-balances-and-bounded-ledger-projection).
      **Selected editing implemented in the candidate:** existing edit policy,
      draft comparison and staged save run under a third fixed drained form.
      Native detail reads include check/tag and attachment metadata without bytes.
      All 1,966 units (34 host) and 27 native cases pass, including cold retained
      edits. The check/account-move failure reproduced once and remains an open
      activation blocker; later passing runs do not resolve it. [Editing evidence](worker-session-resource-decision.md#worker-owned-selected-transaction-editing).
      **Workspace initialization implemented in the candidate:** reuse the finite
      initialization chart independently of local finance usability, and drain
      its issued writes with the three forms. Broker host UUID and native Jazz
      app scope are now separate. All 1,968 units (36 host), 30 native cases and
      a fresh 200-schema/42-session proof pass. Actual authority cases create the
      first workspace without fixture writes and retain it/account after an offline
      process restart. [Startup evidence](worker-session-resource-decision.md#worker-owned-native-workspace-initialization).
      **Recovery display implemented in the candidate:** reuse Local First's
      existing private UI actor/dialog and translations; actual key export and
      scope rechecks run in the Worker, returning only on a private reply port.
      All 1,969 units (37 host) and 33 native cases pass, including no automatic
      export and clearing on hide/detach/close. The native application matrix
      also passes through the readable-source candidate assembler. [Recovery boundary](worker-session-resource-decision.md#existing-recovery-dialog-with-worker-owned-key-export).
      Continue to
      reuse the existing account archive chart/operation and its issued-write
      drain first; supply membership/grant facts. Native create/archive leaves
      are now shared in `data/accounts.ts` without Svelte imports, preserving
      existing frontend exports and local settlement. Then move other forms/workflows into the worker, reusing
      their validation, transaction, permissions and outcome handling. Keep DOM,
      focus and UI interaction behavior with Svelte. Retain operation identity,
      interruption and uncertain-write behavior; do not add a second command-owner
      framework or replay unknown mutations.
- [ ] **C7 — Consolidate tests and spec around the selected design.** Apply this
      in every slice. Keep real SDK persistence/full-process restart coverage and
      domain tests. Replace tests tied to removed grant mechanics with meaningful
      single-session boundary cases: account switching, stale views, startup
      interruption, native failures and close with pending writes. Retire stale
      active plan/build assertions; keep source history and qualification records
      traceable in Git. Do not weaken durability or call the known CI/extension
      failures fixed without evidence.

Recommended execution order: first audit and delete only confirmed-unused
prototype code in C1/C2, trimming obsolete catalog constraints in C3 and keeping
coverage aligned through C7. Keep the live Finance lifecycle and financial
machines unchanged in that deletion-only slice. Next review and qualify the
coordinated SDK upgrade, including its patch, backend/schema, auth and Vercel
namespace boundaries. Then complete C3/C4/C5 as one real read slice, followed by
C6. Qualification is required before replacing live behavior; the first cleanup
must not turn into a runtime cutover or a new account-data migration.

### Continuous simplification during implementation

The user reiterated on 2026-11-17 that identifying cleanup is part of every SDK
upgrade and worker slice. Apply this during U1–U5 and C3–C7, using the shared
[native-library and integration guidance](../../../../docs/engineering/dependencies.md#prefer-native-library-behavior-and-small-integration-surfaces).
Keep the seven tasks above; this is how we execute them, rather than a separate
cleanup phase after migration.

For the code touched by each slice:

- Check the actual installed library APIs and existing app/shared code for a
  simpler supported solution. Look for wrappers, duplicated lifecycle state,
  manual schema/type copies and SDK workarounds that native behavior replaces.
- Concentrate SDK lifecycle/platform differences in thin adapters. Share behavior
  through Local First when both Finance and Clipper actually need it; keep native
  domain schemas, permissions and queries in their owning app. Avoid a universal
  SDK facade or abstractions built for hypothetical future callers.
- Remove superseded code and implementation-specific fixtures when the replacement
  is adopted and qualified. Preserve financial identity, settlement, evidence and
  resource-drain behavior; fewer files alone does not establish a simplification.
- Add a short note to the existing handoff describing what was reused or removed
  and what remains. For deferred cleanup or an SDK limitation, record the concrete
  code/API, evidence and adoption prerequisite. Discuss an uncertain architectural
  choice with the user before implementing it. A missing SDK feature does not
  automatically justify another workaround.

The isolated alpha.66 candidate already demonstrates this approach: it removes
Finance's text-column wrapper, Clipper's reading-column wrapper and Finance's
per-read previous-schema override, while reusing native transforms/sets, existing
record codecs and the existing restore charts. The restore probe is shared by the
old and candidate test harnesses. Keep candidate-only removals distinct from
active-source adoption, and retain genuinely historical evidence separately.

The [offline-edit investigation](worker-pr39-ci-offline-edit.md#hosted-recurrence-native-protocol-error)
now contains a real hosted native `protocol` error followed by an already-committed
rollback refusal. Keep the original error and unknown-write protection; review
uncommitted rollback versus committed settlement during C6 rather than adding
retry infrastructure. The separate workspace-settings failure still lacks its
nested cause. Neither failure is established as fixed by the alpha.66 candidate.

## C1: unused grant/call removal

The repository-wide source/configuration reference audit found no active Finance
layout, session or domain-machine caller of the grant/call layer. Its only
non-test entry was the inactive factory catalog; the build-only driver exposed
its Window adapters. Those proof requirements kept the prototype reachable in
test builds, not in the production application.

Removed the Finance grant/call owners and contracts, descriptor/protocol/callback
bindings, exact-grant Window adapters, bespoke native fixture parents/clients,
two generated grant/call model suites and their omission assertions. The proof
driver now re-exports Local First's existing `serveBrowserWorkerHost` directly.
Its graph still checks SDK/shared implementations, UI isolation, bundled
dependencies, the real Window adapter, the application entry and Wasm output.
No replacement owner, protocol, patch or runtime activation was introduced.

All six actual-SDK cases and all six IndexedDB isolation/serialization/restart
cases remain and pass across Chromium, Firefox and WebKit. The count is now 12
instead of 30 because 18 tests exercised the removed prototype; no SDK/IDB
durability scenario was removed. Focused host tests pass (49), remaining
account-store model tests pass (17), and real-build tests pass (11). Worker-proof,
browser-fixture and model-package types pass. Full Finance verification passes:
1,964 unit tests, Svelte/service-worker types, the worker-proof build and the
production application build. The first full-unit attempt was blocked by sandbox
listener restrictions; the authorized disposable-listener run passes. Workspace
links and guidance pass. Historical counts below keep their original revision
and scope; fresh hosted CI is still required for the cleanup head.

At the C1 checkpoint, the old Window account-storage bridge and its model package
remained; C2 below removes them. C3 is only partially addressed: obsolete catalog requirements
are gone, but the entry is still build-only. C7 is ongoing. Keep shared broker,
channel, callback-custody and close APIs; changing their public surface is not
part of this Finance-only deletion. The active Window application, financial
operation identity/drains and workspace dependencies are unchanged.

## C2: unused Window account-storage removal

The repository-wide source/configuration audit found all bridge imports and
exported-symbol callers confined to its own implementation/tests. Neither the
active layout/session nor the retained worker entry and SDK/browser fixtures
depend on it. Removed `host-client`, `window-host`, `host-drain`, `host-protocol`,
the account-store facade/storage/selection/namespace helpers and all seven legacy
account-store machine/contract files. This also removes the unused earlier-key
selection, root scrubbing, migration, Web Lock and Window storage transport path.

The dedicated `tooling/worker-state-tests` package exercised only that retired
graph after C1. Its tests, workspace/lock importer, package/root command aliases
and CI invocation/counterexample artifact steps are removed together. The retired
host test configuration is removed too. The worker-proof TypeScript configuration
keeps the same strict compiler options directly. Existing deployment path tests
still recognize historical test paths, including deletions; they are not callers
of the removed code.

`runtime/worker/account-store.ts` and its normal unit coverage remain unchanged,
using the public Local First IndexedDB AccountStore. All 12 real SDK/IDB native
scenarios remain, including isolation, serialization, close and full browser
restarts. Shared IDB state/model/native tests remain in Local First. The active
Finance app still uses its current Jazz storage; its authentication/readiness/
debugging tests of SDK-default localStorage keys remain. No migration, fallback,
dual write, reset or production storage switch is added.

The lock update removes the retired importer and its unused test peer contexts.
Existing Local First injected peer bindings are preserved; no dependency version
or SDK/auth patch changes. Frozen offline installation, workspace peer links and
guidance pass. The existing tooling suite passes all 19 tests. All 1,928 remaining
Finance unit tests and all 12 native SDK/IDB cases pass across Chromium, Firefox
and WebKit. Application/Svelte/service-worker, worker-proof and browser-fixture
types pass, along with E2E scope checks and both production builds. The 36 removed
unit cases and 17 dedicated test-workspace cases exercised the retired bridge;
SDK/IDB and financial domain coverage remain. Hosted CI passed at `d8c0820e`:
every Finance, Clipper and foundation workflow is green. The user merged PR #39
at `fb380114`; this deletion-only checkpoint is complete.

This completes the deletion-only checkpoint. C3's actual application worker,
C4's lifecycle integration and C5's read view remain unimplemented. Review and
qualify the coordinated Jazz upgrade before adding new worker integration glue;
do not activate the replacement application or change deployment namespaces as
part of this cleanup.

## Historical foundation backlog and product parity requirements

Status: recorded migration backlog after code research on `main` at `eb0f615f`
(2026-11-13), incorporated by [spec.md](spec.md#application-worker-migration-handoff).
W01 inventory/baseline and W02's inactive build proof are complete against
`670fb720`. W02's approved qualification passed type/build checks, 35 focused
unit tests and 19 production browser cases. The user selected a worker-accessible
IndexedDB AccountStore in Local First on 2026-11-13. W03's storage choice is
resolved; the user explicitly excluded all migration/old-version compatibility
code. W03 and W04's shared-store foundation are complete. W04 qualification
passed 1,111 unit tests and 60 native cases across Chromium/Firefox/WebKit.
W01–W04 are merged in [PR #29](https://github.com/delightful-labs/delightful-labs/pull/29)
at main `1b6287d6`. The W05 branch is fast-forwarded to that merge with its local
implementation preserved; the merge tree is identical to the qualified PR head.
It was subsequently refreshed to main `ea460e9d` (Clipper layout/UI changes),
with a frozen install and peer-link check. Earlier qualification counts retain
their `1b6287d6` baseline. Clipper qualification has also passed against the
refresh: 869 unit tests, 17 component cases, 32 worker cases, 12 packaged
extension cases and eight production offline cases. See the transport evidence
for commands and separate baselines.
Hosted foundation, Clipper and Finance qualification all passed on that PR.
Finance's first application-2 run failed the existing image-editor filename
assertion (`undefined` instead of `receipt.png`). The original three image-editor
cases passed locally unchanged, and one retry of the failed CI job passed.
This records a transient failure; it does not establish its cause or a code fix.
W05's R1/R2 extractions and Finance F1/F2 binding slices passed approved
qualification. Actual SDK/native-capability integration and app storage adoption
remain pending. The [SDK binding decision](worker-sdk-binding-decision.md) selects
separate exact grants through existing callbacks, with no new Jazz patch.
W06–W21 implementation remains unstarted.
The user merged the qualified R1/R2 and F1–F3 checkpoint plus the native-close
review correction in [PR #35](https://github.com/delightful-labs/delightful-labs/pull/35)
at main `434a06ee` on 2026-11-14. The follow-up branch
`feat/finance-worker-grant-owner` is fast-forwarded to that merge, preserving
the runtime-client direction, Clipper lifecycle changes and PR #34's Markdown-only
CI/build selection. Historical results above retain their actual baselines;
the [grant-owner record](worker-grant-owner-design.md) links the close correction's
1,170-library-test and refreshed native/app evidence. F4a's private binding/
acquisition contract now passes approved qualification: 2,047 Finance unit tests,
129 focused host cases, 14 real-build proof cases and 15 native cases across
three engines, including actual transferred data/control paths. It starts no
production grant acquisition or worker SDK; the owning charts remain next.
The user requested an ongoing tracking PR: [draft PR #37](https://github.com/delightful-labs/delightful-labs/pull/37)
contains that tested checkpoint at `95eebd7d`. F4b's single-grant chart now passes
approved qualification on the same branch: 2,082 unit tests, 163 focused host
cases, 18 generated-worker-state cases and 21 native cases across three engines.
The grant-owner record preserves the `can()` defect found/fixed during testing,
harness/omission-fixture corrections and the two separate hosted UI failures.
The original transaction-edit case passed the inspected focused run and hosted
rerun, which instead failed the existing image-editor filename case; no further
retry or established cause is claimed. F4a counts retain their original scope.
PR #37 subsequently merges main `fca60ca0` on 2026-11-14, preserving its newer
Clipper reader and workspace-planning changes alongside all worker progress.
The [grant-owner handoff](worker-grant-owner-design.md) records the task-list
formatting conflict and scoped merge checks; historical counts keep their
original baseline.
Detailed implementation designs remain subject to their review gates.
The user merged PR #37 at main `4301afde` on 2026-11-14. Continue on
`feat/finance-worker-grant-population` from that merge. Its first bounded slice,
[F4c2](worker-grant-population-design.md#f4c2-sdk-call-and-interruption-contracts),
qualifies truthful SDK callback interruption and canonical request-byte contracts
after the user's separate implementation/test approval on 2026-11-14. Its linked
record owns exact checks and results. The population/inbox and actual SDK
integration are still pending, and W05 remains incomplete.
The qualified checkpoint is uploaded at `dce092be` in
[draft PR #39](https://github.com/delightful-labs/delightful-labs/pull/39);
continue the bounded population/bridge on that PR.
The [F4c3 callback owner](worker-sdk-call-owner-design.md) passes separately
approved qualification: 43 direct cases, 400 generated sequences, 2,148 Finance
units and 24 native cases across three engines. It separates SDK delivery from
native settlement/reservation release. The bounded native intake and population
are still unimplemented; W05 remains incomplete.
PR #39's hosted application-2 failure at `c0606557` remains under
[offline-edit investigation](worker-pr39-ci-offline-edit.md). The original cases
and full shard passed locally; test-only diagnostics preserve the nested error
details missing from CI's original trace. This is not an established application
fix or a completed hosted merge qualification.
This is a planning artifact, not an activation or production release. Read the
[research and source evidence](worker-migration-research.md), existing
[ownership specification](xstate-v6-migration.md), and
[PR #67 dispositions](../../../../specs/002-monorepo-agent-guidance/finance-worker-pr67-review.md).
Existing implementation-review gates apply when implementation begins.

The [Local First/Clipper reuse review](worker-foundation-reuse.md) owns the
extraction details: reuse the library's existing workflows directly; move native
close, broker, applicable receipt custody and disposable-worker mechanisms
from Clipper into Local First before Finance adopts them. Add the missing
IndexedDB AccountStore there; retire the permanent Window account-storage bridge. Update Clipper to the
same shared implementation, preserving app-specific policy and namespaces.

## Instructions for the next agent

1. Read workspace/Finance and affected Local First/Clipper guidance, then the
   spec handoff, source research and reuse specification. Work in the maintained
   monorepo, not the former source repositories.
2. Verify current remote default-branch `main` and record the actual baseline.
   This research started at `eb0f615f` in the separate
   `research/finance-worker-foundations` worktree; refresh code findings if the
   baseline changes. Preserve unrelated work and user servers/storage.
3. Start with the first incomplete task whose dependencies are met. Read the
   [W01 inventory](worker-ownership-inventory.md) and [baseline](worker-baseline.md)
   before W02/W03 design. R1–R4 are extraction work within the
   W-series, not another copy of the backlog or already available library APIs.
4. Model and review the selected ownership/state/API change, implement a bounded
   slice, then perform checks under the applicable review authorization. Existing
   approvals recorded for old startup/import sessions are not blanket approvals
   for this work. Keep deployment/commit/merge gates explicit.
5. Mark tasks complete only with actual acceptance evidence: source revision,
   affected package/app, commands/results, browser/native scenarios and limitations.
   Update this checklist and the implementation checkpoint together. Shared
   extractions must identify both Clipper adoption and Finance adoption; landing
   an unused library copy is not completion.

The main spec links here; this file is the single completion checklist for
W01–W21. Source research and R1–R4 explain the work without duplicating task state.

Every task needs its own reviewed ownership/state design, focused implementation
and appropriate checks. Large feature rows below must be split into bounded
review cycles. Tests accompany each slice after the applicable implementation
approval; integration and lifecycle qualification are not deferred to the end.
No XState reconversion, library reimport or new Jazz patch is assumed necessary.

## A. Establish the baseline and prove the resource boundary

- [x] **W01 — Inventory ownership and parity.** Record current SDK/root/subscription
      owners, intended owners, native capabilities and every reachable feature/route.
      Include shared shell data, profile, account ordering, banks, transfers,
      attachments, backup/restore, identity recovery and developer tools. Establish
      reproducible production-build, browser and performance baselines; reconcile
      intended main-branch CI selection. Complete when the inventory names an owner,
      scope, lifetime and acceptance flow for every domain responsibility.
      Completed 2026-11-13 at `670fb720`: the
      [inventory](worker-ownership-inventory.md) covers all 18 page files, parent
      layouts, shared domain/native owners and server endpoints; the
      [baseline](worker-baseline.md) records frozen install/link/type/build checks,
      1,940 passing unit tests, 16 passing production PWA cases and the existing
      521-transaction export/restore/performance case. The
      [result summary](worker-baseline-results.json) retains exact commands/timings,
      the rejected initial PWA setup and dev diagnostic limitations. CI PR #23 is
      merged and the authorized Vercel production-branch corrections are verified.
      W01 changed no runtime/test implementation; W02 evidence follows below.
- [x] **W02 — Prove a worker-safe production import graph.** Depends on W01.
      Add an inactive minimal application-worker entry and identify non-Svelte SDK
      and Local First exports. Build the actual worker with the production toolchain;
      verify no provider/Svelte UI imports enter it and trace emitted JS/Wasm assets.
      This probe does not activate the AccountStore or open a second SDK session.
      The user approved the build-only approach. The
      [W02 implementation/design record](worker-bundle-design.md) describes the
      inactive entry, shared production configuration, strict type/build commands,
      resolved/rendered graph and emitted JS/Wasm evidence. The proof and normal
      application build/check pass; the probe is absent from normal client output.
      Completed 2026-11-13 after explicit implementation/test approval: 35 focused
      unit tests (eight new real-build guard scenarios), all 19 production browser
      cases (16 existing PWA/offline plus three actual emitted provider-module
      scenarios), application/service-worker/proof/test types and production build
      pass. The design record retains exact commands, outputs and limits; no new
      session, persistent storage owner or production probe activation is included.
- [x] **W03 — Design IndexedDB account storage and reconcile salvage.**
      Depends on W01. The user selected IndexedDB and then explicitly excluded all
      migration/old-version compatibility code on 2026-11-13. The
      [revised design](worker-native-custody-design.md) owns transaction/admission/
      receipt/close behavior and keep/adapt/leave decisions across Finance, Clipper,
      Local First and PR #67. Build no import, legacy fallback, dual writes, source
      cleanup, migration markers or old-tab/reload coordination. Existing legacy
      values are ignored, not actively deleted. This scoped instruction supersedes
      earlier requirements to preserve localStorage identities or mixed-version
      account-store compatibility. Ordinary atomicity/failure/close guarantees remain.
- [x] **W04 — Implement the shared transactional IndexedDB AccountStore.**
      Depends on W03's reviewed ownership contract. Put the adapter/native resource
      owner and supported SDK integration in Local First. Perform read, synchronous
      SDK transform and replacement within one active read/write transaction; only
      transaction completion acknowledges an update. Request strict durability,
      bound active/queued work and retain actual completion/abort receipts through
      cancellation, owner failure, version changes and close. Reuse compatible
      existing native IDB/custody contracts; do not copy a workspace journal or
      remote-lock framework. Qualify concurrent real workers/tabs, request success
      followed by abort, worker termination, interrupted close and cold reopen.
      Validate packed public consumers and the SDK AccountStore interface. Actual
      Finance/Clipper adoption is W05; W04 cannot depend on its dependent W05.
      Completed 2026-11-13 after concrete implementation/test approval: full library/
      test types, 53 unit files / 1,111 tests, 60 native cases (20 per engine), packed
      public-consumer types/build, packaging/strict publint and changed-source lint/
      formatting pass. The [verification record](worker-account-store-verification.md)
      retains commands, failed setup/oracle attempts, limits and the real stored-
      undefined bug found/fixed by a cursor read. The new reproducible native command
      runs in library verify and CI. No app startup hookup or migration code was added.
- [ ] **W05 — Integrate the AccountStore and broker lifecycle.** Depends on
      W02 and W04. Bind the shared IDB store into Finance using stable app/profile
      configuration and the existing single SDK/session owner. On 2026-11-13 the
      user approved Finance-first sequencing: Clipper's remaining store/runtime
      conversion is a separate follow-up, not a prerequisite of W05/W06. No
      localStorage selection import, fallback, dual write, legacy cleanup, migration
      marker or old-version compatibility work is in scope. A missing IDB record
      follows ordinary SDK first-use behavior; native failures remain failures.
      Extract Clipper's native close control (R1) and SDK broker/generation adapter
      (remaining R2) into Local First, qualify Clipper then Finance adoption, and
      preserve exact capability admission. Generation storage is a separate SDK
      mechanism; do not silently migrate it with account selection. Remove replaced
      permanent account storage/lock channels after qualification. Preserve unknown
      outcomes, actual native drain and SDK transform semantics without replay.
      First slice: R1's native close transport now has a public Local First
      `worker/host-close` export; Clipper's former implementation re-exports it.
      See the [ownership and review boundary](../../../../packages/local-first/docs/worker-host-close.md).
      R1's approved qualification passed 1,120 library tests, 88 Clipper runtime
      tests, 32 real worker/browser cases and packed-consumer types/native/build
      checks. R2 moves the broker transport to `backend/jazz/worker-broker`, with
      mandatory app-supplied capability admission and a small Clipper policy adapter.
      See its [contract and review boundary](../../../../packages/local-first/docs/jazz-worker-broker.md).
      R2's approved qualification passed 1,144 library tests, 869 Clipper unit/native
      tests plus 14 component cases, all 32 actual worker cases and all 12 packaged
      extension cases, packed public-consumer types/native/module-worker builds and
      production app builds. All eight production offline cases also pass, including
      full stopped-server browser restarts with retained local edits and reconnect.
      Neither extraction changes app account storage.
      Continue Finance's exact broker binding and worker-owned store configuration
      next. The first bounded Finance slice is recorded in
      [worker-finance-binding.md](worker-finance-binding.md). It remains inactive in
      normal application startup; W06 owns actual SDK/session qualification. The
      concrete store factory, exact broker adapter and extended import proof pass
      app/worker types and builds. After the user's test approval, all 1,984 Finance
      unit tests, 69 focused host cases and nine native cases across three engines
      pass, along with all 19 production PWA/provider-worker cases. The native
      command and failure-artifact retention are wired into the existing PWA CI job.
      The [SDK binding decision](worker-sdk-binding-decision.md) selects separate
      grants through the existing callbacks with no new Jazz patch. After the user's
      2026-11-14 approval, F2 passes 2,006 unit tests, 90 focused host cases, all
      12 real-build proof cases and nine native cases across three engines. The
      combined adapter is removed after separate-grant qualification; the fixtures
      and proof consume the replacement. Callback routing and owned SDK/session
      integration remain pending. No private SDK algorithm was copied or admission
      widened to bypass it.
      F3 now exposes the existing broker channel for child invocation so a grant
      owner can supervise it without starting roots inside acquisition I/O. This
      shared API refactor is qualified after 2026-11-14 approval: 1,160 library
      tests, three packed public consumers, 2,006 Finance tests and 12 native cases,
      plus all Clipper unit/component/worker/extension/offline regressions. The
      [grant-owner design](worker-grant-owner-design.md) records concrete APIs,
      commands/results, two initial browser failures and successful reruns, aggregate
      bounds, duplicate/late acquisition and SDK-before-grant shutdown. The actual
      bounded grant population, private acquisition transport and SDK/session
      integration remain pending; W05 is not complete.
      PR #35 is merged with the reviewed native-close correction. On its follow-up
      branch, F4a extracts the canonical exact grant binding and defines the private
      acquisition identity/reply/transfer contract before the owning charts use it.
      The user approved its concrete implementation/tests on 2026-11-14; all 2,047
      Finance unit tests (39 new contract cases and two new proof cases), 129 focused
      host cases and 15 native browser cases pass. The next slices are one grant's
      lifecycle, the aggregate population/callback bridge, the actual native
      acquisition transport, then retained SDK/session composition. Aggregate limits
      are declared, not yet enforced. See the same grant-owner record for the
      concrete frame semantics and qualification boundary.
      F4b now implements one retained grant's acquisition/channel chart on
      PR #37's branch. It posts once, retains late acquisition across retirement/
      uncertainty/deadline, invokes the shared channel, reports explicit custody/
      availability/rejected replies and requires actual close/non-allocation output.
      After 2026-11-14 concrete implementation/test approval, all 2,082 Finance unit
      tests, 163 focused host cases, 18 worker-state tests (including 400 generated
      grant sequences), 15 real-build proof cases and 21 native browser cases pass.
      Pure transition-value checks fix the `can()` issue found by that coverage.
      The aggregate population and actual acquisition transport remain pending,
      and production startup remains unchanged.
      The [F4c callback custody decision](worker-grant-population-design.md) records
      the next code-research finding: callbacks waiting for acquisition need explicit
      stop/error settlement, and unaccepted opened ports need native custody through
      delivery. The user selected the shared Local First extraction on 2026-11-14.
      F4c1's public keeper and existing-channel adoption now pass approved
      qualification: 1,192 library tests (109 focused), four packed consumers,
      2,082 Finance units, 163 focused host cases, 18 worker-state cases, 21 native
      cases and 19 production PWA cases, plus Clipper's 872 unit/30 component,
      32 worker, 12 extension and eight production-offline cases. The keeper record
      preserves the initial native-callback failure, its chart-driven drain fix and
      separate environment failures. The bounded population/callback bridge and
      actual acquisition transport remain pending; W05 is still incomplete.
      Clipper's still-Window-owned hidden capture SDK and its IDB adoption are
      deferred together. No temporary UI-only-thread exception was approved.
      Source inspection confirmed the extension sign-in worker and hidden offscreen
      runtime currently share the native SDK selection. Adopt the shared IDB binding
      in both together, retaining SDK/session shutdown before store closure. Do not
      switch only the sign-in worker and leave capture on the old default store.
      Until that separate follow-up, retain Clipper's existing account-storage path;
      remove Finance's superseded inactive transport after its replacement qualifies.
- [ ] **W06 — Qualify a single worker SDK/session owner.** Depends on W05.
      Integrate the current patched SDK with the retained acquisition lifetime and
      Finance configuration. Prove IDB identity/binding reuse after creation, persistent
      replica access, offline writes, full browser/worker exit and cold reopen,
      multiple tabs, broker generation failure and native resource release.
      Do not reset existing storage or claim persistence from matching names alone.

Milestone A: a production-buildable, crash-safe worker runtime that preserves
identity and storage. No production UI handoff is implied.

## B. Establish the application and UI contracts

- [ ] **W07 — Define runtime connection and bounded views.** Depends on W02/W03;
      real-runtime qualification depends on W06. Define versioned commands,
      projections, subscription attach/detach, operation receipts and host capability
      requests. Bind runtime/attachment generations, identity/workspace scope and
      request IDs. Bound bytes, collections and pending work; specify cancellation,
      overload, stale A → B → A results and duplicate handling. Add a UI connection
      that exposes views/commands, not actor or database handles. Preserve exact
      money/date representation. Do not transport arbitrary queries or raw errors.
      The user confirmed the worker-backed client direction on 2026-11-14; the
      [client-boundary decision](spec.md#finance-runtime-client-boundary) is part of
      this task. Expose bounded feature views through the native Svelte store
      contract: synchronous current value on subscription and explicit unsubscribe.
      Give runtime failure/unavailability a typed view outcome. Replacement must
      invalidate old identity/workspace data and command capabilities immediately;
      generation checks must reject stale A → B → A reports and intents.
      UI subscription disposal releases observation, while the application owner
      retains SDK/session lifetime and actual financial-effect settlement. Keep
      component-owned UI actors separate from this domain-client boundary.
      Qualify initial subscription to an already-ready runtime, multiple observers,
      detach/resubscribe, replacement, failure and late commands/results through the
      actual worker transport. W07 remains incomplete until implementation and these
      acceptance checks pass.
- [ ] **W08 — Implement shutdown/replacement and uncertain-outcome ownership.**
      Depends on W06/W07. Model layout detach, runtime close, account/environment
      replacement, host failure and worker crash separately. Retain/reconcile issued
      effects, invalidate capabilities, drain descendants, clear transients and
      close actual resources before safe-close acknowledgement. No blind replay.
      Wire sanitized bounded diagnostics using the existing projection.
- [ ] **W09 — Add worker-owned query observation.** Depends on W06/W07.
      Implement reusable non-Svelte observation at the Local First Jazz boundary,
      drawing on Clipper's direct SDK bindings without extracting domain queries.
      Use non-Svelte SDK subscriptions with owned lifetimes and failure reports;
      preserve LocalFirst foreground behavior and explicit authority-tier operations.
      Copy live rows at immutable actor boundaries, bound views, reject stale results
      and dispose on scope replacement. Expose only reusable mechanisms in Local
      First; Finance retains queries and permission policy.
- [ ] **W10 — Split form transport from DOM and localization.** Depends on W07.
      Evolve Local First's existing workflow/integration boundary rather than add
      an app-local replacement for its scoped form machine.
      Keep FormData extraction, native inputs, focus and presentation in Window.
      Keep validation, eligibility, draft/workflow authority, submissions and result
      selection in worker actors. The first account-creation slice replaces callback-bearing feedback labels in
      wire views with selected serializable descriptors and qualifies reactive locale;
      other feature-specific input/reset/navigation/private-file boundaries remain.
      For those features, retain Finance's current wording
      and reactive locale. Specify draft revisions, out-of-order input, reset,
      navigation acknowledgement, cancellation and late completion. Qualify shared
      API changes with existing consumers; don't create another form workflow.
- [ ] **W11 — Prove native capability and private submission adapters.** Depends
      on W07/W08. Specify and prototype navigation/WebAuthn/file/canvas boundaries
      and a bounded private one-use submission channel for secret/file payloads.
      Recreate opaque WeakMap-backed handles in their receiving realm. Verify
      rejected/late/duplicate submissions, scope replacement, cancellation, port
      loss and cleanup without logging secrets. Qualify clone/transfer behavior and
      supported processing primitives before dependent feature migration.
      Separately extract Clipper's generic disposable-worker job (R4) into Local
      First and update Clipper's image-job caller before Finance's finite-job
      adoption; this extraction need not wait for all private submission adapters.

Milestone B: actual SDK-backed observations, cloneable application/form views,
safe commands and explicit native boundaries. UI does not reconstruct access or
workflow decisions from worker internals.

## C. Move shared application flows, then bounded features

- [ ] **W12 — Move session/workspace/access coordination.** Depends on W08/W09
      and required W11 capabilities. Move restoration/bootstrap, selected-workspace
      ownership, membership/grant observation and scoped resource drains. Replace
      live actor/context bindings with W07 views/commands. Preserve locally known
      usability, denied/partial knowledge and immediate invalidation on access loss.
- [ ] **W13 — Move shell data, balances and preference coordination.** Depends
      on W12. Replace WorkspaceBootstrap's data/query/aggregation responsibilities
      with worker projections. Preserve exact balances, workspace navigation and
      account-order edit/done/move and persisted preference behavior. Keep disclosure,
      responsive layout, route observation and native storage primitives in Window.
- [ ] **W14 — Prove the first read-only vertical slice.** Depends on W13.
      Render existing accounts presentation from the worker's list projection in an
      isolated migration preview. Verify no page SDK/query owner, bounded output,
      subscription disposal, permission loss and workspace switching.
- [ ] **W15 — Prove the first financial-write vertical slice.** Depends on W10,
      W12 and W14. Move manual transaction creation without attachments first.
      Exercise validation → authorization → write → local settlement → result →
      navigation, plus cancellation, access replacement and unknown outcomes.
      Prove offline save and cold restart; keep transaction resources in one realm.
- [ ] **W16 — Migrate ordinary domain features in dependency order.** Depends
      on W15. Split into focused slices: account creation/settings/order/archive and
      grants; category/tag management; transaction pagination/filtering/details/editing;
      transfers/linking/unlinking and integrity operations; profile and identity
      settings. Use W10/W11 where required. Preserve selected-account permissions,
      transaction-time invariants, money semantics and atomic operations. Verify each
      route against W01; do not hide unported routes behind a ready startup shell.
- [ ] **W17 — Migrate images and attachments.** Depends on W11/W15 and affected
      W16 flows. Move processing/validation/upload/replacement/removal coordination,
      retaining required native display/picking surfaces in Window. Verify actual
      Pica/canvas/bitmap compatibility, transfer ownership, cancellation, resource
      release, partial attachment failure and profile-avatar flows.
- [ ] **W18 — Migrate provider setup, discovery, sync and history.** Depends on
      W11/W12/W15 and needed account flows in W16. Add validated provider-worker
      request admission and explicit endpoint binding. Preserve one-use setup-token
      PRF preflight, explicit per-operation passkey verification, encrypted storage,
      scoped transient secrets, import idempotency, settlement and log retention.
      Keep the disposable HTTP worker initially. Prove no startup/reconnect/timer
      transaction fetch or implicit retry; include mixed/partial discovery results.
      Reuse R4 for finite worker lifecycle only, preserving provider secrets outside
      inspectable job context and keeping consent/domain decisions in Finance.
- [ ] **W19 — Migrate backup, restore and workspace administration.** Depends on
      W11/W12 and relevant file/account flows. Recreate one-use submissions inside
      worker ownership; move archive read/validation/crypto/planning and persistence
      there. Preserve legacy fixtures, restore journals, interrupted recovery,
      workspace creation/rename and identity-merge behavior. Qualify large archives,
      cancellation, unknown writes and protected file/password cleanup.

Milestone C: every inventory feature has a worker-owned domain path and existing
UI behavior. These rows can be prepared independently after their prerequisites,
but remain separate bounded review cycles.

## D. Qualify and activate the complete application

- [ ] **W20 — Complete parity, packaging and performance qualification.** Depends
      on W16–W19. Exercise the actual built application across supported engines,
      identity/workspace replacement, revocation, multi-tab contention, worker/host
      failure, offline writes and cold browser restart. Verify nested worker/Wasm
      precaching, offline deep links and consented PWA updates. Include developer
      tools and sanitized inspection. Audit Window imports/execution for remaining
      domain work. Compare startup, large lists, balance updates, import and archive
      processing to W01, including message/clone cost and responsiveness. Record
      unsupported paths explicitly; no arbitrary improvement target is invented.
- [ ] **W21 — Activate, accept and remove obsolete ownership.** Depends on W20
      and release authorization. Replace the Window SDK provider and old integration
      paths as one qualified ownership handoff. Preserve origin/configuration and
      logical IDB identity/data; apply the explicit no-migration scope and verify
      supported current-version tab coexistence without concurrent SDK owners in a
      single application tree. Remove superseded paths after acceptance,
      and update specification/checkpoint/task records to the final implementation.

## Rollout constraint

Foundation changes may land inactive. Incomplete application flows are developed
in an isolated preview configuration with exactly one SDK/session owner. Keep
the complete existing production app until the worker path has parity; do not
publish a partial shell or use a second Window SDK to support unmigrated screens.
If earlier production slices are desired, first review a concrete single-owner
compatibility design and prove that it preserves every reachable existing flow.

W02 and W03 can proceed independently after W01. W07/W10 design can advance
while native custody is qualified; activation waits for W06. W17–W19 branch only
after their shared prerequisites. The first implementation step is W01's concrete
inventory/baseline, followed by the bounded W02 bundle proof and W03 custody
design; it is not a wholesale restart or merge of PR #67.
