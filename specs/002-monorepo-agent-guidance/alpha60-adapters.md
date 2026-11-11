# Alpha.60 adapters: qualified source compatibility slice

This is the next scoped migration step after qualified alpha.59 integration
`5e66936`. The user's subsequent “Continue” selects the previously stated step
of preserving the consumers' alpha.60 adapter behavior in library source.
No consumer changes SDK versions or dependencies in this step. No SDK patches,
consumer schemas, catalog strings, generic machines or archive formats change.

## Source and installed API evidence

The behavior baseline is Clipper's active package at consumer revision
`2e0ae22805185daf5b1565acdf75892fec87c2a0`, archive
`delightful-local-first-auth-lifecycle-9c13e3f-alpha60.tgz`, SHA-256
`8812fc4825b6b0f53ca199c84dc41b328cf7edb2c0163db425b6651c25a028ee`.
Its committed `tooling/build-v6-vendor.mjs` describes the emitted-code adaptations.
The immutable archive baseline and source hashes remain in the prior inventories.

Read the exact installed alpha.60 public declarations: `dist/client/index.d.ts`,
`session/create-jazz-session.d.ts`, `backend/index.d.ts`,
`backend/create-jazz.d.ts`, `runtime/db.d.ts` and `runtime/client.d.ts`.
They expose `createJazzClient`/`JazzClientConfig`, `Jazz.forReqUser(Request)`,
`isNoJazzAccountError`, `beginSerializableTransaction`,
`Transaction<'serializable'>` and `SerializableWriteHandle`.
The source SDK is the published, unpatched alpha.60 package. The installed v6
agent guide and stability manifest were also consulted; no XState API or machine
implementation changes are needed.

## Ownership and asynchronous boundary review

The existing session-acquisition chart still owns acquisition, late results,
attachment lifetime and drain. Its SDK capability continues to issue one creation
call, now `createJazzClient`. Startup only retains the same owner/configuration;
readiness and restoration keep their existing owner protocols and callbacks.
There is no new session/promise cache, actor or credential store.

Invitation admission remains one native verification operation. It captures URL,
method and a copied Headers object before awaiting `forReqUser`, maps the verified
account or admission error to the existing result union, and constructs leaf
transaction capabilities. It neither stages nor commits a transaction during
admission. The existing invitation authority chart owns eligibility, acquisition,
mutation, commit, settlement, rollback and uncertain receipt custody. The backend
client remains host-owned. No native session or database close ownership is added.
The capture cannot follow later mutation of the host's Headers. Request bodies
are neither copied nor read; body identity remains untrusted.

Backup still uses the existing reader/export/envelope charts. The adapter opens
one serializable native transaction and retains the same handle/receipt paths;
its scope check now uses alpha.60's string account identity. Conflict mapping
adds `serialization_conflict` while retaining the consumer's older conflict
strings. There are no new async stages, decision flags, cleanup paths or changed
archive consistency labels. Cancellation/unknown writes still require runtime
qualification; matching emitted code is not proof of those behaviors.

## Implementation

Six production modules change:

| Module under `src/lib/backend/jazz` | Change |
| --- | --- |
| `session.ts` | Use `createJazzClient` and its public client config type |
| `startup.ts` | Client-side session/config types from `jazz-tools/client` |
| `session-readiness.ts` | Session type from the client entry point |
| `restoration.ts` | Session type from the client entry point |
| `backup.ts` | String account identity, serializable transaction and conflict mapping |
| `invitation-authority.ts` | Native request admission, string identity, serializable custody types and no-account error mapping |

The invitation adapter's input now declares URL and method as well as headers.
The old consumer archive's emitted implementation already reads all three, but
its declaration incorrectly requires headers only. Requiring
`Pick<Request, 'url' | 'method' | 'headers'>` makes the source contract reflect
that implementation without a cast or fabricated URL. Actual Request callers
remain compatible; synthetic callers need the complete request facts.

Local First's exact development and optional peer SDK version becomes
`2.0.0-alpha.60`. It does not advertise alpha.59 compatibility. Root lockfile
resolution retains the website/UI importers and their existing snapshot entries;
only the library selects the new SDK/peer closure. A fresh ordinary resolution
also rewrote unrelated optional peer contexts, so those existing closures were
retained explicitly before the successful frozen install. No framework or other
project's direct dependency was upgraded.

The generic package-audit command now requires explicit
`--allow-source-changes` for a changed library. It records baseline and working
hashes for each changed source file. Its normal mode still rejects source drift.
This avoids describing the new build as an unchanged original source revision.

## Static evidence and emitted comparison

Passed under Node 24.22.2 / pnpm 10.28.0:

- Frozen install with install hooks disabled; approved tests run separately.
- Library Svelte/TypeScript check: zero errors and warnings.
- Package generation and strict publint.
- Formatting of the six changed source files and local diff whitespace checks.

[Comparison evidence](alpha60-package-comparison.json) records six production
adapter changes and nine updated test files against the retained source baseline.
Against Clipper, 276 of 281 publishable files match byte-for-byte; none is added or
missing. Inspection of the five differing files shows:

- `backup.js`: line wrapping only.
- `invitation-authority.js`: line wrapping and redundant parentheses only.
- `invitation-authority.d.ts`: corrected required URL/method input facts.
- `creation-persistence.d.ts` and `journal.d.ts`: order of union members only.

Against Finance, the remaining generic lifecycle differences are the previously
recorded newer source functionality. Finance is not switched to this source.
No source implementation is reconstructed from emitted JS at build/install time;
these adapters now compile directly from reviewed TypeScript.

Reproduce after `pnpm dlf:package`:

