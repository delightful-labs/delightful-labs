# Verified backup implementation tasks

Implementation began after PR #15. The user subsequently authorized the combined test app
completion, tests and experiments in PR #26, then the repository-wide routing cleanup. That
combined authorization does not authorize Finance deployment or identity/storage changes.

## Current handoff

**Finance adoption merged (2026-11-07):** [Finance PR #54](https://github.com/delightful-labs/delightful-finances/pull/54)
and [Finance PR #57](https://github.com/delightful-labs/delightful-finances/pull/57) implement
T008 capture/profile/UI and T009 isolated restore, comparison, recovery and UI on Jazz alpha.59,
using DLF `ad99117`. The final PR CI run
[42376826034](https://github.com/delightful-labs/delightful-finances/actions/runs/42376826034)
passed, including the three-browser restore recovery job. Finance's
[implementation and evidence](https://github.com/delightful-labs/delightful-finances/blob/ab6c85073b0fbb2187283965a547eb50928f166c/specs/015-workspace-backup/spec.md)
records the disposable-data qualification. T008/T009 and the scoped T010 deployed fake-data rehearsal
are complete. T004 is closed with accepted limitations; T014 confirmed-rejection retry is implemented
and locally qualified, pending publication and Finance's package adoption.
Production workspace data is outside the authorized test scope.

**Closure decision (2026-11-07):** the user accepts the measured Jazz alpha.59 scaling slowdown and
intermittent `not_observed` failures as a known limitation. Stop further SDK/performance investigation
for this delivery. Reopen that work if the symptoms occur in real production use. T004 is closed by
this scope/acceptance decision, not by turning failed experiments into passes or claiming a fix.
Phone, maximum-aggregate and storage-pressure guarantees remain outside the measured claims.

**T014 completes the shared implementation scope.** Explicit same-operation retry after confirmed
rejection and repaired permissions is implemented and locally qualified. The user reviewed the
implementation and authorized testing. All 947 unit tests pass, including 16 new writer cases.
The full native restore regression run passed 71 cases, with seven optional measurement cases skipped.
The final focused run passed three permission-denial/repair cases through full restore completion:
same session, page reload and a graceful Chromium process restart with a temporary persistent profile.
They preserve destination/mappings and rejected-attempt evidence, and repeated resume issues no
duplicate write. See the
[qualification record](restore-journal-design.md#t014-writer-integration--qualified-2026-11-07).
Publication and Finance's package adoption remain pending. The uncommitted Finance capacity change
still needs separate review and publication; this work does not commit, merge or deploy it.

### Investigation record before closure

The dated observations below preserve the investigation history. Their references to open T004
work are superseded by the closure decision above; measurements and failed outcomes are unchanged.

**Partial T004 observations (2026-11-07):** the actual merged Finance UI passed 12 disposable
Chromium cases across 521/2,084 transactions, 0/1/4/8 MiB attachments, two protection modes and
page-only 4× CPU throttling. Ten restored; two verified expected refusal because an 8 MiB attachment
produced an 11,973,171-byte payload that exceeds Finance's single retained-source file bound.
Two stronger boundary/cancellation cases and plain inventory round trips in Firefox/WebKit passed.
Review cancellation returned in 35 ms without creating an operation. Record-heavy restores took
68–75 seconds, and 4 MiB attachments caused main-thread tasks up to 553 ms. These are development
bundle observations, not phone or production latency qualification.

After extended backend reuse, a normal restore timed out and the disposable server was found
terminated with exit 137; cause unknown. All three normal cases passed against a fresh backend
with unchanged deadlines. Preserve that stress failure as unresolved. Finance's pending
qualification branch `test/finance-backup-qualification` contains the test instrumentation.
The [committed qualification evidence](https://github.com/delightful-labs/delightful-finances/blob/852abaf688211b0c0e27b242229bc9eb493cf60d/specs/015-workspace-backup/qualification.json)
and [adjacent spec](https://github.com/delightful-labs/delightful-finances/blob/852abaf688211b0c0e27b242229bc9eb493cf60d/specs/015-workspace-backup/spec.md)
retain the method, measurements, failures and accepted limitation. That documentation commit does
not include the pending Finance capacity implementation.

Read-only deployed metadata now matches Finance `ab6c850`, the 23-table schema and permission head
v9. This supersedes T007's historical deployment revision only: its private source inventory has
not been refreshed. No live backup/restore or source-row read was performed. T004 stays open for
round-trip capacity, stress diagnosis, production-bundle/platform and maximum-size qualification;
T010 used a deployed preview with a separate Jazz app and fake data. The previous request for
the user's signed-in production browser is withdrawn.

**User-directed scope correction (2026-11-07):** qualify deployed recovery with fake data only.
Verify preview/backend isolation before seeding, use a fresh test identity/browser, retain and
independently inspect the downloaded file, restore into a new workspace, compare after a fresh
session and preserve the fake source. Do not access production workspace data or use its admin
credential. Historical T007 evidence remains historical and need not be refreshed for this task.

**T010 passed on deployed fake data (2026-11-07):** existing PR57 preview deploy
`6aef268f8874d12e026bf451` at Finance `23e811f` uses verified separate Jazz app `b7fe11a2…`.
Its startup seeder created 120 transactions, three accounts and eight categories under a new test
identity. The UI downloaded a password file; a separate Node reader opened it. Restoration took
36.6 seconds. After closing/relaunching the entire owned browser, a new destination download matched
all captured business values/relationships, and its retained source payload matched byte for byte.
Reselecting the file created no duplicate destination; a new source download matched all original
records/references/attachments including audit exactly. There were zero page errors or attempted
production requests. No production credential was used. There were no original financial attachments;
the destination's one attachment is its retained source document. This qualifies this deployed fake
graph, not maximum-size or phone support. The existing preview app expires after 14 days. Evidence
is recorded in Finance's adjacent backup spec and aggregate qualification JSON on the branch above.

**Capacity alignment ready for review (2026-11-07):** three existing Finance implementation files
now cap encoded exports at the existing 8 MiB retained-source limit and share restore reservations.
Generic DLF budgets and the format validator remain unchanged; this refuses an unsupported download
before native commit/sealing/handoff. All 32 focused native cases passed, including rollback,
unchanged source/audit and a subsequent successful export. Application diagnostics, test types,
browser scope checks and the production build passed. The
[draft deploy](https://6aef49eb6d8987a6c61293bb--delightful-finance.netlify.app) uses separate fake
Jazz app `cbed0d21…`: ordinary-account 4 MiB backup/restore passed, including full browser restart,
exact remote fields/references, part hashes, retained payload bytes and source preservation. Both
8 MiB protection modes refused download and preserved the fake source. These low-level checks used
a manual fixture later found to omit its initialization marker; healthy startup is not qualified
by that run. This adds no larger-file or
phone guarantee; retained history still consumes the same budget. The code is uncommitted; the
stress slowdown/exit 137 and remaining T004 platform/size work stay open.
The three ordinary 521-transaction backup browser cases also passed with unchanged deadlines;
the updated opt-in 8 MiB pre-download refusal assertion passed separately.

**Stress diagnosis (2026-11-07):** healthy deployed startup with 521 fake transactions passed two
warm UI round trips, then the third export failed. A complete browser restart recovered the same
account/source. Two export-only controls reproduced the third-export failure without restore.
Passive breakpoints on the original served bytes identified Jazz `not_observed` during hydration
metadata; the Finance reader/root reached explicit failed outcomes and editable controls.
Four groups of ordinary public reads passed in both Node and the deployed browser. A smaller
public-SDK control, without Finance validation/encryption/restore, then reproduced `not_observed`
on its third exclusive read-only capture after two accepted zero-mutation commits. Eight captures
of the three-row accounts query passed, so this is not a universal third-transaction failure.
Sequential multi-query captures also failed on the third attempt. Four one-query captures of 521
transactions passed, but native reads took 12.3–13.0 seconds versus warm ordinary reads of 1.2–1.5
seconds; their commit waits took 0.65–0.83 seconds. Investigate the public native read/coverage path
using that reproducer before changing Finance orchestration. No exact core/worker defect is claimed.
An ordinary Node memory client reproduced the failure after Finance was closed: two zero-write
captures accepted, then ordinary hydration failed. A separate ordinary-read-only Node control
passed 112 reads in eight groups, excluding that query count alone. The schema, permissions and
cloud service are still shared; their contributions have not been isolated.
No retry, limit increase, alternate consistency tier or private SDK workaround was added.

The earlier manual capacity fixture omitted `profiles.initialWorkspaceId`; retain its low-level
4/8 MiB results but exclude it from healthy-startup qualification. The original T010 application-
seeded rehearsal remains valid. A contemporaneous macOS Jetsam report establishes host memory
pressure around the local exit 137; ownership of its largest Node process and the killed process
remain unknown. Stable page heap and additional SharedWorker targets do not prove a leak.
Finance's existing qualification JSON/spec preserve these controls and failed attempts. T004 stays open.

**Backend-growth follow-up (2026-11-07):** ordinary reads remained successful through 120 seconds,
and three later native captures passed; the third-attempt failure is not universal. An ordinary
cold read also failed before capture. The controlled profile attributes most wall time to native
transaction/transfer queries, with little client CPU. A role-predicate simplification was slower
and was discarded without changing Finance permissions.

On a fresh fake backend with the existing policy, adding unrelated same-owner workspaces increased
capture of an unchanged 521-transaction source from **4.46 → 6.78 → 12.06 seconds**, at one/two/four
workspaces. Fresh SDK clients at every measurement and an unchanged source/audit projection hash
exclude retained client state as a necessary cause. This does not separate live-row/history costs,
qualify cross-user scaling or identify the exact coverage-timeout defect. The installed alpha.59
artifact is from the older Groove core, not the existing Jazz checkout's newer SQLite engine.
No SDK replacement, private API application workaround, retry or consistency downgrade is included.
The four-workspace cloud repeat accepted once at 9.9 seconds and then failed in the transaction
query with `not_observed`; it remains a failed qualification. A pinned local in-memory control
also reproduced growth (**1.22 → 2.00 → 3.68 seconds**), so cloud timing is not required. Backend
sampling identifies maintained-query rehydration/graph compilation and operator hashing as
prominent work. A new fake owner on that populated local backend also remained slower than the
one-workspace baseline; that additional comparison changes identity/IDs. The exact SDK correction
is still unimplemented. No Finance role/state-machine rewrite is justified by these controls.

**Native capture revision (2026-11-05):** the user requested a fresh smaller implementation after
the [native Jazz experiment](../../fixtures/native-capture/README.md). The
[replacement contract and evidence](contracts/native-capture.md) supersede writer admission,
quiescence confirmation and repeated graph comparison for the new Finance export path. Hydrate the
complete scope, capture through one exclusive transaction, validate and await a zero-application-
mutation commit verdict before protection/download. Ordinary writers need no registration.
The shared replacement and Finance integration are implemented; actual-size/platform qualification remains open.

**Updated 2026-11-05.** PRs #23–#26 are merged. [PR #26](https://github.com/delightful-labs/delightful-local-first/pull/26)
implements complete test app restore and native actor routing.
The test app root coordinates the retained plan, all mapped writes, fresh exact-content comparison,
activation and same-browser resume. Shared actors own journal/lock/transaction settlement and drain.
No Finance data, production configuration or dependency versions changed.

Final implementation qualification: **1,097 functional cases** — 927 units, 17 independent-reader,
18 test app-export, 60 native Jazz/Chromium restore, 65 Storybook browser and 10 native private-creation
cases — plus strict static/package/consumer checks. GitHub CI passed on `d69fe4c`. Three separate
1/4/8 MiB desktop experiments establish a bounded baseline, not mobile or deployed-Finance support.
See [restore evidence](restore-completion-design.md), [routing audit](native-event-routing-review.md)
and [performance report](test-app-performance.md). Earlier slice notes live in
[handoff history](handoff-history.md).

The user authorized a broader implementation review and all necessary tests while away. The
[simplification review](restore-simplification-review.md) replaces the unsuccessful serialized-cache
and worker experiments with allocation-free UTF-8 byte counts, indexed graph remapping and bounded
note transactions under the existing restore owner. At the user's request, all entry points now
use only the faster plan (fixed saved version 2); older plans are rejected without writes. The historical
[reuse](journal-reuse-design.md) and [worker](journal-worker-design.md) measurements remain preserved;
the worker path and retained JSON caches are removed. Final measurements and qualification are
recorded in the review and [performance report](record-performance.md#simplification-review).
Changes are ready for pull-request review; no deployment has been performed.

**T007 is complete:** [read-only deployed Finance inventory](finance-deployment-inventory.md)
verifies frontend `31f70cb`, the 22-table backend schema and permission head v8, owner authority,
633 scoped projected records and zero reachable attachments. Local/remote projections match and
no tracked pending writes were observed in the existing browser. The comparison encoding totals
672,633 bytes; it is not a Finance archive-size or capture-readiness claim.

## Next work

1. **Publish T014 and update Finance's package:** the shared implementation and local qualification
   are complete. Finance still pins the earlier package; adoption needs its own consumer checks.
2. **Finance capacity change:** review the existing uncommitted change and its tests before publication.
   No additional performance experiments or SDK changes are scheduled. Reopen T004 only if the known
   slowdown/failure occurs in real production use; preserve current safety and validation behavior.

T008/T009 are implemented and qualified on disposable Finance data in the merged PRs above.

**T014** adds explicit retry to the existing writer. It does not add an automatic retry engine or
change the qualified treatment of uncertain outcomes.

## Completed shared, test app and inventory work

- [x] **T001:** bounded portable archive codec, strict schemas, canonical values and graph validation.
- [x] **T002:** archive corruption, bounds, exactness and public-package qualification.
- [x] **T003:** plaintext integrity and password envelope, native crypto, immutable releasable resources.
- [x] **T005:** independent retained-file inspector; generic integrity/profile outcomes remain distinct.
- [x] **T006:** shared capture/export and complete test app restore: isolated destination, retained
      mappings, all attachments/notebook/notes, fresh exact fields/references/bytes/set comparison,
      activation, reload/resume and uncertain-activation reconciliation without duplicate replay.
- [x] **T012:** concrete versioned Zod restore journal, bounded attempts/receipts, CAS and durable
      progress through comparison/activation. Finance integration is implemented under T009.
- [x] **T011:** optional Zod form-error adapter, preserving library-neutral consumer contracts.
- [x] **T013:** profile draft-check review; retain simple draft checks rather than adding a schema.
- [x] **T007:** establish deployed Finance frontend/backend revisions, schema/permission hashes,
      all released record/attachment types, observable pending local writes and aggregate sizes
      read-only. [Inventory evidence](finance-deployment-inventory.md): deployed frontend `31f70cb`,
      matching 22-table schema/policies at head v8, 633 projected records, zero reachable attachment
      bytes, matching local/remote projections and zero tracked pending operations. Scope excludes
      hidden physical rows, excluded secret/avatar values and other devices. No source mutation,
      publication, write flush or storage reset was performed. Later disposable capture qualification
      is recorded under the completed T008.
- [x] **State-model cleanup:** envelope/avatar/recovery/custody corrections and the routing audit of
      all 45 machine-bearing modules. Nineteen implementation modules now use state-scoped native
      sends; qualified seed-health and stale-assessment checks remain deliberately documented.

## Qualification closure and remaining adoption

- [x] **T004:** closed for this delivery by the user's acceptance of the documented performance
      limitation. Preserve the desktop, deployed fake-data and backend-growth measurements, including
      failures. Investigate further if the slowdown/failure occurs in real production use. No SDK fix,
      phone guarantee, maximum-aggregate or storage-pressure qualification is claimed. See the
      closure decision above and Finance's `specs/015-workspace-backup/qualification.json`.
- [x] **T008:** Finance's allowlisted capture/profile and consumer-owned backup interaction,
      owner authorization, complete hydration, native exclusive capture/verdict, exact attachment
      bytes and disposable-data qualification. Merged in Finance PR #54 and exercised with restore
      in PR #57; deployed fake-data retained-file recovery is recorded under T010 below.
- [x] **T009:** Finance's additive incomplete-destination lane, policies, journal/mappings, inert
      provenance, domain writes, comparison, activation and UI. Finance PR #57 qualifies cached
      clients, restart, scope invalidation, native custody, rejected receipts and no blind replay.
- [x] **T010:** demonstrate retained-file independent validation, isolated full restore, fresh-session
      exact comparison and original preservation on a deployed Finance preview with fake data and a
      separate Jazz app. The 120-transaction deployed rehearsal above passed. Never substitute a
      download alone or shared test app results for this evidence.
      Do not access production data, identities, storage or admin credentials for this task.
- [x] **T014:** integrate an explicit same-operation retry after a confirmed remote rejection and
      corrected authority, as accepted in [the spec](spec.md#accepted-retry-behavior--2026-11-03).
      The existing write machine now admits a new explicit invocation after a confirmed rejection and
      known transaction ID. It checks current authority and journals a new attempt before any write,
      retaining the same destination/mappings and latest rejection evidence. Sixteen new machine cases
      and three real Jazz permission-repair cases qualify the behavior; full unit/restore regressions pass.
      Generic exceptions, hidden/null reads and unknown outcomes never authorize replay. No automatic
      retries or repair heuristics are added. Finance's pinned package adoption remains separate.

## Qualification boundary

The test app restore input is a known prebuilt archive; destination/policy checks use actual Jazz.
Actual capture uses the sole native Jazz export workflow; the old in-memory source simulator is removed. Recovery is
qualified for the same browser/origin with retained IndexedDB and a reselected matching archive,
including page reload/fresh session. Browser-process crash, cleared journal, offline restart and
cross-device/browser recovery are not qualified product claims. Additional platform guarantees need
an explicit scoped requirement and evidence; they are not implied TODOs for this PR.

Finance's delivered backup/restore scope is complete with accepted limitations. The shared
implementation scope is complete and locally qualified, pending T014 publication and Finance's
package adoption; publication of the uncommitted capacity change is separate.
Sign-in implementation and its Zod
configuration/external-input TODOs remain in
[the separate delivery plan](../002-shared-delightful-sign-in/delivery.md#zod-validation-todos).
Historical implementation evidence remains linked in [the handoff archive](handoff-history.md).
