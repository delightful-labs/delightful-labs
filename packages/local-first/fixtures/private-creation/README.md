# Private creation qualification fixture

Ten focused tests cover Jazz 2.0.0-alpha.59: four policy cases and six Chromium exclusive-transaction
and process-restart cases. The disposable schema lives outside the published library. This fixture
adds no production storage adapter, journal or consumer domain model.

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

The suite starts temporary local authorities and a Vite browser fixture at `http://127.0.0.1:6198`;
that port must be free. It owns disposable Chromium profiles, restores test credentials only in
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

These tests qualify SDK behavior and fixture policy. They do not exercise the existing DLF creation
owner or journal, prove application recovery/drain behavior, or justify adding a separate persistence
layer. The existing creation stack's review findings are tracked in the
[current task ledger](../../specs/001-local-first-foundation/tasks.md#architecture-review-follow-ups).
No production schema, consumer migration, or cross-platform support claim follows from this fixture.
