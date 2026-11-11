# Draft backlog: Local-first usability and startup

**Status**: Implementation and consolidated investigation in progress; plan.md is present.
The user's latest direction authorizes completing open investigations/tests without further review
pauses. See [investigation-results.md](investigation-results.md) for the current evidence and decisions.
The spec remains incomplete where required behavior is unbuilt or unsupported; investigations and
rejected optimizations are not equivalent to delivery. Commit/deployment authorization is unchanged.

## Specification and guidance

- [x] T001 Resolve initial product clarification one question at a time. Q1: all accessible finance
      records across all accessible workspaces, attachment files on demand (`spec.md` FR-010).
      Q2: new identities can create their first workspace offline; recovered identities never
      automatically create replacements from incomplete local data. Q3: measure representative
      devices/datasets before choosing numerical budgets, without delaying local-first corrections.
      New consequential product questions discovered during research must still be asked individually.
- [x] T002 Reconcile constitution I and XState/testing memory with FR-001–007/016. Clarify locally
      known authorization, partial replicas, cold restarts, and remote nonresponse; retain online-only
      access administration and provider-operation boundaries. Present this focused docs change first.
- [x] T003 Reconcile `specs/006-multiple-workspaces/spec.md` and `plan.md`,
      `specs/008-actor-orchestration/contracts/workspace-integrity-report.md` and `fake-data.md`,
      and `specs/009-independent-checks/spec.md` using the research conflict inventory. Mark historical
      descriptions clearly; add cross-references rather than claiming pending changes already work.
- [x] T004 Produce a reviewed technical plan for the first implementation slice. Read XState memory;
      model local session/data availability separately from provenance/repair/seeding/recovery, with
      cancellation, failure, identity replacement, and cleanup. Limit each implementation review batch.

## First delivery: ordinary local usability

These are lower-risk directions, not permission to remove safeguards or blindly replace every remote
read. T005–T008 depend on the reviewed plan and applicable guidance reconciliation. A statechart must
precede workflow code. Coverage changes follow review of the exact implementation they exercise.

- [x] T005 Decouple available local shell/data access from initialization provenance in
      `src/lib/machines/workspace-initialization.ts`, `readiness.ts`, and
      `src/lib/components/WorkspaceBootstrap.svelte`. Use explicit local-first discovery on the
      usability path; keep empty results from authorizing bootstrap or repair. Preserve current
      identity/membership/scope guards. Show the statechart and file scope before editing code.
      Implementation reviewed; test follow-up authorized. Four focused unit suites passed (89 tests),
      then the updated readiness suite passed all 26 tests, including pending/failed provenance
      and empty first-workspace discovery.
      Selection uses observed session facts to avoid transient parallel-region ordering. Locked dependency installation resolved prior dependency errors. Type checking passes with zero
      errors/warnings; the existing offline owner Playwright workflow passes. Cold restart and a live
      unresponsive remote remain pending T009/T013/T014 coverage.
      No cold-start or performance guarantee validated yet.
- [x] T006 Remove opt-in seeding from the critical readiness path in `workspace-fake-data.ts`,
      `workspace-initialization.ts`, and its owner. Preserve authoritative emptiness/exclusive seed
      acceptance and cancellation/resource ownership; allow ordinary local use while seeding waits.
      Implementation approved and verified: six focused unit suites pass (117 tests), application
      and test type checks pass, and the seed-enabled Playwright reload/deduplication case passes.
      Startup coverage includes nonresponding seed reads, failure, replacement, and shutdown.
      After simplification: 37 affected readiness/startup unit tests pass. Latest application/test
      type checks and both seed reload/deduplication and visible-loading browser checks pass.
- [x] T007 Separate attribution-only repair progress from unrelated local capabilities in
      `workspace-integrity.ts`, `workspace-integrity-owner.ts`, and `readiness.ts`. Inspect the actual
      finance/bank consumers first; do not remove essential credential or operation-specific facts.
      Consumer audit and design approved. Readiness now accepts explicit Sync Now through current
      bank access instead of repair results; contract updated. Implementation approved and verified:
      85 unit tests, application/test type checks, and four focused bank/readiness browser cases pass.
