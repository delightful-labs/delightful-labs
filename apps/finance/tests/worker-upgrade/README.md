# Isolated Jazz upgrade proofs

The coordinated upgrade target is now alpha.66. The schema mode below qualifies
Finance's native authoring boundary on that version; the default worker/session
suite still targets alpha.65. See the
[alpha.66 source audit and qualification boundaries](../../specs/013-local-first-startup/worker-jazz-alpha66-research.md).
The two modes have separate qualification scopes.

## Alpha.66 Finance schema, permissions and retained data

From Finance, using the workspace's Node/pnpm and current built Local First:

```sh
node tests/worker-upgrade/run.mjs --schema
```

This uses the published, integrity-verified **unpatched alpha.66** SDK and its
matching native core. It copies real Finance source into disposable projects,
creates/closes actual alpha.60 SQLite records, and uses the alpha.65 compiler
only to produce comparison metadata. `finance-schema.patch` ports the native
authoring source; Jazz generates its initial history, bindings and permission
JSON. No generated artifact is hand-edited. The SDK upgrader's identity comparison
checks the stored-schema hash and permission bundle before tests run.

The patch replaces callback/raw permission composition with the native DSL,
moves runtime query definitions out of authoring `schema.ts`, and implements
eight native named transforms for the existing 22 columns. It removes the old
text-column wrapper. Source-import changes occur only in copied consumers;
active application source and dependency pins remain alpha.60.

Strict authoring/query/transform/native-fixture types and `generate --check`
pass. All **176 tests pass**: 128 existing permission/bank-log cases, ten native
transform/retention cases, 37 existing backup cases and one retained-archive case.
A real alpha.60 store keeps its app identity,
maximum-safe minor-unit amount and normalized text after opening with alpha.66;
an alpha.66 edit survives another close/reopen. The test also distinguishes a
stored zero from an absent optional amount. Jazz's native null passthrough
replaces alpha.60's accidental `Number(null)` read as zero; no compatibility
transform is added. Sync counts retain the existing native signed-32-bit storage.

The backup caller now uses only the current generated queries. Its previous-schema
override and per-read table selection are removed. `backup-seed.mjs` runs the
released v1 reader against the actual preceding schema and a real device account
on alpha.60, retaining the resulting archive bytes. Alpha.66 independently opens
and validates that file: workspace/account IDs, maximum-safe minor units and
attachment bytes survive exactly. No old/new-schema Db adapter is introduced.
Jazz rejects using current-schema queries on a Db already bound to the older
schema; the old archive must be generated with its own native query bindings.

The new native tests live in the patch and run/type against the candidate SDK,
so alpha.66 imports do not enter active alpha.60 test discovery. Svelte's normal
compiler handles the existing shared data module. The runner adds no runtime
framework, production migration, dependency pin, catalog generation or SDK patch.
Artifacts include the source copies, locks, generated history/JSON/bindings,
retained records/store, `retained-backup.dlf`, its fixture IDs and
`schema-identity.json` in the printed directory.

This does not qualify Clipper, all Finance callers/backup/restore experiments,
worker durability, backend auth, the full existing SDK patch or Vercel data
destinations. In particular, the full historical restore experiment and its
browser/session harness still need their native caller port. Opening a retained
archive does not prove restore staging, publication, cancellation or drains on
alpha.66. U3 remains open for the
rest of those boundaries; U4/U5 remain required before any live switch.

## Alpha.66 Clipper schema, reading and retained data

From Finance, using the same runner and current built Local First:

```sh
node tests/worker-upgrade/run.mjs --clipper-schema
```

This reuses the Finance proof's isolated install/generation/identity pipeline,
with Clipper's installed dependency versions, source overlay and native tests.
The unpatched alpha.66 SDK/native core preserve the alpha.60 stored-schema hash
and the permission bundle. Native history/generation, `generate --check`, strict
selected schema/record/reader/fixture types and **57 tests** pass.

`clipper-schema.patch` replaces callback permissions with the native DSL and
removes the unused auth-only App, reading-column wrapper and policy-fixture clone
helper. Tests use the generated native App directly. Progress uses a native named
transform over the existing string grow-only set. Resume positions use the native
set directly; their existing fold and encode/decode logic lives at Clipper's
record boundary. Reader/domain values still contain Date instances.

An attempted nullable JSON transform was rejected: Dates cannot be represented
in its JSON view, and native null passthrough prevents mapping an empty/null view
back to a required stored array. No special SDK wrapper, sentinel format, schema
change or patch is added. The stored reading sets and tie-breaking behavior stay
the same. One JSON write projection omits absent optional anchor keys to satisfy
the generated native JSON type; it does not change annotation policy or data.

The 57 cases include existing data/permissions, reader-domain checks, offline
notes, actual two-replica reading convergence after both replicas restart, and an
alpha.60 SQLite store opened by alpha.66. Furthest progress stays monotonic while
a later backward resume position wins; Date values reach the actual reader
subscription. A new alpha.66 reading edit survives another close/reopen. Native
fixtures retain their original bounds and assertions; raw-row expectations use
the new native backing shape rather than pretending SDK rows are domain DTOs.

The source-import/fixture changes affect only disposable copies. Active Clipper,
Finance and dependency pins remain alpha.60. Full app/extension/session adoption,
Better Auth/provider qualification, persistent browser-worker qualification and
retained Vercel destinations remain separate gates. This mode does not turn the
known alpha.65 caller experiment green or complete U3/U4/U5.

