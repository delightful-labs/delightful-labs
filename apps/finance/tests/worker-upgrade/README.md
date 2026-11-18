# Isolated Jazz upgrade proofs

The schema and persistent-worker proofs qualify alpha.66 and, with the explicit
SDK selector below, alpha.67. The schema mode below qualifies
Finance's native authoring boundary on that version; `--worker` also qualifies
the alpha.66 persistent-worker/session boundary. The historical default
worker/session suite still targets alpha.65. See the
[alpha.66 source audit and qualification boundaries](../../specs/013-local-first-startup/worker-jazz-alpha66-research.md).
The modes have separate qualification scopes.
The registry selects alpha.67 as `latest`. The retained-store comparison also
covers both releases against alpha.60. All modes keep their bounded scopes and
do not change workspace pins.

## Alpha.67 qualification with the existing proofs

Use the same schema/worker pipeline with an explicit published version:

```sh
node tests/worker-upgrade/run.mjs --worker --sdk=2.0.0-alpha.67
node tests/worker-upgrade/run.mjs --clipper-schema --sdk=2.0.0-alpha.67
node tests/worker-upgrade/backend.mjs /path/to/reported-clipper-alpha67-artifacts --auth
```

All **325 positive cases pass**: 200 Finance schema/permission/backup/restore,
30 worker/session, 57 Clipper schema/reading, 30 auth and eight gateway cases.
Strict selected types, Svelte checks and native schema/bundle identity pass.
The existing schema, workflow, adapter and patch bodies are reused unchanged.
`schema-identity.json` labels the candidate's actual version; alpha.66/default
and historical alpha.65 behavior remain available rather than being relabeled.

A published unpatched alpha.67 Chromium control still retains account identity
but loses the saved/edited Finance row on its first full-process restart. It
omits only the unsupported host option and two hook-counter assertions; the
financial row/identity/save/edit/close checks are unchanged. All six SDK files
touched by the bridge match the pristine package in that control. Retain the
existing bridge without extending its responsibilities. Backend/provider and
expiry/read-only negative controls also fail as expected; no new patch behavior.

