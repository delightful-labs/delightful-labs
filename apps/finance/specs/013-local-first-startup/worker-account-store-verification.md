# W04: IndexedDB AccountStore qualification

Completed 2026-11-13 in the isolated `feat/finance-worker-inventory` worktree,
based on monorepo `main` `670fb720e15b15a4b308408c92301bd29a943561`.
The user authorized publication of these foundation changes in a PR after
qualification. The user reviewed the
concrete store and explicitly approved adding/running its focused native/browser
tests. No W02 or historical testing approval was inferred.

W04 qualifies the shared native store and its actual packed public consumer.
W05 owns Finance/Clipper adoption, existing single SDK/session binding and
remaining broker/close extraction; W06 owns persistent SDK/runtime qualification.
This task boundary avoids making W04 depend on its dependent W05. Both app
adoptions remain required; the fixture is not a claim those apps have switched.

## Implementation and correction

The [Local First adapter](../../../../packages/local-first/src/lib/backend/jazz/indexeddb-account-store.ts)
exports `createIndexedDbAccountStore` from
`delightful-local-first/backend/jazz/account-store/indexeddb`. Its XState owner
admits eight calls, serializes its FIFO, rejects queued work on close and waits
for original native transaction/open receipts. The native adapter requests
strict durability, performs the synchronous SDK transform/replacement inside one
IDB transaction, and acknowledges only transaction completion. No SDK session or
production caller was added.

Native qualification found one real edge case: IDB `get()` returns `undefined`
for both absence and a stored undefined value. That violated the requirement
that corrupt records fail rather than appear empty. The read now uses an exact
key cursor: null means absent, while any existing non-string/oversized value
aborts/fails. The regression covers number, null, undefined and oversized records.
There is still one atomic read/transform/write operation and no extra migration
metadata or fallback path.

## Executed checks

Pinned tools: Node 24.22.2, pnpm 10.28.0, XState 6.0.0-beta.1 and Local First's
Playwright 1.60.0. Missing Firefox/WebKit binaries for this package's exact
Playwright release were installed; the final run uses all three engines.

| Check                                                     | Result                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter delightful-local-first check`              | Full library/test types, zero Svelte errors/warnings; TypeScript passes.                                                                                        |
| `pnpm dlf:test`                                           | 53 files / **1,111 tests passed** in 2.86s. Includes 13 new owner cases and a 300-run generated campaign.                                                       |
| `pnpm --filter delightful-local-first test:account-store` | Packaging/strict publint, fixture types, packed public consumer types/build, and **60 native cases passed** in 18.15s (native Vitest duration). No final skips. |
| Changed-source Oxfmt/Oxlint                               | Passed, with denied warnings.                                                                                                                                   |
| `pnpm build:libraries`                                    | Both shared libraries package successfully, including strict publint for the new export.                                                                        |
| Monorepo guidance/local links/whitespace                  | Checked with current handoff updates.                                                                                                                           |

The reproducible native command packages current source before running. Its
fixture packs/extracts a tarball into a disposable independent consumer, resolves
the supported subpath there, type-checks its SDK `AccountStore` conformance, then
builds a self-contained module worker. A graph guard requires the packed public
entry. Forced-actor-stop cases additionally create test-owned internal roots;
production consumers continue using the supported export.

The native command is included in Local First's `verify` and the monorepo
Local First CI job. Existing CI gates and job selection remain enabled. These
are local results, not a hosted CI or deployment claim.

## Native scenarios

Each engine runs the same 20 cases, using real IndexedDB and dedicated workers:

- Empty store, commit and reopening the packed public store in a fresh worker.
- Concurrent transforms in workers in two tabs, retaining all 24 independent
  updates without lost writes.
- Thrown transform, oversize output, injected quota error and actual native
  transaction abort after successful put; old bytes remain and errors are safe.
- Corrupt persisted number, null, undefined and oversize values fail, not empty.
- Close after put success: queued updates are not issued; actual transaction
  completion precedes native close acknowledgement.
- A canceled pending native open retains its original request, closes a late
  acquired connection and does not block a subsequent real upgrade.
- Forced actor stop during its transform and native transaction creation:
  original abort evidence is retained, no orphaned replacement is written.
- Real version change releases the old connection and refuses later calls.
- Injected native close failure cannot acknowledge safe closure/reopen admission.
- Whole-worker termination before issue, at put success and after commit. The
  middle case permits either exact old or exact new bytes, never partial data;
  after-commit requires new bytes. A replacement worker can read and write.
- Three persistent browser-process launches using one disposable profile: reopen
  the committed value, edit offline, then reopen that edit after another restart.

The 13 owner tests separately cover pre-open admission, eight-call bounds in
opening/running, synchronous native completion, stale/duplicate settlement,
close/cancellation, failures, retained native close and forced stop. The pinned
`@xstate/test` campaign uses seed `20261113`, 300 runs, up to 24 commands, full
contract event/state/transition coverage and failure key
`indexeddb-account-store-owner`. The independent demand/result ledger compares
native issue order and caller outcomes without reading production actor context
or private child refs. It is bounded sampled evidence, not exhaustive proof.

## Fixture scope and limitations

Profiles/database names are disposable; protected Finance servers 5173/5174 and
user storage were not used. The inert fixture document is fulfilled at a synthetic
HTTPS origin with no real server. The prebuilt worker bytes use a local Blob.
All AccountStore construction, reads/writes, and persistent reopen checks run
with the browser context offline. The fixture's document/module bytes are
bootstrapped before switching offline; this does not qualify an application's
production worker URL or service-worker precache. W06/W20 retain that requirement.

The quota/close errors are explicit injections into real native methods, not
physical disk exhaustion. The store tests do not qualify live SDK authentication,
replica persistence/reconciliation, financial transactions, actual app UI or full
application-worker cold startup. App adoption/removal of old transports remains
W05, and the current Window-owned application is still active.

The user's explicit scope excludes migration, localStorage import/fallback, dual
writes, source cleanup, migration markers and old-version compatibility code.
Existing localStorage values are ignored by this adapter, not deleted by tests
or implementation. No browser/SDK namespace reset or source cutover occurred.

## Failed attempts retained honestly

- The first shutdown oracle registered its completion listener after production's
  handler. Native dispatch can run Promise microtasks between listeners, so it
  observed too late. It now registers before production callbacks; the ordering
  assertion was retained. Initial run: seven passed, one fixture assertion failed.
- The initial available-engine run passed 17 Chromium cases but could not launch
  the required Firefox/WebKit versions. Installing their pinned binaries fixed
  that setup failure; those suites are not silently skipped in final evidence.
- The stored-undefined regression failed against the original native `get` read,
  confirming the real bug above. The cursor fix passes the retained regression.
- The first full unit run could not bind three native Jazz fixture listeners in
  the sandbox (1,040 passed, 71 unrun). The authorized listener-enabled run passed
  all 1,111 tests; this was an environment failure, not an app assertion failure.
- Firefox/WebKit reject offline fixture-document navigation before interception.
  WebKit also exposes Blob worker loads to routing; an overly broad deny rule
  intercepted them. Fixture bootstrap now completes before offline store work,
  and HTTP(S)-only denial does not intercept local Blob loads. No IndexedDB
  assertion or durability requirement was weakened.

Raw logs are retained locally under
`/private/tmp/finance-worker-w04-670fb720/`, including native/full-unit/type/build
results and the corrupt-record/fixture diagnostics. The tracked fixture and
commands make the final results reproducible without those temporary logs.
