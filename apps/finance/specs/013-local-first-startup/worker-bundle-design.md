# W02: inactive worker bundle proof design

Status: W02 complete (2026-11-13). The user approved the build-only approach,
reviewed the concrete implementation, then explicitly approved adding/running
focused tests. Dedicated types/proof build, application and test types, normal
production build, 35 focused unit tests and 19 production browser cases pass.
Baseline: W01 at monorepo `main` `670fb720`. Read the
[W01 evidence](worker-baseline.md), [ownership inventory](worker-ownership-inventory.md)
and [W02 task](worker-migration-tasks.md). User direction: stop and discuss
uncertain choices rather than silently choose a migration approach.

## Verified package entry points

The exact installed exports currently resolve as follows:

| Public entry                                                                     | Source graph                                                                                                                         | Intended proof                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `delightful-local-first/backend/jazz/session`                                    | `backend/jazz/session.ts` imports `createJazzClient` from `jazz-tools/client`                                                        | Compile the real SDK acquisition adapter without invoking its `open` capability.                                 |
| `delightful-local-first/backend/jazz/startup`                                    | Imports the same adapter and Local First `session.ts`, which reexports identity/session machines without a Svelte integration import | Compile the retained session-owner composition without starting an actor/registry acquisition.                   |
| `delightful-local-first/session/workflow`                                        | Acquisition/startup/readiness machines                                                                                               | Compile existing shared ownership logic, not a replacement root.                                                 |
| `delightful-local-first/worker/channel/workflow`, `worker/effect-drain/workflow` | Existing generic lifecycle machines                                                                                                  | Establish that the shared worker foundation can enter the same worker build.                                     |
| `jazz-tools/client`                                                              | `dist/client/index.js`, account/session/client modules                                                                               | Compile public non-Svelte SDK APIs. Type-only imports do not count as emitted runtime dependencies.              |
| `jazz-tools/local-first`                                                         | `dist/local-first/index.js` → native/default DB implementation                                                                       | Retain the lazy runtime import and trace its nested JS/Wasm assets. No database creation or storage is admitted. |

The top-level package entries and `jazz-tools/svelte` are not substitutes for
these specific exports. The earlier PR's bundle reached Svelte provider files;
the proof must inspect the resolved module graph, not just succeed because all
interesting imports were removed by tree shaking.

## Approved delivery approach

The user approved a **dedicated build-only proof using shared production worker
settings**. Keep the probe outside normal page/startup imports. Use Vite's real
module-worker bundling path to compile the future worker source and its lazy SDK
runtime. Share the Jazz/Wasm aliases and worker build options with the app's
production configuration instead of copying a second configuration that can
drift. Output goes to an ignored proof directory, separate from the served app.

The unselected alternative was to make normal production builds emit and precache an unused worker
asset immediately. That directly exercises the existing SvelteKit asset-manifest
integration but changes deployed public assets/cache size before custody and
runtime activation are ready. It requires an explicit build reference even
though no existing application flow should create the worker yet.

Both approaches must leave the Window SDK as the sole active owner and must not
start a second session, open storage, request native locks, connect a broker,
read credentials or migrate a route. The recommendation proves bundling only;
the eventual real application entry, served asset chain, offline startup and
cutover still require W05/W06/W20 evidence. A build fixture is not that evidence.

## Implementation scope

1. A minimal worker-side import boundary that uses the real public SDK/Local
   First entries. Do not introduce an application command protocol or session
   root before its W07/W06 design. Prevent a successful proof that tree-shakes
   away the target factories/lazy runtime graph; inspect both resolved and
   emitted dependency evidence.
2. A build-only driver that references this entry through Vite's module-worker
   mechanism. It must not be imported by page/layout/diagnostic production code.
3. A small shared production resolve/worker configuration used by the normal
   app build and proof build. Preserve existing Wasm aliases and asset naming;
   do not add dependencies, SDK/XState patches or Svelte UI worker plugins.
