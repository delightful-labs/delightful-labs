# Finance workspace backup and restore (T008/T009)

Finance uses merged DLF `ad99117` and Jazz `2.0.0-alpha.59` for owner-authorized
workspace downloads and explicit restoration into a new workspace. PRs #54/#57 are merged;
the qualified application revision is Finance `ab6c850`. T007 inventory is complete.
T010's deployed fake-data rehearsal is complete for the workload below. Finance's delivered scope
is complete with the accepted limitation below; T004 is closed by the user's decision. The current
uncommitted capacity change still needs review/publication. The separate shared DLF task T014
(explicit same-operation retry after confirmed rejection and repaired authority) remains open.

## Accepted limitation and closure — 2026-11-07

The user accepts the measured Jazz alpha.59 slowdown as unrelated backend data grows and the
intermittent `not_observed` failures. Stop further SDK/performance investigation for this delivery;
reopen it if the symptoms occur in real production use. This closes T004 by acceptance, not by
claiming that the SDK defect is fixed or that failed experiments passed. Preserve the existing
limits, explicit failure feedback, native validation and resource cleanup.

Phones, maximum aggregate/count and storage pressure remain outside the qualified claims. The
earlier server exit 137 remains unattributed. Production workspace data is outside this task.
The dated investigation notes below retain their original findings; their statements that T004
remains open describe the position before this closure decision. This closure does not commit,
merge or deploy the existing capacity change.

## T004 qualification work

### Capacity alignment change

Finance's export adapter now restricts encoded payloads to the existing 8 MiB retained-source
file bound. The existing DLF preparing/validating states reject excess before native commit,
encryption or download and retain their normal cleanup paths. A shared pure capacity predicate
reserves one source file and owner membership and checks financial file bytes/counts; export
checks the configured payload upper bound, while restore checks actual decoded bytes. The upper
bound avoids another serialization or byte copy. Under the 8 MiB encoded bound, financial attachment
data cannot exceed 8 MiB, so using that bound does not reject an otherwise supported aggregate.
The Finance format validator remains unchanged: older larger files can still be independently
inspected, and restoration refuses them before journal/destination creation. DLF's generic budgets,
schema, provenance storage and messages remain unchanged.

Verification on 2026-11-07:

- **32/32** focused native backup tests passed in 99.95 seconds. Capacity boundaries reserve the
  source/member, ignore preceding history as a live file and prevent a larger caller budget from
  raising the ceiling. A real over-capacity capture performed zero commits, rolled back, handed off
  no file, preserved source/audit and allowed a subsequent export after cleanup.
- Application diagnostics: zero errors/warnings. Test types, browser scope validation, formatting,
  diff checks and the production Netlify build passed. No dependency/lockfile change is included;
  the Netlify adapter was supplied from temporary build dependencies.
- **3/3** ordinary backup browser regressions passed in 88.8 seconds, retaining the 521-transaction
  workload and original deadlines. The updated opt-in 8 MiB refusal case also passed in 33.0 seconds,
  checking zero downloads, editable recovery, unchanged source audit and no destination/operation.
