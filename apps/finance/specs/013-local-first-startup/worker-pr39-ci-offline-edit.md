# PR #39 offline transaction-edit CI investigation

Status: unresolved; diagnostic coverage added, no application fix established.

At head `c0606557`, Finance's [application-2 job](https://github.com/delightful-labs/delightful-labs/actions/runs/43665593252/job/132664160697)
passed 91 cases and failed the imported-expense offline category/tag/note edit.
The trace shows the intended draft values and selected tag, followed by
independent-transaction-persistence errors and the existing unknown-save-result
feedback. The stored transaction retained all original values. The failure is
not merely the persistence assertion running before a successful save. The
image-editor cases passed this run.

The original trace records console objects as shallow previews, omitting the
nested sanitized error details. Browser offline mode also prevents Vite from
forwarding those diagnostics to the server log. The precise SDK error therefore
cannot be recovered from the uploaded artifacts. Do not attribute this failure
to worker callback code or call it a fixture race without further evidence.

## Diagnostic change

The two imported offline-edit cases now retain the existing sanitized machine
diagnostic objects in an `offline-edit-machine-failures` JSON attachment. A
`finally` block attaches them even when an assertion fails. They also require
the existing Transaction saved feedback before checking persisted fields;
Save Transaction becoming disabled alone can indicate an operation in progress.
All field, provenance, tag-link and reload assertions remain. There are no
production changes, retries, timeout increases or new SDK patches.

## Local evidence

Using Node 24.22.2/pnpm 10.28.0 and the isolated disposable Finance fixture on
port 5198, preserving user ports 5173/5174:

- Both original cases passed six times each (12 cases) with temporary commit/
  settlement error diagnostics; no persistence error was observed.
- The matching application-2 shard passed all 92 cases with those diagnostics.
- A controlled probe disconnected Jazz before creating the imported fixtures
  and used client-side navigation to retain that disconnected session. Both
  cases passed. Pending seed writes alone did not reproduce the failure; do not
  change fixture durability to global on this evidence.
- All temporary production diagnostics, seed disconnection and navigation
  changes were removed. Only the test diagnostic attachment and completion
  assertion remain. Strict browser TypeScript and both focused cases pass on
  that final test change.
- A temporary synthetic sanitized diagnostic emitted while browser-offline was
  recovered intact, including its nested error, in the Playwright attachment.
  That one-case probe passed; its injection was removed before upload. This
  qualifies diagnostic capture, not reproduction of the original SDK failure.
- Shared guidance/link discovery passes in all six project contexts.

Original artifact `14141889794` is preserved at
`/private/tmp/pr39-transaction-edit-failure.zip`, with extracted trace, screenshot
and error context under the same prefix. Logs are
`/private/tmp/pr39-offline-edit-diagnostic.log`,
`/private/tmp/pr39-application-2-diagnostic.log`,
`/private/tmp/pr39-offline-edit-pending-seed.log` and
`/private/tmp/pr39-offline-edit-diagnostics-check.log`.

## Next step

Inspect hosted results for this diagnostic change. If the failure recurs, read
the JSON attachment to identify the failing operation/error before proposing an
application correction. A green run establishes intermittent behavior, not an
explanation or a fix for the original failure. Keep that qualification separate
from F4c3's worker/native tests and from production merge/deployment guarantees.
