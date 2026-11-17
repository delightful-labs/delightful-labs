# Jazz alpha.66: release audit and revised upgrade order

Researched 2026-11-17 against the published package, not just the release notes.
The upgrade target is now **2.0.0-alpha.66**. Live workspace pins and the active
patch remain alpha.60; the maintained isolated upgrade runner still targets
alpha.65. Its results must not be relabeled as alpha.66 qualification.

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

The historical two-app `previousApp` restore experiment and backup table typing
are not ported by this selected proof. Nor does it qualify all Finance callers,
Clipper, browser worker durability, backend auth, every existing patch
responsibility or Finance's retained Vercel destinations. Keep U3/U4/U5 open.

Final packaged proof: `/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-GJSvMl`;
log: `/private/tmp/finance-alpha66-schema-final.log`. Strict fixture types, native
generation/identity checks and all 138 cases pass in that same clean copy. Active
alpha.60 Finance test types, workspace links and shared guidance checks also pass.

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
