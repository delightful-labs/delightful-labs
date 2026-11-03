# Private creation qualification fixture

Twenty-six focused tests pass: four Jazz 2.0.0-alpha.59 policy tests, six Chromium SDK process
restart/exclusive transaction tests, and sixteen Chromium journal adapter tests. This directory is outside the published library and defines
an isolated qualification schema, not a consumer domain model. No consumer deployment is used.

The owner may read its own workspace and operation rows. Both tables deny updates and deletes.
Workspace insertion requires a matching owner-bound marker whose intended workspace ID is that row's
ID. The marker policy does not query the workspace, keeping policy dependencies acyclic. An owner
can insert an orphan marker; that marker is not a completed workspace.

## Running coverage

Install the locked dependencies and matching browser with `pnpm exec playwright install chromium`.
From the repository root, run:

- `pnpm exec vitest run --config fixtures/private-creation/vitest.config.ts`
- `pnpm exec tsc --project fixtures/private-creation/tsconfig.json`
- `pnpm exec oxlint --deny-warnings fixtures/private-creation`
- `pnpm exec oxfmt --check fixtures/private-creation`

The suite starts temporary local authorities and Vite browser fixtures at `http://127.0.0.1:6198`
(SDK) and `http://127.0.0.1:6199/journal.html` (journal); both ports must be free. It owns disposable Chromium profiles, restores test credentials only in
memory, and removes profiles on completion. Sandbox permission may be needed for listeners and browser
processes. The suite is separate from default library unit tests. Browser controls expose individual
SDK boundaries to the tests; they are not production creation orchestration or public package exports.

## Established behavior

Four mergeable-transaction policy cases check matching atomic insertion and foreign read denial;
atomic rejection of a mismatched record set; forged owners, missing markers and foreign marker
substitution; and permitted orphan markers without workspace creation. The matching case also
checks immutable ownership/fingerprint fields and denied deletion. Global waits check authority fate.

Six real-browser cases check:

1. Exclusive commit confirmation with a configured authority, followed by browser process closure
   and recovery of the exact workspace/marker identities in the same persistent profile.
2. Abrupt process termination before commit, followed by absence of both rows on the authority.
3. Abrupt termination after confirmation, followed by recovery of the matching accepted pair without
   replaying writes.
4. Abrupt termination immediately after commit issuance without waiting or retaining a transaction
   ID. Restart reads both stable IDs: either the complete matching pair exists or both are absent.
   Absence remains unresolved evidence and does not authorize retry. The test makes no replacement write.
5. Two independent browser profiles restored to the same account concurrently create different
   operation markers for one workspace ID. Exactly one exclusive commit succeeds; the other produces
   a rejection/conflict. Both clients observe the winner and no accepted losing marker.
6. After confirmation and local read-back, stop the authority, kill Chromium, reopen the same profile
   and read the exact saved pair locally while the authority remains unavailable. The fixture web
   server stays available; this is not an offline app-shell/service-worker test.

Crash tests use the public DevTools process-info command to identify the fixture's browser process,
send SIGKILL, observe disconnection and close Playwright's owned process resources before reopening.
They do not simulate a crash by closing a tab or shutting down the Jazz session gracefully.

## Limits

The exclusive collision result qualifies this concrete immutable fixture and these stable IDs; it
does not establish every application uniqueness rule or authoritative completeness of arbitrary
queries. The commit-gap race does not force every possible transport schedule. A missing pair after
restart remains unknown; no supported historical transaction-fate lookup is demonstrated.

These tests qualify SDK behavior and fixture policy. A supplemental browser journal adapter is implemented and separately covered below. It is not
integrated into the creation actors or extracted journal already shipped on main. Integration,
unknown-write reconciliation and drain/rejection behavior for this adapter need separate review. They are not qualified by these fixture controls. No production
schema, consumer migration, invitations or cross-browser/platform support claim follows from this run.

## Journal adapter verification

Sixteen Chromium cases in `journal.test.ts` import the actual internal browser adapter through
`journal-browser.ts`. The journal fixture uses native IndexedDB without starting a Jazz session or
requiring an authority. Its coverage is distinct from the ten SDK/policy cases above:

- Two separate pages contend for one insert and one revision advance; exactly one of each persists.
- Host/account/operation keys stay separate; workspace/fingerprint substitution and duplicate insert
  conflict, while the original stored identity remains unchanged.
- Unsafe revisions, skipped evidence steps, stale revisions and advancement of a missing operation
  cannot alter a valid record.
- Five terminal paths persist accepted, denied, conflict and either precommit-abort state, and reject
  later evidence changes.
- Mutating caller identity, read key and evidence after invocation cannot change the queued operation.
  Only declared identity fields reach storage.
- Stored undefined, malformed/corrupt records, unexpected fields and unknown record versions remain
  unavailable on read, insert and advance, with the original raw values preserved.
- A future database version and incompatible store layouts are refused without schema repair.
- An injected native add-success listener aborts the real storage transaction. The adapter reports
  storageFailed after abort and a later read finds no record; add success cannot become persistence.
- Injected blocked-open events exercise both subsequent upgrade abortion and late connection success.
  Actual native opens complete after abandonment. No journal entry is written, and database deletion
  succeeds without a blocked connection. The event itself is injected; this does not claim Chromium
  naturally emitted blocked for a version-1 open in these cases.
- An injected synchronous factory failure returns storageFailed, while invalid inputs are rejected
  before opening a database.
- With browser networking offline, persist intent, commitPossible and authorityAccepted journal
  records, kill the complete Chromium process, reopen the same profile and read exactly the same
  records with networking offline again. The fixture HTML/module is served before disabling network.
  Recovery reads do not advance the evidence or replay SDK writes.

No journal implementation correction was required by these cases. Fixture TypeScript, source
TypeScript/Svelte, focused lint/format and diff checks pass. These results cover Chromium on this
macOS host; they do not qualify other browsers, eviction, power loss, or an offline app shell.
The creation workflow must still enforce evidence provenance and retain unknown mutation outcomes;
a journal's ability to store a supplied evidence value does not establish that value's truth.

The public creation workflows and existing journal remain unchanged. This supplemental adapter has
its own private contract module (`workspace-creation-journal.ts`), schema and database namespace; it
must not be substituted for the existing journal or used to require authority waits during creation.
