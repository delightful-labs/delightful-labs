# Research: Local-first usability and startup

Researched 2026-10-29. App declares Jazz `2.0.0-alpha.59`, SvelteKit `^3.0.1`,
XState `^5.33.2`. Jazz evidence includes the published alpha.59 npm archive read in memory,
not an installed dependency tree. No production build, runtime measurements, or tests were run.

## Evidence and boundaries

Primary references (current documentation can change independently of the pinned SDK):

- [Jazz sync](https://jazz.tools/docs/concepts/how-sync-works)
- [Read/write tiers](https://jazz.tools/docs/reference/durability-tiers)
- [Permissions](https://jazz.tools/docs/auth/permissions)
- [Mutation errors](https://jazz.tools/docs/writing/writing-data)
- [Transactions](https://jazz.tools/docs/writing/transactions)
- [Local-first identity](https://jazz.tools/docs/auth/local-first-auth)
- [Client/runtime configuration](https://jazz.tools/docs/getting-started/client-setup)
- [Jazz internals](https://jazz.tools/docs/reference/internals)
- [SvelteKit manifest](https://svelte.dev/docs/kit/$app-manifest)
- [Service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)
- [SharedWorker exposure](https://html.spec.whatwg.org/multipage/workers.html#shared-workers-and-the-sharedworker-interface)
- [Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Worker)
- [Structured cloning](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [Static routing](https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes)
- [Navigation preload](https://developer.chrome.com/docs/workbox/navigation-preload)
- [Wasm compilation](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/compileStreaming_static)

## Jazz reads, writes, authorization, and storage

Verified alpha.59 package paths are relative to `jazz-tools/`:

| Finding                                                                                                                | Evidence                                                                                             | Consequence                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Browser query defaults are local; propagation defaults to full                                                         | `dist/runtime/client.js`, `resolveDefaultDurabilityTier` and `resolveEffectiveQueryExecutionOptions` | Ordinary browser reads need no remote preflight and still sync            |
| `LocalFirst` includes cached/pending data; `Remote` uses authoritative scope                                           | `dist/runtime/client.js`, `dist/runtime/db.js`; tier docs                                            | Choose local-first for ordinary use; remote waits offline                 |
| `LocalFirstUnlessEmpty` can wait when empty                                                                            | Tier docs and alpha.59 runtime/declarations                                                          | Its name does not guarantee immediate local delivery                      |
| Empty-unless-remote waits up to five seconds during connection setup; connected first-answer waits have no fixed limit | Current tier docs; package confirms read mode, not an independent timing experiment                  | A live but stalled server differs from a known disconnected client        |
| Local write waits confirm persistence; global waits require acceptance                                                 | Package write handles and transaction docs                                                           | Preserve local save completion plus later rejection reporting             |
| Mergeable transactions support offline local commits; exclusive acceptance requires authority                          | Transaction docs and package handle shape                                                            | Do not replace ordinary writes with exclusive confirmation                |
| Persistent browser runtime owns IndexedDB and sync in a SharedWorker                                                   | Internals docs; `dist/runtime/browser-worker-config.js`, worker assets                               | Much Jazz work is already off-thread; memory-driver behavior differs      |
| Query defaults can be global outside window/document environments when a server is configured                          | `dist/runtime/client.js` runtime detection                                                           | Worker migrations must explicitly verify local-first defaults             |
| `canInsert/canRead/canUpdate/canDelete` request authoritative advice                                                   | `dist/runtime/db.js` and `client.js`                                                                 | Do not introduce them as ordinary local action prerequisites              |
| Local-first account creation works offline after assets are available                                                  | Auth docs; `dist/session/create-jazz-session.js`                                                     | App bootstrap can introduce a network dependency beyond identity creation |

Local-first is a writable replica, not merely stale-while-revalidate HTTP response caching. Only
requested/received records are available offline. Read coverage, relationship completeness, data
volume, pagination, account scope, storage eviction, and attachments need explicit investigation.
Server policy enforcement remains authoritative; locally known permission data can become stale.
Observed revocation invalidates current capabilities; disconnected devices cannot promise immediate
revocation awareness or erasure of downloaded data. Unknown writes require reconciliation, not replay.

## Application audit

| Area              | Observed code                                                                                                                                                  | Interpretation                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Session           | `src/routes/+layout.svelte`, `src/lib/jazz-session.ts`: `initial: 'local-first'`; start requested on mount                                                     | Correct identity mode; earlier page bootstrap remains an investigation                   |
| Initialization    | `src/lib/machines/workspace-initialization.ts`: profiles and organizations read together with `LocalFirstUnlessEmpty`; absent marker enters `Remote` discovery | Even an empty secondary query can hold startup; missing provenance blocks readiness      |
| Shell and queries | `src/lib/components/WorkspaceBootstrap.svelte`: shell and organization/account/balance queries depend on initialized workspace readiness                       | Local data is downstream of initialization; decouple use from provenance safely          |
| Readiness         | `src/lib/machines/readiness.ts`: current identity/selection/membership gates; separate integrity report for bank-sync eligibility                              | Preserve scope checks; integrity is not a universal finance-rendering gate               |
| Integrity         | `src/lib/machines/workspace-integrity.ts`: local assessment then remote suspected-repair confirmation                                                          | Do not replace missing attribution with unconditional repair; defer repair independently |
| Saves             | `src/lib/data.ts` and persistence machines generally wait at local tier                                                                                        | Existing ordinary persistence mostly matches desired behavior                            |
| Save recovery     | `src/lib/machines/transaction-save.ts`: remote reads for unknown ledger/Check outcomes                                                                         | Exceptional recovery may wait; keep it scoped and cancellable                            |
| Seeding           | `workspace-fake-data.ts`, `fake-data.ts`: opt-in; local empty result triggers remote reads and exclusive acceptance on initialization path                     | Preserve seed deduplication while removing seeding from critical readiness               |
| Rejections        | `application-readiness.ts`: `db.onMutationError` observation                                                                                                   | Existing late-rejection path must survive changes; completeness needs audit              |

These are static findings, not proof that they dominate current measured startup time. A partial
replica cannot be made complete by changing a tier; missing required local facts still limit actions.
Stable bootstrap IDs already exist but do not prove safe cross-device creation or blind retry.

## Service workers and earlier startup

`src/service-worker/index.ts` precaches `immutable`, `assets`, and `prerendered`, serves matching
same-origin GET paths cache-first, and activates updates only on explicit message. The app
prerenders public shells via `src/routes/+layout.ts`. No explicit early Jazz preload appears in
`src/app.html`; SvelteKit-generated preload output was not inspected.

SvelteKit lists Vite-generated files in `immutable`. Jazz uses a statically analyzable worker URL
in `dist/runtime/browser-worker-assets.js`. This suggests emitted runtime assets may be precached;
it does NOT establish that the full worker import/Wasm chain or worker-originated requests work
offline. There is no generated production output in this checkout to verify that chain.

Alpha.59's `dist/runtime/wasm-loader.js` explicitly configured URL path fetches bytes, validates the
Wasm header, and initializes from bytes. It reuses initialization for the same URL within one realm.
Do not generalize that path to every default browser load or assume cross-realm compilation reuse.

| Option                        | Established fact                                                                                       | Remaining question / decision                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Complete runtime precache     | Cache API can retain executable assets for repeat/offline visits                                       | Inspect production manifest, worker imports, Wasm, MIME/URLs, cold restart, and update compatibility           |
| Existing cached shells        | Already cache-first; avoids navigation network dependency                                              | Measure shell lookup and service-worker cold start; direct detail routes need audit                            |
| Static routing                | `InstallEvent.addRoutes()` can serve cache/network rules before worker JS starts; limited availability | Feature detection, equivalent keys/fallback/update rules, actual benefit on supported browsers                 |
| Navigation preload            | Overlaps network HTML request with service-worker startup                                              | Usually wasted for our precached shell; evaluate only actual network navigation cases                          |
| Earlier page-owned Jazz start | Window can construct SharedWorker without full UI mounted                                              | Find earliest supported singleton initialization, assets, lifecycle ownership, and measurable overlap          |
| Wasm preparation              | `compileStreaming()` can compile separately; Jazz accepts `runtimeSources.wasmModule`                  | Verify broker path accepts/reuses module, realm/version identity, persistence/support, and end-to-end savings  |
| Jazz in service worker        | SharedWorker constructor is exposed only to Window; service workers terminate and lose globals         | Existing persistent runtime cannot simply be launched here; alternative runtime/handoff is unproven            |
| Background wakeup             | Service-worker events can run without an open page, browser-controlled                                 | No guaranteed always-warm app; no automatic bank-provider fetching; no supported Jazz sync handoff established |

Current handler uses pathname-only matching and cache keys. Jazz override URLs require immutable
`wasmVersion` when explicitly configured, so query-bearing asset identity must be audited before
adding overrides. Do not assume stripping query strings is safe for all resources. Cache Storage
is separate from HTTP caching; warm HTTP cache or a surviving worker must not conceal precache gaps.
All-assets installation can also compete with current work; sizes, duplicate downloads, update
cost, and storage budget require measurement before changing the installation policy.

## Application workers

XState actors are logical execution units, not automatic threads. A selected machine can be
instantiated in a worker with command/result messages; function callbacks, live actor references,
and database handles cannot simply be cloned. Keep UI/focus/navigation owners in the page. CPU-heavy
parsing/calculation or independent domain work may be candidates; a machine mostly awaiting Jazz
may gain little. Main-thread transformations, subscription delivery, repeated copying, balance
calculation, and rendering should be profiled before moving owners. Dedicated workers also cannot
construct SharedWorker directly: establish a supported database/message bridge before proposing one.

## Existing coverage and missing evidence

- `tests/pwa.e2e.ts` covers prepared shell navigation/reload and update behavior, but warms the app
  online first. Establish a fresh runtime and eliminate HTTP-cache masking for full cold-start proof.
- `tests/offline-access.e2e.ts` covers warmed cached scope/roles and local edits/reconnection.
- `tests/bank-sync-offline.e2e.ts` covers unavailable explicit provider actions, not general data sync.
- Unit coverage exists for initialization, integrity, save recovery, seeding, and application readiness.
  Inspect fixtures/assertions before changing behavior; do not run to discover statically visible drift.
- No numerical baseline, supported-device matrix, complete offline coverage policy, module-preparation
  benchmark, static-routing experiment, or safe recovered-identity bootstrap protocol was established.

## Guidance reconciliation inventory

| File / topic                                  | Disposition                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Constitution I                                | Already agrees; clarify no remote first-answer/timeout requirement for ordinary available local work   |
| Jazz memory                                   | Add verified tiers, defaults, workers, and absence-versus-availability distinction now                 |
| XState memory: readiness                      | Clarify local usable states versus remote reconciliation, retaining ownership/correlation              |
| Testing memory                                | Add full cold offline restart and live-unresponsive-remote verification guidance                       |
| `006/plan.md`, Initialization                 | Supersede remote provenance as a universal usability prerequisite; retain duplicate prevention         |
| `006/spec.md`, Story 1 scenario 4             | Clarify “stale access” means superseded observed facts, not a mandatory fresh remote check             |
| `008/contracts/workspace-integrity-report.md` | Reconcile finance ineligibility table with attribution-only nonblocking intent; trace actual consumers |
| `008/fake-data.md`                            | Preserve authoritative seed safety while making seeding independent of local readiness                 |
| `009/spec.md`, staged-save recovery           | Preserve narrow remote reconciliation; document deferred recovery without unrelated UI blocking        |
| `007/spec.md` and PWA review                  | Preserve update consent and local data; extend asset/cold-start evidence, do not rewrite prior results |

Approved online-only access administration, passkey/secret protections, and explicit provider fetching
are deliberate boundaries, not contradictions to remove silently. Reconciliation tasks must distinguish
historical implementation descriptions, actual conflicts, clarifications, and retained exceptions.

## T008 ordinary-write audit after local-readiness delivery

Scope: static inspection of the current checkout with installed `jazz-tools@2.0.0-alpha.59`.
No new runtime experiment or tests were run for this audit. Earlier T005–T007 validation results
remain separately recorded in `plan.md`; they do not prove every write path works offline.

| Path                                                                              | Evidence                                                                                                                                                                                                                  | Disposition                                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Profile name/avatar, workspace rename, account/category/tag creation and archival | Every returned write in `src/lib/data.ts` waits with `{ tier: 'local' }`; helpers validate before one write                                                                                                               | No remote completion gate to remove                                                                                              |
| Ledger and Check persistence                                                      | `independent-transaction-persistence.ts` and `check-create-persistence.ts` commit mergeable transactions and explicitly settle at local tier                                                                              | Preserve existing local completion, scope rechecks, rollback, and rejection/unknown classifications                              |
| Staged transaction save                                                           | `transaction-save.ts` allocates checkpoint transaction/Check IDs before writing; normal Check lookup is LocalFirst                                                                                                        | Preserve IDs and local child settlements; no ordinary remote preflight found                                                     |
| Unknown ledger outcome                                                            | `reconcilingLedger` is selected only for `transactionSettlement === 'unknown'`; `makeReadLedger` uses Remote and compares submitted values/tags                                                                           | Retain narrow remote reconciliation; do not treat an absent row as permission to replay. Navigation/reload recovery remains T012 |
| Unknown Check outcome                                                             | `readCheck` selects Remote only for `checkSettlement === 'unknown'`; normal lookup uses LocalFirst                                                                                                                        | Retain uncertainty check and compatibility decisions; no blanket tier replacement                                                |
| Workspace creation                                                                | `workspace-creation-transaction.ts` stages stable IDs and waits for local settlement                                                                                                                                      | Preserve creation protocol. Automatic bootstrap eligibility/provenance remains T010                                              |
| Transfer creation/link/unlink/deletion                                            | `internal-transfer-create.ts` and `internal-transfer.ts` use local settlement adapters and transaction/transfer IDs for mutation tracking                                                                                 | No authoritative completion wait found; preserve original operation scope and tracked IDs                                        |
| Attachment writes                                                                 | Upload, replacement, and removal actors wait for local writes; relationship/part reads explicitly use local tiers                                                                                                         | No remote save gate found. On-demand download/retention coverage remains T011                                                    |
| Late mutation rejection                                                           | Application `running` state invokes `observeMutationRejections`; `db.onMutationError` forwards transaction ID. `MUTATION_REJECTED` records generic or tracked-transfer notice, rendered by root `MutationRejectionNotice` | Preserve observer and notice independently of workspace initialization/seeding/integrity. No changes made                        |

A repository search for explicit Remote/LocalFirstUnlessEmpty reads, global/edge waits, no-argument
waits, and authoritative permission preflights found remaining remote boundaries in uncertain-save
recovery, bootstrap, attribution repair, and exclusive fake-data seeding. These have separate owner
tasks and safety requirements; they are not ordinary save gates. No speculative persistence refactor
is warranted by this audit.

Installed SDK inspection confirms `createJazzSession` awaits `createJazzSessionOwner`; that owner
awaits account selection and `openClient` before returning an initially ready local-first session
(`dist/session/create-jazz-session.js`, `dist/session/state.js`). This supports the current initial
mutation-observer attachment but does not prove every identity-replacement/reload scenario.

Coverage boundaries: `data.test.ts` checks local wait options and local failures; persistence tests
cover local outcomes and interrupted/uncertain writes. `transaction-save.test.ts` covers Remote only
for uncertain reconciliation and stable-ID retries. The application readiness tests verify rejection
correlation and unsubscribe, but several inject `MUTATION_REJECTED` directly; those assertions alone
do not establish SDK callback delivery or actual server rejection across restart. Full rejection,
partial-replica, unresponsive-remote and cold-start guarantees remain T009/T012–T014 work.

Decision: T008 audit complete with no verified ordinary remote gate requiring an application change.
Preserve existing persistence and rejection behavior; investigate deferred recovery and replica
coverage through their scoped tasks rather than broadening this audit into a rewrite.

T009 callback follow-up: application-readiness tests now invoke the callback registered through
`db.onMutationError` using complete synthetic rejection payloads. Both untracked and tracked-transfer
cases verify the app notice, omission of server error details from that notice, retained workspace,
dismissal and unsubscribe after graceful shutdown. The targeted suite passes all 48 tests;
application and test type checks pass. These are callback-adapter tests, not a real server-rejection
or cold-restart experiment. Existing direct-event tests remain useful for broader correlation cases.

## T010 identity provenance and offline-bootstrap investigation

Evidence: installed `jazz-tools@2.0.0-alpha.59` declarations and implementation, inspected statically.
No SDK upgrade, network experiment, schema/persistence change, or tests were performed in this
investigation. This section records supported surface versus internal behavior; it does not claim
an offline-safe bootstrap protocol has been implemented.

| Surface                      | Evidence                                                                                | Finding                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public account handle        | `dist/accounts/state.d.ts`, `AccountHandle`                                             | Exposes branded handle, ID and identity issuer/subject; no creation/restoration provenance                                                                                                                         |
| Public session snapshot      | `dist/session/state.d.ts`, `JazzSessionSnapshot`                                        | Exposes status, account/client, pending operation, error and recovery scope; pending is transient, not durable provenance                                                                                          |
| Session configuration        | `dist/session/create-jazz-session.d.ts`                                                 | `initial` accepts local-first/backend configuration; no public bootstrap-result/provenance hook                                                                                                                    |
| Automatic first identity     | `dist/session/state.js`, `dist/accounts/persistence.js`                                 | `ensureAutomaticLocalFirst` atomically selects/adopts a retained root under AccountStore update. Internal code knows whether it chose an existing root; the session returns only the resulting account             |
| Browser selection storage    | `dist/accounts/create-account-manager.js`                                               | Default AccountStore uses Web Locks and durable localStorage writes. A separate app read of empty storage can race another tab or precede restore/adoption; it cannot establish final newness                      |
| Explicit identity operations | `AccountManager.createLocalFirst`, `JazzSession.createLocalFirst` / `restoreLocalFirst` | An app initiating an explicit operation knows its intent while running. That does not provide crash-safe bootstrap provenance after restart, or preserve the automatic cross-tab root-selection protocol by itself |
| Custom AccountStore          | `dist/accounts/persistence.d.ts`                                                        | Supports durable atomic transform, but its payload is opaque SDK selection data, not a documented new-identity event. Do not parse credential serialization to infer product policy                                |

Current app bootstrap uses stable user-derived profile/workspace/membership IDs in
`workspace-initialization.ts`, then the mergeable `workspace-creation-transaction.ts`. Its transaction
checks profile/organization/membership/category facts and owns local settlement/rollback. The initial
remote discovery is currently what prevents recovered empty replicas from authorizing creation.
Removing that discovery without replacing its eligibility evidence is unsafe.

The separate explicit workspace-creation path journals its prepared attempt through
`workspace-creation-operation.ts` / `workspace-creation-journal.ts`, then reconciles and rechecks
before writing. Initial automatic bootstrap currently bypasses that journal. Stable IDs can bound
duplicates but do not establish newness, protect against restoring a previously deleted membership,
or resolve an uncertain commit after local eviction. The existing journal is a useful resource-owner
pattern, not a ready-made authorization to recreate absent rows.

### Options and recommendation

1. Prefer a supported SDK provenance/creation hook tied to atomic root selection. The contract must
   distinguish a newly generated winning identity from adopted/restored/unknown identities and allow
   an application bootstrap intent to survive the handoff or fail conservatively. A transient boolean
   alone leaves a crash gap. This requires SDK work or a version with a verified supported contract;
   no such public contract was found in alpha.59.
2. Design an application-owned explicit identity-creation flow using supported session methods and
   durable bootstrap ownership. This is a larger reviewed session/persistence change: it must retain
   cross-tab root selection, account-selection durability, interrupted creation recovery and SDK
   identity-change drain. Do not assume a separate marker and SDK storage update form one atomic
   operation. The design must state which crash windows conservatively become unknown.

Retain existing discovery for unknown/recovered identities while this mechanism is unresolved.
Available local finance data remains independently usable under T005. This is an implementation
limitation, not a change to the approved product requirement that a genuinely new identity can create
its first workspace offline. Do not implement a local-empty shortcut or import internal SDK helpers.

Any approved protocol must model provenance assessment → acquire/journal bootstrap ownership →
prepare stable IDs → reconcile known attempt → stage mergeable bootstrap → local settlement → retire
intent, with explicit unknown outcome, cancellation, replacement, failure and cleanup paths. The
protocol must prevent retries from resurrecting membership and must not couple recovered-identity
remote discovery to unrelated local capabilities. Show its statechart and file scope before coding.

Disposition: SDK/public-API limitation identified; T010 implementation remains pending a provenance
mechanism decision and concurrent-bootstrap design review. No product clarification has been assumed.

## T011 offline-preparation scope audit (partial investigation)

Evidence: current application queries/schema/permissions and installed Jazz alpha.59 `Db` declarations.
Static audit only: no quota, eviction, history-volume, multi-workspace completeness or attachment
network-transfer experiment was run. T011 remains open until those evidence gaps are resolved.

### Current coverage

- `WorkspaceBootstrap.svelte` subscribes to accessible organizations, the selected workspace's active
  accounts, selected-workspace transactions for balances, current selected membership, and selected
  integration records. This warms transactions for the selected workspace but does not prepare every
  accessible workspace or all relationships needed by detail/edit pages.
- `TransactionView.svelte` subscribes to all matching transactions of the selected workspace/kind,
  plus accounts, categories, tags and transaction-tag links. `TransactionList.svelte` paginates the
  already received groups in memory (25 items per page). The current list does not use database
  offset pagination; earlier offset concerns are a future-preparation risk, not a finding that this
  implementation skips records through database offsets.
- `TransactionEditEntry.svelte` uses `transactionDetailQuery` for the opened record. That query includes
  account/category/tag/Check relationships and `attachments.file.parts`. It must not be reused as the
  background preparation query: part rows contain file bytes, while `files` holds file name, MIME,
  size and scope metadata. Viewing detail currently requests these attachment relationships; no
  claim is made that merely opening a list downloads every attachment.
- `checks`, `internalTransfers`, transaction batches/templates, grants, archived accounts/categories/
  tags, and attachment/file metadata need explicit coverage. Warming only active account selectors
  or visible list rows omits facts needed for existing history and later detail navigation.
- No app-level `navigator.storage.persist/estimate/persisted` usage or complete-replica preparation
  workflow was found. IndexedDB persistence alone does not establish all-workspace availability,
  quota guarantees or retention after the browser evicts storage.

### Scope for a preparation design

| Records                                                      | Preparation boundary                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Organizations and current-user membership/grant facts        | All accessible workspace discovery; retain current authorization checks, not creator/owner shortcuts                           |
| Accounts, transactions, categories, tags and transactionTags | All accessible rows across discovered workspaces, including archived references and all history; retain account grant policies |
| Checks, internalTransfers, batches/templates                 | Explicit relationships and policy-permitted rows; do not assume transactions alone populate related tables                     |
| transactionAttachments and files                             | Attachment links and file metadata for readable transactions, preserving file-reference permissions                            |
| fileParts/content                                            | On demand; do not include parts in preparation queries or claim content is available from metadata alone                       |
| Integration metadata                                         | Only policy-permitted connection/link/history data; ciphertext stays encrypted, no passkey unlock or provider request          |
| uploads and legacy denied rows                               | Do not override deny policies or assume every schema table belongs in the preparation set                                      |

Read policies remain authoritative. `files` read access follows readable attachment references and
`fileParts` follows file access (`permissions.ts`); organization ID on a file is not a substitute for
those relationships. Preparation must not broaden permissions, restore missing rows or treat
absence as authority to repair. Provider credentials/transactions are never fetched automatically.

### Recommended architecture, pending review and experiments

Use an application-tree-owned preparation actor bound to the session/database, independent of
selected workspace and initialization provenance. Its integration owns SDK subscriptions; the
statechart owns workspace discovery, bounded work scheduling, retry, interruption and cleanup.
Use explicit LocalFirst subscription options so available records remain usable and upstream
propagation can continue without a remote first-answer gate. Track dynamic per-workspace children
and stop obsolete scopes on observed access loss/identity replacement. Keep provider and UI owners
in the page; this does not require an application worker.

Installed `Db.subscribe` supports typed object callbacks including terminal errors and returns an
unsubscribe function. It delivers complete current result arrays on updates; the SDK documents
fresh allocations. Unbounded subscriptions across every table/workspace can therefore add memory,
copying and transform costs even though Jazz already has a SharedWorker. Compare a small bounded
subscription set with staged background snapshot acquisition before choosing a workload policy.
Do not select arbitrary concurrency or retention budgets without representative measurements.

Local subscription delivery does not prove remote completeness. Report observed workspace/table
counts and local availability without presenting them as a percentage of all remote data. If an
explicit background remote snapshot is used to establish a checkpoint, keep its wait scoped to
preparation and define what a multi-query checkpoint actually guarantees. A later remote change,
partial relation or interrupted read must invalidate that completeness claim. Do not scan offset
pages over a changing/incomplete replica and infer completion from a short local page.

Before implementation: verify scoped subscription/relationship coverage and metadata-versus-byte
transfer with never-opened records; measure large-history memory and update costs; exercise quota
failure and browser eviction; determine whether attachment retention can use supported SDK APIs
without deleting shared domain rows. Current attachment removal deletes application rows and is
not a cache-eviction operation. Requesting browser persistence can reduce eviction risk on supporting
browsers but cannot be represented as an unconditional guarantee.

Disposition: query/schema coverage audit and architecture recommendation recorded. No background
preparation, progress UI, data-retention policy or offline-completeness guarantee implemented.

### T011 runtime probe: unopened shared workspace and attachment metadata

Environment: the existing development agent at `http://127.0.0.1:5186`, disposable in-memory Jazz
server, seeding enabled, two fresh isolated Playwright Chromium contexts, installed Jazz alpha.59.
The probe was orchestrated through explicit XState steps with browser cleanup on success/failure.
It did not touch existing browser storage or identities. No cold restart or persisted-storage
inspection was performed. A first fixture attempt ran before optional seeds existed and stopped;
the completed run explicitly waited for the owner's three seeded accounts independently of page
readiness, consistent with T006.

Reproduction sequence:

1. Open `/accounts` in two independent fresh contexts and wait for initialized scoped pages. Wait
   separately for three seeded accounts in the owner workspace. Retain each current account ID and
   URL workspace ID; do not navigate the recipient to the owner's workspace.
2. In the owner workspace, insert one ordinary expense (123 USD minor units) referencing an existing
   active account/category. Create a file metadata row referencing that transaction, a fileParts row
   with four synthetic bytes `[1,2,3,4]`, and a transactionAttachments link. These writes each wait for
   global acceptance so a delayed fixture commit cannot be confused with missing preparation.
   Use new UUIDs for all rows. The bytes are opaque probe content, not a valid displayable image.
3. Grant the recipient viewer membership with `accountAccessMode: all` in the owner workspace. The
   recipient stays on its own Accounts page and requests `app.organizations.orderBy('id')` at Remote.
   It observes two accessible workspaces. No account/finance/detail query for the shared workspace
   has been requested by its UI.
4. Call recipient `db.disconnect()`. Query its shared-workspace accounts, synthetic transaction,
   attachment link, file metadata and fileParts using `tier: 'local'`; record counts. Disconnecting
   prevents those observations from warming the replica through an upstream response.
5. Reconnect and request only
   `app.transactionAttachments.where({ id: attachmentId }).include({ file: true })` at Remote. Do not
   include `parts`. Disconnect again and repeat local observations.
6. Reconnect, explicitly request `app.fileParts.where({ fileId })` at Remote, disconnect and repeat
   observations. Close both isolated contexts/browser. No app preparation code is installed.

Observed recipient-local query results:

| Stage                           | Shared accounts | Probe transaction | Attachment link | File metadata | Parts | Queryable content bytes |
| ------------------------------- | --------------: | ----------------: | --------------: | ------------: | ----: | ----------------------: |
| Workspace discovery only        |               0 |                 0 |               0 |             0 |     0 |                       0 |
| Attachment metadata requested   |               0 |                 1 |               1 |             1 |     0 |                       0 |
| File parts explicitly requested |               0 |                 1 |               1 |             1 |     1 |                       4 |

Interpretation: organization discovery is insufficient for Q1 preparation. A metadata query without
parts made the file/link and referenced transaction locally queryable in this scenario, while the
account remained unavailable. Preparation therefore needs explicit related-record coverage, rather
than assuming permission or relationship dependencies populate every detail requirement. File content
was not queryable locally until explicitly requested, supporting the proposed metadata/content split.

Limits: query visibility is not a byte-level inventory of IndexedDB or network traffic. This probe
does not prove that no content bytes crossed the transport, that all grants/relations behave alike,
or that queried data survives every client closing. It covers one viewer/all-access grant, two small
workspaces and one four-byte part; it establishes neither a large-history budget nor retention/quota
behavior. T011 remains open for those experiments and a reviewed preparation implementation plan.

## T012 staged-save recovery audit and proposed boundary

Evidence: current `transaction-save-contract.ts`, `transaction-save.ts`, `scoped-form.ts`,
`scoped-form-submission.ts`, `forms.svelte.ts`, and installed Jazz alpha.59 Db declarations. Static
investigation; no new production behavior, storage migration or runtime/test execution in this step.

### Observed behavior

- `transaction-save.ts` allocates transaction/Check IDs before writes and records check/ledger
  settlement separately. A Check can be locally saved while the ledger fails. In the same form scope,
  retry receives the checkpoint and reuses these IDs instead of creating another Check blindly.
- Before Check/ledger writes, the machine records intended values and marks the corresponding
  settlement unknown. It invokes resource-owning persistence children and updates that fact when
  their output arrives. Cancellation and scope replacement retain actual settlement in the result.
- An unknown ledger outcome selects `reconcilingLedger`, whose Remote query compares the prior
  submitted row, tags and Check relationship. It does not retry the write because a row is missing.
  Check lookup is Remote only for unknown Check settlement; normal lookup is LocalFirst. These waits
  belong to the particular save attempt and are cancellable, not global readiness requirements.
- `scoped-form.ts` retains unsuccessful checkpoints only for the matching scope revision. Success
  clears them. `clearDraft`/reset and scope replacement clear checkpoint and feedback; outputs from
  an older scope revision cannot attach recovery state to the new form. `forms.svelte.ts` shuts down
  its form actor on unmount. This protects current UI scope but is not durable recovery ownership.
- The checkpoint schema contains `scope.binding`, a live object validated with `z.custom<object>`.
  `sameSaveScope` compares bindings with `===`. Persisting the existing checkpoint JSON cannot restore
  this identity after a database/session restart. Serializing an actor snapshot is likewise not a
  supported recovery solution.

The same-form guarantee therefore ends at reset/scope replacement/unmount/reload. There is no
app-owned durable pending-save journal in the audited path. A later new submission can allocate new
IDs; the app must not describe that as resuming an old unknown attempt. An uncertain old write may
still settle, which is why operation identity must survive outside the route owner before offering
cross-navigation retry guarantees.

### Proposed design, not yet approved for implementation

Use a versioned data-only recovery record containing stable app/environment namespace, identity,
workspace, direction, original edited-record ID if any, operation UUID, allocated transaction/Check
IDs, immutable submitted ledger/Check values and tag assignments, and independently observed
settlements. Do not persist database handles, actor references, credentials or a copied lifecycle
state. Preserve current in-memory binding checks during active operations; resume by validating the
durable record and reauthorizing its stable scope against a newly attached current binding.

A session/application-owned recovery owner must exist before route forms. It owns durable pending
records and their recovery children, independent of the selected workspace/form lifetime. A route
may discard its draft while the owner retains the issued operation's identity. Identity replacement
must detach old UI reports and drain active resource work without relabeling it for the new identity;
records remain scoped to their original identity/environment. No unknown attempt may automatically
replay on startup, reconnect or a missing local row.

Write-ahead persistence must finish before issuing each independently meaningful Check/ledger write.
A durable intent is not evidence that the database write happened. A crash after intent persistence
but before write issuance must remain distinguishable as uncertain unless supported observations
establish otherwise. Persist the resulting settlement before retiring recovery state. A journal
failure before issuing a write must fail that attempt; it must not silently downgrade durability.
Jazz and an IndexedDB journal are separate commit domains, so do not claim atomicity between them.
The installed public Db declarations do not expose a general transaction-fate query that would by
itself settle every post-crash ambiguity; verify any proposed additional SDK API before relying on it.

Retain the existing narrow remote comparison for unknown writes. Scope remote waits to the pending
operation; allow unrelated finance work and other independent operations to proceed. Matching prior
values may establish the existing attempt's effect; conflicting or absent results must preserve
explicit conflict/unknown outcomes rather than restoring rows or authorizing blind replay. Ordinary
successful saves still finish after local persistence, and late rejection reporting stays separate.

A future statechart must expose: read/validate journal → attach current authorized scope → inspect
known settlement → scoped reconciliation or explicit action → persist updated outcome → retain or
retire record. Active save integration must expose journal intent → one child write → journal result,
with cancellation, partial Check-only success, rejection, unknown outcome, identity replacement and
shutdown cleanup. Do not hide these steps inside a promise actor or transaction callback.

### Suggested review slices

1. Define the durable recovery DTO and validation/adapters alongside the transaction domain contract;
   demonstrate binding-independent round trip and unchanged stable IDs after reattachment.
2. Implement a resource-owning journal machine with version/scope validation, atomic compare/write,
   quota/error outcomes and cleanup, using the workspace journal as a pattern rather than blindly
   sharing domain-specific state. Review before tests.
3. Integrate write-ahead intent/result states into the staged save machine while preserving its
   existing child transactions, local settlement and interruption priority.
4. Attach application-tree recovery ownership and route handoff, then review any user-facing pending
   recovery actions/localized messages separately. Define conflict and multiple-pending-operation
   behavior before implementing those actions. This is a larger change and must be discussed before
   expanding across form, application and integration files.

Coverage required after implementation review: Check-only partial success, uncertain ledger/Check
outcomes, journal write failure before an effect, crash windows on both sides of each write,
navigation/reload, A → B → A, stale reports, late rejection, mismatched identity/environment, and
unrelated local work while reconciliation never responds. Current same-form unit coverage and the
T009 callback checks do not establish these future guarantees.

Disposition: concrete current boundary and staged design recorded. Durable recovery remains
unimplemented; T012 remains open for design review, SDK ambiguity experiments and accepted delivery.

## T013 production runtime assets and offline routing — completed audit

Build source: committed application code at `423c6f4`, isolated feature worktree
`/private/tmp/delightful-finances-startup-assets` on `audit/local-first-startup-assets`, with its own
locked dependency installation. Uncommitted callback tests/research do not change its app code.
Versions: Jazz 2.0.0-alpha.59, SvelteKit 3.0.1, Vite 8.3.4, Svelte 5.57.2, Playwright 1.64.0.
The development checkout/server at port 5186 was left untouched.

Reproduction: `pnpm install --frozen-lockfile`, then build with `FINANCE_PREVIEW=true`,
`PUBLIC_FAKE_DATA=false`, `PUBLIC_DEBUG=false`, an isolated UUID app ID, and
`PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:49999` (verified unused loopback port, no remote backend).
Serve with `FINANCE_PREVIEW=true pnpm preview --host 127.0.0.1 --port 4183 --strictPort`.
The valid unreachable URL permits local-first runtime startup without contacting the configured
cloud backend. An earlier empty-URL build installed its worker but did not initialize the app; its
startup result was not used as offline evidence. Production builds succeeded.

### Finding 1: worker-local Wasm is emitted but not precached

| Output path                                                |      Bytes | In generated precache paths? |
| ---------------------------------------------------------- | ---------: | ---------------------------- |
| `_app/immutable/workers/jazz-broker-worker-Di-oGEU0.js`    |    396,529 | Yes                          |
| `_app/immutable/workers/assets/jazz_wasm_bg-ayzBUhbu.wasm` | 19,342,148 | **No**                       |
| `_app/immutable/assets/jazz_wasm_bg.ayzBUhbu.wasm`         | 19,342,148 | Yes                          |
| `_app/immutable/assets/jazz-broker-worker.D5msRnvZ.js`     |    827,415 | Yes                          |

Both emitted Wasm copies have SHA-256
`49d0af280091fa462720a5739431cb516ab4d7cc8ca943faa0279ebcd008f056`.
The hashed compiled worker resolves its default Wasm URL relative to its own worker location,
pointing at the nested `workers/assets/` copy. The compiled page also loads the root asset copy for
its own runtime/crypto work. Caching the root copy does not satisfy the worker's different URL.

Verified by Chromium tracing: start `browser.startTracing(page, { categories: ['devtools.timeline'] })`
before visiting `/accounts`, wait for the shell and `navigator.serviceWorker.ready`, stop tracing,
and inspect `ResourceSendRequest` URLs. The trace contained both root Wasm and nested worker Wasm
requests on different threads. The installed shell Cache Storage contained the two worker JS files
and root Wasm, but not the nested worker Wasm. No page errors occurred in this online-asset run.
The worker is bundled/self-contained JavaScript; its traced missing asset is the nested Wasm.

The generated service worker's `immutable/assets/prerendered` inputs list the worker JS but omit its
nested Wasm. Its fetch handler intercepts only those listed paths. A previous HTTP-cache hit or live
SharedWorker can therefore mask this gap. Full cold-runtime proof is still T014; this audit directly
establishes missing executable-asset coverage without claiming a completed cold offline scenario.

For scale, the first build's client output totaled 42,721,857 bytes; unique listed precache paths
whose files were present in the client directory totaled 23,308,110 bytes (excluding prerendered HTML
stored separately). These are emitted byte counts, not compressed transfer, installed quota usage,
or startup timing. Two identical 19.3 MB Wasm copies warrant later transfer/storage profiling; do
not silently double download/storage cost as an unmeasured optimization.

### Finding 2: dynamic detail documents have no offline shell route

Prerendered HTML covers `/`, `/accounts`, `/account`, `/expenses`, `/expenses/new`, `/income`,
`/income/new`, `/login`, settings pages, and `/transfers/new`. Dynamic `/expenses/[id]` and
`/income/[id]` documents are not in the precache set. The service worker returns immediately for
unlisted paths and has no navigation-shell mapping for those supported links.

Runtime reproduction in a fresh isolated Chromium context: visit `/accounts`, wait for service-worker
installation, reload so it controls the document, enable CDP `Network.setCacheDisabled`, then call
`context.setOffline(true)`. `/accounts` returned HTTP 200 from the service worker. A direct document
navigation to `/expenses/<valid UUID>?workspace=<valid UUID>` failed with
`net::ERR_INTERNET_DISCONNECTED`. No finance-record availability is needed to demonstrate the
missing document response; the UUIDs in this probe were synthetic. The result proves a shell-routing
gap, not access to any saved detail record. No complete cold-restart test was performed.

### Query identity and proposed fix boundaries

Current fetch matching and cache keys discard query strings. The traced shipped default runtime
uses hashed asset paths without a query-version override, so no incompatible-byte response was
observed in this configuration. The SDK requires `wasmVersion` for explicit asset overrides; retain
that URL/version identity in any future loader/cache design rather than assuming pathname-only
normalization is universally valid. Do not add runtime overrides as an incidental repair.

Recommended reviewed fixes: (1) include the emitted worker runtime chain using build-derived paths
and exact compatible bytes, checking duplicate download/storage behavior; (2) map only supported
same-origin GET document navigations for finance detail routes to their corresponding cached public
shell. Preserve workspace/query/hash processing in the client, public-only caching, current update
consent and no data/auth/sync caching. Do not use a generic shell fallback for APIs, worker scripts,
Wasm or arbitrary unknown paths. Then add T014 cold-runtime/direct-link coverage that closes every
client and defeats HTTP-cache masking while preserving app Cache Storage/IndexedDB.

Disposition: T013 audit complete with two reproduced gaps; fixes and T014 validation await a focused
statechart/build-integration/file-scope review. No production service-worker or loader changes made.

T013 fix A implementation evidence: a client-only post-order Vite manifest plugin now adds emitted
worker dependencies omitted by Vite. In the isolated production build, exactly the missing nested
19,342,148-byte Wasm gained a manifest entry, and SvelteKit included its URL in the generated precache.
Type checking and build passed; post-fix browser/cold-runtime evidence remains pending review. This
adds install coverage/cost rather than claiming a performance improvement. Detail routing is still
unfixed. See plan.md for the two-file implementation boundary and T024/T025 follow-through.

T024 post-fix runtime verification: four isolated production Playwright cases passed. New checks
confirmed every emitted Wasm URL exists in the installed shell cache and serves valid Wasm while
offline with HTTP cache disabled. A second case created a saved account, cleared HTTP cache, closed
its persistent browser context (exiting the browser/SharedWorker), relaunched the same profile with
network offline, and displayed the saved account. Existing public-cache-scope and update-consent
cases also passed. The build was configured for the known disposable local agent backend only, so
setup could create a new identity/workspace without cloud traffic. This establishes the tested cold
static-route/runtime path; dynamic detail-link offline routing still requires T025.

T025 post-fix evidence: the route-neutral shell passes cold offline saved-detail navigation for both
expense and income with HTTP cache removed and browser process restarted. URL/workspace/hash and
local field values are preserved; returned public HTML contains no finance payload. Non-navigation
fetches, POST documents, APIs and unsupported paths remain outside fallback. All 15 PWA cases were
verified (13 initially; two update cases after correcting fixture scope waits). This fixes the two
T013 gaps for the tested build/Chromium scenarios without claiming all-workspace preparation or
cross-build/browser compatibility. Implementation is committed as 5bb7225; test updates are separate.

### T014 distinct-build asset availability probe

An isolated Chromium context kept a controlled page open across two actual production builds at
the same preview origin. The second build changed only a hidden marker in the isolated checkout's
offline route, producing a different emitted module hash. No marker or probe code was added to the
application checkout. The old tab stayed open; the new worker installed, then received the existing
ACTIVATE_UPDATE message. HTTP cache was cleared through CDP and the context went offline before
requesting the first build's emitted node modules with cache: no-store.

Build versions were 1793298592153 and 1793298638128. The older node
`/_app/immutable/nodes/13.QgGuLqE3.js` failed to fetch; all 18 unchanged node URLs returned HTTP 200.
The new output instead contained `13.JXSaAu0R.js`. This establishes an old hashed-asset availability
gap across real builds, not a completed user-level transaction navigation or draft-loss test.
Cache names were sampled immediately after activation was requested, so the sample containing both
names does not establish completed retention: activation deletes older caches asynchronously.

Static implementation explains the gap: activation deletes every older shell cache and fetch
handling accepts only the current build's public paths. Keeping an old cache without extending
exact immutable-asset lookup would therefore be insufficient. A focused follow-up should preserve
assets needed by live older clients, serve only exact same-origin hashed immutable requests from
retained public caches, and reclaim obsolete generations when those clients no longer need them.
Preserve explicit update consent and drafts; never broaden this to data/auth/API caching or a generic
asset fallback. A fixed one-generation retention limit alone cannot cover a tab spanning multiple
deployments. Review version ownership and cleanup before implementing the follow-up.

Probe setup correction: Playwright waitForFunction with an async predicate was unsuitable for
observing the waiting worker here. The completed run used expect.poll around page.evaluate, matching
the existing PWA tests. Earlier attempts failed before activation and are not verification evidence.

T026 disposition: deferred by user after scope review. No cache-retention, client-version protocol
or new lookup machine will be implemented in this startup slice. The observed asset gap remains a
known limitation; no failed user-navigation or draft-loss claim was established by this probe.

### T009 cold restart with an open, unanswered remote transport

A bounded production-browser probe passed against Jazz 2.0.0-alpha.59 in isolated Chromium.
The production build used a disposable HTTP/WebSocket proxy at 127.0.0.1:6191 forwarding to the
known in-memory agent backend at 127.0.0.1:61119. Both warm and cold runs used this same configured
Jazz origin, preserving identity/registry scope. No cloud endpoint or user browser profile was used.

Reproduction sequence:

1. Build in the isolated checkout with PUBLIC_FAKE_DATA=false, PUBLIC_DEBUG=false,
   PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:6191 and the existing disposable agent app ID. Serve
   production output at 127.0.0.1:4183. Initially forward proxy HTTP and WebSocket traffic normally.
2. In a newly created persistent Chromium profile, install/control the public shell, create a cash
   account and an expense with amount 12.34, date 2026-03-10 and a recognizable description. Open
   the saved detail to prepare its local data; retain its exact workspace-scoped URL.
3. Clear only HTTP cache through CDP Network.clearBrowserCache, then close the persistent browser
   context, exiting its browser and SharedWorker. Preserve Cache Storage, localStorage and IndexedDB.
4. Change the proxy to accept incoming WebSocket upgrades with a valid HTTP 101 response and
   Sec-WebSocket-Accept header, then consume incoming bytes without sending application frames.
   Hold ordinary HTTP requests unanswered as well. The proxy does not contact the backend in this
   mode. This external fixture covers the SDK's SharedWorker transport without relying on page routes.
5. Relaunch the same profile with networking enabled, navigate to the original detail URL and
   assert its document is served by the service worker, amount is 12.34 and navigator.onLine is true.
   Change the amount to 42.13, explicitly save, assert Transaction saved, then reload and assert 42.13
   remains. Assert no pageerror events. Close the browser and delete only the probe's temporary profile.

All assertions passed. The silent proxy recorded two successful WebSocket upgrades and 2,314 bytes
received from the client across cold startup/reload; it sent no Jazz application frames. No ordinary
HTTP request reached its holding branch in this run. This establishes that available local detail
data and a locally persisted edit remain usable during an open but unanswered WebSocket connection,
including a fresh database runtime and reload, without relying on HTTP cache or browser offline mode.

Limits: the fixture withholds the Jazz server hello, so this is stalled protocol negotiation rather
than a fully negotiated Jazz session whose later query response stalls. The edit's remote acceptance
was not checked. This is a bounded diagnostic probe, not yet a checked-in automated regression test;
partial replicas, observed access changes, actual server rejection/recovery and a broader browser
matrix remain separate T009 work. No production code change was needed for this scenario.

Automated follow-up: `tests/startup-stalled-remote.e2e.ts` now reproduces this scenario without the
diagnostic's pre-existing backend or manual mode change. Playwright fixtures own a fresh in-memory
Jazz server initialized with the real schema and permissions, a silent proxy and a temporary profile.
The cold phase asserts successful upgrades and client bytes, navigator online, saved detail values,
local save confirmation and amount 42.13 after reload. Service-worker responses and no page errors
are also asserted. The dedicated production suite passed (one test); test TypeScript and formatting
checks passed. Its initial collection failure was a Node/Playwright #lib import-resolution issue,
corrected by an explicit test-only paths mapping before the successful run. No production workaround
or dependency change was introduced. This closes the diagnostic-only automation gap for this scenario;
the other limits above remain.

### T009 real serving-authority rejection after local success

The dedicated production suite now includes a second automated case with its own disposable backend
and profile. A backend-authenticated Node session uses the SDK's public jazz-tools/backend
createJazzSession API; no internal SDK import or browser database test hook is required. Its direct
backend connection remains independent of the browser's proxy.

The browser creates and opens an expense for 12.34. A remote authority read confirms amountMinor
1234 before disconnection, establishing actual acceptance of the baseline. The proxy then becomes
silent while the authority changes the sole workspace membership from owner to viewer with
accountAccessMode all and awaits global settlement. This deliberately retains read access while
removing server-side write permission; the disconnected browser still observes its cached owner role.

The browser edits the amount to 42.13 and receives Transaction saved before reconnecting. A separate
authority read still returns 1234. Restoring proxy forwarding reconnects the SDK, which emits an
actual mutation rejection to the existing application observer. The browser shows the rejection
notice, removes Save Transaction and disables the amount input as it observes the viewer role.
The authority still reports amountMinor 1234 and membership role viewer. Dismissing the notice works;
reload retains the same detail/workspace URL and shows 12.34 with write controls disabled.

Both production cases pass (silent cold restart and late rejection); test TypeScript and formatting
checks pass. The checked-in test setup uses only public SDK APIs. Local staging success is therefore
observably distinct from remote acceptance in this scenario, and the app remains readable after the
permission change. This does not establish durable unknown-outcome recovery, post-negotiation query
stall behavior, or every partial-replica/access-change case; T009/T012 retain those boundaries.

### T011 follow-up: simpler query topology and its remaining cost

Static inspection of alpha.59 Db.subscribe confirms its public callback is adapted from an
internal delta callback by passing update.all. The declarations mark subscribeDelta private;
preparation cannot assume a supported counts-only or incremental public subscription. Discarding
rows in the callback avoids retaining another app copy, but does not prevent full-result
materialization/delivery. Performance evidence is therefore needed before mounting global live
queries across the entire accessible history.

The schema's organization-scoped read predicates also mean separate per-workspace actors are not
intrinsically necessary: a fixed query per readable table is a simpler candidate. Files and attachment
links have relationship-based read predicates, so test their exact root queries as part of the
coverage experiment. The existing runtime metadata probe used an included file, not that full set.
Plan.md now records this candidate, its session-bound lifecycle and the pre-adoption experiments.
No coverage, durability or performance guarantee follows from this static simplification alone.

### T011 bounded experiment: authorization failure blocks preparation adoption

Environment: isolated checkout, agent dev server 127.0.0.1:5188, two fresh persistent Chromium
profiles, the owned in-memory Jazz backend/proxy fixtures from startup-stalled-remote.e2e.ts,
Jazz alpha.59 and real application schema/permissions. No production preparation code was added.
Queries ran under each browser's own local-first identity; only fixture creation used a separate
backend-authenticated Node session. No backend credential was passed to either browser.

The performance experiment stopped on an authorization assertion. A subsequent four-transaction
reproduction isolated the finding for both users, including a user who was not organization.ownerId.

Reproduction:

1. Initialize two independent identities in their own Accounts pages; never open the shared
   workspaces' finance pages. Using the backend fixture, create two additional organizations,
   each with two accounts, one category and two expenses, one expense per account.
2. Give each user viewer/all membership in the first organization. Give each viewer/selected
   membership plus a read grant for only the first account in the second organization. Keep the
   second account archived; archiving does not remove its authorization requirement.
3. Add file metadata, a four-byte part and an attachment link to a readable expense in the first
   organization. Add a second set to the ungranted account's expense in the second organization,
   using fileName denied.bin and synthetic bytes [5,6,7,8]. Await global acceptance of fixture writes.
4. For each browser, obtain its own db through the existing development session module. Request
   app.transactions and the denied transaction by ID at Remote. Request app.files and
   app.transactionAttachments at Remote, then app.fileParts.where({ fileId: deniedFileId }) at Remote.

Both identities produced the same result:

| Observation | Result |
| --- | --- |
| Readable transactions | 3 of 4, as expected |
| Denied transaction queried by ID | 0 rows, as expected |
| File metadata | Both probe.bin and denied.bin; denied metadata should be absent |
| Attachment links | Both links; denied link should be absent |
| Parts for denied file | 1 row containing [5,6,7,8]; should be absent |

This is an existing server-policy authorization gap, not merely an overbroad preparation result
or stale browser replica: the profiles were fresh and the denied transaction itself was correctly
filtered. Full table queries revealed it; the file part was then explicitly requested as part of
the synthetic diagnostic. Do not claim background metadata queries alone downloaded those bytes.

Static cause: transactionAttachments.allowRead currently uses
policy.transactions.exists.where({ id: attachment.transactionId }). Existence does not enforce the
referenced transaction's read policy. Files trust readable attachment links through
allowedTo.readReferencing; fileParts in turn trust file read access. Candidate focused correction:
transactionAttachments.allowRead.where(allowedTo.read('transaction')). This uses the existing
declared relation and supported read-policy composition already used elsewhere in permissions.ts;
it requires no schema, UI, lifecycle or readiness change. Do not mask it with a client-side filter.

Before testing that correction, review the one-predicate implementation. Then extend the existing
attachment permission tests with selected-account and unrelated-user negative reads for links,
files and parts, retaining positive readable-parent and unlinked-file coverage. Re-run the minimal
browser reproduction against the corrected server policy before resuming preparation measurements.
Do not interpret later revocation as proof of erasure of previously downloaded bytes.

Experiment setup notes: one early insert used id as a data column; corrected to the SDK's third
insert options argument. The larger seed attempt also hit the actual serving-authority error
"commit unit version count 9018 exceeds max 4096"; seeding per organization avoids that fixture
limit. Neither failed setup attempt establishes a read limit. No completed 10,000-record comparison,
heap/latency budget, whole-scope cold-persistence result or acquisition-policy recommendation was
produced. The narrow authorization reproduction failed at its intended denial assertion, with both
users' observed results recorded before the assertion. See T027; T011 remains incomplete.

T027 compatibility result: the proposed predicate was rejected during permission publication on
Jazz alpha.59 before any unit assertion executed. The error was: converted files read policy is
invalid, UnknownColumn { table: transactionAttachments, column: accountId }. This establishes that
this proposed composition does not work with the installed SDK/server; it does not establish that
every possible permission design is unsupported. Per user direction, the predicate and new tests
were reverted. No authorization repair shipped, and broad preparation remains paused. The browser
reproduction was not rerun against the rejected rule.

Follow-up isolation: `reproductions/attachment-read-inheritance.repro.ts` reduces the publication
failure to six tables and three policy variants on an identical schema. Existence-based links
publish. Parent-read links with reverse file inheritance also publish when the transaction grant
predicate correlates only accountId (plus current user). Adding the organizationId correlation
rejects the converted files read policy with UnknownColumn on links, naming organizationId or
accountId. The standalone run reproduced these outcomes and cleaned up its disposable servers.
It checks publication, not data filtering. Earlier exploratory selected-grant reads showed an
account-only explicit join can publish/filter a reduced fixture, but that expression does not
establish full organization and role semantics. Neither dropping organization checks nor adopting
that partial join is a supported repair. T027 remains open. See reproductions/README.md for the
command, recorded output and verification boundary.

T027 supported alternative: retain links' allowedTo.read('transaction'), but replace files' reverse
read inheritance with allOf(allowedTo.read('transaction'), matching attachment existence).
The matching attachment must have both fileId = file.id and transactionId = file.transactionId.
The existing files.transaction relation supplies the complete parent policy without copying role
or grant logic. No schema change or weakened organization predicate is needed. Unlinked files and
files referenced only through a different transaction remain unreadable. This deliberately enforces
the existing file-to-transaction association rather than allowing cross-transaction references to
confer file access. The full app permission suite passes all 73 cases, including new positive/negative
link, metadata and part reads for role modes, denied accounts, unrelated users, a wrong-organization
grant and a cross-transaction link. Existing replacement denial now occurs at local read enforcement;
its assertion checks that specific rejection. Five browser cases also pass: attachment upload/download/
removal, draft removal and preview reload, new image edits, saved offline replacement/reload, and
viewer download without edit access. Type checks report zero errors/warnings. This repair does not
establish cold query coverage.

### T015 initial production startup baseline

Production code at fdcf11b, isolated checkout and preview on 127.0.0.1:4185, headless Chromium,
no CPU/network throttling, disposable in-memory Jazz behind the owned proxy. Three independent
persistent browser profiles each supplied first-visit, warm-reload and cold-offline samples.
PUBLIC_FAKE_DATA and PUBLIC_DEBUG were false. Numeric samples are in startup-baseline.json.

| Scenario | Observed usable median (range), ms | Document response end median, ms | DOMContentLoaded median, ms | FCP median, ms |
| --- | --- | --- | --- | --- |
| First visit, empty workspace Accounts | 3747.6 (3325.4–4233.3) | 8.9 | 57.6 | 64 |
| Warm saved expense detail reload | 2507.2 (2458.4–2652.6) | 3.1 | 20.7 | 72 |
| Cold offline saved expense detail | 2780.8 (2231.8–2854.7) | 14.6 | 106.5 | 284 |

Method: first visit waits for the canonical workspace Accounts URL and enabled Add Account action.
Then create one cash account and a saved expense through the existing UI helper; open its detail.
Warm measurement reloads that detail, then waits for its saved description and enabled amount field.
Cold measurement clears HTTP cache, exits the persistent browser including SharedWorker, relaunches
the same profile offline and visits the same detail URL, applying the same saved-value/control checks.
Take Performance.now after those checks and a CDP metrics request. This includes automation/CDP
overhead; it is an observed upper bound, not a precise first-interactive event or pure rendering cost.
First-visit and returning cases have different data/targets and are not identical-workload comparisons.

Navigation, paint and page resource entries were captured without production instrumentation. In
sample one the page-visible Wasm response ended at 547.8 ms (first visit), 75.9 ms (warm) and 299.7 ms
(cold offline). Those are resource-response timings, not Wasm compilation or database-ready timings.
Worker-originated resources are not comprehensively represented by page ResourceTiming. CPU metrics
were enabled after readiness, so do not use them to attribute startup CPU. No development timing is
mixed into this production table. All nine usability observations passed.

Recommendation: instrument/profile the session-open, local database/query and readiness-to-form
boundaries next. The document/paint timings alone do not explain the seconds before usable local
controls. This evidence does not identify Wasm compilation, Jazz opening, query work or application
readiness as the dominant cause. Avoid choosing earlier downloads, application workers or numerical
budgets from this small dataset. Large histories, update activation, supported devices, controlled
network conditions, worker/CPU attribution and balance/render breakdown remain T015 work.

### T015 session and actor timing attribution

A second isolated production run used temporary performance marks at getOrCreateJazzSession's
request/resolution boundary and the existing XState inspectActor callback. Only static machine IDs
and finite state values were recorded; no contexts, financial values or credentials. The marks ran
without opening Stately or changing actor ownership. All instrumentation was removed afterward.
Three profiles supplied the same nine scenarios; raw state timings are in startup-profile.json.

Median session-open duration was 373.6 ms on first visit, 111.1 ms on warm detail reload and
167.3 ms on cold offline detail. This is the public session promise boundary, not proof that every
later database query or form dependency has settled. In sample one, warm session readiness occurred
at 159.8 ms, workspace membership readiness at 622.3 ms and transaction edit attachment at 686.3 ms;
observed usable time was 2371.7 ms. Cold equivalents were 356.9, 879.0, 943.8 and 2659.2 ms.
Initialization provenance settled later than membership in both cases, but the edit actor already
attached before provenance settlement, consistent with the earlier decoupling change.

A one-profile measurement check took timestamps before and after CDP collection. Returning-case
overhead was 3.9 ms warm and 3.8 ms cold (27 ms first visit); it does not explain the observed gap.
That run's pre-CDP usable readings were 1848.8 ms warm and 1996.7 ms cold, demonstrating material
run-to-run variation without an application optimization. Do not present it as a performance gain.

A final one-profile run added scoped-form/readiness state marks. It showed multiple availability
awaiting/current transitions after transaction edit attachment (594.5 ms warm, 929.9 ms cold), with
updates continuing near 1876.7/2195.4 ms before usable readings at 2314.6/2598.6 ms. Multiple scoped
form actors share machine IDs, so these marks do not identify a single actor as responsible. The
transitions themselves are brief; their repetition alone does not establish a bottleneck.

Next focus: correlate individual query delivery and browser CPU/render work between session-ready
and usable controls, including repeated observation/binding updates. These traces argue against
attributing the entire delay to the public Jazz session-open promise. They do not yet distinguish
database query cost, frame work, form dependency arrival and automation polling. No optimization,
permanent diagnostics, numerical budget or SDK workaround was introduced. All focused runs passed.

### T015 page CPU and direct form availability

One further production profile used the same three scenarios and small fixture. CDP Profiler
started before each measured navigation and stopped after the usability assertions. A temporary
requestAnimationFrame probe marked the first frame observing the known synthetic saved description
and an enabled amount input. Unlike the earlier automation-completion timestamps, that mark is
inside the page; it still measures DOM state, not first paint or actual input latency. Source
instrumentation was not required. Results are summarized in startup-cpu-profile.json.

| Scenario | Form DOM enabled, ms | Automation capture, ms | Sampled Wasm self time, ms | Sampled idle, ms |
| --- | --- | --- | --- | --- |
| First visit, empty Accounts | Not applicable | 2770.0 | 976.5 | 1169.1 |
| Warm saved detail | 2161.2 | 2648.0 | 947.4 | 1092.4 |
| Cold offline saved detail | 2188.9 | 2642.1 | 936.7 | 1093.7 |

The earlier automated readings overstate DOM availability by about 450–490 ms in these returning
samples. They remain upper bounds; do not combine their medians with this single direct observation
as if every run had the same delay. The form probe condition does not apply to the empty Accounts
page. The CPU run passed all three scenario assertions.

Page-target CPU samples include substantial execution in jazz_wasm_bg. Allocation/deallocation
alone accounts for roughly 280 ms of returning sampled self time; other visible functions include
maintained-view/query evaluation, query graph compilation, projection planning and record/string
operations. This is execution evidence, not a measurement of Wasm download or compilation time.
Approximately 0.94 s of sampled Wasm work in each returning profile makes query/runtime cost a useful
next target. It does not prove which app query causes it, that subscriptions are duplicated, or that
all allocation time belongs to query setup. Idle samples may include waits and test-driver gaps.

Worker CPU was not profiled. The Performance counters accidentally read from a newly attached
post-start session were near zero and are excluded from conclusions; the CPU sampling session was
started before navigation. Profiling and frame probes have overhead, and one small-data profile
cannot set a budget or establish total process CPU. Next: count/correlate query acquisition and
updates through supported app integration boundaries, then test whether consolidating genuinely
duplicate work reduces this measured cost. Do not patch SDK internals or change permission rules
as a performance workaround. Temporary profiling code was removed; no optimization was shipped.

## Consolidated open-item investigation

The user subsequently authorized all remaining investigation/testing without per-slice review
pauses. Current decisions and remaining feature work are in
[investigation-results.md](investigation-results.md); that report supersedes earlier provisional
status wording. New evidence is stored in browser-capabilities.json, worker-benchmark.json,
runtime-cache-inventory.json, query-setup-profile.json, core-preparation-probe.json and
cross-browser-cold.json. Historical measurements above remain tied to their stated environments.

The negotiated-stall regression pauses both directions of an already established proxy connection
after authoritative acceptance of a baseline record. A local edit completes while the authority
still has the old value; reconnect then accepts the new value. It passed alongside real rejection,
cold restarts and cache/update checks in the 18-case Chromium production run. The existing ten
offline role/grant scenarios also passed. Firefox/WebKit core workflows supplied ten distinct
passing cases; the Firefox cached-body protocol issue required the documented test-only adjustment.
Two extra cold-runtime cases passed with the HTTP-cache limits recorded in the report.

The large-history cold-query investigation **did not pass**. Warming the readable records and
authorization facts did not establish coverage after browser exit with a silent remote; explicit
LocalFirst still returned NotObserved. The online permitted counts and acquisition timings are
recorded, but no all-workspace offline-preparation or byte-retention guarantee follows. The separate
Firefox minimal routing fixture also failed to establish control; its fallback result is inconclusive
and is not classified as an application failure. Actual Firefox app offline/update workflows passed.

Primary API evidence: [WebAssembly serialization](https://webassembly.github.io/spec/web-api/) rejects
module serialization for storage; [Service Worker routing](https://www.w3.org/TR/service-workers/)
defines cache routing; [navigation-preload guidance](https://developer.chrome.com/docs/workbox/modules/workbox-navigation-preload)
recommends against enabling it for precached HTML. Local browser probes and installed alpha.59 source
were used to check applicability. No unsupported SDK override, provider fetch, permission workaround,
worker migration or cache-retention implementation was added.

Final consolidated checks: `pnpm check` passed in the restored isolated checkout with zero Svelte
errors/warnings and service-worker TypeScript success. `tsc --project tests/tsconfig.json --noEmit`
passed. Targeted test/artifact formatting and git diff whitespace checks passed. The seven unit
suites passed 205 tests; 40 distinct browser workflow cases were verified across the production,
offline-role, cross-browser and extra cold-runtime runs, with the stated Firefox rerun and WebKit
cache limitation. The failing broad-preparation diagnostic remains explicitly unresolved rather
than included in the passing workflow count. Temporary adapters/marks/configs and owned test servers
were cleaned up. Changes are uncommitted; no deployment occurred.


### T011 controlled cold-query follow-up after T027 (transport control superseded)

Evidence: cold-query-follow-up.json. Installed alpha.59, b39d9fa permissions, isolated agent server
127.0.0.1:5192, headless Chromium and synthetic fixtures. Two real browser identities replaced the
backend-seeded fixture for this probe: writer creates a separate workspace, two accounts, historical
transactions and viewer/selected membership for the reader with a grant to one account. The readable
account is then archived. Reader never opens that workspace's finance pages. Remote whole-table
queries acquire authorization facts, transactions with audit fields, plain transactions, accounts
and categories. Both reader clients and its SharedWorker exit before cold launch; identity equality
is asserted. HTTP module fetching stays available while Jazz WebSockets are intercepted without
forwarding, separating this data test from already-tested production executable caching.

Small controls separately close the remote socket, leave it open without responding, and add the
old probe's explicit db.disconnect call. Each returns the one permitted row for all four LocalFirst
query shapes: exact audit projection, exact plain root, workspace subset and ID subset. A separate
10,000-transaction fixture (5,000 permitted) also succeeds after restart with the unanswered remote:
exact audit root 5,000 / 1,917.5 ms; plain root 5,000 / 1,160.1 ms; workspace subset 5,000 / 1,300.9 ms;
ID subset one row / 467.7 ms. Queries run sequentially, so these are not independent startup timings.
Bulk fixture setup took about 2.9 minutes through the ordinary writer browser; that includes staging
and globally settling synthetic writes and must not be reported as reader acquisition latency.

A separate two-transaction metadata fixture creates a four-byte file and attachment for each account.
The reader's online files and attachment root queries each return exactly the permitted reference.
After cold restart with an unanswered remote, those same roots retain exactly that file/link; denied
references remain absent. An unwarmed fileParts query returns zero rows/bytes locally. A subsequent
online browser explicitly requests those parts at Remote and receives [1,2,3,4]. Local empty content
therefore does not establish remote absence or physical byte erasure. No fileParts query is included
in metadata warming, and no provider fetch occurs.

The earlier NotObserved result is not reproduced here. Query-shape changes, silent transport,
explicit disconnect and 10,000-row history alone do not explain it; do not replace the historical
failure with a claim that its cause is fixed. These controlled successes support investigating the
fixed permission-filtered dataset candidate with the installed SDK. They do not yet verify every
relationship/detail include, multiple shared-workspace scales, permission changes during acquisition,
page/worker memory, storage/quota, subscription costs or user-visible preparation progress. Keep
T011 open and production preparation disabled until a reviewed acquisition policy has that evidence.

Setup corrections: the first new fixture tried inserting an already-archived account, which the real
insert policy correctly rejected. The corrected fixture creates it active, stages history, then
archives it. An initial cold probe asserted an Accounts workspace URL and instead reached workspace
settings; it did not reach query measurement. Subsequent probes wait for the local client and
classify data reads independently of routing. No finance UI navigation guarantee follows from them.

### T011 retained subscription cost and public ID projection (initial candidate)

Evidence: preparation-cost-follow-up.json. Paired headless Chromium measurements use the installed
alpha.59 and b39d9fa permissions on the known isolated agent server at 127.0.0.1:5192. Separate writer
and viewer identities share two never-opened finance workspaces; each viewer has a selected grant to
one of two accounts. Histories contain 1,000/10,000 transactions, of which 500/5,000 are readable.
Initial whole-table acquisition is Remote, with authorization facts acquired first. No app collection
copy is retained. After acquisition, one remote edit globally settles without a retained whole-table
app subscription; after one second the reader disconnects and checks its local snapshot. It still
contains the original amount 1234 rather than accepted 2345 at both sizes. This bounded observation
is not proof that an arbitrarily longer wait could never receive an update. After reconnection and
resynchronization, a retained LocalFirst subscription receives accepted 3456. Ordinary-edit callbacks
still deliver the entire permitted result array, even though app code keeps only counts and one
inspected scalar. No private subscribeDelta, worker, runtime option or server change is used.

| Projection / readable rows | Acquisition ms | Added live page heap | Edit callback rows | Max edit-window frame gap ms |
| -------------------------- | -------------- | -------------------- | ------------------ | ---------------------------- |
| Full plus audit / 500      | 1,129.3        | 2.12 MiB             | 500                | 16.8                         |
| Full plus audit / 5,000    | 6,871.5        | 21.00 MiB            | 5,000              | 33.4                         |
| ID only / 5,000            | 7,106.1        | 10.30 MiB            | 5,000 IDs          | 16.8                         |

Heap is page Runtime.getHeapUsage after forced GC; the added heap is relative to the post-acquisition
baseline. After release, page heap returns within 0.08/0.13/0.17 MiB of those baselines respectively.
Jazz SharedWorker/Wasm memory and physical storage are excluded. These are live-heap measurements,
not peak allocations. Frame/long-task windows exclude forced GC; no long task was reported in these
samples. Fixtures and initialization are not included in acquisition ms. ID-only's edit-observation
upper bound was 1,782 ms versus 706 ms for full rows at 5,000; that includes authority acceptance,
transport and polling. The single samples do not establish faster acquisition or update delivery.
ID projection reduces measured page retention by roughly half, but still materializes full ID arrays
on ordinary edits and does not establish a device/storage budget or unbounded-history scalability.

The public alternative is query.select('id'), not a counts-only private subscription. Its replication
semantics were checked independently: a fresh reader queries/subscribes only transaction IDs in a
selected-account shared workspace. The writer edits amount/description on an existing transaction
and creates a second permitted transaction. The subscriber sees counts [1,1,2]. After release and
complete reader/browser/SharedWorker exit, a cold reader with an unanswered remote reads both full
records through audit/plain/workspace queries and the existing record by ID. Expected amounts,
descriptions, currency/date and nonempty audit authors/valid audit timestamps are present. No full
transaction query warmed those records first. At 5,000 readable rows, the ID-cost case also reads
all full records and accepted amount 3456 after disconnect. These verify the tested record fields;
do not extrapolate them to every schema/query shape without coverage.

A separate ID-only files/attachment-root acquisition retains the permitted file's filename, MIME,
size and matching link fields across cold restart; the denied account's references remain absent.
File-part query returns zero local rows/bytes, then explicit online content acquisition returns the
synthetic [1,2,3,4]. Transactions in that metadata fixture were warmed separately; it specifically
establishes ID projection for file/link metadata, not every relationship's cold coverage.

Selected candidate for the next implementation review: retain permission-filtered ID-only dataset
queries, release them with their session binding, keep counts/status facts rather than row arrays,
and keep background acquisition independent of readiness. Prefer this over full-row global results
for the tested page-retention cost. One-shot acquisition can seed a snapshot but must not be described
as continuous remote preparation. A local callback/count does not establish remotely complete data;
that status requires separately defined evidence. Preserve file contents on demand. The previously
proposed session/dataset statechart remains the ownership model; no production preparation owner is
implemented by this investigation. Other relationship shapes, permission changes, worker/storage
costs and progress semantics remain open. Five final projection/audit/metadata/content browser phases
and three cost fixtures pass; no broader application suite was rerun for these diagnostic-only edits.

### T011 remaining investigation — final disposition

Evidence: remaining-investigation-results.json, plus the final paging-boundary results below.
All application schemas and permissions in the isolated checkout were compared with b39d9fa's main
checkout sources. No production preparation code was enabled. The backend fixture bundles the actual
schema/permissions with Vite to resolve repository #lib TypeScript imports in Node; the SDK package
is external and unchanged. A disposable backend, public frontend serverUrl adapter and real proxy
isolated the tests. No provider operation, credential unlock or user storage reset was performed.

**Transport correction.** Page-level routeWebSocket mocking did not reliably control the SharedWorker:
a supposed silent partial-replica probe received a remote result. The preceding cold-query-follow-up
control/timing claims are therefore provisional, not proof of an unanswered transport. They are now
superseded by a real HTTP/WebSocket proxy which accepts upgrades and holds every Jazz application
frame and HTTP request. Every qualified cold case exits all reader browser clients/SharedWorkers and
asserts proxy upgrades and client bytes after restart. The original NotObserved observation remains
historical and unexplained; no SDK defect is claimed fixed by these probes.

**Replication/authorization primitive.** Remote-tier subscriptions with ID projections qualify for
background server-facing acquisition on alpha.59. Foreground reads/writes remain LocalFirst/local;
background acquisition must not participate in readiness. The tested fixed set is the 17 planned
metadata/data tables plus full current-user membership/grant queries. It excludes fileParts, uploads,
retired checkDetails and provider calls. A callback describes an observed SDK snapshot, not globally
fresh/complete finance data. Public subscribe still returns full result arrays; there is no private
counts-only API dependency.

The LocalFirst global-ID candidate failed live authorization qualification: grant removal reached the
fact stream while a transaction result stayed at six rows versus five in a new Remote read. Linked
transfer visibility also remained stale. Immediate LocalFirst rebind, full root fact subscriptions,
and user-scoped facts/checkpoints alone did not qualify that model. Adding an organization-scoped
transaction query corrected that transaction view but not the global transfer view. Scoped queries
and declared traversal (transactions -> attachments -> file) handled grant changes; a cached global
LocalFirst organization list could still linger after membership removal. Do not treat cached
organization metadata or ID presence as current authorization. No client-side filtering was used to
hide a server-policy overread, and no unsupported SDK rule was adopted.

The simpler Remote-only global design passed the full live-access scenario in Chromium, Firefox and
WebKit: account/transfer endpoint grant revocation, regrant, membership removal, a profile shared only
through the removed workspace, admin-only metadata admission/downgrade, duplicate file references,
last-link removal/restoration and unsubscribe cleanup. Remote subscriptions avoid the failed global
LocalFirst view in this background-only role. Server permission rules remain b39d9fa's rules.

**Cold/relationship coverage.** Fifteen final cross-browser phases acquired data using subscriptions
only, without a one-shot finance query. Both an edited and newly inserted transaction retained their
full fields/audit metadata after cold restart with the unanswered real proxy; an additionally inserted
and deleted transaction did not reappear. File/link ID subscriptions retained full permitted metadata
without parts. Explicit later online content acquisition returned the four-byte fixture. A separate
large subscription-only Chromium case retained 5,006 permitted of 10,008 seeded transactions (including
relationship fixtures) across cold restart; its scoped query returned 5,003. Metadata-only detail
includes resolved account/category/tag/check/batch/attachment data, archived references, both transfer
endpoints and an offset subset. Denied account metadata was absent; the content query stayed empty
until requested. Executable modules remained available from the dev server: these are data tests,
not additional production-shell/offline-code guarantees.

**Lifecycle and partial data.** On a fresh partial replica with six authorized remote records, a
local callback could be empty; a real unanswered Remote acquisition remained pending. The exact
Remote-only subscription set produced no premature finance callback, released cleanly, and sent no
late reports after transport resumed. An invalid UUID query reported a terminal error while a valid
sibling continued. SDK identity replacement after old lease release denied the old scopes and emitted
no old callbacks. These SDK-level checks do not implement the future owner's lifecycle unit tests or
extend existing application drain guarantees to arbitrary external identity calls.

**Memory/storage.** At 5,006 readable rows, the Remote ID query's post-GC page heap rose from
29,308,308 to 40,105,440 bytes and returned to 29,467,584 after release. The observed SharedWorker
broker's JS heap changed from 5,983,748 to 6,019,312 bytes; its reported backing storage stayed around
4.34 MB. Page backing storage stayed around 17.01 MB. These are per-target metrics, not total process
or complete Wasm resident memory; do not sum them into a physical budget. The origin estimate was
3,263,192 bytes (2,912,256 IndexedDB bytes). Persisted storage was false and persist() was ungranted in
this headless profile. Deleting only the disposable active Jazz namespace retained identity, left zero
local finance rows and did not create another owned workspace while remote discovery was unanswered
(one owned workspace before/after). This is not whole-origin/OS-eviction recovery certification.
The quota experiment was inconclusive: Chrome reported an approximately 605 KB override but accepted
three local one-MiB writes and reported about 3.92 MB usage. No QuotaExceededError occurred, so no
actual quota-failure/recovery behavior is claimed verified. No SDK storage shim was introduced.

**Initial acquisition changes the decision.** Steady-state memory/edit measurements alone were
insufficient. An initial 5,006-row global sweep caused a 3,027 ms main-thread long task (3,016.6 ms
frame gap); the form opened in 294 ms before that burst. A matched single-query control still caused
2,887 ms, so this is not explained solely by registering 19 subscriptions together. Do not enable an
unbounded automatic startup sweep. No new app worker or SDK override is proposed to disguise it.

Public ordered offset/limit pages are a supported bounded alternative. The experiment statechart
explicitly acquired one retained Remote page, classified it, yielded an animation frame and acquired
the next page, with success/failure/cancellation and fixture-owned lease cleanup. Twenty-six pages
(25 x 200 plus six rows) retained all 5,006 full records cold. Worst frame gap fell to 116.7 ms, but
25 long tasks remained (about 114–131 ms) and acquisition took 111.1 seconds. Eleven 50-row pages
(506 permitted records) with the metadata subscriptions had an 83.3 ms maximum gap, two 50/51 ms long
tasks and a 55.9-second acquisition; cold full fields remained available. These are single desktop
samples, not budgets, and neither result makes unconditional bulk startup work acceptable.

A retained-page boundary scenario also passed: initial counts [2,2,2,0], edits outside the projection,
inserts sorted before existing rows, a full tail signalling another page, manual next-page acquisition,
delete rebalancing, grant revocation and regrant. The future owner must keep a tail observation and
expand/trim its page set, handle partial/error/cancellation states, and avoid claiming completeness
from independently timed page counts. No production paging implementation was added.

**Next implementation review.** Keep T011 runtime adoption open. The tested acquisition primitive is
Remote ID subscriptions, but a budgeted/yielding history protocol is required before mounting it.
Retain the session-generation owner, per-dataset failure isolation, public cleanup and no readiness
gate; show the paging/growth/scheduling statechart before effects. Review startup and foreground
responsiveness with the real integration rather than assuming a nonblocking actor means no CPU
contention. Physical-device budgets and real quota pressure remain external validation. T010's
provenance constraint, T012's data-only durable journal and the user-deferred T026 are unchanged.

### Dedicated-worker preparation compatibility — concrete result

**Decision:** Do not implement worker-hosted broad preparation on `jazz-tools@2.0.0-alpha.59`.
The worker does remove the measured page blocking, but its client does not prepare the app's
persistent replica. This is a tested compatibility boundary, not a request to change Jazz or wait
for a future release. No production worker, SDK patch, startup sweep, or credential protocol was added.

The experiment used the isolated checkout with its own dependencies, the current application
schema/permissions, disposable local-first identities, an in-memory backend, and the real
forwarding/silent HTTP-WebSocket proxy. Public `createAccountManager`, `exportLocalFirstSecret`,
`restoreLocalFirst`, `createDb`, Remote subscriptions, LocalFirst reads, and `shutdown` supplied the
entire client path. A volatile public `AccountStore` let the worker restore the disposable identity;
its signing root was transferred only to the same-origin diagnostic worker and never logged.
No persisted account-selection parsing, private runtime source, inspector port, or `window` shim
was used. The page and worker had the same account, app ID, environment, and logical database name.

The resource-owning diagnostic machine starts with account-manager creation, then guarded identity
selection (restore, retain, or explicit fixture creation), database opening, idle/observing, draining,
and stopped/failed outcomes. Observing owns the subscription callback and its unsubscribe cleanup;
manager creation, database opening, and shutdown are separate leaf actors. The actor/helpers were
inspected for hidden orchestration. This bounded experiment does not implement production session
replacement or claim cancellation-during-open behavior.

Fourteen distinct diagnostic cases qualified: three worker bootstrap checks, nine acquisition/live/
cold cases across Chromium, Firefox, and WebKit, and two large Chromium acquisition comparisons.
The worker's default account store throws `createAccountManager requires an AccountStore outside
the browser`; a public custom store resolves that initialization requirement. Both worker driver
settings then acquired three permitted transactions, excluded the fourth ungranted transaction,
received field changes, removed results on grant deletion, and restored them through a public grant
restore. No late callbacks appeared in the observed 200 ms after graceful release. All reader
clients/workers exited before cold reopening the same profile and original identity. The proxy
accepted a fresh WebSocket upgrade and received client bytes while sending no Jazz application
frames or HTTP responses.

| Acquisition location | Configured driver | Online permitted rows | Cold page rows in each of the three engines           |
| -------------------- | ----------------- | --------------------- | ----------------------------------------------------- |
| Dedicated worker     | persistent        | 3                     | **0**                                                 |
| Dedicated worker     | memory            | 3                     | **0**                                                 |
| Page control         | persistent        | 3                     | **3**, including updated amount and full fields/audit |

The store adapter is not the finance-persistence boundary: the cold page retained its original
identity in every case. Installed SDK source explains the difference. `runtime/db.js` selects its
persistent browser connection only when both `window` and `Worker` exist. A dedicated worker lacks
`window`, so public `createDb` selects the direct connection even with a persistent driver.
`runtime/default-runtime-source.js` uses the same browser test for broker/foreground leases.
All three worker realms also reported `SharedWorker` unavailable, although IndexedDB and Web Locks
were present. The availability of those browser storage primitives does not attach this Jazz client
to the durable broker. Framework/session wrappers ultimately use the same factory.

Public runtime asset overrides choose Wasm/broker asset inputs; they do not expose a preparation
attachment transport. `browserWorkerPort`/session fields and `Db.createWithBrowserWorker` are marked
internal. They were not used as application APIs. The official [client setup](https://jazz.tools/docs/getting-started/client-setup)
and [browser architecture](https://jazz.tools/docs/reference/internals) provide configuration and
SharedWorker background; the installed alpha.59 code and browser results establish this version's
worker limitation. A worker that asks the page to execute subscriptions would retain the page's query
work. No supported replica-import path was established that could copy acquired records back while
preserving Jazz identity, audit, permission, and replication semantics.

The matched large samples used the same 17 table-ID roots plus two full current-user authorization
subscriptions and 5,000 permitted transactions. They sent IDs, not full financial result arrays,
back to the page. A minimal diagnostic input supplied a UI interaction, while rAF/PerformanceObserver
measured the page directly:

| Acquisition location | Observed acquisition, ms | Maximum page frame gap, ms | Maximum page long task, ms |
| -------------------- | ------------------------ | -------------------------- | -------------------------- |
| Dedicated worker     | 7,342                    | 16.8                       | None observed              |
| Page control         | 10,754                   | 2,683.2                    | 2,698                      |

These are single desktop development-runtime samples, not production startup gains or device
budgets. They show that moving the query runtime off the UI thread helps responsiveness; they do
not fix the missing persistent-replica integration. Keep broad preparation disabled. Budgeted
page-side preparation remains a possible separately reviewed offline-availability feature, rather
than a startup speed optimization.

Focused diagnostic TypeScript passed. Early harness issues were corrected before the qualified
cases: a root state target, an accidentally spread raw-secret property rejected by the public Db
factory, Vite root-HTML routing (the final page is a verified HTTP-200 static asset), an evaluate
argument, and grant reinsertion (the final fixture uses public `restore`). None was reclassified as
an app bug or hidden by an SDK patch. Results and limits are recorded in
[worker-preparation-results.json](worker-preparation-results.json); diagnostic sources and raw
artifacts remain in the isolated `/private/tmp/delightful-finances-startup-assets` checkout and
`/private/tmp/spec013-worker-results` respectively. No user server/storage was touched.

### T028 subscription ownership audit — first implementation review

Audit the application before adding a shared subscription layer. The installed alpha.59 Svelte
`QuerySubscription`/`QuerySubscriptionOne` already share one SDK cache entry for matching query
and option keys within the same client. Each component's effect releases its own listener on rerun
or destruction. The SDK retains the underlying unused entry for 30 seconds, cancels cleanup when
another consumer arrives, and does not renew an unused deadline merely because a delta arrives.
Multiple component declarations are therefore not proof of duplicate native subscriptions or a leak.
`TransactionForm.svelte` is presentation and has no Jazz subscriptions; its integration callers are
`TransactionEntry.svelte` and `TransactionEditEntry.svelte`.

Static ownership inventory for the measured Accounts/saved-expense routes:

| Owner                                | Queries/lifetime                                                                                                                                                                | Audit implication                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceBootstrap.svelte`          | Organizations, active ordered accounts, balance transactions, current membership, own bank connections, bank account links; session/root lifetime with reactive workspace scope | Existing shared shell sources; current balances and bank readiness remain live requirements                                                   |
| `AccountCreation.svelte`             | Current membership, selected workspace, active **unordered** accounts; mounted integration lifetime even when dialog is closed                                                  | Membership already shares. Unordered accounts create an avoidable distinct key from shell's ordered active accounts                           |
| `src/routes/accounts/+page.svelte`   | Ordered active accounts, current membership/grants, scoped members/all grants, balance transactions; route lifetime                                                             | Matching shell queries already share. All-member/all-grant queries support account access administration and differ from current-user queries |
| `TransactionEditEntry.svelte`        | Detailed record/audit/attachments, membership/grants, active ordered options, tags/categories, transfer state, author profiles; detail integration lifetime                     | Includes and selected-author changes are meaningful query changes. Transfer candidate queries already have conditional gates                  |
| `TransactionView.svelte`             | Kind/date-ordered transactions, historical accounts/categories/tags, tag links; list integration lifetime                                                                       | Archive filters and ordering differ intentionally from edit-option queries; do not merge by superficial row similarity                        |
| `+layout.svelte` / `forms.svelte.ts` | Session/workspace keyed subtree and form observation/drain ownership                                                                                                            | Preserve session-generation remounts, meaningful scope replacement and graceful write cleanup; no new owner proposed                          |

Two isolated production-mode Chromium runs used the unchanged app query code, separate disposable
profiles/backends, one cash account and one saved expense. Timing-phase diagnostics were disabled.
The build still included temporary diagnostic code, so these are comparable-harness starting
samples, not exact deployed-bundle measurements or a speedup over historical runs.

| Automation-completion upper bound, ms                      | Run 1 | Run 2 |
| ---------------------------------------------------------- | ----- | ----- |
| First visit, Accounts usable                               | 1,695 | 2,952 |
| Warm saved detail reload                                   | 1,853 | 1,987 |
| Cold saved detail, Jazz connection opens but never answers | 1,118 | 1,414 |

Cold means HTTP cache cleared, every reader browser/worker closed, same profile/identity reopened,
and real proxy forwarding no Jazz responses. Each run observed a new upgrade and 1,149 client bytes.
App assets remained available; this adds data/startup evidence, not a new full offline-asset guarantee.
The scenarios differ in cache/data/target and cannot be compared to each other as identical workloads.
No device budget or latency improvement follows from two samples.

The separate count phase used the SDK's installed **internal developer introspection**, enabled
through `devMode`, plus its built-in subscription debug output. These were read-only lab diagnostics,
not a new public application API/dependency, replica bridge, or SDK patch. Result payloads were
discarded; artifacts retain topology/event counts with synthetic UUIDs replaced by fixture labels.
Counts refer to SDK subscription registrations, not every Svelte listener or internal Wasm DAG node.

Observed results (both topology runs agree; second run also captures delta events):

- Accounts had **11 distinct active subscriptions**, with no duplicate exact native query/tier/branch
  signatures. Opening and closing Add Account kept the count and cumulative acquisitions at 11.
- Two active-account queries had identical workspace/archive predicates but differed in name
  ordering. The closed creation dialog acquires the unordered variant; shell and Accounts route
  share the ordered variant. This is a confirmed structural consolidation candidate.
- Saved detail reached 21 active entries immediately after client-side navigation. That includes
  cached entries from the prior route, not 21 independently required permanent detail subscriptions.
- Typing and restoring an unsaved description caused **zero additional native acquisitions**.
  A separate remote memo edit produced three observed SDK delta events, so stable subscriptions
  still delivered data changes. Changed editor attribution legitimately acquired an author query.
- After client-side workspace replacement, the old scoped entries disappeared within the observed
  SDK cleanup window, returning to **11 active entries** in the second workspace. The final sample
  was about 30.3 seconds after the first settled-scope sample. Count-phase totals were 32 subscribe,
  49 delta and 21 destroy events; no exact native signature was duplicated in sampled snapshots.
  This is expected SDK retention, not evidence that old component listeners remained attached.

**First focused change for review (T030):** add `.orderBy('name')` to the existing active-account
query in `AccountCreation.svelte`. That matches `WorkspaceBootstrap.svelte` and other active-account
consumers, allowing existing Jazz sharing to remove one distinct subscription (expected Accounts
count 11 to 10; not yet implemented or measured). The creation policy uses an order-independent
`.some` duplicate-name check; default currency comes from the workspace, so no new workflow, helper,
registry, context or authorization sharing is necessary. This reduces query-key divergence; a user
startup improvement still requires before/after measurement.

No T029 rebinding fix or T032 lifecycle rewrite is justified by these samples. T031 remains a
separate design question: the closed dialog's queries participate in readiness and `canOpen`.
Simply making all queries depend on dialog-open state can leave the trigger disabled, and removing
children on close can interfere with draft/write ownership. Do not turn this audit into that refactor.

Affected coverage for the first change: account creation/access unit cases, the account create/reset/
selected-workspace/live-account cases in `tests/workspace.e2e.ts`, creation while ordering in
`tests/account-order.e2e.ts`, and local creation with stalled transport. Inspect those fixtures and
assertions after implementation review and run only relevant cases. Then repeat the same native
count/usable-time harness; count reduction alone is not a speedup. The diagnostic TypeScript and
both production-mode probes passed. No production code or tests were changed; temporary diagnostic hooks
were removed from the isolated app session/layout. Results are in
[subscription-audit-results.json](subscription-audit-results.json). T015's larger datasets, physical
devices and further CPU attribution remain open; not every route or identity-replacement path was
exercised dynamically here.

### T030 query alignment — verified result

After review, `AccountCreation.svelte` now adds `.orderBy('name')` to its existing active-account
query. It matches the shell/Accounts/entry query key without adding helpers, actors, ownership
layers or read-tier changes. Account duplicate-name checks remain order independent. No production
async workflow or actor/helper orchestration changed; the machine-first gate requires no new machine
for this declarative alignment.

The same isolated production-mode audit verified Accounts at **10 active SDK subscriptions instead
of 11**, both with the account dialog closed and open, and again in a second workspace after old
cache entries expired. The saved-detail client-navigation snapshot fell from 21 to 20. Typing caused
zero extra acquisitions; the remote memo edit still produced three observed delta events. Exact
native signatures remained unique. The SDK cleanup policy and application binding lifetimes are
unchanged; no private diagnostic API is used by the production implementation.

One post-change automation-completion sample was 1,716 ms first visit, 1,818 ms warm detail and
1,342 ms cold detail with an unanswered remote. Compare the two baseline samples above using the
same harness and their limits. This confirms a structural reduction in query registrations, **not
a measured startup speedup**, device budget or CPU improvement.

Validation completed in the isolated checkout:

- Two account-creation/access unit suites: **28 passed**, including normalized duplicate-name policy.
- Production audit/startup workflows: **four passed**, covering the count comparison, live updates,
  workspace cleanup, genuine cold browser/SharedWorker exit with real unanswered wire, an established
  connection stall/later acceptance, and real rejection after a locally successful stale-access save.
- The existing cold-start test now also navigates to Accounts, creates an account while Jazz replies
  remain withheld, and verifies the new account after reload. This is durable-local behavior coverage,
  not an assertion about a query builder's spelling.
- Focused agent account workflows: **five distinct cases passed** for creation/reload, whitespace
  validation and corrected cash/bank/card submissions, draft/scope reset, live sorting/archiving and
  workspace selection, and creation while ordering with storage fallback.
- Application checking: zero errors/warnings, including service-worker types. Focused browser-test
  TypeScript, formatting and whitespace checks passed.

An initial test expectation change was wrong: `FormFeedback.svelte` intentionally renders the full
`invalidMessages` guidance list for invalid submissions, rather than filtering it to Zod issue paths.
After inspecting that presentation path, the original whitespace expectation was restored and the
single affected case passed on its focused rerun. `tests/workspace.e2e.ts` has no net change. No
product validation behavior was changed to satisfy the test. Production Node tests used the isolated
compiled copy of the unchanged schema/permissions for the known alias-loader boundary; the browser
received no backend credential and the SDK was not patched.

The code and extended cold regression remain uncommitted. Temporary session/layout diagnostic
hooks were removed from the isolated app, and the owned servers were stopped. The before/after
counts, timings and validation are in `subscription-audit-results.json`. T033 is complete for this
slice; later T029/T031/T032 work needs its own confirmed candidate and review.

### T031 dialog-only query scope — implementation review

The Accounts page's workspace-wide `organizationMembers` and `accountMemberships` subscriptions
feed only the Manage Account permission controls and grant-writer observations. They do not supply
the visible ledger, balances, account archive eligibility, Add Account, or shell readiness. T030's
closed-dialog snapshot includes both broad keys; those are the concrete deferred candidates.
The separate current-user membership/grant queries stay live for ordinary actions.

The implementation gates these two existing public Svelte query getters on AccountList's native
dialog visibility. AccountList keeps its simple disclosure state and reports visibility to the page;
close, selected-account removal and component destruction withdraw consumer demand. Jazz still owns
its normal subscription cleanup/cache window. There is no new actor, global cache, manual runtime
bridge, or promise workflow. Existing grant-write decisions stay in `account-delete-grants.ts`:
idle -> assessing -> operating.writing -> succeeded/failed/denied, with operating.closing -> closed
for owner shutdown. Dialog close does not shut down that machine. The writer's already-decided
GrantWrite input survives query-listener release; later commands still refresh scoped observations
and pass existing loading/error/authorization guards. Actors/helpers were inspected recursively;
no new hidden orchestration or lifecycle context flags were introduced.

Only the permission fieldset now uses existing QueryContent loading/error presentation. Archive
controls remain independently available. The shared plural `nouns.permission` combines with existing
loading/error message templates; no decorative styling or dialog implementation was added.
Read tiers and local-first data semantics are unchanged. First access offline can only use the
available replica; missing local metadata is not proof of complete membership/grant absence and
must not hide ordinary finance content. The broader all-workspace preparation guarantee stays open.

Expected structural result is **8 initial Accounts subscriptions instead of 10**. This is not yet
measured, and no startup speedup is claimed. Four implementation files changed (page, AccountList,
AccountActionsDialog, English noun catalog). Implementation review precedes tests. Relevant coverage
includes native/escape close and reopen, live permission updates and role changes, workspace/session
replacement, immediate close after an issued grant change, archive access independent of permission
query loading/errors, and the existing cold local creation/save workflows. Production counts should
show the two broad keys absent before Manage and acquired only when it opens, followed by the SDK's
normal cleanup window. T031 remains open until that focused T033 verification.

### T031 deferred permission queries — verified result

The focused slice passed **22 unit tests and 14 browser workflows** after implementation review.
No production correction was needed during testing. The public QuerySubscription visibility gate,
existing writer ownership and permission-only loading/error boundary behaved as planned.

The production audit measured **8 initial Accounts subscriptions instead of 10**. Add Account
open/close retained the same 8. Manage Account acquired exactly the two workspace-wide member/grant
keys, reaching 10. Escape close and immediate reopen reused those entries without new acquisition;
native close withdrew demand, and the normal SDK cleanup window returned the count to 8. Both broad
keys were absent before first Manage and after cleanup. No exact native signature was duplicated.
Saved-detail navigation had 18 entries instead of T030's 20, including the same prior-route cache
qualification. Typing acquired nothing new and the remote memo edit still yielded three observed
SDK deltas. This is a structural query-work reduction, not proof of lower page CPU or startup latency.

One comparable-harness post-change sample was 2,322 ms first visit, 1,842 ms warm saved detail and
1,107 ms cold detail with a real unanswered Jazz connection. Earlier samples vary substantially;
no speedup, numeric budget or supported-device certification is claimed.

Focused coverage:

- Four new presentation tests cover ready/granted, loading, error and restricted-role permission
  content. Loading/error states hide incomplete permission controls while leaving Archive enabled.
  Together with existing query-content and archive ownership suites, **22 unit cases passed**.
- Two permanent production regressions exercise live server grant updates, an input click followed
  by native dialog close in the same JS task before asynchronous local settlement, and a reopen
  showing the accepted grant. Native/escape close both work. A separate real-silent-wire case proves
  Archive and persisted reload still work before administrative data has ever been opened; the
  authority remains unchanged while stalled and accepts the archive after reconnect. The grant-dialog
  case was then expanded and rerun alone: changing workspace excludes the prior member's control;
  an observed owner-to-viewer role change removes permission controls and restoring owner brings
  them back. That targeted rerun and focused test types pass.
- The existing three production startup/stall/rejection workflows plus the updated production audit
  also pass: **six production workflows total**. This includes cold browser/SharedWorker exit with
  HTTP cache removal, available transaction edits/account creation, later acceptance and rejection.
- **Eight agent account workflows passed**: offline archive preserving another account, draft reset
  and workspace isolation, live sorting/archive/workspace updates, and five archive access cases
  (admin, all-account member, selected-account write member, selected-account read member and viewer).
- App checking reports zero errors/warnings, including service-worker TypeScript. Focused browser
  test types, formatting and whitespace checks pass. The tests used disposable data and the isolated
  checkout's own dependencies; compiled unchanged schema/permissions remain the documented Node
  alias-loader adapter. No backend credentials reached the browser and no SDK code was patched.

Default metadata read tiers are preserved. First access to a never-opened permission inventory while
offline is still limited to available replica knowledge; this does not certify all-workspace
preparation or global absence. Query cache retention is the SDK's own policy, not a new immediate
native-cancellation promise. Creation-dialog metadata remains live because it participates in trigger
readiness. Production actors/helpers were re-inspected: this slice adds no promise orchestration,
context lifecycle flags or actor shutdown on dialog close.

Results are recorded under `dialogDemandVerification` in `subscription-audit-results.json`.
Temporary diagnostic hooks were removed from the isolated session/layout and owned servers stopped
at completion. T031 is complete for the reviewed scope; T033 is verified for this slice. Changes
remain uncommitted; T029/T032 and broader spec measurements require their own evidence/review.
