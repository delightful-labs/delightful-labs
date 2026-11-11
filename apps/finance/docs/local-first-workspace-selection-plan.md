# Shared workspace selection: Finance adoption

Status: implemented on `plan/workspace-lifecycle`. The transfer-recovery blocker is corrected by
the user-approved acyclic Finance insertion policy; real held-write recovery now passes with its
transfer records retained. All 102 permission tests and 21 focused browser scenarios pass, along
with source/service-worker and browser-test types. Refreshed CI remains a merge gate.

## Ownership

The library owns selected-workspace eligibility, lease invalidation, request/epoch correlation, and
its exact drain handshake. It does not choose routes, create workspaces, import Finance schemas,
initialize financial records, or call SDK identity mutations.

Finance retains Jazz subscriptions, organization/member policy, initialization, creation and
reconciliation, bank operations, transfer mutations, integrity, routes, and navigation. This slice
changes no persisted schema, permissions, localization catalog, CSS, or user-facing component design.
Existing Finance data needs no migration.

The application supervises these independent lifetimes:

- A selection attachment binds one shared actor to a captured database/client, identity, and
  application attachment. It retains that actor until finite completion before replacing it.
- The workspace coordinator consumes library leases. Identity-bound initialization, navigation,
  and creation survive ordinary selected-workspace changes.
- Selected resources own bank/retention and integrity work. Their terminal output supplies cleanup
  evidence; component unmount and actor liveness do not prove release.
- The transfer mutation owner retains issued operations through commit and settlement, rejects
  queued old-scope requests, and acknowledges exact scoped drains without terminating itself.
- A finite drain join combines selected-resource and transfer-owner evidence for one library token.

## Observation and lease protocol

WorkspaceBootstrap owns SDK subscriptions and dependency binding. It sends raw target facts to the
application's observation adapter; it does not construct a second SDK session. Locally observed
membership must match both target and identity. Empty/loading/failed directories are independent
facts, never an extra target-access gate or proof of revocation. Unknown target facts cannot grant
access. Explicit denial and observation failure remain distinct outcomes.

Selection attempts and observation generations advance monotonically. Fresh attachment tokens
prevent A -> B -> A and same-client restoration from reusing an old lease. Both transfer integrations
capture the original request scope at actor construction. The application validates that scope
against the current lease, database, identity, workspace, and globally increasing transfer generation.
Late requests and reports cannot acquire the replacement workspace's authority.

## Exact resource drain

1. Library invalidation immediately removes the usable lease and closes new scoped action admission.
   Finance retains the latest requested target while the old scope drains.
2. The application captures the library's exact drain token and old lease. It requests old selected
   resources and transfer work to shut down independently; neither leg may impersonate the other.
3. Issued writes remain retained through local settlement and cleanup. Cancellation does not erase
   a committed write. A bank import cancelled after confirmed local persistence is retained business
   progress, not cleanup failure; unresolved writes or logging still prevent clean release.
4. The join accepts finite evidence from both legs, including explicit absence of acquisition and
   already completed owners. Preclosed resource evidence enters the join as input, avoiding a late
   message to an immediately completed actor. Old tokens and foreign scopes are rejected.
5. Only the matching combined result acknowledges release to the library. Failure requires explicit
   recovery; unresolved ownership cannot authorize replacement or certify clean shutdown.
6. The next allowed library lease attaches the next selected-resource lifetime. Generic pending
   attachment does not bypass the shared decision.

Identity retry/restoration additionally waits for actual finite coordinator completion and shared
selection release. The coordinator's terminal-entry `WORKSPACE_CLOSED` notice is informational;
only its correlated dynamic completion proves release. The transfer owner stays alive while
selection requests its scoped drain. SDK calls already issued stay retained until they settle.

Route-local form/image actors retain their existing old-scope checks and independent shutdown.
This slice does not claim a root acknowledgement for every historical route actor or migrate all
Finance actor ownership into the library.

## Qualification