- [x] T008 Audit ordinary writes in `src/lib/data.ts` and persistence machines for local completion
      and late rejection handling. Fix only verified remote gates in a focused slice; preserve existing
      local waits, immutable operation IDs, and state ownership. Do not refactor working paths wholesale.
      Static audit recorded in research.md: no ordinary remote completion gate found. Preserved
      local settlement, stable IDs, late-rejection observer, and narrow uncertain-write recovery.
      No production changes or new test execution in this audit; T009/T012 evidence remains pending.
- [x] T009 After each preceding implementation approval, update affected unit fixtures/assertions
      (initialization/readiness/integrity/seeding/save recovery as applicable) and Playwright coverage
      in `tests/offline-access.e2e.ts`/`tests/pwa.e2e.ts`; run only relevant checks in an isolated setup.
      Include a connection that opens but never returns data, not only browser offline mode.
      Progress: local startup, independent seeding and repair capability checks recorded above.
      Application observer callback delivery now covered for generic/tracked rejection notices,
      dismissal, retained workspace and unsubscribe; 48 application-readiness tests and type checks
      pass. A bounded production probe now passes cold browser/SharedWorker restart, saved-detail
      display, local edit/save and persisted reload with networking enabled and a proxy completing
      WebSocket upgrades but sending no Jazz replies. See research.md for evidence and limits.
      Automated follow-up: startup-stalled-remote.e2e.ts passes with an owned in-memory backend and
      silent transport, including HTTP-cache removal and browser/SharedWorker exit. Test types pass.
      Actual server rejection now covered too: an isolated authority changes a disconnected
      client's membership to viewer, the stale local client saves, and reconnect delivers the
      rejection notice. Accepted amount remains unchanged, read-only access takes effect and reload
      shows the accepted value. Both focused cases and test types pass. Post-negotiation stalls,
      broader partial/access scenarios and unknown-outcome durable recovery remain separate work.

## Investigations informing later delivery

Every investigation records exact versions, evidence, reproducible conditions, remaining uncertainty,
and a recommendation in `research.md`. Research does not automatically authorize implementation.

- [ ] T010 Investigate new versus restored identity bootstrap in `workspace-initialization.ts`,
      `workspace-creation-transaction.ts`, reconciliation/journal helpers, and Jazz account APIs.
      Implement the approved Q2 behavior only after establishing supported identity provenance and
      an offline-safe protocol retaining stable IDs, concurrent-device safety, and no membership
      resurrection. If provenance cannot be distinguished reliably, report the SDK limitation and
      present alternatives; never infer newness from an empty cache. Present the statechart before code.
      Investigation recorded in research.md: alpha.59 exposes no public durable automatic-identity
      provenance result. SDK-supported handoff versus app-owned explicit identity flow requires
      mechanism/design review; automatic offline bootstrap remains unimplemented.
- [ ] T011 Investigate all-accessible-finance-record preparation under FR-010 and review its
      runtime adoption. **Available SDK/browser investigation is complete; runtime remains unbuilt.**
      See remaining-investigation-results.json and the final research/plan disposition. Remote-only
      ID subscriptions qualify for background replication/live authorization across all three browsers;
      global LocalFirst views did not qualify. Foreground reads/saves remain local-first and never
      wait for preparation. Seventeen metadata/data roots exclude fileParts/provider operations.
      Cold edited/new/deleted records and audit/relationship metadata pass with a real unanswered
      proxy; 5,006 permitted records survive the large cold case. Namespace eviction retains identity
      without recreating workspaces. Lifecycle/cancellation/error-isolation checks pass. The earlier
      page WebSocket mock did not reliably isolate SharedWorker traffic; real-proxy results supersede it.
      **Do not enable an unbounded startup sweep:** initial acquisition caused a roughly three-second
      main-thread stall. Public retained pages preserve tested cold data and signal live boundaries,
      but acquisition is much slower (111 seconds for 5,006 records in 200-record pages). A budgeted,
      yielding page/growth/progress owner requires machine-first design and focused implementation
      review. Counts do not establish global completeness. Actual quota-failure and supported physical
      device budgets remain unverified; the reported Chrome quota override did not enforce a limit.