```sh
python3 scripts/monorepo/compare-library-build.py /path/to/source-parent packages/local-first delightful-local-first --allow-source-changes > specs/002-monorepo-agent-guidance/alpha60-package-comparison.json
```

## Approved qualification

The user approved this concrete implementation with “continue” before test and
fixture updates. The earlier 1,085-test result remains alpha.59 evidence; the
results below qualify this alpha.60 source slice.

| Check | Result |
| --- | --- |
| Formatting, lint, full Svelte/TypeScript and fixture types | Passed; zero Svelte errors/warnings |
| Unit suite | 1,090 passed in 52 files |
| Generated readiness | 27 passed |
| Package and strict publint | Passed |
| Public packaged-consumer types, runtime checks and builds | Passed |
| Native backup/capture/export, including persistent Chromium | 20 passed |
| Private creation, native permission boundaries and restart | 10 passed |
| Full restore browser suite | 72 passed; 7 existing opt-in measurement skips |
| Public Storybook build and Chromium suite | Build passed; 63 tests passed |
| Website regression | Zero diagnostics, 152 tests, production build and emitted SSR checks passed |
| UI regression | Zero diagnostics, 131 tests, build and package validation passed |

Five new unit cases cover all three recognized capture-conflict strings and
native/cross-copy no-account admission errors. Request-capture assertions cover
URL/method/cookies, later host header mutation, unchanged body ownership and
sanitized outcomes. Existing permission tests now assert the authority's
`permission_denied` code instead of alpha.59's textual error wording. No
permission predicate was relaxed and no new skip or timeout was introduced.

### Fixture API and ownership adaptations

The fixture updates use the installed alpha.60 public APIs:

- Browser sessions are endpoint-scoped (`scope` retains legacy test account
  namespaces). Typed session doubles use the current lifecycle methods.
- Disposable backends use `startTestJazz`, fronting their core through the app's
  native Jazz handler. The backend-owned `jazz.db` performs privileged fixture
  writes; guest readers remain separate and permission-scoped. Permission repair
  uses `redeploy` so the native backend also adopts the changed bundle.
- Test-only schemas explicitly declare `migrations: 'none'`. Their tables,
  relationships and owner/immutable-row requirements remain the same, expressed
  through alpha.60's string `session.user` account reference.
- Persistence fixtures explicitly await `upgradeToLocalFirst` and assert
  `isLocalFirst`; thin-client success cannot qualify offline/native behavior.
- Alpha.60 no longer exports `jazz-tools/dev/vite`. A shared fixture asset helper
  resolves the binary from the SDK's own WASM dependency, prebundles known lazy
  dependencies before interactions, and retains Vite's workspace allow-list.
  Each disposable app backend allows only its exact fixture page origin; no
  wildcard or production origin setting changes. Native browser callbacks use
  their browser-loaded module's loader, avoiding SSR-transformed imports inside
  Playwright's serialized functions.
- The upgraded SDK Db handle has readonly methods. Restore issue counting now
  observes the common fixture transaction-writer commit boundary, including
  attachment/root/note continuations and explicit fixture commits. All original
  issuance/no-replay assertions are retained. A WeakMap keyed by the disposable
  Db stores only a test observer; it owns no SDK resource, persists nothing and
  makes no workflow decision. Identity replacement is injected through the
  fixture write machine's two-method identity port rather than mutating the Db.

The schema/backend changes apply only to disposable qualification fixtures; no
Finance or Clipper domain code is moved into the library.

### SDK observations that differ from alpha.59

The installed SDK's `runtime/db.js` and public transaction declarations distinguish
mergeable reads from serializable validation. Native qualification confirms:

- Mergeable reads follow committed changes; snapshot isolation tests use
  serializable transactions and retain their frozen-graph assertions.
- A serializable remote read hydrates a coherent cold snapshot. The old
  empty-cold-cache probe now asserts complete, exact graph capture and authority
  acceptance. Concurrent row/permission changes and predicate insertions must
  still reject the stale serializable capture.
- Read-only capture of pending local edits waits for their fate. It may succeed
  when those source writes are accepted; rejection still invalidates capture,
  and a fresh attempt reads the settled graph.

These are version-specific SDK observations, not a weakened archive contract.
Export still hydrates before capture, waits for authority confirmation, protects
payload ownership and preserves the existing archive format/consistency label.
No generic production machine was changed.

Initial qualification failures exposed legacy API assumptions, readonly test
instrumentation and the exact-origin requirement. One browser attempt was also
invalidated by a concurrent package rebuild triggering Vite reloads; the valid
browser runs were performed after the package build finished. Subsequent retries
were limited to the diagnosed fixture fixes and required remaining checks.

The seven skipped restore cases are the existing explicit workload measurements
controlled by `DLF_BACKUP_MEASURE` / `DLF_BACKUP_RECORD_MEASURE`. Full hosted CI has
not run yet. Root CI keeps its full Local First checks enabled.

## Remaining consumer-link gates

Clipper's separate `jazz-tools` runtime patch remains consumer-owned. Its DLF
presentation patch also remains separate: it adds `./recovery/view` and fixes an
emitted view-model type name. Neither is silently imported or dropped. Before
workspace linking, reconcile these patches and verify the actual consumer builds,
SDK lifecycle, storage/offline and extension behavior. A matching adapter build
alone does not establish those guarantees.

## Rollback

Discard/revert only this adapter slice and its SDK lockfile change to return to
qualified `5e66936`, then reinstall the previous frozen lockfile and rebuild the
library. Consumer archives, deployed clients, persisted data and source repository
settings are untouched. No source handoff or production release has occurred.
