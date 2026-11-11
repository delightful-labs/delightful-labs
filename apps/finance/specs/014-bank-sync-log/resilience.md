# Bank sync resilience review

This change is based on main `7409577`. The user supplied history summaries:

- November 2: 15m45s, six imported, 219 existing, Saved, unexpected error.
- November 4: 1m56s, zero imported, 56 existing, not completed.
- October 31: 39s, unspecified counts, provider failure; another 13s attempt
  was not completed with unspecified counts.

The first two entries prove provider processing had reached import; the latter
provider error identifies another failure boundary. These summaries do not reveal
the particular failing database call or transport error. Saved describes local
persistence of imported transactions, not the history write or full-attempt success.
The November 4 entry may be a successful existing-only sync: the previous status
mapping displayed "not completed" whenever there were no new inserts. Its actual
overall outcome was not included in the pasted details, so failure is unproven.

## Confirmed failure paths

- `BankSyncIntegration` cancelled every operation on every navigation, despite
  application/workspace ownership of the bank actor.
- `import-account.invalidMapping` ended without setting the required result,
  causing an actor crash instead of the intended mapping error.
- Account import failures were recorded as `unexpected` at attempt level, even
  when account-level records identified an import failure.
- The browser relay request had no deadline. The relay's upstream deadline
  cannot bound worker startup, browser transport or a stalled response body.
- Each imported transaction starts several authorization/query actors. A large
  response can monopolize the page through repeated microtask completions.
- The history settlement label said "not completed" even for a successful sync
  containing only existing transactions. Show the existing Succeeded/Partial
  message for completed attempts with no new inserts; preserve Saved and
  unresolved settlement messages and persisted settlement facts.
- An account's first transaction failure stops the import. Preserve this rule
  for financial integrity; do not replay uncertain writes automatically.

## Machine-first design

The provider operation is a workflow: HTTP request -> inspect status -> read JSON
-> validate response -> success/failure. Define it as a worker-owned
XState root under `src/lib/machines/bank-sync/`. Promise actors perform one leaf
operation each. Request and read actors share one HTTP response; no retry occurs.
The worker is a disposable resource for one explicit provider operation.

The page's existing fetch actor owns a single worker request adapter. The adapter
constructs one dedicated worker, sends transient request data, observes a typed
terminal reply, and terminates the worker on success, failure, abort, message error
or a 75-second deadline. The page-side deadline also bounds worker startup and body
consumption; timeout/cancellation dispose the same platform resource. Only safe stage/status
metadata returns on failure; credentials/provider errors never enter diagnostics.

Passkey user verification stays on the page. The worker receives the unlocked
Access URL only for this request and never stores it. The parent authorization
checks before fetching and before importing remain intact. Cancelling terminates
the worker; a late reply cannot start import. No startup/reconnect/timer/retry
starts a provider request. Claiming one-use setup tokens remains unchanged.

Jazz writes stay on the persistent browser client: the installed SDK's dedicated
worker replica did not share persistent page storage in spec 013's investigation.
The account traversal statechart yields through a disposable MessageChannel
between batches of 25 transactions, including omitted/existing rows. Empty and
final batches do not schedule a yield; no per-row timer is used. Issued
financial writes still settle before cancellation completes. No write timeout or
automatic retry is introduced.

Before transaction traversal, read at most 500 recent provider transaction IDs
for that account at LocalFirst, skipping this read for empty/missing transaction
lists. Snapshot logging belongs to its active state and has no heartbeat.
This is positive knowledge only: a stable ID in
the set needs no further lookup/authorization queries because no write occurs.
A miss follows the original per-transaction lookup and authorization path,
including immediately-before-write authorization. No snapshot completeness is
assumed. A five-second deadline or snapshot error falls back to that original
path. Late snapshot completion is ignored. Per-transaction authorization and
duplicate-lookup states each have a 20-second read deadline; a deadline fails
without inserting or retrying. The SDK query itself has no cancellation API;
the actor ignores its late result. The parent still owns permission/scope changes.

Same-workspace client navigation preserves an active SYNC. Setup/discovery still
cancel when leaving their page; unloading the document still cancels. Existing
workspace, identity, access, credential replacement and shutdown paths retain
ownership of cancellation/draining.