The worker run uses an isolated checkout of the committed foundation, excluding
the unadopted sign-out prototype, with unchanged built public libraries and
catalogs reused without generation. This does not complete actual application
caller adoption, the entire historical restore matrix, live Vercel workload
admission or the coherent workspace switch. See the
[alpha.67 source review and evidence](../../specs/013-local-first-startup/worker-jazz-alpha66-research.md#alpha67-native-source-review-and-requalification).

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
pass. All **200 tests pass**: 128 existing permission/bank-log cases, ten native
transform/retention cases, 37 existing backup cases, one retained-archive case
and 24 native browser restore cases.
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

The existing restore implementation needs only the public `user.accountId` and
native `RowOf` type changes. Its charts and shared-Db ownership are retained.
The small browser entry exposes those real workflows and the native SDK factory;
it adds no account-client/session facade. Chromium, Firefox and WebKit each
qualify completion from the actual alpha.60 archive, exact financial/attachment/
source-payload preservation, a completed IndexedDB journal recognized after page
reload without repeated writes, cancellation at review, same-account replacement
and A → B → A. Cancellation/replacement rejects stale confirmation without writes
and leaves the application Db usable. XState development freezing stays enabled.
These browser clients use memory data drivers and real IndexedDB journals;
page reload is not a persistent-worker or full-process restart qualification.

The additional six cases hold real server replies after authority acceptance,
then cancel or replace the native identity (both in all three browsers). The
operation stays active and retains its artifacts while the receipt is pending.
After replies resume, cleanup releases once and journal resume commits only the
remaining activation, preserving the accepted financial rows and destination.
The existing `tests/helpers/silent-jazz-proxy.ts` and the original restore probe
are reused. The probe is extracted to `tests/helpers/restore-probe.ts` for both
the alpha.60 experiment and alpha.66 candidate; its chart body is unchanged.
Both original alpha.60 accepted-commit cases also pass after that extraction.
No application workflow or SDK implementation change is needed for these cases.

Three additional native cases change an accepted financial row before resume.
The actual stored mismatch produces a conflict, performs no further destination
writes and leaves membership unpublished. Both the returned record and the
reopened IndexedDB journal preserve the previous evidence; the existing workflow
does not replace that checkpoint with a new conflict marker. Three cleanup cases
inject one artifact-release failure after real publication, retain custody in
the existing blocked state, and release once on `RETRY_RELEASE` without additional
Jazz commits. All three browsers cover both boundaries. The application charts
remain unchanged; the fixture reuses the existing probe and journal-step actor.

The new native tests live in the patch and run/type against the candidate SDK,
so alpha.66 imports do not enter active alpha.60 test discovery. Svelte's normal
compiler handles the existing shared data module. The runner adds no runtime
framework, production migration, dependency pin, catalog generation or SDK patch.
Artifacts include the source copies, locks, generated history/JSON/bindings,
retained records/store, `retained-backup.dlf`, its fixture IDs and
`schema-identity.json` in the printed directory.

This does not qualify Clipper, all Finance callers/backup/restore experiments,
worker durability, backend auth, the full existing SDK patch or Vercel data
destinations. The full 107-case historical restore experiment is not ported by
these 24 browser cases. Rollback/restart failure paths, broader conflict and
cleanup variants, and the full policy/role matrix remain required on
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

## Alpha.66 native gateway admission

After a successful `--clipper-schema` run, reuse its reported artifact directory:

```sh
node tests/worker-upgrade/backend.mjs /path/to/finance-jazz-alpha66-artifacts
```

This copies the generated Clipper source into a separate fixture with its own
dependencies. It ports the existing `gateway-auth.integration.test.ts` to public
device-user metadata, `exportDeviceKey()` and `acceptDeviceAccounts`; the gateway
implementation and domain policies stay unchanged. No new auth layer, dependency
version, app pin, catalog generation or live destination is introduced.

Two unpatched controls establish the current SDK limitations: the configured
Chrome extension origin is refused at startup, and omitting only that option
lets registered guests sync but the gateway returns 401 for a valid proof.
The runner then extracts the two backend hunks from the existing alpha.60 patch
and applies them to a copied alpha.66 SDK without changing their behavior.
Strict native types and all **eight existing gateway cases pass**: valid/private
access, malformed/tampered/expired/foreign/unregistered proofs, configured versus
denied origins, unsafe configuration and revocation rechecks.

Alpha.66 reports a signed-out backend-user request as 200 with `{ user: null }`.
The copied assertion checks that body explicitly; all unauthorized-origin and
private-data denials remain. The old test-core `allowLocalFirstAuth` option is
removed upstream and is not used. This local proof does not qualify the Vercel
store, retire every workspace patch responsibility, or establish Better Auth/
session-expiry and real consumer compatibility. U4/U5 remain open.

Artifacts retain both negative-control logs, independent locks, the API overlay,
the exact reused backend patch/hash and `backend-qualification.json`. The source
SDK tarball and preceding unpatched schema proof remain intact. See the
[backend scope and remaining gates](../../specs/013-local-first-startup/worker-jazz-alpha66-research.md#native-gateway-admission-foundation).

## Alpha.66 Better Auth and actual backend session expiry

Add `--auth` to the same backend command:

```sh
node tests/worker-upgrade/backend.mjs /path/to/finance-jazz-alpha66-artifacts --auth
```

This reuses the generated schema, gateway pipeline and all 29 existing Clipper
auth tests. Only the disposable dependency graph adopts Better Auth **1.7.22**,
the SDK's required peer baseline, with Clipper's existing ATProto peer versions.
`clipper-auth.patch` ports the actual server entry and adds one native integration
case. Strict types, **30 auth cases and eight gateway cases pass** on that graph.

Admission supplies the real session expiry in Unix seconds and uses Better Auth's
read-only session options already used by Clipper's publication endpoint. Jazz's
native `refresh` hook renews due sessions and forwards Better Auth's returned
cookies. Native Better Auth 1.7.22 keeps the session token during this renewal;
`next(request)` therefore sees the same valid cookie and updated database expiry.
No application session wrapper, renewal actor or custom cookie parser is added.
The new case imports the real server, uses its lazy auth/Db integration, verifies
that ordinary admission does not renew, checks renewal and cookies through Jazz's
backend-user route, and proves revoked access is refused.

Three negative controls retain their logs: the published unpatched provider fails
its real callback on the removed `findAccountByProviderId`; omitted expiry fails
native admission; allowing refresh during admission changes the stored expiry and
fails the read-only assertion. The existing one-line provider patch applies
unchanged to a copied package. This adds no dependency patch behavior.

The source overlay also replaces removed Vercel `name` configuration with the
native production/per-branch namespace API so the real server type-checks. Tests
open only disposable memory/SQLite stores. **Live destination access and core-name
override retirement are not qualified or changed.** Active app pins remain
alpha.60; full consumer/patch adoption and retained Vercel data are still gates.
See the [auth evidence and reuse findings](../../specs/013-local-first-startup/worker-jazz-alpha66-research.md#better-auth-and-real-backend-expiry).

## Alpha.66 retained Vercel destinations

After either alpha.66 schema mode, run the source-only naming check:

```sh
node tests/worker-upgrade/vercel-names.mjs /path/to/finance-jazz-alpha66-artifacts
```

It executes the installed candidate's native naming functions without opening a
store or contacting Vercel. Finance's observed production and `mono` preview
core/Drive names match exactly; the custom qualification name remains unreachable.
`vercel-name-qualification.json` explicitly records that live data is unqualified.
This replaces the historical alpha.65-only naming evidence with a repeatable
alpha.66 check; it adds no application naming helper or dependency patch.

`inspect-retained-drive.mjs` uses only Node filesystem reads. It
checks retained app-ID/trust presence, native version and store file/byte totals
on three native read-only snapshot mounts. It prints no IDs, trust contents,
file names or financial rows. Both a disposable local layout smoke check and the
user-approved cloud inspection pass. All three retained Drives report alpha.60
version markers, present identity/trust metadata and nonempty stores. The
temporary Sandbox stopped after 24.116 seconds; the final listing confirms its
stopped state and all three snapshot mounts. No original Jazz core was opened.

The [snapshot inspection evidence](../../specs/013-local-first-startup/worker-jazz-upgrade-plan.md#retained-drive-inspection-source-preserving-access)
records the exact mounts, bounded Sandbox command, results, cleanup and log hash.
Snapshot access does not itself qualify alpha.66 schema/auth/data
access: compare native old/new readers on independent scratch copies afterward.

## Native retained Finance reader comparison

Prepare the readers from a successful Finance `--schema` or `--worker` artifact:

```sh
node tests/worker-upgrade/retained-prepare.mjs /path/to/qualified-finance-schema-artifacts
```

The printed directory contains independent alpha.60/66/67 installs, locks and
`readers.tgz`. The script reuses the actual legacy schema/permissions bundles and
qualified generated Finance bindings, asserting retained-schema identity first.
Native pnpm optional-platform configuration includes matching Linux binaries;
the archive omits other platforms, source maps and macOS extended attributes.
No workspace install, pin, dependency patch, catalog or schema generation occurs.

In the authorized nonpersistent Sandbox, mount the same three existing Drives
as `snapshot` at `/retained/production`, `/retained/preview` and
`/retained/qualification`. Upload/extract the archive and run:

```sh
node /vercel/sandbox/readers/retained-compare.mjs /retained
```

Each reader opens a new scratch copy with the source app ID and native SQLite
blob mode, checks SDK/native version equality, and reads all 23 Finance tables
through native `Db.all`. It compares every returned field including IDs, audit
values, Dates, BigInts and binary contents. An ephemeral keyed digest avoids
exporting rows or private values; the key/digests and scratch copies are removed
in cleanup. Printed results contain only table names, counts and comparison
booleans. These test scripts add no application persistence/backup abstraction.

The fresh local alpha.60 fixture passes all nine reader opens and six comparisons,
including a maximum-safe amount and nonempty attachment bytes. An independent
native one-byte attachment edit is refused despite unchanged row/byte counts.
The actual Vercel snapshot run also passes every identity/table/binary comparison
for alpha.66 and alpha.67: production has 987 rows and 1,127,923 binary bytes,
preview 92 rows with no binary values, and qualification 36 rows and 28,723 bytes.
Preview attachment retention is unexercised because no attachments are present.

The Sandbox stopped after 64.355 seconds. Original cores/Drives were not opened
for writes or upgraded. This is retained snapshot read compatibility, not live
OIDC admission, namespace access to the custom core, schema rollout, writes,
client adoption or complete alpha.67 qualification. See the
[exact retained-data evidence](../../specs/013-local-first-startup/worker-jazz-upgrade-plan.md#native-reader-comparison-on-retained-snapshots).

## Alpha.66 persistent worker and session boundary

From a clean checkout with current built public Local First/DUI packages and
the installed Playwright browsers:

```sh
node tests/worker-upgrade/run.mjs --worker
```

This reuses the Finance schema pipeline and all existing worker/session fixture
and adapter patches. It applies the existing six-file worker bridge to the
integrity-verified alpha.66 SDK, generates the native Finance schema/history, and
runs the **200 schema/restore checks** before the **30 worker/session cases**.
The worker imports the native generated runtime queries. The SDK bridge and
shared session/recovery adapter implementations need no further changes.
Strict adapter/fixture types and native Svelte checks pass. Each production and
development build retains exactly one broker asset.

The 30 cases cover the same cold-process restart/offline Finance records, native
SDK/Svelte recovery, loader failures and development XState actor lifetime as
the alpha.65 fixture. Chromium/Firefox/WebKit pass, including actual SDK sessions
inside dedicated Workers, signed-out startup, close during held acquisition,
SDK/AccountStore/broker teardown and development freezing. This proof uses a
clean committed foundation; the unadopted sign-out prototype is outside its scope.

An unpatched alpha.66 Chromium control still loses the saved/edited Finance row
after the first full browser-process restart, while retaining the account ID.
For that diagnostic, use the published SDK tarball, omit the patch-only host
option, and omit only the two bridge-hook counter assertions; keep the actual
row, identity, save/edit and close checks. The maintained positive fixture is
unchanged. Evidence: `/private/tmp/finance-alpha66-worker-control-retention.log`;
the diagnostic project is `/private/tmp/finance-alpha66-worker-control/app`.
Keep the existing bridge; no additional patch behavior is introduced.

Successful artifact directory:
`/var/folders/qb/xn1lqlhn4234zgfwy1r17cdc0000gp/T/finance-jazz-alpha66-8OYup9`;
log: `/private/tmp/finance-alpha66-worker-proof.log`. Workspace pins and deployment
destinations remain unchanged. This is Finance's bounded worker/session proof,
not full Finance/Clipper adoption, backend authentication, retained Vercel data,
extension/joining-proof/offline-retry parity or the complete workspace patch.
The default alpha.65 Clipper overlay still has its documented 15 failures; this
mode does not run or relabel it. Retire that historical path only after its real
Clipper replacement qualifies.

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

The Clipper candidate now uses the shared actor connection at its actual account
host, including creation, restoration, SDK retry, ordered sign-out and realm
close. Its existing attachment and domain-drain protocols remain in place;
no SDK facade enters XState context. Strict candidate types and 69 Clipper tests
pass, clearing the original 15 getter/freezing failures. The current alpha.60
Clipper batch passes 72 tests. The 21 focused three-engine Worker cases also
pass using the shared change/close invocations with actual Jazz sessions and
development freezing. The corresponding shared identity/backend batch passes
272 tests. See the [current host qualification](../../specs/013-local-first-startup/worker-session-resource-decision.md#clipper-host-adoption-qualified-in-the-candidate).
Finance caller adoption and the coordinated SDK upgrade remain open; pins and
production destinations are unchanged.
