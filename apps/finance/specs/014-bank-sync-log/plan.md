# Implementation Plan: Bank Sync Log

## Scope and ownership

Persistent connection-level Bank Sync attempt history, per-account results,
settings presentation and fixed retention. Transaction revision history and
system-account display naming remain separate features. No provider request,
passkey prompt or financial mutation is triggered by viewing or retaining logs.

The bank supervisor composes `createLoggedBankOperationMachine`. Its raw bank
operation retains ownership of credentials, Web Locks, imports and cleanup.
`BankSyncIntegration` owns foreground Jazz queries and browser-offline observation.
The bank actor invokes the independent retention coordinator. `BankSyncLog` is a pure presentation component with data/callback
props, native disclosures and localized labels. No new custom CSS properties.

## Persistence and permissions

`schema/bank-sync-log.ts` declares `simplefinSyncAttempts` and
`simplefinSyncAccountResults`; `validation/bank-sync-log.ts` owns canonical
validation. The additive migration creates only these tables. Existing financial
records are unchanged. Attempts use stable IDs, and account-result IDs are
stable derivations of attempt/account identity. Counts distinguish null from zero.
Persist bounded failure codes, never raw exceptions, provider payloads or secrets.

Current owner/admin membership permits organization-scoped reads, including other
users' connection logs. Only the connecting owner with current admin authority
can create or settle attempts. Organization, connection, initiator, start and
account identities are immutable. Account results require an unfinished matching
parent and a local account in the same organization. Terminal records cannot be
reopened or edited. Deletion is restricted to completed, finished attempts owned
by the current admin user; account-result deletion inherits that permission.
The fixed cap is enforced by the exclusive workflow, not an unsupported policy
aggregate. No manual edit/delete/replay controls are exposed.

## Logging statecharts

Composed operation: capture identity -> prepare authorization -> save start ->
wait for readiness -> existing bank operation -> drain its cleanup -> classify
safe log completion -> save account results -> save terminal attempt -> return
financial result with separate logging outcome. Only explicit SYNC commands log;
setup, discovery and disconnect retain existing behavior.

Logging child: validate start -> record start -> await actual operation result ->
validate completion/accounts -> derive account ID -> save account (repeat) ->
finalize attempt. The terminal attempt is saved last because account writes need
an unfinished parent. Start failure falls back to the existing operation without logging; completion failure
preserves actual financial results and leaves readable unfinished history.

Cancellation normally waits for issued log writes, bounded by the wrapper deadline.
The SDK may complete a timed-out log write later. While the operation owns
imports, logging waits for its actual drained result rather than inventing
rollback or settlement. Scope replacement and shutdown preserve the existing bank
owner's drain protocol. Unknown account identities are not fabricated. Unexpected logging-actor errors
are contained: before provider work they fall back to the existing operation; during an operation
they preserve its resource owner and continue draining, including cancellation.
The final financial result is returned with separate unavailable-log feedback.
Safe provider/passkey/mapping failure codes are projected from the existing classifier.

## Retention: knowledge before mutation

Retention is independent of sync and starts for the bank actor’s observed owned
connection. A viewer selection cannot retarget its cleanup. Its
coordinator chooses -> works -> idles, retries after 60 seconds, and handles
replacing/closing by cancelling and draining the existing child before rebinding
or final shutdown. Offline/no-access observations disable cleanup. Bank shutdown
drains the retention child before reaching its final closed state.

The transaction child performs:

1. Check observed identity and authority-read membership/connection ownership.
2. Authority-read completed history ordered by `finishedAt desc, id desc`.
   At most 100 needs no mutation or transaction acquisition.
3. Authority-read every account result for attempts older than the newest 100.
4. Open one exclusive transaction and recheck membership/connection locally.
5. Read completed history locally within the transaction; require exactly the
   authority-observed attempt IDs, otherwise defer and roll back.
6. Select the older attempts, read their account rows in the same transaction,
   and require exactly the authority-observed account-result IDs.
7. Recheck observed identity, stage all child/parent deletes, recheck identity
   again, commit once and await authority acceptance.

Terminal rows and account results are immutable under the production policy, so
matching identities also preserve ordering and contents. Exclusive read conflict
checks and atomic commit protect concurrent cleanup. Unfinished attempts and
other connections are excluded. No local count is treated as global completeness.