The bank page only renders the shared integration's view. It must not cancel the
workspace-owned operation on destruction: client navigation destroys that page
after the integration's `beforeNavigate` hook has preserved an active SYNC.
CI's navigation regression exposed the redundant page-level `onDestroy` hook;
removing it also removes the unused context-level cancel callback. Explicit
cancellation remains bound to the current lease in the integration.

## Review and validation

Implementation scope: twelve files (integration, account/transaction import, logging supervisor,
history presentation, provider operation, SimpleFIN adapter, worker adapter/root,
provider statechart, shared relay HTTP leaf and canonical reply validation).
No Jazz schema, permission or localized string changes are required. Reuse existing
mapping/import/provider failure messages.

The user approved completing implementation and tests in this session. Test scope:

- `simplefin.test.ts`: worker double instead of fetch double for discovery/sync;
  single request, malformed response, startup/error/message-error/abort/deadline.
- Provider machine: HTTP failure, malformed JSON/schema, stalled header/body,
  terminal result redaction and no retry.
- `import-transaction.test.ts`, `import-settlement.test.ts`, `import.fixture.ts`,
  `mapping.test.ts`: yield timing, invalid/archived mappings, retained counts,
  cancellation and unresolved-write draining. Update the account fixture to supply
  the new existing-ID snapshot actor. Cover cache hits/misses, user-edited rows,
  same-response duplicates, partial/failed/stalled snapshots, read deadlines and
  late reads making no writes. No failed query establishes absence.
- `logged-operation.test.ts`: mapping/import classification with partial counts
  and preserved existing passkey/provider/lock errors.
- `history.test.ts`: existing-only/empty success and partial status, actual failures,
  Saved for persisted rows and retained uncertainty/import failure descriptions.
- `tests/bank-sync.e2e.ts` and `bank-sync-offline.e2e.ts`: explicit-only fetching,
  in-app navigation during sync, explicit cancellation/late response, workspace
  changes, worker HTTP interception, repeat-sync idempotency and offline behavior.
- Production build: emitted worker loads, aliases resolve, and runtime asset is
  included in the service-worker build list. Static checks are not runtime proof.

Remaining risks to investigate with a real failed diagnostic export: local storage
failure, delayed server rejection, query coverage, provider schema differences,
and cross-device concurrent imports. Do not treat these possibilities as confirmed
causes or bypass authorization/idempotency to conceal them.

## Checklist

- [x] Inspect app ownership, provider transport, import and historical error paths.
- [x] Implement isolated worker and resource cleanup, without a separate Jazz replica.
- [x] Preserve navigation continuity and repair mapping/error classification.
- [x] Bound optional prefetch and non-mutating transaction reads; preserve write drains.
- [x] Complete formatting, static checking and production worker-bundle inspection.
- [x] Present the implementation for review (required before adding/running tests).
- [x] Update the affected fixtures and add focused unit and Playwright regressions.
- [x] Verify the actual bundled worker entry in native worker threads with mocked transport.
- [x] Run the focused unit tests and record actual results, including a synthetic
      repeat-sync latency measurement with cached/partial data.
- [x] Type-check/discover the browser scenarios and check their suite coverage.
- [ ] Run full application browser assertions and measure real-browser repeat-sync
      latency. Session sandbox restrictions block execution; no live provider call is needed.

## Checks performed

`pnpm check` passes with zero errors/warnings. `FINANCE_PREVIEW=true pnpm build`
passes. The provider worker is a separate 96,304-byte production asset,
`_app/immutable/workers/simplefin.worker-DrN_lZab.js`, referenced by the client
manifest and service-worker precache. Formatting and `git diff --check` pass.
Build output retains existing large-chunk and unspecified adapter-target notices.

Dependencies, framework output and localization caches are isolated to this
worktree. Initial CDN resolution failed; copying the existing ignored plugin
cache allowed normal Paraglide compilation/check/build to complete. No catalogs,
localization configuration, live data or running development servers were changed.