- [ ] T012 Investigate unknown-outcome recovery in `transaction-save.ts` and staged Check/ledger
      persistence. Establish how pending recovery survives navigation/reload without replay or blocking
      unrelated work; determine which remote checks remain necessary and propose scoped states.
      Audit recorded: checkpoints are form-local, cleared on scope/reset, and contain a live binding
      object; direct serialization is unsafe. Data-only journal/application ownership and write-ahead
      review slices proposed. No durable recovery implemented; narrow remote reconciliation retained.
- [x] T013 Inspect a production build's manifest, cached shell paths, Jazz worker script/imports,
      and Wasm URLs. Trace worker-originated fetches and query-version identity. Determine whether
      pathname normalization can serve incompatible bytes. Record specific missing assets/routing bugs.
      Build only in an isolated checkout if the user's development server is active.
      Isolated build/runtime audit recorded: worker-local Wasm is emitted and requested but omitted
      from precache; supported dynamic detail documents fail offline while static shells work.
      Fixes and full cold-runtime validation remain pending review/T014. Default query identity
      audited; no incompatible-byte response observed without overrides.
- [ ] T014 After review of any T013 fixes, extend `tests/pwa.e2e.ts` to establish a genuine cold offline
      restart: all app clients closed, no surviving runtime, HTTP-cache masking eliminated while
      retaining application Cache Storage/IndexedDB, supported direct links, and update version cases.
      Progress: pwa-cold-start.e2e.ts verifies emitted Wasm cache coverage and saved-account restart
      after browser/SharedWorker exit, preserving profile data with HTTP cache cleared. Dynamic
      detail links now verified for both expense/income records through T025. Real transitions
      between distinct production asset graphs reproduced an old hashed-module availability gap;
      see research.md and T026. Full update workflow and broader browser coverage remain pending.
- [ ] T015 Measure startup and interaction baselines: first visit, warm return, cold offline restart,
      and update; representative small/large datasets and supported devices. Attribute shell, worker,
      Wasm, local query, readiness, result transformation, balance calculation, and render costs. Set
      performance budgets from evidence without delaying the first local-usability correction.
      Capture comparable pre-change evidence before modifying a measured path; the broader device
      matrix is not a prerequisite for correcting verified remote dependencies (approved Q3).
      Initial production baseline recorded in research.md/startup-baseline.json: three profiles,
      first visit plus warm and cold-offline saved-detail usability. Next: session/query/readiness
      attribution; large datasets/devices/update scenarios and budgets remain open.
      Follow-up traces in startup-profile.json place returning session-open medians at 111/167 ms
      (warm/cold), before later membership/form observation updates. CDP collection overhead checked.
      Query delivery and browser CPU/render attribution remain unresolved; no optimization selected.
      Page CPU follow-up captured roughly 0.94 s sampled Wasm work on returning detail startup;
      direct enabled-form observations were approximately 2.16/2.19 s warm/cold in one profile.
      See startup-cpu-profile.json. Query/runtime cost is the next target; duplicate work, worker
      CPU, large histories and optimization benefit are not established by these samples.
- [x] T016 Evaluate earlier page-owned initialization using `src/app.html`, `src/routes/+layout.svelte`,
      `src/lib/jazz-session.ts`, and `application-readiness.ts`. Establish earliest supported start,
      singleton ownership, cancellation/auth transitions, dependency payload, and measured overlap.
- [x] T017 Evaluate `InstallEvent.addRoutes()` for existing public precache paths: browser matrix,
      feature detection, cache key parity, cache misses, update lifecycle, and cold startup savings.
      Preserve fetch-handler fallback; adopt only with evidence of benefit and compatibility.