4. A proof build configuration and command with isolated ignored output and a
   machine-readable report of actual resolved module IDs, emitted imports/assets,
   and public entry/version provenance. Do not rely on guessed hashed filenames.
5. Spec/checkpoint evidence naming exactly what was compiled and what remains
   unqualified. The concrete paths/file grouping are recorded below; keep the
   implementation bounded and explain any shared build-file
   change rather than spreading a probe through production routes.

## Acceptance and test impact

- Types and production-mode worker build pass on the pinned workspace runtime.
- Resolved worker modules exclude `.svelte` components and Jazz's Svelte provider
  integration. Type-only imports and harmless string literals are not violations;
  don't substitute a minified-output text search for dependency inspection.
- The proof includes actual SDK/local-first/shared factory implementations and
  emitted nested JS/Wasm dependencies; it must not externalize them or report an
  empty worker as success.
- Normal production app build remains usable and retains its existing worker
  asset behavior. If common build configuration changes, inspect the existing
  PWA/Wasm asset coverage and production bundle before selecting focused tests.
- No runtime/session/storage or UI integration is activated by this proof.
- Add/run implementation tests only after review of the concrete implementation,
  following current repository guidance. W01's baseline counts are not W02
  verification, and no prior-session blanket testing approval is inferred.

## Concrete implementation and build evidence

Eight implementation/configuration files define the change:

| File (relative to Finance)                     | Responsibility                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/runtime/worker/application.worker.ts` | Inactive entry retains the public SDK/Local First factory graph and lazy local-first loader. If manually opened, it reports import kinds; it does not call the factories. |
| `tooling/worker-proof-driver.ts`               | Exported module-worker constructor, never called automatically or imported by production startup.                                                                         |
| `vite.worker-proof.config.ts`                  | Isolated Vite production build, dependency audit, implementation-retention and emitted-import checks, plus version/asset reports.                                         |
| `tsconfig.worker-proof.json`                   | Dedicated strict check for worker, driver and build tooling without relying on generated page configuration.                                                              |
| `tooling/jazz-wasm.ts`                         | Shared existing Wasm aliases, worker asset naming and ES-module worker format.                                                                                            |
| `vite.config.ts`                               | Consumes that shared configuration; no application probe import or runtime hookup.                                                                                        |
| `tooling/worker-assets-manifest.ts`            | Retains precache manifest integration; asset naming moved to explicit shared configuration instead of a configResolved mutation.                                          |
| `package.json`                                 | Adds `check:worker-proof` and `build:worker-proof`; no new dependencies.                                                                                                  |

Normal workers now use explicit ES-module output instead of Vite's implicit
IIFE default. Existing Finance worker constructors already request module
workers. This output-format change is necessary for the lazy SDK graph's split
chunks and is a concrete behavior boundary for the follow-up tests; successful
compilation alone does not establish provider/browser compatibility.

Commands run in the isolated W01 checkout on Node 24.22.2 / pnpm 10.28.0:

```sh
pnpm --filter delightful-finances check:worker-proof
pnpm --filter delightful-finances build:worker-proof
pnpm finance:check
FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=same-origin \
FINANCE_EPHEMERAL_JAZZ=true PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false \
pnpm finance:build
```

The same disposable same-origin environment was supplied to the recorded checks.
All commands passed; the application check reported zero errors and warnings.
The final proof guards were subsequently tightened to require the exact Finance
entry report and validate emitted dependency closure, and its dedicated type/
build checks were rerun successfully. Focused implementation/browser results
are recorded below.

The proof emits `.svelte-kit/worker-build-proof/worker-proof.json` and per-worker
`reports/worker-graph-*.json`. These ignored outputs contain actual resolved
module IDs/edges, rendered module bytes/exports, static/dynamic chunk imports,
public entry/version provenance and emitted asset names. The main graph has
486 resolved modules, 310 rendered modules and 14 chunks. The nested Jazz broker
graph is a prebuilt SDK module reported separately; this is not a source-level
audit of code hidden within prebuilt SDK bundles or Wasm.

Required SDK/session/default-DB and Local First acquisition/startup/channel/drain
implementations have nonzero rendered bytes. The audit rejects Svelte component/
rune modules, Jazz's Svelte integration, missing implementations, missing Finance
entry graph, unbundled emitted JS dependencies and absent Wasm. It does not use
type-only imports or a minified string search as dependency evidence.

Output includes the application probe, lazy local-first/native chunks, SDK
broker assets and an 8,800,443-byte Wasm asset. Normal application client output
was inspected separately and contains no application-worker probe, proof driver
or dependency reports. The inactive probe is not part of served assets or the
application's precache list.

## Approved regression and browser qualification

The user reviewed the eight-file implementation and explicitly approved the
focused tests in this session before they were added/run. Qualification used
Node 24.22.2 / pnpm 10.28.0 in the same isolated checkout based on `670fb720`.
No new dependency or test authority was introduced.

- `src/lib/runtime/worker/worker-bundle.test.ts` exercises real Vite builds with
  eight scenarios: positive SDK/lazy/Wasm output; two resolved UI import
  rejections; omitted implementation rejection; externalized dependency
  rejection; missing Wasm/report rejections; and a harmless component-name
  string accepted. Fixtures modify source or emitted output rather than mocking
  the plugin's graph API.
- `tests/worker-bundle.e2e.ts` opens the actual hashed provider worker emitted by
  the normal production build as a native ES-module worker. Three synthetic
  relay cases verify validated success, malformed JSON refusal and sanitized
  HTTP failure. Each checks exactly one request and terminates its worker.
  Service workers are blocked for these three cases so the test intercepts the
  relay; the existing PWA cases retain their normal service-worker setup.
- `tests/config/playwright.pwa.config.ts` includes those cases. The development
  base config excludes this production-only file, and
  `scripts/check-e2e-scopes.ts` assigns it to the PWA runtime explicitly.

Commands run from Finance unless the command is root-scoped:

```sh
pnpm exec vitest run src/lib/runtime/worker/worker-bundle.test.ts \
  src/lib/integrations/simplefin-worker.test.ts \
  src/lib/integrations/simplefin-worker-runtime.test.ts