Recursive actor review: provider states expose HTTP/status/decode/validation;
worker messaging is a single platform operation with termination cleanup. Import
states expose snapshot acquisition/fallback, positive-ID deduplication, unchanged
authorization/lookup/write decisions, read deadlines and traversal yielding.
Atomicity boundary remains each existing local-settled insert; cancellation never
abandons or replays its pending settlement. No new procedural workflow is hidden
inside a promise actor.

The reviewed revision's final focused run passes **343 tests across 22 files** covering the bank machines,
SimpleFIN adapters, history, read deadlines, snapshot fallback/cancellation and
settlement. The emitted-worker runtime suite includes five cases using Vite's
actual compiled entry, native worker
threads, structured-clone messaging, and mocked HTTP. These validate its real
worker global/message binding, success, HTTP/JSON/schema failures and redaction;
they do not establish browser-specific behavior.

The reviewed revision's 225-row import regression measured 149 ms for initial
imports and 24 ms for the repeat, with zero repeat per-row lookups and two operation-level
authorization queries. This uses mocked database I/O and measures
JavaScript/statechart overhead, not real-bank/browser latency. Earlier scoped
measurements of the per-row timer version varied (for example 475/322 ms);
no time threshold is used to mask
system load or claim a production speedup. A deliberate actor-crash test retains
an existing stopped-actor warning with an empty query payload; assertions pass.

`pnpm check:tests` and `pnpm check:e2e` pass. The latter checks scenario discovery
and canonical/focused suite coverage, without launching browsers or servers.

Browser execution is blocked by the session environment, not missing approval:
the disposable Jazz server cannot bind a listener (`Operation not permitted`),
and elevation was rejected because granular sandbox approval is disabled.
Chromium also cannot launch (`MachPortRendezvousServer` permission denied).
The browser connector timed out. No browser assertions have executed, and no
existing user or other agent server was reused. The focused Playwright config
discovers 22 cases, including six added worker/navigation/performance cases.
Run them in an environment allowing local listeners and browser startup:

```sh
FINANCE_E2E_PORT=5198 pnpm exec playwright test --config tests/config/playwright.bank-sync.config.ts
```

## Approved review follow-up

The user requested all four review fixes, shared transport reuse and regression
tests together. Machine-first changes: account eligibility chooses whether any
transactions need a snapshot; snapshot entry/completion/failure/timeout own its
logs, and no unbounded promise owns a heartbeat. Traversal advances normally
within a batch, invokes a disposable MessageChannel actor after 25 rows when
more remain, and resumes only on that actor's event. Cancellation exits that
state and closes both ports; already-issued financial writes retain their drain.
No per-row timer or background provider retry is introduced.

Worker message handling is a one-shot platform adapter: validate unknown replies
with a shared canonical schema, settle once, and detach/terminate through one
completion path. Malformed replies and callback exceptions reject rather than
disabling the deadline while leaving the promise pending. Sharing the relay HTTP
leaf centralizes POST options only; status, decoding and outcome decisions stay
with their existing workflow owners. These are platform leaves and pure schema
validation, not new procedural workflows.

Regression scope: batch counts/no final or per-row timer yield, cancellation and
port disposal, empty/missing transaction lists with balances preserved, stalled
snapshot completion/cancellation without heartbeat or late logs, malformed reply
and duplicate/late native callbacks, and claim/discover/sync relay request options.

- [x] Replace per-row timers with batch scheduling and verify real channel disposal.
- [x] Reject malformed replies through one guarded settlement/cleanup path.
- [x] Remove snapshot heartbeats and ignore late diagnostics after state exit.
- [x] Skip duplicate snapshots for empty accounts while retaining balance saves.
- [x] Share relay POST construction across page claim and worker requests.
- [x] Run focused unit regressions and type-check/discover the added browser case.
- [ ] Execute application browser regressions when the environment permits them.

The worker adapter reuses the canonical reply/provider schema at the receiving
boundary, so deserialized data and failure metadata are checked without unsafe
casts or raw-payload logging. JSON decoding and the provider workflow remain in
the worker. Snapshot query actors now receive organization/account IDs only.
Recursive review confirms their query and scheduling actors remain leaf effects;
batch, optional-read, cancellation and terminal decisions remain in the statechart.