- The uncommitted change is deployed only to the
  [capacity draft](https://6aef49eb6d8987a6c61293bb--delightful-finance.netlify.app), using its own
  Jazz app `cbed0d21-9d25-4949-bacb-1ec3c0be1aa2`. Served config assets exactly match the local build.
  An ordinary disposable account seeded 120 transactions, one account/category and test-owned binary
  attachment data, then recovered through Finance's login UI. No backend privilege bypass was used.
  Later inspection found that this manual profile omitted `initialWorkspaceId`, causing global
  workspace initialization to fail. Retain the low-level results below, but do not count this run
  as healthy application startup qualification. The stress follow-up uses Finance's actual startup seeder.
- A **4 MiB attachment** exported with a password in 19.1 seconds and restored in **51.7 seconds**.
  After closing/relaunching the entire owned browser, remote business fields/references and every
  attachment part hash matched. The complete retained checked payload matched byte for byte.
  Reselecting the file created no duplicate. A plain source download took 19.7 seconds and preserved
  the original records, references, original bytes and audit exactly.
- An **8 MiB attachment** was refused before download in password/plain modes in **31.4/26.0 seconds**.
  Both forms became editable again, emitted zero downloads and preserved the fake source metadata
  and part hashes. Ordinary permissions were used throughout.

This aligns admission by refusing over-capacity downloads; it does not add larger-file support.
Existing history still consumes the same budget, so later generations can reach the export bound.
Destination verification for the 4 MiB case used remote rows/part hashes rather than creating a
larger nested backup. The first seed setup incorrectly used the new app's schema credential for
backend data admission; HTTP 401 refused it before writes. Switching to an ordinary local-first
account and the existing recovery UI fixed the experiment without application/auth-policy changes.
The draft's code identity and aggregate evidence are recorded under `capacityAlignment` in
[qualification.json](qualification.json). The extended-use slowdown/exit 137 remains unresolved;
no performance improvement or new platform guarantee is claimed by this change.

### Stress investigation — 2026-11-07

The same isolated capacity draft was tested with Finance's actual startup seeder, then ordinary
test-owned SDK access added 401 transactions to its default 120. The resulting source had three
accounts, eight categories, 521 transactions and no financial attachments. No production account,
data or credential was used. Source archives were independently opened and compared including audit.

| Control                                                              | Observed result                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Same page, first round trip                                          | Export 27.6 s; restore 127.9 s; source preserved                              |
| Same page, second round trip                                         | Export 22.0 s; restore 116.4 s; source preserved                              |
| Same page, third export                                              | Explicit error, no download; this is a failed case                            |
| Complete browser restart, same account/source                        | Export 27.2 s; restore 146.5 s; source preserved                              |
| Separate fresh account                                               | Test setup failed with `NotObserved` before backup measurement                |
| Export only, two separately restarted browser runs                   | First two exports succeeded; third export failed in both                      |
| Public ordinary SDK reads, no export/capture/restore                 | Four groups passed in Node (13 queries each) and the browser (14 each)        |
| Public SDK exclusive capture, 14 queries, zero application mutations | Two accepted commits, then third capture failed with `not_observed`           |
| Same capture with sequential transaction queries                     | Two accepted commits, then third capture failed while reading                 |
| Accounts query alone, three rows                                     | Eight exclusive captures passed                                               |
| Transactions query alone, 521 rows                                   | Four captures passed; native reads 12.3–13.0 s; warm ordinary reads 1.2–1.5 s |

Passive conditional CDP breakpoints on the original served JavaScript identified native
`not_observed` failures in the reader's `hydrate` metadata phase. This happens before the exclusive
capture. The reader and root reached their explicit failed outcomes and restored editable controls;
the error is not evidence of an unknown machine state or automatic-download blocking. Diagnostic
breakpoint timings are not production latency benchmarks. Ordinary reads alone do not reproduce
every query shape or lifetime of capture, so they do not establish that the SDK is fault-free.

The smaller native reproducer uses the existing deployed browser Db and public schema queries:
hydrate 14 metadata queries at Remote tier → begin exclusive transaction → execute the same Remote
queries → commit with zero application mutations → await `wait()` → repeat. It submits no Finance
backup, constructs no payload and performs no encryption, file handoff or restore. It reproduces
the failure inside native capture. Executing the transaction queries sequentially did not fix it.
The passing one-query controls show that this is not a universal third-transaction rule. In the
521-row control, accepted commit waits took 0.65–0.83 s; the larger delay was in the native read.
These observations isolate a public native read/coverage problem for further SDK investigation;
they do not identify an exact Rust/worker defect or justify changing Finance's consistency tier.

A separate ordinary Node memory client reproduced the problem with Finance already closed:
two zero-write captures accepted, then the next hydration queries all failed with `not_observed`.
Its harness also attempted capture after that failed hydration; the additional failure does not
qualify an independently hydrated capture. A longer ordinary-read-only Node control passed all
eight groups of 14 queries (112 reads), so this is not explained by that query count alone.
These controls exclude Finance's UI/backup runtime as necessary conditions but still share its
schema, permissions and cloud service. The exact client/core/server/policy cause remains open.

Settled page heap was approximately 23–28 MiB after successful round trips; browser RSS was roughly
719–775 MiB. More SharedWorker targets appeared after restore, but SDK alpha.59 deliberately avoids
closing portless worker globals during lease release because of an attachment race. Target counts
alone do not establish active-client leaks. No private SDK cleanup or namespace reuse was added.

The original local failure coincided with macOS `JetsamEvent-2026-11-07-094938.ips`, which establishes
host memory pressure. Its largest Node process had roughly 65 GiB of footprint accounting including
compressed pages; its ownership and the killed process are unknown. The later known agent server
had a 2.8 GiB physical footprint while its RSS was about 111 MiB. RSS alone was insufficient for
diagnosing that server. This does not attribute exit 137 to Finance or establish a specific leak.

The invalid initial manual-fixture runs and a setup stalled before measurement are retained as
excluded/failed attempts in [qualification.json](qualification.json). No extra application change,
retry, longer timeout or consistency downgrade was made during this diagnosis. T004 stays open.

### Backend growth follow-up — 2026-11-07

The later controls narrow the diagnosis and supersede any inference that a third capture always
fails. Ordinary reads passed at 0/30/60/90/120 seconds on one client. Matching-projection native
captures passed three rounds; another fresh client's ordinary hydration failed before any capture.
Alternating default/audit ordinary queries then passed. Projection differences and a simple
connection-age limit therefore remain unproven explanations. A manual reconnect followed by a
successful read also changed the projection, so it does not isolate reconnect as the remedy.

Successful 14-query captures took about 29 seconds but only 1–2 seconds of client CPU and roughly
50 KiB of inbound data. A sequential table profile found 10.3 seconds in the 521-row transaction
query and 11.0 seconds in the empty transfer query. The transfer policy checks transaction access
and endpoint relationships; returning no transfer rows does not make its native read cheap.

Two new, separate fake backends used the same Finance structural schema and cloned business graph.
The control retained current permissions. The candidate combined owner/admin membership predicates
and member/viewer all-account predicates using equivalent role sets, leaving the other clauses
unchanged. Three interleaved captures each passed: current policy took 4.7–5.0 seconds, candidate
5.6–6.1 seconds. No improvement was demonstrated; the candidate was discarded and its temporary
bundle removed. No repository permission or schema change was made. App-specific identity bindings
were adapted; no account credential, original preview policy or production data was modified.

The current-policy backend then received three unrelated, same-owner fake workspaces, each with
521 transactions. The original source remained at 521 transactions. Each measurement closed the
previous SDK session and opened a fresh ordinary memory client. Its 14-query source projection,
including audit, retained SHA-256 `54ce20a068de4d5988140ac86cb40c31a0ffe5ff4e615fb2a61ecabad5b98a2f`.

| Owned workspaces | Total transactions | Source hydration | Source capture | Transaction query | Empty transfer query |
| ---------------- | ------------------ | ---------------- | -------------- | ----------------- | -------------------- |
| 1                | 521                | 1.66 s           | 4.46 s         | 1.08 s            | 0.96 s               |
| 2                | 1,042              | 1.73 s           | 6.78 s         | 1.94 s            | 1.63 s               |
| 4                | 2,084              | 2.92 s           | 12.06 s        | 3.96 s            | 3.40 s               |

This demonstrates increasing work with unrelated owned backend data/history in this control,
without requiring a retained browser/client heap. It is one growth sequence on one cloud backend;
live-row versus history costs and cross-user scaling are not separated. The source fingerprint
covers those 14 queries; original workspace/profile/membership rows were not edited by cloning.
This is native-read evidence, not a full UI or platform performance guarantee.

With no additional data, a fourth-workspace repeat accepted in 9.9 seconds; the next repeat failed
with `not_observed` in the transaction query after successful hydration. Both clients were fresh.
That case remains a qualification failure; 12.06 seconds is not a stable latency guarantee.

The same growth procedure also passed on a separate, verified local disposable in-memory backend
running the pinned SDK. Source capture took **1.22 → 2.00 → 3.68 seconds** at one/two/four owned
workspaces, with the local source/audit projection unchanged and fresh clients each time. Cloud
timing alone is not required for the effect. A new fake owner with only one source workspace on
that populated local backend then took 3.62–3.88 seconds across three captures, alongside four
other-owner workspaces. Identity/record IDs differ in that additional control; it is not a
randomized comparison or a general cross-user scaling bound.

A 12-second CPU sample of the known local backend, containing only fake data, identifies prominent
work in maintained-query rehydration, `open_seeded_maintained_subscription_view_in_authorization_mode`,
Groove graph compilation/deduplication and `NodeDescriptor::node_id_of` / `OpType::hash`. The source
baseline hashes inline record contents while deriving graph identity. That locates an SDK-side
work site to investigate; it is not a causal proof of the timeout or a measured SDK optimization.
The sampled backend's physical footprint was approximately 1.5 GiB. No process memory payloads,
production records or credentials were inspected by the profiler.

The installed alpha.59 NAPI manifest identifies release baseline `204dc5b` (2026-10-02), whose core
uses Groove. The existing Jazz checkout's newer SQLite code is not that installed engine. The
manifest records a dirty diff, so the baseline alone does not establish exact native source
equivalence. No SDK binary was changed. Further correction must preserve frozen-snapshot coverage
and commit validation while investigating scoped query inputs/permission evaluation; no consumer
tier downgrade, automatic retry or SDK fork was introduced. Exact coverage-timeout and exit-137
causes remain open. Aggregate controls and failed setup attempts are recorded in `followUp` within
[qualification.json](qualification.json).

Finance PR #57 is merged at `ab6c850`; its final CI run `42376826034` passed. T008/T009 are
implemented. Qualification reuses the actual settings download/open/review/restore flow and its
exact-content/source-preservation checks on disposable data. Baseline measurement used the merged
workflows; the focused capacity change above is the only application change in this qualification.

The opt-in matrix covers the inventory's 521-transaction workload, four times that record load,
1/4/8 MiB original attachments, and a 4x page-CPU run. Plain and password files are measured
separately. Record counts and encoded sizes are reported as generated; synthetic Finance data is
representative of the inventory's scale, not a copy of the private 633-record graph.

Test-owned observers record export, independent opening, review preparation and native restore
durations, main-thread long tasks/frame gaps/timer delays, and sampled Chromium page heap and
browser-process RSS. RSS sums can include shared pages and sampling can miss peaks; neither is an
OS peak-memory guarantee. CPU throttling does not throttle every SDK worker or qualify a real phone.
The normal CI cases retain their existing workloads and limits. Larger cases remain opt-in.

Capacity refusal is measured as refusal, not successful restore. Finance currently retains the checked
payload as one source file: an otherwise valid download whose decoded payload exceeds 8 MiB cannot
be restored by this UI. The larger-attachment case must verify refusal before destination writes.
Supported-phone, maximum aggregate/count and storage-pressure qualification remain explicit gaps
until corresponding evidence exists. T010 uses a separate deployed preview and Jazz app populated
with fake data. Production workspace data, identities, storage and credentials are outside this task.

### Baseline observations — 2026-11-07, before capacity alignment

[Aggregate measurements](qualification.json) retain workload, browser/host, phase timing,
responsiveness, sampled memory, failed attempts and the fresh-backend control. These are real UI
experiments using a development bundle with debug enabled and a disposable in-memory backend,
not production latency guarantees. Attachment data repeats an eight-byte pattern. The matrix
ran serially against one increasingly populated backend; its ordering and host load prevent
controlled comparisons between protection modes or browser engines.

All **12 Chromium matrix cases passed** in 18.4 minutes. Ten restored successfully and two
verified expected capacity refusal. Times below span password/plain cases; maximum task duration
covers application export, preparation and restore phases, excluding test verification.

| Workload                                | Export to download | Restore                     | Longest main-thread task |
| --------------------------------------- | ------------------ | --------------------------- | ------------------------ |
| 521 transactions, no attachment         | 4.2–5.3 s          | 19.6–21.0 s                 | 107 ms                   |
| 2,084 transactions, no attachment       | 10.3–15.3 s        | 67.8–74.5 s                 | 368 ms                   |
| 521 transactions, 1 MiB attachment      | 21.6–22.9 s        | 37.3–40.9 s                 | 192 ms                   |
| 521 transactions, 4 MiB attachment      | 33.4–35.3 s        | 46.4–49.9 s                 | 553 ms                   |
| 521 transactions, 8 MiB attachment      | 49.4–51.4 s        | Refused before confirmation | 496 ms                   |
| 521 transactions, page CPU throttled 4× | 25.0–26.7 s        | 49.4–56.2 s                 | 419 ms                   |

The 4 MiB file produced a 6,380,767-byte payload and restored. The 8 MiB file produced an
11,973,171-byte payload: independent opening succeeded, but Finance rejected retaining it as
one source file under the existing 8 MiB limit. This is a round-trip capacity gap, not corruption
or a successful large-file restore. Supporting every currently exportable file needs a separately
reviewed change to retained-source storage or an aligned export bound; raising limits without
measurement would not resolve the memory question.

Two additional 4/8 MiB plain-file cases passed with stronger checks: refusal and review cancellation
left zero restore-operation rows, unchanged workspace roots and unchanged source transaction/audit
snapshots. Review cancellation returned to editing in **35 ms**; reselection then restored the
4 MiB case. This does not measure cancellation while a native write is pending. Plain inventory
round trips also passed in Firefox and WebKit. Their late-run timings are not an engine comparison;
unsupported long-task/memory observations are recorded as unavailable.

Across the matrix, sampled page heap reached roughly **289 MiB**, and summed browser-process RSS
reached roughly **1.33 GiB**, including test verification. The backend process is excluded. These
samples do not establish a safe phone memory budget. Larger records and attachments still cause
visible main-thread stalls, despite worker-based archive handling.

After many serial workloads, ordinary small cases slowed substantially. One restore reached its
unchanged 180-second deadline; the disposable backend was subsequently found terminated with
exit code **137** and no listener. The cause is unknown. A fresh-backend control passed all **3/3**
normal backup cases in 89.1 seconds, with password/plain exports of 3.4/4.7 seconds and restores of
18.0/20.7 seconds. This control does not explain or dismiss the earlier termination. The controlled
release-failure test now waits for its actual injected commit fault within its existing overall
deadline before asserting the error; its recovery assertions and timeout remain intact.

Read-only deployment verification found production frontend `ab6c850`, Netlify deploy
`6aef2b939f5346cb8c17af46`, matching 23-table source/server schema hash
`c30773a877641832506f851ec904d84c100821c1f629f39b63c21dd23dcae0b5` and permission head **v9**.
Policies matched after SDK-equivalent normalization of omitted/null optional fields. No deploy or
schema publication was performed. The merged PR's final CI run
[42376826034](https://github.com/delightful-labs/delightful-finances/actions/runs/42376826034)
passed, including **99/99** real restore experiments, superseding the earlier local 98/99 note below.
This session inspected deployment/schema metadata only; it did not read live workspace rows or
produce T010 retained-file recovery evidence.

The capacity gap above describes the original merged revision; the alignment change now refuses
those exports before download. T004 remains open for the unexplained stress failure, broader build measurements,
maximum aggregate/count, real phones and storage pressure. Per the user's direction, T010
exercises the deployed Finance UI against fake data in an isolated preview Jazz app, using a fresh
test identity/browser. Verify that namespace before seeding, retain and independently validate the
download, restore into a new workspace, then compare after a fresh session while preserving the
fake source. The earlier request to connect the user's production browser is withdrawn; no production
workspace backup or restore is required or authorized by this qualification task.

Reproduce against a known disposable agent server on port 5196, using Node 24 and one worker:

```sh
PUBLIC_DEBUG=true pnpm dev:agent --host 0.0.0.0 --port 5196 --strictPort
# In another terminal; omit FINANCE_BACKUP_QUALIFICATION for the three ordinary cases.
FINANCE_BACKUP_QUALIFICATION=true FINANCE_E2E_PORT=5196 FINANCE_E2E_REUSE_SERVER=true pnpm exec playwright test --config tests/config/playwright.workspace.config.ts tests/features/workspace-settings.e2e.ts --grep 'downloads and independently reopens' --workers=1
```

The opt-in test timeout is 300 seconds; ordinary restore cases retain 180 seconds. The observer
and envelope cleanup belong to the test fixture; the existing application statecharts still own
every export/restore operation. Only two files are added: the observer helper and aggregate evidence.

### T010 deployed fake-data rehearsal — passed 2026-11-07

Used the existing [PR57 preview](https://6aef268f8874d12e026bf451--delightful-finance.netlify.app),
deploy `6aef268f8874d12e026bf451`, at Finance `23e811f`. Its backup machines, schema and preview-build
sources match merged `ab6c850`; the preview predates unrelated filter UI changes. Public assets
verified Jazz app `b7fe11a2-065d-4213-8b16-1625e0a59d3c`,
separate from production, before creating the test identity. No new deploy, migration or production
credential was needed. A fresh owned Chromium profile used the existing fake-data startup machine:
**120 transactions, three accounts, eight categories and zero original attachments**.

The actual UI downloaded a **274,110-byte password-protected file** in 11.0 seconds. A separate Node
reader opened it without an application login. The UI then opened/reviewed it without adding a
workspace before confirmation, restored into a new workspace and reported Done in **36.6 seconds**.
The entire browser was closed and relaunched with only that test profile retained. A new plain
download from the destination took 12.9 seconds; independent reopening and comparison established:

- Every captured business field and relationship matches after normalizing remapped record IDs.
- Its retained source document contains the complete original checked payload byte for byte,
  including original audit and inert references. The destination's one attachment is this source
  document, not an original financial attachment.
- Reselecting the original protected file reports Done without creating another workspace.
- A fresh source download matches the original records, references and attachments exactly,
  including audit; the fake source is preserved.

No page errors occurred, and no request to the production origin or known production app was
attempted. The `.dlf` files and owned browser profile are retained outside Git in a private temporary
test directory; aggregate results are in [qualification.json](qualification.json). Initial direct
navigation showed an unselected workspace picker; selecting the generated Personal workspace fixed
the test setup without application changes or increased deadlines.

This completes the user-directed T010 rehearsal for this fake-data graph. It does not qualify phones,
maximum sizes or every nonempty Finance record type. The preview Jazz app is disposable and expires
after 14 days. Open the preview in a fresh browser profile to generate a separate fake workspace;
use Workspaces to select it, download, restore, restart and compare. Production data, the user's
browser/session and the production admin credential remain excluded.

## User workflow

Workspace settings exposes both Download Backup and Restore Workspace. Downloads can use a
password or no password. Restore accepts either protection mode and existing v1/v2 Finance files.
The file is opened and validated before showing its workspace name for review. Create Workspace
confirms a new operation; Try again confirms an incomplete operation. No destination is written
before confirmation. Invalid files, wrong passwords and unsupported capacity fail without creating
an operation. Feedback uses existing approved localization; no catalog edits are needed.

The restore continues across ordinary route/workspace navigation. Its root-owned feedback remains
available outside settings, including Cancel and release retry where applicable. Open Workspace
navigates to the restored workspace after confirmed completion using normal route authorization.
Restore never overwrites the original workspace or reactivates archived collaborators or providers.

Reselecting the same checked payload with the same account/app/environment derives the same operation
and target IDs. An incomplete journal resumes using its original intent and exact saved mappings;
a completed journal reports Done without acquiring a destination client. Cancellation before an
intent exists leaves a new operation to confirm. A reload requires reselecting the original file and
entering its password again; neither the file nor its password is saved in the journal. There is no
automatic restore or replay of uncertain writes and no second destination on retry.

## Profile and coverage

New exports use `delightful.finance.workspace` version 2, application `delightful-finances`.
Existing version 1 files remain readable by the restore planner.
`src/lib/backup/workspace.ts` defines the explicit field allowlist and pure profile validator.
Never spread SDK rows directly into an archive. Preserve exact amounts, currencies, dates, text,
optional variants, archived rows, cyclic transfer links, unassociated Checks and attachment bytes.
Preserve source audit timestamps, account attribution, and issuer/subject separately from domain fields.
Minimal membership-referenced profiles, memberships, account grants and sanitized bank history are
inert references; they never authorize a destination or reconnect a provider.

The declared graph contains 19 types: organizations, organizationMembers, profiles, accounts,
accountMemberships, categories, tags, transactions, transactionTags, checks, internalTransfers,
transactionBatches, batchTemplates, transactionAttachments, files, simplefinConnections,
simplefinAccountLinks, simplefinSyncAttempts and simplefinSyncAccountResults. V2 adds the inert
`sourceDocuments` reference type for a retained checked payload; ordinary workspaces have no such row.

Exclude credentials and their encryption/unlock metadata, profile avatars, arbitrary provider error
text, operational upload jobs, deleted rows and full engine history. A visible legacy `checkDetailsId`,
missing edge, unsupported value, unsafe integer, incomplete file or inconsistent transfer fails capture.
Denied legacy rows and hidden orphan files cannot be declared absent from policy-filtered reads.

Follow attachment links from every scoped transaction; the normal uploader does not populate file
workspace columns. Validate file ownership, contiguous unique part indices, declared and actual
lengths, and complete original bytes. Physical part IDs are not application graph identities.
Use metadata-only part queries before bounded body reads. Never omit, resize or downsample bytes to fit.
Keep DLF's existing limits: 8 MiB per attachment, 16 MiB aggregate attachments, 32 MiB payload,
64 MiB outer file, 50,000 logical records and 5,000 attachments. Sentinel queries reject truncation.
Finance export additionally applies the stricter 8 MiB encoded-payload ceiling above; generic
DLF limits still bound independently opening older files.

## Ownership and statecharts

The application root invokes a fixed restore controller for its lifetime. The controller owns:

`bounded read -> checked opening -> validation -> stable scope/IDs -> journal initialization/discovery
-> planning -> review -> native session -> cleanup`.

The native session owns a separate persistent SDK client using the existing account handle and
`restore-<operationId>` namespace. Its sequence is:

`load journal -> acquire client -> selected write/comparison -> drain retained receipts ->
shutdown({waitForSync:true}) -> release artifacts`.

DLF supplies checked-file opening, durable journal/intent format, native operation lock, selected-write
transaction custody, uncertain outcomes and reconciliation. Finance supplies typed graph planning,
scoped native queries/staging, comparison, resource ownership and UI integration. Native session actors
are spawned for each checked plan because each factory owns operation-specific resources. Their
completion/error/snapshot reports are correlated with their actor reference. The parent never starts
children manually through promise bridges.

Root retry, identity recovery, startup/readiness/observer failure and shutdown drain restoration before
allowing account/session replacement. Early startup retirement is deferred until cleanup finishes.
Ordinary workspace replacement retains its independent release gate, allowing unrelated local work.
Observed session/client replacement invalidates the restore. Confirm/Open additionally require the
current ready identity. A stale request cannot replace or release the active request.

Cancellation latches while an acquisition or leaf is pending. Every acquisition completion path retains
its resource before cleanup; late results cannot start another write. The native owner drains transaction
acquisition, pending staging, commit and settlement, or confirms rollback before closing its client.
A commit receipt forbids rollback. Unknown rollback, settlement or close outcomes retain resources in
blocked states whose explicit retry repeats only that native operation. Permanently rejected acquisition
or commit receipts and native actor crashes require a document reload; they never repeatedly await the
same rejected promise. The existing Try again action requests that reload through the application root.
Reload does not acknowledge cleanup or automatically replay restoration: the user reselects the original
file, and journal plus destination evidence determine whether the same operation can resume. An issued
operation without sufficient evidence remains incomplete. Scope invalidation supersedes cancellation;
shutdown cannot be downgraded by a later cancel. A crash never reports false cleanup. Owners must receive
SHUTDOWN and finish drain before they are stopped or their account manager is released.

Raw File/password/bytes, checked archives, typed graphs and native handles stay outside actor snapshots.
Public reports contain view metadata and opaque correlation tokens. Cleanup releases those private
artifacts only after SDK custody ends. Promise actors perform a single query group, ID/digest group,
pure validation/projection, staging, commit, settlement, rollback or close. Business branches use
statechart guards and invoke completion; file/part loops reenter their invoked state without route-only
intermediate states. The pure presentation component translates machine-selected messages.

## Export

The finite Finance reader authorizes the owner, reads metadata and dependent relations/file metadata,
validates closure/bounds, then allocates/reads/hashes each bounded file before projecting capture.
Ownership requires both organization ownership and owner membership, independent of account-selection
mode. The reader has no writable database/transaction interface.

DLF hydrates the declared graph through ordinary remote reads before opening one native exclusive
transaction. Capture rechecks the complete scope and validates the payload, commits with zero application
mutations, and awaits the native verdict before encryption/download handoff. A conflict discards the
attempt; explicit retry hydrates again with a fresh transaction. No maintenance mode, writer registry or
repeated graph-comparison protocol is used. Authority confirmation can remain pending offline.

Export failure recovery keeps one release invocation alive across scope changes and shutdown. A failed
release retains its request, disables another export, and offers explicit reload instead of reporting
closed. If the route leaves before release finishes, its retained observer reports a failed release to
the application root so recovery remains accessible outside settings.

The settings export machine owns unavailable/editing/preparing states and one fixed invoked export
across work, cancellation and drain. Scope includes identity, workspace, membership, attachment and
generation, including A -> B -> A changes. Browser download clears its byte copy and URL in finally.
Completion means Download started, since the browser does not confirm the user's retained file.

## Typed plan and destination

The planner uses the released Finance field schemas: read source -> scope/saved-intent guards ->
decode -> index records -> saved-mapping guard -> derive IDs -> project -> collision guard -> fingerprint
graph/writes/plan -> rebuilt-intent guard -> publish. Each leaf returns a value assigned by the chart;
there is no mutable private object carrying hidden workflow progress. Opaque values hold only private
payloads/rows/graphs, with request-owned byte cleanup. Scope, mapping and final-intent decisions are
named guards on invocation completion. Resume derives physical IDs and reuses admitted saved mappings.
IDs use deterministic `(kind,type,sourceId)` keys, independent
of locale and source storage layout. Physical attachment/source-part IDs and fresh owner membership
use the immutable operation ID. Resume rejects altered archive, scope, mapping or fingerprint data.

Twelve live types become typed Finance rows: organizations, accounts, categories, tags, Checks,
transaction batches, batch templates, transactions, transaction tags, transfers, files and attachment
links. Seven historical types remain inert in the retained source. Restored membership is exactly the
new owner, with no imported grants, profiles or bank connections. Newly inserted rows receive real
restore-time SDK audit; original audit stays in the checked source document.

The native destination validates graph/plan fingerprints and scope, reads one related snapshot,
checks source layout and hashes exact source bytes before classifying presence/authority. It stages
only the already-selected write group. The comparison actor requires a fresh exact match before
advancing to activation. Unknown or hidden results cannot authorize replay, overwrite or recreation.
An unresolved issued attempt stays bound to its original destination and transaction facts.

The pinned SDK requires omitting nullable transformed insertion fields to retain null defaults.
Provider IDs, archived accounts, legacy transfer representations and nullable associations remain exact.
The qualified adapter uses one financial batch; no unsupported partial-batch algorithm is introduced.

## Isolation schema and permissions

The additive migration adds nullable `organizations.restoreOperationId` and private `restoreOperations`.
Existing workspaces receive null bindings. The previous schema/normal policies remain a shared baseline
for compatibility tests; promoted policies compose qualified restore exceptions.

Preparation creates a destination header, immutable operation and retained source without owner
membership. Ordinary workspace discovery stays empty and normal edits/sharing remain denied.
The operation records owner, workspace/source-file references, payload/graph hashes and workspace header.
Its insertion policy checks those facts against the actual hidden workspace. It can transition only
from incomplete to active with unchanged bindings/header/hashes, and cannot be deleted or reopened.

While incomplete, only the operation owner receives scoped reconstruction inserts/recovery reads.
Publication atomically seals the operation and inserts the fresh owner membership. Owner membership
for a marked workspace requires its operation to be active. Publication closes reconstruction exceptions;
ordinary roles/grants govern live data afterward. Existing normal workspaces cannot gain restore access.

A fresh same-identity client can reconcile hidden rows using the private immutable header; it need not
read the hidden organization through ordinary discovery. Isolation does not prevent the authorized
recovering owner from explicitly querying those private rows. Server permissions enforce phase, owner,
scope, bindings and tested relationships. Full archive validation and exact graph comparison remain
trusted owner-client responsibilities, as in DLF's test app; the server does not independently prove
that an arbitrary owner client compared the entire graph.

Cached old-schema clients can edit published workspace settings even if they drop the unknown
reference to null. The immutable active operation keeps reconstruction closed. Old clients cannot
install a fresh non-null binding or reopen an incomplete workspace.

## Retained source and subsequent backups

The exact checked portable payload is retained as an immutable document in existing files/fileParts,
bound by immutable `restoreOperations.sourceFileId`. It includes original audit, collaborator and
sanitized bank metadata without making those records live. Parts are at most 256 KiB. The graph stores
source metadata; staging borrows bytes from the checked archive rather than expanding them for hashes.

Source access checks actual tenancy, null transaction/account associations, operation binding and phase;
a pointer alone grants nothing. Only the recovering owner reads it before publication; afterward only
current owners/admins can. Viewers retain normal attachment access but cannot read this source.
Mutation, deletion, rebinding and late part insertion are denied. Missing, malformed or hash-mismatched
source bytes block comparison/publication and subsequent export.

V2 exports include one inert sourceDocuments reference and its bounded attachment. Its checked payload
can contain a preceding generation, preserving provenance through another restore. The planner maps
only live financial attachments; preceding source documents stay inside the newly retained payload.
Embedded history uses the same strict field/relationship allowlist and a 32 MiB cumulative decoding
bound. Hash comparison rejects native corruption before download handoff.

The UI rejects a source payload over the existing 8 MiB per-file bound, a retained-source plus live-file
sum over 16 MiB, more than 5,000 combined files or more than 50,000 projected logical records. It never
silently drops history or raises DLF budgets. Repeated generations consume these bounds. Old cached
v1 writers collect transaction-linked files only and do not preserve restored provenance; use the
current v2 writer for that behavior.

## Qualification and limits

Tests use disposable schemas, ordinary real SDK accounts and persistent browser replicas. Backend
credentials only publish/inspect disposable data or inject explicit corruption. Every restore
experiment independently rereads its original source and requires it to remain unchanged. These
implementation experiments performed no production reads/writes, schema publication, identity
replacement, user-storage reset or deployment. The later read-only T004 deployment metadata check
is documented separately above; it did not read workspace rows.
The protected development checkout and ports 5173/5174 remain untouched.

The browser harness adds only test instrumentation around the production factories, including a finite
wire barrier and real transaction counters. A failed barrier cannot authorize writes. Lost-reply tests
forward actual writes, confirm server acceptance independently, terminate the entire browser, then
restart the retained profile. A page reload is not substituted for those restart tests.

Coverage includes:

- Original-policy rejection/acceptance baselines and private-lane relationship/header/owner denial.
- Cached-client additive migration, hidden catalogs and publication in Chromium, Firefox and WebKit.
- All live Finance types, archived/provider graphs, empty workspaces, original bytes and multipart UTF-8.
- Source-file role access, role downgrade, cross-workspace pointer substitution and immutable parts.
- V1 compatibility, strict v2 history, repeated backup/restore and deterministic budget refusal.
- Stable mappings, same UUID across types, substituted archive/identity/plan and interrupted crypto.
- Accepted preparation/financial/activation replies lost in all three engines; reconciliation issues
  zero new application commits. Missing local receipts do not fabricate evidence or strand accepted data.
- A genuinely unsent persistent outbox write synchronizes after restart without another application
  transaction. SDK retransmission is not counted as an application-issued replay.
- Corrupt destinations produce conflict without membership publication or replacement intent.
- Cancel/shutdown/invalidation retain native custody through held commits, rollback and close faults.
- Root shutdown/retry/recovery/startup-failure/observer-failure drain before releasing the old SDK session;
  unrelated workspace navigation remains usable.
- File-controller cancellation/reselection/reload, blocked close retry and completed history in all
  three engines; completed history never acquires a destination client.
- Actual settings downloads/restores, protected/plain files, wrong password, malformed input,
  no writes before review confirmation, navigation/cancellation, exact source preservation,
  one fresh owner membership, Open Workspace and duplicate-file completion lookup.

The persistent namespace is deliberately retained for uncertain-write recovery. Public
shutdown({waitForSync:true}) is qualified for its drain boundary, not namespace deletion, browser/OS
storage eviction or all-device quota behavior. An earlier memory-driver disconnect experiment exhausted
roughly 4 GiB and does not justify a private SDK workaround; the qualified design uses persistent storage.
T004 still needs representative maximum-size, phone and storage-pressure qualification. Prior desktop
536-record downloads measured roughly 3.6–7.1 seconds and 102–113 ms maximum observed main-thread tasks;
those samples are not platform-wide performance guarantees.

The change adds six files: planner, restore owner/controller module, frozen migration, migration
snapshot, browser test bridge and restore experiment suite. Earlier experimental schema adapters,
standalone test HTML/config, duplicate test-source projection and separate restore notes are removed.
The combined existing backup spec is the single implementation record. No DLF dependency change is
needed for this final application integration. Commit/push/PR and deployment remain separate actions.

### Final application verification

Node 24.22.2 verification on 2026-11-06:

- **1,895/1,895** unit/integration tests passed across 138 files, including 79 root lifecycle tests.
- **86/86** real restore experiments passed in 365.33 seconds. Chromium, Firefox and WebKit cover
  persistent replica isolation, migration, recovery, source preservation and controller lifecycle.
- **6/6** settings browser tests passed: protected/plain download-and-restore flows plus existing
  owner/admin/member/viewer settings access. The two complete restore flows took 40.0 and 46.3 seconds.
  They independently check all 521 transaction facts, exact attachment bytes and unchanged source audit.
- Application diagnostics: zero errors and warnings. Test/service-worker type checks, e2e scope
  validation, production build without a live Jazz service, changed-file formatting and diff checks passed.
- The existing CI workflow runs the restore suite in a dedicated job with all three
  browser engines. The workspace browser job already includes both complete restore UI cases.

Planner-refactor verification on 2026-11-07: 20 focused admission/cancellation cases and all 1,895
unit/integration tests passed. The expanded restore suite has 96 cases: the full run passed 95 and
timed out in one Firefox financial-write restart case. That isolated case passed in 22.6 seconds;
all three Firefox restart phases then passed together without logging or timeout changes. The
saved-image policy test now retains its actual local write receipt and awaits global acceptance
before querying it, matching the adjacent native policy test; application saves still settle locally.
Both protected/plain 521-transaction UI restore flows passed with the refactored planner in 43.8 and
47.8 seconds, including exact transaction facts, attachment bytes, unchanged source and history lookup.

Orchestration cleanup verification on 2026-11-07:

- **1,901/1,901** unit/integration tests passed, including 81 application lifecycle and 30 backup tests.
- All 96 existing restore experiments passed in the expanded 99-case run. That run passed 98 cases;
  the new lost-commit-receipt experiment initially assumed the write was durable before document reload.
  Its fault injection now awaits actual remote acceptance before discarding the caller's receipt.
  Both permanent receipt-failure cases then passed in a focused 15.67-second run. A second complete
  99-case run was not performed.
- **3/3** backup settings UI tests passed together: failed release remains recoverable after leaving
  settings and reload retains identity; password/plain flows verify 521 transactions, attachment bytes,
  unchanged source and duplicate prevention. The full restore flows took 39.6 and 46.1 seconds.
- Application diagnostics found zero errors/warnings. Test/service-worker types, e2e scope validation,
  production build, changed-file formatting and diff checks passed. No new files or catalog edits.

Commands use the repository's pinned dependencies:

```sh
pnpm exec vitest run
pnpm exec vitest run --mode restore-experiment --reporter=verbose
FINANCE_PREVIEW=true pnpm exec svelte-kit sync
FINANCE_PREVIEW=true pnpm exec svelte-check --tsconfig ./tsconfig.json
pnpm exec tsc --project src/service-worker/tsconfig.json --noEmit
pnpm check:tests
pnpm check:e2e
FINANCE_PREVIEW=true PUBLIC_JAZZ_APP_ID=ci-build PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:9 pnpm exec vite build
FINANCE_E2E_PORT=5192 FINANCE_E2E_REUSE_SERVER=true pnpm exec playwright test --config tests/config/playwright.workspace.config.ts tests/features/workspace-settings.e2e.ts --grep 'workspace backup downloads'
```

Run Node/framework checks and builds before starting the isolated preview. They regenerate SvelteKit
environment files; running them while testing the UI can replace that preview's Jazz URL. The final
UI runs used the restarted in-memory agent server on port 5192, with no further framework-generation
commands during those runs. Paraglide catalogs and message wording were unchanged.