pnpm check:worker-proof
pnpm check:tests
pnpm finance:check # workspace root
FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=same-origin \
FINANCE_EPHEMERAL_JAZZ=true PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false \
pnpm finance:build # workspace root; PUBLIC_JAZZ_APP_ID unset
FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=same-origin \
FINANCE_EPHEMERAL_JAZZ=true PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false \
pnpm exec playwright test --config tests/config/playwright.pwa.config.ts \
  --workers 1 --max-failures 1 # PUBLIC_JAZZ_APP_ID unset
pnpm check:e2e
pnpm monorepo:check-guidance # workspace root
```

The focused unit run passed **3 files / 35 tests** in 1.62s, including the eight
new bundle tests and 27 existing provider wrapper/runtime tests. The browser run
passed **19 cases** in 39.9s: all 16 existing PWA/offline/update/Wasm cases plus
the three actual production-provider module cases. All listed type/build checks
passed; Svelte reported zero errors and warnings. Raw qualification logs are
retained locally under `/private/tmp/finance-worker-w02-670fb720/`.
These are W02 runs, distinct from W01's baseline evidence.

The production preview was disposable on port 4173 with in-memory Jazz;
protected user servers/data were not used. The tests establish the shared
ES-module format's compatibility with the existing provider worker and current
PWA assets. The application probe stays outside served/precache assets and has
no production startup caller. No SDK/session/storage owner or financial route
has moved. Persistent application-worker startup, native custody, cancellation/
crash correctness and full migration parity remain W03–W21 work.