- [x] T018 Assess navigation preload only for navigation paths that actually need network HTML;
      document why it is rejected for precached shell hits or identify a concrete beneficial case.
- [ ] T019 Evaluate Wasm download/compilation preparation and supported `runtimeSources.wasmModule`
      reuse across page/broker realms. Inspect actual default and override loaders, stable asset scope,
      module persistence/message support, contention, and fallback. Compare elapsed startup and memory;
      do not assume a compiled module equals a running database or supported service-worker handoff.
- [x] T020 Profile application-worker candidates after accounting for Jazz's existing SharedWorker.
      Examine calculations/parsing/subscription transforms/rendering; define message payloads, explicit
      local-first defaults, supported database bridge, lifecycle and cancellation. Keep UI owners in the
      page. Do not migrate machines solely because they make asynchronous calls.
- [ ] T021 Evaluate service-worker install/update cost: total asset size, duplicate downloads,
      foreground contention, retention of old version assets, quota/eviction, and browsers. Preserve
      existing update consent and no mandatory remote-sync wait; recommend changes only from evidence.

## Follow-through

- [x] T022 Turn accepted investigation outcomes into separately reviewed implementation slices and
      appropriate tests after approval. Keep rejected/unproven ideas documented, with no implied
      always-running service worker, unsupported Jazz handoff, or automatic provider fetching.
- [x] T023 Reconcile research, legacy specs, memory, and completion status after each delivery. Record
      measured results and limitations; distinguish completed research, implemented behavior, and
      validated guarantees. Do not mark this feature complete while approved investigations remain.

## Reviewed runtime findings: focused fixes

- [x] T024 Include emitted worker dependencies in the Vite client manifest used by SvelteKit precache.
      Implementation approved; isolated build/type checks and four production browser checks pass.
      Precache contains worker-local Wasm; a saved account survives browser-process exit and offline
      restart with HTTP cache cleared. Public-only caching and update consent remain covered.
      Additional 19.3 MB install asset documented. See plan.md, T013 fix A.
- [x] T025 Map supported dynamic finance-detail document navigations to the corresponding cached
      public shell without caching data/auth/API responses. Review route matching and file scope
      separately; then extend T014 cold restart/direct-link coverage.
      Implementation committed as 5bb7225. Saved expense/income details survive browser-process exit
      and offline restart with HTTP cache cleared; original workspace/hash and local values remain.
      All 15 PWA cases verified (13 initially, two after canonical-scope fixture correction);
      fallback-boundary, cache-scope and update-consent checks pass. Tests committed as 0e5e1d6.
- [ ] T026 **Deferred by user:** preserve older immutable assets across build activation. The probe
      reproduced an asset-level failure, not a failed user navigation. Keep existing update behavior
      for this slice; document the older-tab/reload limitation. Revisit with a concrete workflow and
      T021 storage/update measurements before designing cache retention or client reporting.
- [x] T027 Fix attachment read authorization before broad background preparation. Links now
      require allowedTo.read('transaction'). Files inherit reads directly from their existing
      transaction relation AND require an attachment matching both fileId and transactionId;
      parts retain file-read inheritance. This avoids the rejected reverse-inheritance composition
      without changing parent organization, role or grant checks. No schema change or SDK fix.
      Full-app permission suite: 73 passed, including role modes, wrong-organization grants,
      unrelated users, denied accounts and cross-transaction file links. Five attachment/image
      browser checks passed, including offline edit/reload and viewer download. Type checks report
      zero errors/warnings. See reproductions/README.md for the rejected expression and alternative.
      Broad preparation remains unbuilt pending T011 cold query coverage and storage investigation.

## Subscription ownership and startup query work

These tasks follow T015's query/runtime CPU findings and the user's requested subscription cleanup.
They use the installed Jazz public APIs and remain independent of T011 broad offline preparation.
No redundant subscription or performance improvement is assumed. Complete T028 and review its
findings first, then take one evidence-backed implementation task at a time in small review cycles.
If an audit finds no applicable waste, record that outcome rather than adding an abstraction.