## Alpha.65 worker and session boundary

From Finance, with the workspace's Node/pnpm and installed Playwright browsers:

```sh
node tests/worker-upgrade/run.mjs
```

This reuses `tests/worker-bindings`, the actual Finance schema/validation and
recovery integration, and the current built public Local First/DUI packages.
It creates a temporary project
with separate dependencies and browser profiles. It downloads the exact
alpha.65 SDK, checks npm's SHA-512 integrity, applies the inactive candidate,
checks types and runs the native suite. The generated dependency lock, SDK
metadata, versions and sources remain in the printed artifact directory.
Both libraries' `dist` outputs must be current before packing.

- `worker-bridge.patch` carries only the existing worker detection, Window hooks,
  asynchronous generation operations and clone exclusion into six alpha.65 files.
  The newer SDK's store-deletion helper also awaits that generation reader and
  broker open; otherwise changing the shared reader to async would break that
  caller. No reset policy or new hook is introduced.
- `fixture.patch` adapts the maintained SDK leaf to immediate local-first startup,
  public user/account IDs and the new emitted broker location. It retains exactly
  one hashed broker asset and adds loader-failure and native session-adapter
  qualification cases per engine. It also builds a native Svelte page with the
  actual Finance recovery integration and packed shared UI. Reports compare
  recovery phrases inside the browser and return booleans, never keys or phrases.
- `session-adapters.patch` ports shared recovery/restoration to the public session
  methods and exposes native `starting` status. The runner compiles those source
  adapters and their contracts against alpha.65, updates a temporary library
  tarball, and tests the normal public package exports. Recovery needs only the
  native snapshot getter and device-key export; it also accepts that observation
  pair from a native Svelte context without requiring session ownership methods.
  It also adds the approved actor's private Jazz adapter to the temporary package.
  This adapter owns native session creation, client loading, immediate local-first
  setup and observation projection; its SDK facade stays inside native closures.
- `consumer-session.patch` adapts Finance's recovery component to native
  `getJazzSession()`/`get(store)` and the bound export action. Svelte's store owns
  subscription and initial publication; the existing recovery actor still owns
  its scope and secret lifetime. The component's existing locale runtime is
  copied unchanged rather than regenerated.
- `run.mjs` supplies dependency/build isolation; it adds no application runtime,
  actor owner, RPC layer, workspace package or CI job.
- `clipper-session.patch` ports the actual Clipper account host/contract and
  readiness chart, removing the separate SDK preparation phase. Its worker-host
  fixture retains a faithful signed-out session `db` getter. `clipper.mjs` copies
  the current Clipper source and runs strict types plus its maintained startup,
  root, sign-out and worker-host tests in a separate temporary package with
  Clipper's own installed dependency versions and the same candidate tarballs.

**Current blocker:** the expanded Clipper check currently fails,
with 52/67 cases passing. Development XState walks the native SDK facade in
context and invokes its new throwing `db` getter while signed out. Strict types
and all 46 application-readiness cases pass; an actual SDK/browser development
diagnostic reproduces the owner failure. The runner therefore does not report
overall success at this checkpoint. The approved
[actor boundary](../../specs/013-local-first-startup/worker-session-resource-decision.md)
now passes its first foundation qualification; identity commands and actual
Clipper/Finance adoption remain. Do not weaken the old fixture or disable checks.

Strict declaration/fixture types, native Svelte checks and all **30 native cases**
pass in the isolated candidate, including the prior 21 worker/session/Svelte cases.
Nine new cases exercise the actual packed shared session actor with real SDK
sessions inside dedicated Workers in a separate development build. They assert
that XState froze its context, no Window exists in that realm, signed-out/device
startup succeeds and actual SDK close completes once.
Close during late acquisition never subscribes or publishes that session.
Worker teardown awaits native SDK, AccountStore and exact broker-host receipts.
The controls reuse the existing SDK fixture's broker host and typed command
channel; Window code only supplies the narrow native bridge and test controls.
Production and development each retain exactly one broker asset. The actor uses
the existing acquisition chart, not a copied fixture workflow. It adds no SDK
patch. Full shared types, library Svelte checks, packaging/publint and 234 affected
identity/backend tests also pass.
The three Svelte cases cover initial availability, phrase/native-key equality,
clearing an open phrase on same-account replacement, the SDK's `loading` snippet,
sign-out/reopen, external-provider unmount/remount and native close. Mounting the
provider does not reread the AccountStore; unmounting leaves the SDK session ready.
These checks use actual SDK operations and public Svelte/package exports.

The candidate is **not the complete workspace Jazz patch**. Backend/guest proof,
Chrome-extension admission, joining-peer proof and offline-retry behavior remain
separate qualification. The alpha.60 peer warning from the packed Local First
package is expected: only its IDB/broker/build helpers and selected session
adapters are qualified here; the rest of its alpha.60 surface is not upgraded.
The proof uses Finance's installed OpenTelemetry API version throughout its
dependency graph to respect the SDK's peer range. Workspace dependencies and the
active patch remain alpha.60. Existing Finance data and Vercel destinations are
outside this probe.

See the [upgrade plan and qualification](../../specs/013-local-first-startup/worker-jazz-upgrade-plan.md#u1-isolated-worker-qualification)
before broadening or adopting this candidate.
