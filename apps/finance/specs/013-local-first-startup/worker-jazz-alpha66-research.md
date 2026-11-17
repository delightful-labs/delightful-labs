# Jazz alpha.66: release audit and revised upgrade order

Researched 2026-11-17 against the published package, not just the release notes.
The upgrade target is now **2.0.0-alpha.66**. Live workspace pins and the active
patch remain alpha.60. The maintained schema and `--worker` modes now qualify
bounded alpha.66 slices below. The historical default worker/caller mode still
targets alpha.65; its results must not be relabeled as alpha.66 qualification.

The user reiterated the design constraint during this audit: concentrate Jazz
integration in thin native adapters and app-owned native schemas/permissions;
use Svelte, XState and Jazz for the behavior they provide. A missing SDK feature
usually belongs in limitation notes first. Implement additional coordination
only for a demonstrated application requirement that cannot wait for upstream.
Do not turn this release audit into another compatibility framework. This is
also recorded in the [shared engineering guidance](../../../../docs/engineering/dependencies.md#prefer-native-library-behavior-and-small-integration-surfaces).

## Evidence and scope

- npm published alpha.66 at `2026-11-17T02:49:04.462Z` (November 16, 9:49 PM EST).
  `latest` selects alpha.66; `alpha` still selects alpha.60. The GitHub release
  was published later, at `2026-11-17T04:25:36Z`.
- Downloaded the npm tarball and verified its SHA-512 integrity:
  `sha512-jQt0f+/YqYtkwHEce39gZ3eJ8mgq4/A5f64kRtYvc1b1l2mk+B2ol5Q6QeXUE8fUUYQTlohiCzgw4ztzrRhiLQ==`.
- Compared the distributed JavaScript/declarations with pristine alpha.65,
  including all six files touched by the isolated worker bridge, session
  startup/retry/close, Svelte bindings, schema/permission/migration APIs,
  backend configuration and upgrade tooling. Inspected both apps' actual
  schema/permission callers and Clipper's transform implementations.
- Primary references: [release notes](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.66),
  [native session implementation](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.66/packages/jazz-tools/src/session/jazz-session.ts),
  [public client factories](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.66/packages/jazz-tools/src/session/create-jazz-session.ts),
  and [upgrade implementation](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.66/packages/jazz-tools/src/upgrade/index.ts).

Local evidence is retained at `/private/tmp/finance-jazz-latest-audit`: npm
metadata/tarball, focused source diffs, GitHub release/compare JSON, native probe
source/log/results and the close-failure reproduction below. These are audit
artifacts, not committed application code or a whole-app qualification suite.

## Session boundary: keep the supported awaited factory

The new public `startJazzClient(config)` returns the native session immediately
in `starting`. A failed start remains observable as `error`; `retry()` starts
again on that same facade. The source also fixes a race by clearing the failed
startup promise before notifying observers, allowing an observer to retry.

A disposable production-build probe used the unpatched published SDK and its
matching alpha.66 Wasm, the existing Local First IndexedDB AccountStore/build
helpers, and the memory database driver. All **24 cases pass**: ready device
startup, signed-out startup, loader failure followed by retry, and close during
a held loader, in both Window and a dedicated Worker, in Chromium, Firefox and
WebKit. The close cases verify that the promise remains pending until startup
settles and repeated close returns the same promise. Each case uses a fresh
browser context and an ephemeral test origin with no working Jazz/auth backend.
This verifies lifecycle behavior only, not persistent-worker retention, Finance
schemas, real backend identity or application adoption.

There is a material failure-path limitation. In `ownJazzSession.start()`, a core
that arrives after close is immediately closed. If that close rejects, the
startup promise rejects; `session.close()` awaits that promise with
`pending?.catch(() => {})`, then resolves because the core was never assigned.
The public snapshot remains `closed` without the error. A source-level probe
against the installed, unchanged session engine reproduced this exactly:

```js
const held = Promise.withResolvers()
const entered = Promise.withResolvers()
const session = ownJazzSession({}, () => {
	entered.resolve()
	return held.promise
})
await entered.promise
const closing = session.close()
held.resolve({
	close: async () => {
		throw new Error('late core close failure')
	}
})
await closing // Resolves; the close failure is lost.
```

`ownJazzSession` is the internal engine the public factory directly delegates
to. The injected core isolates the failure path; this is not evidence that a
real browser database failed to close. Reproduction output is
`late-close-failure.json`; native successful cases are in `probe/results.json`.

**Selected approach:** retain the current public `createJazzClient()` leaf and
the approved actor's awaited acquisition/close protocol. The actor waits for
the issued open, then explicitly closes the acquired resource and observes its
result. Do not switch factories solely to remove these states, add a new SDK
patch, or add a second close supervisor. Reconsider the immediate factory when
upstream propagates late-resource close failures and the same failure-path
qualification passes. The private adapter still provides one place to change
SDK calls later.

This finding is a recorded upstream limitation, not an additional implementation
task. Do not add compensating code for it. The existing supported awaited
factory already avoids selecting this new path.

The enumerable `session.db` getter is unchanged and still throws without a
ready client. The [approved private actor boundary](worker-session-resource-decision.md)
remains necessary; alpha.66 does not make raw SDK facades safe in XState context.
Its client-only Svelte session helpers expose observations but reject session
operations; they cannot replace the worker's native session owner.

## Schema and permissions are an earlier prerequisite now

Alpha.66 removes functional `defineApp`, callback `definePermissions`, schema
slicing and `schemaToWasm`. The retained export names throw `JAZZ_API_REMOVED`;
they are not compatibility implementations. Runtime callers import `app` and
row types from generated bindings. Authoring uses `s.defineSchema`, its typed
permission DSL and `jazz-tools generate`; the backend takes the generated
permissions JSON instead of the previous compiled permission map.

This affects real source, not hypothetical usage:

- Finance's `src/lib/schema.ts` defines both `previousApp` and the restore app
  with `defineApp(..., { migrations: 'none' })`. Its `permissions.ts` composes
  normal policies and restore overrides from callback-based definitions.
  Preserve both the backup/restore schema boundary and the resulting complete
  permission behavior when moving to generated bindings. Actual alpha.65
  compilation marks **22 transform columns** across accounts, checks,
  transactions, transfers and bank-sync logs. Their implementations are
  `schema/text-column.ts`, `schema/transactions.ts` and `schema/bank-sync-log.ts`.
  Port the existing validation and number/BigInt conversion through native named
  transforms; do not add a shared financial codec framework or weaken precision.
- Clipper's `backend/jazz/schema.ts`, `auth-schema.ts` and `permissions.ts` use
  the removed APIs. `reading-columns.ts` has two real transforms: maximum
  reading progress and last resume position, both stored as string grow-only
  sets. Alpha.66 uses named declarations and implementations in `jazz.computed.ts`.
  The subsequent [qualified port](#clipper-native-schema-foundation) keeps that
  mechanism for progress and uses native resume sets plus existing record codecs,
  preserving encoding, merge and ordering without a nullable-transform repair.
- The alpha.66 upgrader requires fresh legacy app/permission JSON and runs the
  app's installed legacy validator. Although the release guide discusses
  alpha.64/65, `upgrade/fresh.js` accepts DSL-era versions through alpha.65,
  including alpha.60. Neither app currently commits those generated JSON files.
  The actual direct attempt validated Finance's 23 tables on alpha.60, but that
  validator writes no required app/permission JSON; alpha.66 dry-run therefore
  refused the missing files. Reusing the existing disposable alpha.65 compiler
  produced the files and validated all 23 tables. The subsequent alpha.66
  dry-run refused the recorded transforms. Both apps need a deliberate manual
  transform port. The alpha.65 output is an isolated comparison baseline, not
  an intermediate live upgrade. Do not blindly run the codemod against either
  live workspace app.

Extend U3 to establish the schema/history/generated artifacts in isolation
before broad U2 caller adoption. Check schema hashes, bundle identity, permission
tests and retained data. Do not hand-edit generated files or use `--force` to
bypass identity/provenance checks. SDK schema history is separate from the
explicitly excluded account-selection migration code.

## Worker, backend and financial behavior

The existing six-file worker-only patch passes `git apply --check
--whitespace=error-all` against pristine alpha.66. Three touched files are
unchanged from alpha.65; client, Db and session-factory files changed but their
patch hunks still match. The Window-only broker path has not gained our worker
host capability. Re-run the actual persistent save/edit/two-cold-restart proof
on alpha.66 after the schema port. Applicability is not runtime qualification;
the other existing SDK patch responsibilities remain separate gates.

Alpha.66 also fixes `forUser` transaction claim ownership and earlier write
refusals in `waitForSync()`. These do not replace Finance's per-operation
identity, local/global settlement, uncertain-write handling or domain drains.
No corresponding application workaround was established as deletable here.
Backend clients with permissions now check the admitted bundle before
`forUser`; generated app/permission identity belongs in U4's backend checks.
The Better Auth adapter pushes supported sorting/pagination into the engine and
rejects unsupported query shapes; qualify actual auth flows rather than adding
an application fallback scan.

The release states that storage format and protocol version remain unchanged
from alpha.65. It also requires server-first upgrades for affected unnamed-union
queries and adds an optional wire feature for serializable branch reads. None
of this qualifies our alpha.60 retained stores or changes Finance's destination
retention gate. Preserve preview and production data; Clipper's preview reset
approval does not extend to Finance.

## Finance native schema foundation

The maintained [schema experiment](../../tests/worker-upgrade/README.md#alpha66-finance-schema-permissions-and-retained-data)
now runs with `node tests/worker-upgrade/run.mjs --schema`. It uses the unpatched
published alpha.66 package and matching native core. Workspace dependencies and
the separate alpha.65 worker/session experiment remain unchanged.

The inactive source overlay keeps Finance's modular tables, replaces the old
callback/raw permission composition with native `schema.definePermissions`, and
declares eight native named transforms for the 22 existing column uses. Their
implementations reuse existing validators and BigInt conversion in
`jazz.computed.ts`, checked against Jazz's generated `AppTransforms` type. The
old `validatedTextColumn` wrapper is deleted. Runtime queries/types move out of
the authoring entry. No adapter framework or new SDK patch is introduced.

The SDK's own compiler/upgrader confirms identical identities:

- Current stored schema, including the alpha.60 baseline:
  `b33f0ec2011b495d8d345a92a9047724789fea986aaae6513df707abf9ba0633`.
- Permission bundle:
  `9be840f3bc2ff7e6543bfbc7bb48d9ed9ba946e826677e8e39150c33a985d9e2`.
- Schema-version set: the same single current version; no schema transformation
  or data reset is needed for this authoring port. `migrations create --name initial`
  records it through native tooling.

Strict selected authoring/query/transform/native-fixture types and native
`generate --check` pass. All **138 cases pass**: 128 existing full-policy and
bank-log cases plus ten native transform/retention cases. A real alpha.60 SQLite
store, closed before the new SDK opens it, retains its app identity, records,
normalized text and maximum-safe minor-unit amount. A new alpha.66 edit survives
another native close/reopen. These use isolated test authorities and directories.

One native behavior change is explicit: alpha.66 bypasses transforms for null.
An absent optional amount now reads null; alpha.60 passed it through the old
`Number(value)` conversion and read zero. A stored zero stays zero. Existing
transfer matching selects its legacy amount/currency path from the nullable
side currency, and restore staging already omits null side fields. Keep native
null semantics; do not emulate the old conversion. Backup/restore's complete
caller qualification remains required. Counts use the existing native INT
range; BigInt amounts retain their validated safe-number view.

The initial authoring checkpoint did not port the historical two-app
`previousApp` restore experiment or backup table typing. The subsequent backup
checkpoint below handles the production reader; the full restore harness remains
open. This does not qualify all Finance callers,
Clipper, browser worker durability, backend auth, every existing patch
responsibility or Finance's retained Vercel destinations. Keep U3/U4/U5 open.

Final packaged proof: `/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-GJSvMl`;
log: `/private/tmp/finance-alpha66-schema-final.log`. Strict fixture types, native
generation/identity checks and all 138 cases pass in that same clean copy. Active
alpha.60 Finance test types, workspace links and shared guidance checks also pass.

### Finance backup caller and retained archive

The maintained schema mode now also compiles and runs the actual backup reader,
its existing workflow and all 37 native backup cases. The inactive caller uses
only current generated queries: it removes the previous-schema override and
per-read table choice, without changing the released-field allowlist or archive
profile. No old schema is needed in the production reader.

A native diagnostic rejected current-schema queries on a Db initialized with
the older schema: `Db is already initialized with a different schema`. Selecting
only common fields does not remove Jazz's exact schema binding. Do not work
around it with a schema-swapping Db facade. Instead, `backup-seed.mjs` runs the
actual released v1 reader with its own preceding schema/permissions on alpha.60,
using a real device account and disposable native authority. Alpha.66 separately
opens and validates those retained archive bytes. Workspace/account IDs,
maximum-safe financial amounts and attachment bytes survive exactly.

The fresh proof passes **176 tests**, strict selected types (now including backup
tests and their reader/workflow), native generation/check and unchanged schema/
permission identities. Artifact directory:
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-UmoCBx`;
log: `/private/tmp/finance-alpha66-backup-proof-final.log`. This includes the
previous 138 cases, 37 backup cases and one cross-version archive case. It does
not establish alpha.66 restore staging/publication, cancellation, identity
replacement, pending-write drains or the full 107-case historical suite. Port
that existing workflow/harness next, retaining its behavioral checks and the
approved shared application Db. The older independent account-client probes
must not drive a replacement SDK facade around removed APIs.

### Finance shared-Db restore browser slice

The next inactive port changes two existing implementation files: restore
binding uses public `user.accountId` and exact user/client/Db replacement checks;
planning uses the native top-level `RowOf` type. The existing controller,
planning, journal, destination and transaction charts stay in place. No account
client is reopened and no SDK patch, replacement session facade or command
framework is introduced.

The maintained schema mode now runs 12 real browser cases, four each in
Chromium/Firefox/WebKit, using the real application controller and public awaited
Jazz factory. The retained alpha.60 v1 archive restores through the same Db as
the application. The authority confirms maximum-safe minor units, attachment
bytes and exact retained source-payload bytes. After native close and page reload,
the completed IndexedDB journal recognizes the same file and destination without
repeating writes. The shared Db remains usable after completion/cancellation.
Cancellation at review, native same-account replacement and A → B → A all reject
old confirmation before destination effects. Development context freezing stays
enabled; SDK resources remain outside that context.

Fresh combined result: **188 passing tests**, strict selected schema/backup/
restore/browser types, native generation/check and unchanged schema/permission
identities. Artifact directory:
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-lwveJB`;
log: `/private/tmp/finance-alpha66-restore-proof-final.log`.

This is not the full 107-case historical suite. The clients use memory data
drivers with actual browser IndexedDB journals; page reload does not establish
persistent-worker retention or full browser-process restart. Keep accepted-commit
interruption/drains, conflict and blocked-cleanup recovery, and the broader
policy/role matrix open. Reuse the existing authority-delay/proxy tests when
porting those cases; do not replace them with a simulated SDK transaction.

### Accepted-commit interruption and drain

The same browser proof now includes cancellation and native identity replacement
after the authority accepts the financial commit while the real transport proxy
withholds its response. Both scenarios pass in Chromium, Firefox and WebKit.
The application actor remains active, retains its artifacts and does not publish
membership until its native receipt settles. After transport resumes, artifacts
release exactly once. Reopening the same journal/intent resumes the same
destination, commits only activation and preserves the accepted financial rows;
the preparation/financial steps are not replayed. Development freezing remains
enabled throughout.

This reuses `tests/helpers/silent-jazz-proxy.ts` and the existing restore probe.
The probe's unchanged chart body moves from the historical browser harness into
[`tests/helpers/restore-probe.ts`](../../tests/helpers/restore-probe.ts), shared
by both SDK versions. Its input is the actual Finance plan rather than the
browser harness's larger sample DTO. The two original alpha.60 accepted-commit
cases pass after extraction, as do active Finance test types. No production
workflow, session/Db facade, dependency or SDK patch is added for this slice.

Fresh combined proof: **194 passing tests**, including **18 browser restore
cases**, with strict types, native generation/check and unchanged identities.
Artifact directory:
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-agns1k`;
log: `/private/tmp/finance-alpha66-drain-proof-final.log`. The alpha.60 pair is
recorded in `/private/tmp/finance-restore-probe-alpha60-native.log` (2 selected
cases pass; the other 105 were not rerun). The full historical suite, conflict/
blocked-cleanup recovery and broader policy/role coverage remain open on alpha.66.
These memory-driver browser tests do not qualify persistent-worker storage,
process-restart recovery or full application adoption.

### Destination conflict and artifact cleanup retry

Six further cases reuse the same native browser harness, with no application
chart or SDK implementation changes. In Chromium/Firefox/WebKit, an authority
edit to the accepted financial row before resume produces a conflict. Resume
does not write or publish membership, preserves the edited destination and
retains the previous journal record. The check independently reloads that record
from actual IndexedDB. This matches the historical workflow: conflict is the
operation's outcome, while the existing checkpoint/evidence remains unchanged.
An initial test expectation of a replacement `conflict` checkpoint was corrected
after reviewing that chart and its historical assertion.

Each browser also exercises one controlled artifact-release failure after real
publication. The existing `artifactsBlocked` state retains custody; cancellation
does not claim release. `RETRY_RELEASE` releases once on the second attempt,
leaves the shared application Db usable and performs no additional Jazz commits.
The fixture uses the existing native session/probe and journal-step actor rather
than a simulated transaction or new cleanup mechanism.

Fresh combined proof: **200 passing tests**, including **24 browser restore
cases**, with strict types, generation/check and unchanged schema/permission
identities. Artifact directory:
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-4SeMpE`;
log: `/private/tmp/finance-alpha66-recovery-proof-final.log`. This does not port
the full historical suite, prove every conflict/rollback/restart/cleanup variant
or establish persistent-worker/process-restart behavior. Keep those boundaries
and full policy/role coverage explicit. The next foundation is alpha.66's actual
worker/session requalification before broader caller adoption; these passing
memory-driver restore cases do not substitute for it.

## Alpha.66 persistent worker and private session adapter

The maintained [worker mode](../../tests/worker-upgrade/README.md#alpha66-persistent-worker-and-session-boundary)
now runs with `node tests/worker-upgrade/run.mjs --worker`. It reuses the schema
pipeline, existing six-file SDK bridge patch, session/recovery adapter patch,
Svelte consumer patch and all 30 native fixture cases. The one worker import
moves from the old authoring entry to native generated queries. No SDK bridge,
adapter, actor or fixture behavior is added or changed for this version.

The complete run passes **200 schema/restore checks and 30 worker/session cases**,
strict selected adapter/fixture types, Svelte checks with no errors/warnings,
native schema/history/identity checks, and one broker asset per production and
development build. Cold browser-process restarts preserve offline Finance saves
and edits in Chromium/Firefox/WebKit. Actual SDK sessions stay inside dedicated
Workers with development XState freezing enabled; signed-out startup, held
acquisition/close, loader failure/retry and SDK/AccountStore/broker teardown pass.
The native Svelte provider and actual Finance recovery component also pass.

An unpatched Chromium control uses the published alpha.66 package with the
patch-only host option omitted. Its bridge counter assertions are omitted only
in the disposable diagnostic; every actual row/identity/save/edit/close check
is retained. It saves and edits successfully in the first process, retains the
account ID in the next process, but returns no transaction where the edited
5678-minor-unit row is expected. The existing bridge remains necessary for this
supported-startup path. Do not replace it with the SDK's internal inspector
attachment ports, which are not public application account admission.

Evidence: successful artifact directory
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-8OYup9`;
log `/private/tmp/finance-alpha66-worker-proof.log`. Negative control:
`/private/tmp/finance-alpha66-worker-control/app`, log
`/private/tmp/finance-alpha66-worker-control-retention.log`. The clean checkout
builds committed foundation source and reuses already generated catalogs without
regeneration. The unadopted sign-out prototype is excluded from this result.

Simplification finding: the shared native adapter boundary survives this release
unchanged; reuse it instead of version-specific lifecycle code. The schema and
worker proofs share one setup/generation pipeline. Keep the alpha.65 caller
experiment as explicit historical/incomplete evidence until its real Clipper
replacement qualifies, then retire that active duplicate. This proof does not
make its 15 failing raw-session-context cases pass or complete caller adoption.
Backend/auth, retained Finance destinations, joining/extension/offline-retry
responsibilities and full workspace-patch qualification remain open. No active
SDK pin, user storage, deployment setting or additional SDK patch is changed.

## Clipper native schema foundation

The same [maintained schema runner](../../tests/worker-upgrade/README.md#alpha66-clipper-schema-reading-and-retained-data)
now accepts `--clipper-schema`. It reuses the Finance fixture pipeline with
Clipper's own pinned dependencies and the unpatched published alpha.66 SDK/core.
It preserves all 22 stored tables, native reading sets and compiled permissions.
Its inactive port removes the standalone auth-schema App, the reading-column
wrapper and the policy fixture's cloned-SDK-schema helper. Native tests use the
generated App directly.

The stored-schema hash matches actual alpha.60 compilation:
`46ef1944edb6705219de47da8dba60c43615078ccf1542199bd5992c330c9ae1`.
The unchanged permission bundle is
`371a05e426a5f1f2180d26ad7484c3b858ff4a8dfc926965617d017e7df00c24`.
Jazz generates initial history and checks its files; no generated JSON is edited.

### Use the native set instead of repairing nullable transforms

The existing progress transform fits the native named-transform contract and
keeps its string-set storage, numeric maximum and validation. The resume-position
transform does not fit: its Date-bearing object cannot be expressed as a JSON
view. An attempted encoded JSON view also failed actual native inserts because
alpha.66 passes null through before invoking the transform; null cannot stand
for the empty value of the required stored array.

Do not add an SDK patch, nullable sentinel, alternate schema or compatibility
layer for this. The selected port reads and writes the native resume-observation
set directly. The existing timestamp/key fold and position codecs move to the
Clipper record boundary; reader/domain DTOs keep Date values. Raw SDK row tests
now assert native backing values. Reader-state assertions go through the actual
subscription adapter rather than duplicating its conversion in the fixture.

Strict generated JSON types also require absent optional anchor keys to be
omitted rather than present with undefined. The existing native annotation write
projects those three optional keys explicitly. It adds no new annotation state,
validation framework or permission rule.

### Qualification and remaining scope

Native generation/history, `generate --check`, selected strict schema/record/
reader/native-fixture types and **57 tests pass**. Coverage includes existing
native data/permission suites, reader-domain behavior, offline note restart,
two actual persistent replicas closing/reopening offline and reconciling, and
an actual alpha.60 SQLite reading store opened by alpha.66. Its app identity,
furthest progress and later backward position survive. A subsequent alpha.66
edit survives another native close/reopen. Initial empty subscription delivery
is not treated as proof that the retained document is absent; the test waits
for that known document and retains the original timeout.

The shared fixture change also reruns Finance successfully: its strict selected
types, identity/generation checks and all **138 tests pass**. Clipper's successful
artifact directory is
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-1uP9bj`;
log: `/private/tmp/clipper-alpha66-schema-final.log`. Finance's corresponding run
is `finance-jazz-alpha66-3OVEL1`, with
`/private/tmp/finance-alpha66-schema-shared-runner.log`.

These are source/schema/native-data proofs, not complete app, extension, session,
Better Auth or persistent browser-worker adoption. Finance's historical backup/
restore caller port and the remaining U3/U4/U5 gates stay open. Active applications
and pins remain alpha.60. The old alpha.65 Clipper caller overlay's 15 failures
remain separate and visible.

## Native gateway admission foundation

U4 now reuses Clipper's existing eight-case native gateway suite in a separate
alpha.66 fixture. The schema proof's generated app/permissions and dependency
versions are reused; its original unpatched package/store evidence stays intact.
`tests/worker-upgrade/backend.mjs` repeats this after `--clipper-schema`, without
generating catalogs or changing active pins.

The copied test uses public `user.accountId` / `user.identity`,
`session.exportDeviceKey()` and `acceptDeviceAccounts`. Its native core no longer
takes the removed `allowLocalFirstAuth` option. The actual gateway function and
Clipper policies are unchanged; SDK utilities still mint and verify test proofs.
No app-level JWT verifier, session wrapper or identity lookup is added.

Actual unpatched controls establish that alpha.66 still has two existing gaps:

- Its `allowedOrigins` parser rejects Clipper's configured Chrome extension
  origin before startup.
- With only that option omitted, registered device accounts sync and seed their
  native private libraries, but their valid capture proof gets 401: native
  `accountFor()` resolves authenticated backend users only.

The public backend API provides no equivalent admission-only device-account
lookup with the same registry/revocation checks. Creating another client or
registering an account from the capture API would not preserve that contract.
The proof reuses, byte-for-byte, only the existing two backend hunks from
`patches/jazz-tools@2.0.0-alpha.60.patch`. Both apply directly to the published
alpha.66 file. This qualifies existing patch behavior; it adds no patch behavior.

With those hunks, strict selected native types and **all eight cases pass**,
including private isolation, tampering, expiry, foreign/unregistered proofs,
denied/unsafe origins and fresh registry admission after revocation. Native
signed-out `/accounts/backend-user` responses changed from 401 to 200
`{ user: null }`; the copied test checks that explicit body while retaining all
403 and private-access assertions. See the tagged
[backend implementation](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.66/packages/jazz-tools/src/backend/create-jazz.ts).

Cleanup finding: alpha.66's native test-core API removes the old guest-auth boot
flag, and the real backend/core proof works without it. The Vercel store's native
core options also omit that flag. Do not blindly carry the alpha.60 Vercel flag
hunk forward. Actual Vercel workload admission and retained-data access still
need qualification before declaring that responsibility retired in cloud
deployments. No existing Finance core or Drive is changed by this proof.

The repeatable run is retained in Clipper schema artifact directory
`finance-jazz-alpha66-1uP9bj`, fixture `backend-D4lJ01`, with
`backend-qualification.json`; log: `/private/tmp/clipper-alpha66-backend-repeatable.log`.
Both unpatched controls are retained there as `backend-unpatched-origin.log` and
`backend-unpatched-account.log`. The overlay ports the actual suite instead of
maintaining a parallel auth fixture.

This does not qualify Clipper's real Better Auth session/expiry callback, its
provider patch against the new peer, live Finance/Clipper Vercel stores or the
full SDK patch/consumer graph. U4/U5 remain open. Next qualify the existing Better
Auth lifecycle/provider cases with the required peer and pass the actual session
expiry through Clipper's thin backend callback.

## Better Auth and real backend expiry

U4's next bounded slice now passes on Better Auth **1.7.22**, alpha.66's peer
baseline. `backend.mjs <clipper-schema-artifact-directory> --auth` extends the
existing proof instead of creating another auth harness. It reuses the 29 actual
Clipper auth tests unchanged after schema import rewriting: provider callback,
persisted session renewal/expiry/revocation, provider token refresh and revoked
refresh, handler, completion and request-machine behavior. One new native case
imports the real `server/jazz.ts` and its lazy configured auth/Db integration.
**All 30 auth cases, eight gateway cases and strict selected types pass.**

The thin backend candidate uses supported APIs in that one existing server entry:

- `authenticate` returns `acceptDeviceAccounts(request)` or the authenticated
  user ID and real Better Auth session expiry, floored to Unix seconds.
- It reads fresh sessions with `disableCookieCache: true, disableRefresh: true`,
  reusing Clipper's existing publication authorization pattern. Removing the
  latter option actually extends a due session during admission and fails the
  new case. Omitting expiry raises native `AuthenticateExpiresAtError`.
- Jazz's native `refresh(request, next)` hook performs the normal Better Auth
  session read with refresh enabled, then forwards returned `Set-Cookie` headers.
  The native SDK owns refresh scheduling/serialization; no application renewal
  workflow, SDK facade or cookie parser is added. Direct `accountFor` admission
  remains read-only. The native integration case verifies unchanged expiry on
  admission, renewed expiry and cookies through the backend-user route, canonical
  account identity, and refusal after native session revocation.

This follows the published alpha.66
[backend contract](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.66/packages/jazz-tools/src/backend/create-jazz.ts).
The installed Better Auth 1.7.22 `api/routes/session.mjs` refreshes expiry and
updated-at without changing the session token. Passing `next(request)` is valid
for that implementation; do not invent rotated-cookie parsing. Read-only checks
disable renewal, not Better Auth's native cleanup of already expired rows.
The existing persisted lifecycle tests separately cover expiry/revocation after
backend restart. This bounded HTTP/native proof does not establish full browser
reauthentication, production OAuth or the complete app/extension caller port.

The unpatched published ATProto provider 0.3.2 still fails its real callback with
`findAccountByProviderId is not a function` under Better Auth 1.7.22. Reapplying
Clipper's existing one-line `findAccountByKey` patch restores that test. Its
behavior is unchanged; no additional SDK/provider patch is introduced. Existing
ATProto peer versions are mirrored in the isolated graph, not upgraded alongside
auth. The active root lockfile, installed workspace packages and app pins remain
unchanged. Better Auth 1.7.25 is available; this result qualifies 1.7.22 exactly,
not every release allowed by the SDK's peer range.

The copied server must also use the native Vercel `namespace` option because
alpha.66 refuses old `name` configuration. Its production/per-branch candidate
does not open a Vercel store. Read-only project environment metadata on November
17 lists a core-name override only for preview branch `test/atproto-cold-reader`,
with none listed for production and no hidden production entries. Values were
not decrypted; no settings, deployments, cores or Drive data were changed. This
inventory is not retained-data qualification, proof about every historic deployment
override, or permission to retire the existing override. Keep that rollout gate
open, especially Finance's requirement to preserve preview and production data.

Evidence: artifact directory `finance-jazz-alpha66-1uP9bj`, native fixture
`backend-PHOJIw`, `backend-qualification.json` and three `backend-*.log` auth
controls; full log `/private/tmp/clipper-alpha66-auth-repeatable.log`. The first
attempt was blocked from binding a native local listener by the sandbox; the
permitted isolated run passes. This is environment setup evidence, not an app
failure. U4 remains open for retained destinations and broader backend adoption;
U5 still requires the coherent full dependency/patch/consumer switch.

## Retained Vercel destination follow-up

The maintained `vercel-names.mjs` source-only proof now passes against the actual
alpha.66 package, replacing reliance on alpha.65's naming comparison. Both
observed default Finance core/Drive pairs remain exact, and native
`perBranch('mono')` matches the existing preview namespace. The custom
`finance-alpha60-preview-qualification` name is still refused by the native API.
This qualifies names only; the result explicitly marks live data unqualified.

The refreshed read-only CLI inventory finds the same three mount pairs, with
production running at observation time. The native SDK startup script would
update version/core files and may restart the original core; do not use it as a
read-only compatibility probe. Native Vercel Drive snapshot mounts provide
point-in-time read-only access without stopping the source. The user approved
the bounded cloud inspection, which now passes on all three Drives: each has a
nonempty retained app ID, pinned trust metadata, native alpha.60 version marker
and nonempty store. No row or private metadata values were printed/downloaded.
The one-vCPU nonpersistent Sandbox stopped after 24.116 seconds; its final native
listing confirms stopped status and three `snapshot` mounts. The
[retained Drive evidence](worker-jazz-upgrade-plan.md#retained-drive-inspection-source-preserving-access)
records exact file/byte totals, the command, cleanup and log hash. No original
core was opened/upgraded or source Drive changed. This qualifies metadata access,
not alpha.66 schema, row, attachment or workload-credential compatibility. Those
checks remain open; no custom retention layer, namespace workaround or new patch
is added.

At the preceding auth checkpoint `708ccfe2`, all normal hosted Finance, Clipper
and Foundation jobs pass. This does not fix the intermittent unknown-save
failures, qualify live retained destinations or activate the SDK upgrade.

## Actual retained rows and newly released alpha.67

The follow-up now qualifies native readers on actual retained snapshots, beyond
metadata presence. Independent alpha.60/66/67 SDK/native runtimes open only new
scratch copies from the same read-only mounts. The old and generated candidate
Finance schemas are reused unchanged. Retained app identity and all returned
values across 23 tables match for both newer releases, including audit metadata,
financial amounts and exact nonempty attachment/profile bytes.

Production has 987 rows and 1,127,923 binary bytes; preview has 92 rows and no
binary values; the custom qualification snapshot has 36 rows and 28,723 binary
bytes. No private values are printed/downloaded: canonical row/byte comparisons
use a per-run secret HMAC key, removed with the scratch copies before shutdown.
The local native maximum-safe amount/attachment proof passes, and a real
single-byte change is detected despite identical counts. The Sandbox stops after
64.355 seconds; originals are not upgraded or mounted writable. The
[retained reader evidence](worker-jazz-upgrade-plan.md#native-reader-comparison-on-retained-snapshots)
records exact scope, counts, non-vacuity, artifacts and cleanup.

During preparation npm `latest` moved to **alpha.67** (`alpha` still names .60).
Its published tarball integrity was verified. Actual `backend/create-jazz.js`,
`backend/vercel-store.js`, `typed-app.js` and `runtime/db.js` are byte-identical
to alpha.66. The native fingerprint modules, bundled broker and inspector assets
changed; these observations are not a complete Rust/Wasm/worker release audit.
Better Auth's peer remains `~1.7.22`. The same generated Finance bindings work
with the matching alpha.67 native binary in the bounded read proof; there is no
reason to reauthor the schema or backend callback for an unchanged API.

Alpha.67 still needs the remaining release/patch responsibility review and
worker/auth/caller qualification before replacing the coordinated target at
cutover. This result does not make the 200 schema/restore or 30 worker/session
cases alpha.67-qualified. Live workload credentials and the custom original core
name remain separate gaps. No active source, pin, deployment or patch changes.
The user reported that the historical qualification preview did not show their
transactions and confirmed `https://finance.delightfullabs.com` as the actual
source. Follow the [corrected production backup handoff](worker-jazz-upgrade-plan.md#production-backup-handoff-and-custom-core-scope).
Production retains its compatible existing core/Drive in place; its UI backup
is additional preservation, not a requirement to move into a fresh core. Leave
the separate qualification environment unchanged and excluded from rollout.
Its ownership/retention needs are unconfirmed; do not ask the user to export
unfamiliar data, reset anything or build a naming workaround for it.

## Execution order

1. Keep the approved private session actor and awaited native factory. Finish
   only commands needed by actual consumer workflows, reusing their existing
   charts and native SDK leaves. Review the unadopted sign-out work before
   expanding it; do not build a general SDK command surface in advance.
2. Keep the now-qualified native schema foundations for both apps. Finish
   Finance's historical backup/restore schema callers and full consumer
   qualification before a live switch. Reuse the disposable legacy compiler
   output as a comparison baseline. Preserve schema and bundle identity through
   native generated artifacts, not an application compatibility layer.
3. Requalify the persistent bridge and session/Svelte fixtures on matching
   alpha.66 SDK/Wasm; then adopt the actor in the actual callers. Historical
   alpha.65 passes and its 15 failing Clipper cases remain visible until replaced.
4. Complete U4's backend/auth/full-patch and retained-destination checks, then
   U5's coherent dependency switch. Only then proceed with C3–C5's worker UI
   slice. No partial SDK switch or data reset is authorized by this audit.