- [x] T028 [US1] Audit startup and returning-detail subscription acquisition, replacement, and release
      in `src/lib/components/WorkspaceBootstrap.svelte`, `src/routes/+layout.svelte`,
      `src/lib/components/TransactionForm.svelte`, and their route/integration callers. Record query
      identity (account/session generation, workspace, filters, projection, includes, and read tier),
      owner/lifetime, acquisition/update/release counts, and the triggering reactive inputs in
      `specs/013-local-first-startup/research.md`. Capture comparable production startup/form-usable
      baselines under T015 through supported integration boundaries; distinguish necessary concurrent
      queries from duplicates. Present concrete candidates and affected tests before implementation.
      Completed: two production-mode Chromium probes and diagnostic types pass; see research.md and
      subscription-audit-results.json. Exact keys already share; no typing-induced reacquisition or
      old-scope leak after the SDK cleanup window was found. One active-account query differs only
      by sorting in AccountCreation.svelte. First implementation review is T030 query alignment;
      11-to-10 Accounts count is now verified under T030. Read-only internal SDK
      developer diagnostics were confined to the audit and are not a production dependency.
- [ ] T029 [US1] After T028 review, stabilize confirmed unnecessary rebinding in the audited
      `src/lib/components/WorkspaceBootstrap.svelte`, `src/lib/components/TransactionForm.svelte`,
      or identified route integration. Unrelated reactive updates must retain the current subscription;
      changes to identity/session generation, scope, query shape, or required read tier must replace it.
      Record exact changed paths and before/after acquisition counts in `research.md`; preserve live
      record/permission updates and existing readiness behavior.
- [x] T030 [US1] After T028 review and any overlapping T029 changes, consolidate confirmed identical
      subscriptions in the identified `src/lib/components/` or `src/routes/` integration owners.
      Share only when admitted identity/session generation, workspace scope, query semantics, and
      lifetime match. Retain one explicit owner with cleanup after its final consumer releases;
      keep independent lifetimes separate. Record the exact paths/ownership decision in `plan.md`
      before editing. Use the existing Jazz facilities; do not introduce a global query registry or
      share authorization decisions merely because query results currently look equal.
      Verified first slice: AccountCreation.svelte orders active accounts by name, matching the
      existing shell/route key. Accounts subscriptions fell from 11 to 10; the saved-detail navigation
      snapshot fell from 21 to 20. Live updates, typing stability and old-scope cleanup passed.
      Focused validation: 28 unit tests, nine browser workflows, zero app check errors/warnings,
      focused test types and formatting pass. Existing cold test now also creates/reloads an account
      while the real Jazz connection sends no replies. One post-change timing sample does not
      establish a startup speedup. See subscription-audit-results.json and research.md.
- [x] T031 [US1] After T028 review, defer confirmed dialog-only or inactive-view queries in their
      audited `src/lib/components/` or `src/routes/` integration owners until the view needs them.
      Release them when that owner closes/unmounts, preserving any active save/settlement drain and
      data needed by the visible page. Document exact paths in `plan.md`, and assess initial opening,
      reopening, draft retention, and local/offline availability; do not defer dependencies required
      to make the initial screen usable or alter UI styling.
      Verified focused slice: Accounts acquires workspace-wide members/grants only while Manage
      Account is open. Initial subscriptions are 8 instead of 10; opening adds exactly two, reopening
      reuses them, and closing returns to 8 after the normal SDK cache window. Permission-only loading/
      error feedback leaves Archive independent; native close preserves an issued grant write.
      Validation: 22 unit tests, 14 browser workflows (six production and eight agent account/role
      regressions), zero app-check errors/warnings, focused test types and formatting pass. Includes
      live grants, native/escape close/reopen, writer completion after close, cold local work, real
      rejection, workspace/control isolation, live role replacement, and the archive role matrix. No startup speedup established.
      Results: subscription-audit-results.json. Creation-dialog readiness queries remain live.
