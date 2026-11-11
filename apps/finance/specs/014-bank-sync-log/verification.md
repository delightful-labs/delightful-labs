# Bank Sync Log verification

## Implementation

The log attempts to record one explicit connection-level attempt before provider work, with
stable account results and terminal settlement after bank cleanup. Settings
shows bounded, expandable history for permitted connections, including
previous/disconnected connections. Retention independently keeps the latest 100
completed attempts per connection, with account rows deleted atomically.
Unfinished attempts remain untouched. History/cleanup never requests provider
transactions or passkeys.

The final actor audit also contains unexpected logging-child crashes. A start
crash allows sync without logging; a crash during an issued import does not stop its
resource owner. Cancellation still drains the import before returning its actual
counts and the separate unavailable-log result.

## Automated checks

Feature baseline at commit `383fcfb`: 111 tests pass across nine focused unit/full-policy suites.
All 11 bank-sync/offline browser scenarios pass (1.6 minutes); the production
cold-start/offline history scenario passes (35.8 seconds including build/startup).
After the final logging-crash safety change, all nine composed-operation tests
and the full 111-test batch pass, and the three affected cancellation/log-failure
browser scenarios pass again (24.7 seconds). Static/schema/format checks pass.

| Area                     | Evidence                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit and full policy     | Nine focused suites: supervisor, raw/composed operations, import settlement, logging lifecycle, validation, log policies, retention statechart and full-policy retention.                                                                                                      |
| Live history             | Real explicit syncs record partial/success account results; setup/discovery do not create attempts; repeats remain idempotent.                                                                                                                                                 |
| Settings                 | Expansion, initiator, unknown counts, provider failure reason, 20/24 paging, reset after connection change/reload, workspace isolation and 390px containment.                                                                                                                  |
| Logging failures         | Browser-injected start failure allows imports; final-write failure preserves the successful financial result and an unfinished attempt.                                                                                                                                        |
| Cancellation             | Pending response cancellation has no late import; unit tests drain already-issued imports and log writes, including an unexpected logging crash.                                                                                                                               |
| Retention                | 100/101 boundary, stable finish/ID ties, atomic account/attempt deletion, concurrent cleanup, unfinished/other-connection preservation, partial coverage, timeouts and scope replacement. Browser verifies the actual integration prunes excess history with no provider work. |
| Offline and cold restart | Existing bank offline scenarios plus a production-build persistent-profile test: close every client, reopen against an open/unanswered authority, close again, then reopen fully offline. History and account results remain readable without provider requests.               |
| Static/build             | Paraglide compilation, Svelte/TypeScript checks, test TypeScript, Prettier, diff check, Jazz schema/permission validation and production build.                                                                                                                                |

## Browser transaction finding

On installed Jazz alpha.59, the exact completed-history query returned 101 at
Remote tier outside the browser transaction but zero at Remote tier inside it.
The corrected workflow acquires authority snapshots before opening the exclusive
transaction, then reads at LocalFirst inside it and requires matching attempt
and account-result IDs before staging deletion. Tests explicitly reject partial
or mismatched local coverage. No count or local callback is treated as proof of
complete remote history.

Temporary state/count diagnostics used for this investigation were removed.
The retention root uses the existing sanitized actor inspector.

## Rollout and limits

Current structural hash is `e5a4d82f6013`. The existing additive migration
`20261030T233630-bank-sync-log-c9feba2ff2a5-e5a4d82f6013.ts` creates only the two log
tables. Retention changes permissions only and needs no additional migration.
Publish the schema, migration and permissions through the intended release
process before releasing this feature. No production schema deployment ran.

Deletion removes normal permitted records as replicas observe it; physical
removal from every replica/history/backup is not promised. Locally saved imports
are not presented as confirmed remote acceptance. Cross-device passkey/provider
compatibility is unchanged and is not established by the mocked bank tests.
Transaction revision history and the system-account label are outside spec 014.

## Review follow-up: retention owner and optional names

The bank actor now invokes retention and forwards its own connection/access,
browser-offline observation and settled attempt ID. History selection cannot
retarget cleanup. Shutdown closes only after setup/operation and retention have
drained; late observations cannot reopen it. Refresh waits for an actual scoped
binding because XState cannot expose a snapshot during initial ready entry.
The optional profile lookup no longer participates in the history loading/error
boundary, and errors use the existing name fallback.

After implementation approval, 76 tests pass across bank-supervisor, retention
and workspace-readiness suites. Added cases verify online/current-connection
binding, replacement/offline/access observations, refresh after recorded sync,
and shutdown during both setup and sync with an acquired retention resource.

Five focused development-browser scenarios pass: existing import/history,
cancellation and offline behavior; retention of active A at 100 completed entries
after a new explicit sync while viewing B; and readable saved history/connection
selection with an injected profile query failure. The profile test initially
used an obsolete sidebar label; correcting it to Bank sync passes the case
(8.1 seconds). No application assertions were weakened.

The production cold/unanswered-authority/full-offline history scenario passes
again (46.0 seconds including build/startup). Svelte/TypeScript and test TypeScript,
Prettier and diff checks pass. No schema, permission or deployment changes were
needed for these two fixes. This follow-up has been committed.

## Pending complete-review verification

Earlier passing test counts above apply to their recorded revisions. The current
cleanup adds bounded logging waits and removes unused report/context data; it has
not yet been tested. After review, verify never-settling and late log writes,
cancellation through timeout, identical unresolved crash handling, pagination scope
reset and the existing history/import browser scenarios. Schema deployment remains
a separate release step. System-account transaction attribution is implemented.