This authority/local boundary is required by browser verification on alpha.59:
the same history query returned 101 outside a browser transaction at Remote tier
but zero inside it at Remote tier. Acquisition outside followed by LocalFirst
transaction rechecks passes browser and full-policy tests. Do not substitute an
empty transaction Remote read for sufficient history knowledge.

Each authority/local read has a bounded deadline. Before commit, cancellation,
timeout, missing knowledge, authorization loss or staging failure rolls back any
acquired transaction. Commit is issued once. Its wait drains to actual acceptance
or an explicit unresolved deadline; the latter does not claim deletion, rollback
or financial failure. Later cleanup re-queries rather than replaying provider work.
Deletion removes normal records; it promises no physical erasure of replica or
backup history.

## Settings presentation

Subscribe only on Bank Sync settings, scoped to the selected workspace and
connection. The selector includes disconnected connections and other users'
connections permitted to the current owner/admin. Labels show connection time,
owner and status without UUIDs or credentials. Read initiator names with a safe
unavailable-user fallback. Profile lookup loading/errors do not gate readable history.

Fetch 20 attempts plus a lookahead row, load another 20 explicitly, and reset the
limit on user/workspace/connection changes. Scope-filter retained subscription
values before rendering. Expand an attempt and each account for timestamps,
counts, outcome, safe failure reasons and import settlement. Unfinished means
final result unknown; locally saved is distinct from confirmed remote acceptance.
Explain local history availability and that pre-feature syncs were not logged.
Preserve existing latest-result feedback and separate logging-write errors.

## Verification and rollout

The user authorized the remaining implementation and verification in one final
slice. Tests inspect current schemas, permissions, actor protocols and locators.
Focused unit/full-policy coverage checks validation, recording, financial results,
resource drain, authorization, partial knowledge, timeouts, retention boundary,
stable tie ordering and concurrency. Browser coverage checks live log records,
account expansion, paging/reset, connection/workspace isolation, mobile containment,
log-write failures and integrated background retention without provider requests.
A production-build persistent-profile test covers cold restart with an open but
unanswered authority and full offline history reads.

Record final outcomes in `verification.md` and tasks.md. Validate the schema and
existing additive migration; publish schema/permissions through the normal release
process. No production schema deployment is part of these local verification runs.

## Review follow-up: ownership and optional profile enrichment

The bank actor owns retention as a long-lived invoked child. It forwards its
current authorized connection, browser-offline observation and recorded attempt
completion through the existing CHECK protocol. The history selector supplies no
cleanup scope. Access/connection changes reuse the bank's existing scoped
observations, and normal ready entry checks the settled operation's logging
result. No new promise orchestration is needed; the retention transaction child
and its existing guards, authority/local rechecks and rollback paths are reused.

Shutdown drains bank setup/operation work first, enters drainingRetention, sends
SHUTDOWN to the retention coordinator if still active, and waits for its terminal
report before the bank reaches closed. Late observations cannot reopen that
shutdown state. An already completed/failed retention child is not awaited.

The integration owns only the browser-offline observation and history queries.
Optional profile-name enrichment does not gate history loading or errors; query
failure supplies no profile names and reuses the existing unavailable-user label.

Affected verification after implementation review: supervisor retention binding
and shutdown fixtures; browser sync of active A while viewing old B; injected
profile lookup failure with readable attempts/connection selection; existing
retention, offline and logging/cancellation scenarios. The follow-up was reviewed before tests; verification.md records the focused
unit/browser results.

## Review follow-up: reuse without workflow changes

This slice extracts pure data transformations only: the logged wrapper's empty
cancellation result, the supervisor's connection-scoped completion fields, and
the raw operation's settled import fields. Existing guards still select success,
failure, cancellation, reset and shutdown paths; resource-owning invocations and
their drain boundaries remain unchanged. No helper performs I/O or runs an actor.

BankSyncLog reuses local count/failure snippets and per-locale Intl formatters.
Jazz outcome/failure-code column factories reuse the canonical enum option order;
the structural hash must remain e5a4d82f6013. This is a schema-source refactor,
not a structural migration. The user requested implementation and focused tests
in one slice. Inspect result fixtures, policy tests and history disclosures before
running the affected unit/browser coverage.

Verification: all 116 focused tests across nine bank-sync, validation and Jazz
policy suites pass. The four Playwright cases for history presentation,
cancellation and start/result persistence failures pass. `pnpm check` reports
zero errors and warnings; focused Prettier and diff checks pass. The structural
schema hash remains `e5a4d82f6013`. The cancellation fixture additionally covers
a rejected pending start, preserving its existing failure outcome.