The integrated handoff previously passed 191 distinct focused unit cases and 16 browser scenarios.
The final cancellation correction adds two bank-owner cases; the focused four-file rerun passes
216 cases (49 bank, 73 application, 47 coordinator, 47 drain join). Source/service-worker checking
reports zero errors/warnings; browser-test types and browser-scope validation pass.

Real held-write browser checks retain the acknowledgement only after actual SDK local persistence.
They do not replace the database with a fake. Bank import switching and recovery and transfer
switching pass: issued source writes persist exactly once, destination work cannot mount early,
and restoration cannot start before application release. No stopped-actor assertion was removed.
The pre-fix combined browser run passed 20 scenarios and failed the transfer-recovery
regression corrected below. The broader unit run passes 1,667 cases and times out once in an unchanged
income-payment permission test; rerunning that permission file without competing qualification
processes passes all 82 cases. All 122 unit files therefore have passing results across these runs;
the initial all-suite timeout is retained in the PR record. This does not claim one entirely green
all-suite run or that every application/PWA scenario was rerun.

Draft PRs: [Finance #40](https://github.com/delightful-labs/delightful-finances/pull/40) and
[library #5](https://github.com/delightful-labs/delightful-local-first/pull/5). Library `pnpm verify`
passes, including 219 unit cases, types, formatting/lint, package/publint, consumer checks, and the
Storybook build. Required GitHub CI remains a separate merge gate.

Five production cold-start/remote-boundary checks pass in an isolated checkout with its own
dependencies and generated environment:

- Cold local reads and saves with an open remote that never answers.
- Cold local reads and saves with the browser offline.
- Local saves after a negotiated connection stops answering.
- Later real server rejection after a locally successful stale-authority write.
- Bank history surviving cold unanswered/offline restarts without provider fetches.

These use retained browser storage, cleared HTTP cache, all clients/SharedWorker closed before
restart, the production service worker, and the real local Jazz authority. They do not establish
remote acceptance of an unrelated pending transfer.

## Resolved transfer-recovery authorization boundary

The enabled regression `retains an issued transfer write through workspace recover` originally
failed after the application released its drain barrier: Jazz waited for pending global writes.
An SDK-only browser probe and a direct full-policy regression isolated two permission issues: the
nested two-account predicate failed to settle, and the new endpoints and transfer depended on
one another for insertion authorization. Jazz explicitly disallows that circular grant graph.

The user approved the smaller acyclic fix. New manual transactions still require all direct account,
workspace, category, currency/archive, and check-reference conditions, but their forward marker is
not an insertion-time access grant. Transfer insertion retains complete endpoint-fact validation and
uses the existing factored two-account authorization predicate. Marker updates, existing financial
fact immutability, read and delete policies remain enforced. The three rows remain one locally
settled mergeable transaction; restoration still waits for actual SDK synchronization.

The explicit integrity tradeoff is that an authorized manually constructed new manual transaction
may carry an orphan marker. Finance handles it as an integrity error; it is no longer denied solely
for the missing relationship. New provider transactions do not gain this exception. Regression
coverage names this boundary and retains rejection of inventing a marker through an update.

The focused browser rerun passes recovery, cross-currency creation, linking/unlinking, delete-both,
and unlink-and-delete. No timeout was raised, test disabled, permission preflight introduced, or SDK
shutdown bypass added. See [the investigation and exact policy decision](transfer-creation-permission-investigation.md).
The final full-policy run passes 102 cases (20 new); all 21 focused browser cases pass. Recovery
also passes a stronger error-free SDK-ready assertion with retained rows. Source/service-worker
checking reports zero errors/warnings, and browser-test types, formatting and diff checks pass.
Require refreshed green CI before merging. Shared private workspace creation remains the
next extraction, with Finance schemas, financial starter records, and reconciliation journals
retained by the host.

The known disposable agent server is http://127.0.0.1:5184. User development servers and persistent
browser/Jazz data were not changed.