- [ ] T032 [US1] After T028 review and any overlapping T029–T031 changes, repair confirmed obsolete
      bindings in `src/lib/components/WorkspaceBootstrap.svelte` and the identified scoped form/route
      integrations. Identity, workspace, query, or owner replacement must release old subscriptions
      and reject late reports from the old generation; teardown must preserve existing in-flight
      write/drain ownership. Model any new multi-step lifecycle in `src/lib/machines/` before effects,
      keep Jazz wiring in integration components, and record actual changed paths in `plan.md`.
- [ ] T033 [US1] After each implementation slice is reviewed and approved, inspect and update its
      affected unit/Playwright fixtures and assertions before running relevant checks under
      `.specify/memory/testing.md`. Record exact test paths/results and comparable production timings
      in `research.md`: stable subscription counts under unrelated updates; fresh data on meaningful
      input changes; dialog close/reopen cleanup; repeated workspace/identity changes; stale callback
      rejection; observed grant revocation; and available local work with an unanswered remote.
      Reuse applicable cases in `tests/startup-stalled-remote.e2e.ts` and existing scoped-form/workspace
      suites rather than creating tests that merely mirror code. Compare startup/form usability,
      query acquisition/release counts, and page CPU before/after; report measured benefit or lack of
      benefit without treating subscription-count reductions alone as a speedup. Verify earlier
      slices before starting the next; no app preparation worker or broad startup sweep is included.
      T030 and T031 slices validated with the results above. T033 remains open for later approved slices and
      broader measurements; no T029/T032 implementation was included in these review cycles.

## Balance reads, repeated calculations, and transaction-list cost

These are application-side candidates supported by the installed Jazz APIs. Take one focused slice
at a time, review it, then use T033 for relevant correctness/performance checks. Fewer selected
columns or less repeated code is not by itself evidence of faster startup, fewer wire bytes, or
smaller persisted replicas.

- [x] T034 [US1] Narrow transaction results used only for account balances and category counts.
      All three consumers share transactionSummaryQuery selecting id/accountId/categoryId/amountMinor/
      currency/kind; the balance helper accepts its four required fields. Existing workspace predicates,
      local-first tier and calculation algorithm are preserved. Verification: 3 balance unit tests,
      both sidebar viewport cases and both category count/access cases passed; Svelte/type checks,
      formatting and whitespace checks passed. Fixed the category archive assertion to select its
      confirmation instead of unrelated status messages. Per user direction, performance measurement
      was omitted. No startup-time, heap, network or storage improvement is claimed. Dedicated cold
      projection/update-delete probes were not run in this focused verification.
- [x] T035 [US1] Share the shell's scope-owned read-only balance map with Accounts through the
      existing context boundary. Accounts retains its own account authorization and display rows, and
      no longer subscribes to balance transactions or recalculates them. During implementation, a
      malformed setContext call temporarily replaced account-order context; it was corrected before
      final verification. Verification: 3 balance unit tests, both sidebar viewport cases, account
      archive and all 5 account-order browser cases passed; Svelte/type and formatting checks passed.
      No performance measurement was requested or claimed.
- [x] T036 [US1] Bound TransactionList's date-group scan to groups needed for the requested 25-row
      page. Full filtered count, per-day totals, ordering, page clamping and links remain unchanged.
      Four pagination browser cases passed, including a new 60-row three-date fixture crossing group
      boundaries, live deletion, URL/history/reload/filter reset, full-day totals and mobile navigation.
      No performance measurement was requested or claimed. Broader Jazz query pagination remains
      deferred because it must preserve full counts and daily totals.

## Consolidated follow-through

The current decisions are in investigation-results.md. T009 covers the implemented startup slice;
T012 owns the remaining durable unknown-outcome work. T016/T017/T018/T020 are closed as evaluated
and not adopted. T022/T023 record this batch's test follow-through and reconciliation, not feature
completion. T010/T011/T012 remain unbuilt; T014/T015/T019/T021 retain the stated compatibility,
measurement and storage limits. T026 stays deferred; T027 authorization repair is implemented and verified.