## Review follow-up: required result reports

The existing start-cancellation state and logged-operation completion projection
already preserve null counts before account results are known; no production
count change is needed. Verify both paths alongside completed empty syncs, whose
counts must remain known zero.

This change tightens data contracts only. Import/account actors construct an
outcome in their existing terminal states and attach required account reports at
the output boundary. The raw operation similarly attaches its required reports;
only the logged wrapper adds logging feedback. The supervisor invokes the logged
wrapper in production; its injected actor contract also accepts the raw operation
for isolated import-settlement tests. It narrows wrapper feedback explicitly. Existing states,
invocations, acquired-resource cleanup, failure and cancellation priorities remain
unchanged; no asynchronous effects or orchestration were added.

Implementation review precedes tests per repository agreements. Affected coverage:
index supervisor fixtures must return LoggedOperationResult with required reports
and logging, including retention completion; import/operation actor mocks must
include reports; logged-operation cancellation assertions should verify all three
persisted counts are null, with an empty completed sync retaining zero. Relevant
existing import-settlement and browser cancellation/history scenarios also apply.

Verification after review: 94 focused tests pass across supervisor, raw operation,
logged operation, import settlement and log persistence. New coverage preserves
null counts before unlocking and during start cancellation, and known zero for
an empty completed sync. All four focused bank-sync browser scenarios pass,
including persisted null counts and three visible Unknown values on cancellation.
The first browser run could not open finances on the reused server after generated
environment checks; it was stopped, the known disposable agent server restarted,
and the complete four-case run passed. `pnpm check` reports zero errors/warnings;
focused Prettier and diff checks pass. No schema/policy change or deployment.

## Non-blocking start-log failure

The user requires sync to proceed when logging fails. Keep the existing statechart:
prepare -> logged.starting -> logged.operating on readiness. A rejected/invalid
start or unexpected logger crash in logged.starting instead transitions to the
existing unlogged operation, retaining a separate notStarted logging result.
Cancellation in logged.cancellingStart always completes cancelled after the issued
write drains, including rejection; it must never enter unlogged fallback.
The fallback receives the original captured identity and existing authorization,
lock, credential and import owners remain unchanged. Do not retry provider or log
work. Normal completion/result-log failures keep their existing drain behavior.
No new promise orchestration or resource owner is introduced. Reuse the existing
result-log warning for both log failures; no Paraglide edits are authorized.
Review tests for failed start, invalid start, unexpected start crash, cancellation
while the start is pending/rejecting, actual imports, financial failure during
fallback, scope replacement and shutdown. Browser start-log failure must assert a
provider sync, actual saved imports/result, a separate warning and no log retry.

Verification after review: 82 focused unit tests pass across logged-operation,
log persistence, import settlement and the supervisor. Four browser cases pass;
failed start and result logging each still save an actual imported transaction,
show its successful result and a separate logging warning, without retrying the
provider. Cancellation and normal history/idempotency also pass. App/test types,
focused formatting and diff checks pass. The initial browser run was stopped
because the reused server could not open finances after unit checks; refreshing
the disposable agent server resolved startup and the full four-case run passed.

## Complete-review cleanup

Reuse existing logging-failure transitions after a five-second readiness/completion
wait. A deadline stops waiting, without aborting or retrying the issued Jazz write;
late results cannot advance the stopped logger. Financial writes keep their drain
protocol. Share operation inputs/crash results and log-failure output construction;
remove unused fields, reuse Saved for confirmed history, and centralize pagination
defaults. No schema change. After review, verify stalled/late logging, cancellation,
fallback crashes, pagination resets and the existing history/import browser cases.

## Resilience follow-up

The user approved implementation and regression testing in one session. The
current [resilience design and verification record](resilience.md) describes the
worker resource boundary, persistent Jazz owner, positive-only duplicate snapshot,
read deadlines, traversal yielding, corrected result classification and history
labels. Browser execution is limited by the current session's sandbox; do not
claim the browser scenarios passed from type checks or native-worker evidence.

The approved review follow-up replaces timer-per-row traversal with cancellable
25-row MessageChannel batches, makes reply settlement one-shot with canonical
validation, moves snapshot diagnostics into state transitions, skips snapshots
for empty accounts and reuses a shared relay HTTP leaf. See resilience.md for
the actual regression results and remaining browser execution restriction.
