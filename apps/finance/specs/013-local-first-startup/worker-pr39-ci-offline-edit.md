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
cannot be recovered from those original artifacts. Do not attribute this failure
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

## Hosted recurrence: native protocol error

At head `85f9e5e1496f1ad8b8bcd8b8092841aaa576dec0`, Finance's
[application-2 job](https://github.com/delightful-labs/delightful-labs/actions/runs/44134571544/job/134221216791)
passed 91 cases and failed the corresponding imported-income offline edit at
`tests/transaction-edit.e2e.ts:254`, waiting for Transaction saved feedback.
The existing diagnostic attachment now captures a real failure, not a synthetic
probe. Artifact `14353110354` contains `offline-edit-machine-failures` in the
income case's trace attachments.

The first captured error has code `protocol` and this sanitized message:

```text
Protocol: Protocol: a write[value redacted]s commit this store cannot resolve
```

The persistence chart then attempts rollback. Jazz rejects that attempt with:

```text
Write error: open transaction [token redacted] is already committed
```

The final result remains `failed` with settlement `unknown`; the enclosing save
reports `partial` / `saveUnresolved`. The case stopped before its persisted-field
assertions, so this recurrence does not establish whether the requested edit
survived. Do not infer the redacted text or replay the write from this evidence.

### Actual transaction paths inspected

The active application still uses alpha.60. In
`src/lib/machines/transactions/independent-transaction-persistence.ts`, `commit`
calls native `tx.commit()` and `settle` calls the resulting handle's
`wait({ tier: 'local' })`. Both error paths currently enter rollback, preserving
an unknown outcome unless Jazz explicitly reports a persisted-write rejection.

Published alpha.60 and alpha.66 have the same relevant distinction:

- `dist/runtime/db.js`: `Transaction.commit()` returns a write handle whose
  transaction ID can settle asynchronously. Obtaining the handle is not local
  persistence confirmation.
- `dist/runtime/native-runtime/native-runtime-adapter.js`: `commitTransaction()`
  records the transaction as committed after native commit returns, before
  subscription pumping and write-handle registration finish. `waitForTransaction()`
  observes native settlement separately. `rollbackTransaction()` refuses a
  transaction already recorded as committed.
- Native callback transactions also attempt rollback when commit fails, while
  preserving the original error. Switching to a callback does not by itself
  establish a fix for this protocol failure.

The second error is consistent with cleanup attempting to roll back a committed
transaction. It is not evidence that rollback caused the earlier protocol error,
nor does it prove local durability or authority acceptance. The attachment does
not identify which internal SDK step produced the first error. Alpha.66's other
passing worker/schema tests do not establish that it fixes this recurrence.

Cleanup candidate for C6: keep rollback for uncommitted transaction work and
preserve the original commit/settlement failure when rollback is unavailable.
Qualify the SDK's actual failure boundaries before changing the chart; do not
replace this with a generic transaction wrapper, string-matched recovery or an
automatic retry. No production transaction behavior changed in this investigation.

The downloaded artifact is preserved at
`/private/tmp/finance-pr46-offline-edit-ci.zip`, with its extracted trace under
`/private/tmp/finance-pr46-offline-edit-ci/`.

## Separate workspace-settings failure

At head `93f05ee8ab4a65619b3ea5ff86271a2f2233a1d8`, the
[workspace job](https://github.com/delightful-labs/delightful-labs/actions/runs/44146695541/job/134263783546)
passed 54 cases and failed the rename/currency/reload case at
`tests/features/workspace-settings.e2e.ts:55`. The retained page shows failed-save
and unknown-result feedback, rather than a successful save missed by a locator.
Its console trace omits the nested cause. This path uses the existing single
`db.update(...).wait({ tier: 'local' })` adapter, not the multi-write transaction
above. Do not assign it the same root cause without the actual error.

Artifact `14356618664` is preserved at
`/private/tmp/finance-pr46-workspace-ci.zip`, extracted under the same prefix.

## Native source follow-up

### Tagged native source and bounded reproduction

The tagged Rust source now identifies the static error family. Alpha.60 and
alpha.66 have identical `sync_conflicts.rs` blobs
(`3f7db8fcd1b0969176caf8e925bdcd2691da701d`):
[alpha.60](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.60/crates/jazz/layers/db/src/sync_conflicts.rs),
[alpha.66](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.66/crates/jazz/layers/db/src/sync_conflicts.rs).
`unknown_base()` constructs this error when a write names a base the receiving
store cannot resolve. Its `another node's commit` variant, passed through the
existing `diagnosticText()` quote-redaction expression, exactly matches the
retained sanitized message. The two apostrophes in the SDK's static wording
cause the redaction; this comparison does not recover private data.

The relevant callers resolve or translate predecessor references across nodes
in `relay_bases()`, `resolve_bases()` and `relay_landed()`. This narrows the error
to native commit ancestry/relay handling, rather than form validation. It still
does not identify which store/branch raised the hosted error or why its reference
was unavailable. Identical code here does not rule out fixes elsewhere, and does
not establish that alpha.66 fixes this case.

A disposable Chromium experiment used each release's actual Wasm client,
persistent SharedWorker, IndexedDB account selection, native test authority and
the existing silent Jazz proxy. Fourteen cases completed and their retained
results were independently checked:

| Scope                            | Cases per release | Observations                                                                                                                                                                                                              |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native single-row transactions   | 5                 | Same-account second document after local seeding; edit staged before predecessor acceptance; edit after acceptance; abrupt reload with Jazz unreachable; abrupt reload followed by predecessor acceptance before editing. |
| Actual Finance persistence actor | 2                 | Both abrupt-reload variants, using the imported-income edit, retained archived tag and new tag/link writes, with native XState development freezing enabled.                                                              |

All ten native cases retained identity and changed amount/memo from the original
to the requested values. All four actor cases reported `succeeded` /
`locallyPersisted`, retained two tag links and had frozen context. Thus those
specific timings do not reproduce the protocol error; they are negative
reproduction evidence, not a fix or exhaustive race coverage. These are document
reloads, not full browser-process restarts or the full Svelte product flow.

One earlier actor-fixture variant began before observing the related tag/link
query shapes. It completed with three links instead of two on both releases.
The comparable cases first verified the locally observed historical tag and
single link, as separate readiness facts; they did not require remote acceptance.
Keep the earlier partial-replica observation separate: it is not the hosted
protocol error and does not justify a global-persistence preflight or new
application repair code. The product form's corresponding readiness behavior
has not been established by this isolated experiment.

Artifacts use the `/private/tmp/finance-offline-protocol-` prefix: `alpha60.log`,
`alpha66.log`, `abrupt-alpha60.log`, `abrupt-alpha66.log`,
`actor-dev-alpha60.log` and `actor-dev-alpha66.log`. The aggregate checked result
is `/private/tmp/finance-offline-protocol-harness/validated-results.json`.
The alpha.60 runner is under the isolated worker checkout's
`apps/finance/tests/offline-protocol/`; the alpha.66 runner is under the retained
`finance-jazz-alpha66-8OYup9/app/tests/offline-protocol/` experiment. Both use
independent dependencies and reused catalogs, preserving user environments.
Temporary research fixtures are not another application implementation.

### Native operation labels in existing diagnostics

The only production change adds the named actor `source` to the existing
sanitized failure report. It reads XState's native actor source metadata through
the existing data-property/identifier checks; opaque logic is omitted. The next
retained child error can identify `commit`, `settle` or `rollback`, even though
the parent snapshot has already advanced to its cleanup state. This needs two
lines in the diagnostic adapter, with no SDK method wrapper, source registry,
transaction-chart change, retry or new patch.

The existing ten diagnostic tests pass, including an actual invoked async child
whose source name and original error are retained. Full app Svelte/TypeScript
checking passes with zero errors and warnings. At `426c6617`, all hosted Finance,
Clipper and foundation jobs also passed. That green run confirms intermittency;
it is not evidence of a fix.

Next inspect a subsequent retained failure's native source label to distinguish
failure of the commit invocation from failure while awaiting its write handle.
A `settle` source can also report rejection of the handle's transaction-ID
promise; it does not by itself prove that commit completed or isolate the native
durability wait. Locate that SDK boundary before proposing a patch or recovery
policy. Retain the existing unknown-save protection and financial identity. Keep
this investigation separate from F4c3's worker/native qualification and production
merge/deployment guarantees.

### Hosted original-case investigation

All normal Finance, Clipper and foundation jobs passed at `4916a48a`, including
Finance's full application-2 shard and the operation-source diagnostic checks.
The original failure remains unexplained.

The separate branch `investigate/finance-offline-edit-ci`, based on that exact
head, runs the two original imported offline-edit cases at most ten times each,
with two workers, no retries and a stop at the first failure. Its job uses the
normal pinned Ubuntu/Playwright container, Node and pnpm versions, the existing
application project/configuration, and disposable in-memory Jazz backend. Traces
are retained for every execution, alongside the existing sanitized machine-error
attachment. No original form/persistence assertion is removed or weakened.

After an attempted but unconfirmed save, a test-only readback records comparisons
against the original/requested fields, provenance and link count. It runs after
the original assertion fails, has a separate five-second bound and does not
issue writes. Its observation is explicitly `live-client-local-read`: it cannot
establish cold-restart durability or authority acceptance.

The diagnostic branch reuses a snapshot of existing Finance catalogs and public
Local First/UI builds, installs with scripts disabled and checks injected package
identity. Its Vite configuration omits only the catalog-generation plugin. These
investigation setup changes stay off PR46 and are not a merge candidate; the
regular qualification workflow remains unchanged. This is a focused CI experiment,
not a claim to reproduce the entire prior shard's history or load.

The [initial dispatch](https://github.com/delightful-labs/delightful-labs/actions/runs/44160298061)
selected no tests because the grep was anchored while Playwright includes project,
file and tag text. No application case ran. The corrected filter was checked
locally with `--list`, selecting exactly 20 executions. Corrected branch head
`5ac961f5` runs at
[44160709480](https://github.com/delightful-labs/delightful-labs/actions/runs/44160709480);
it passed all **20 cases in 2.7 minutes**, with zero retries, skipped cases or
flaky/unexpected results. The result archive contains 20 traces and no
machine-failure attachments. Thus the real CI environment and repeated original
cases still do not reproduce the protocol error. Do not call the issue fixed or
continue increasing repetition without a new hypothesis or failure evidence.

Artifact `14363312293` is retained locally at
`/private/tmp/finance-offline-edit-hosted-batch.zip`; its verified SHA-256 is
`22a852a7294632aef24822fb283bded60946c3a2c1e168fae3e16b7c257d93d4`.
The extracted result JSON and checked summary use the same prefix with
`-results.json` and `-summary.json`. GitHub retains this diagnostic artifact until
2026-11-24.

The failure-only readback is also retained in the ordinary PR46 test cases,
reusing the existing `persisted()` helper. Readback collection was included in the
20 hosted product cases above. Its final bookkeeping uses one unconfirmed-request
record in place of four fields/flags and passes strict browser test TypeScript
checking. Those successful cases do not execute the unconfirmed-save readback
branch or establish what the hosted failed write did. There are no additional production changes, SDK patches
or financial retries; the workflow/catalog snapshot setup remains confined to
the investigation branch.

Keep the issue open with the source labels and readback available for its next
real occurrence. In the absence of a reproduction, no application recovery
change is justified by this batch. Continue qualifying the SDK upgrade on its
existing evidence and retained-data gates, without claiming it resolves this
alpha.60 failure.
