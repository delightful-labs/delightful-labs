# WebKit worker startup research

Researched 2026-11-16 after the user pointed out that Clipper already works in
WebKit. The cause is established in the preserved Finance fixture. Two supported
build corrections pass the entire native suite experimentally. Neither correction
has been applied to the committed configuration yet.

## Cause

Finance's `workerRuntimeBuildConfig()` selects `worker.format: 'es'` and permits
code splitting. The emitted SDK worker contains Jazz's account credential WeakMap
and exports the local-first database constructor. Its lazy local-first chunk
imports that constructor back from the worker entry:

```js
// sdk-session.worker-CuZOwsvO.js, abbreviated generated output
const credentials = new WeakMap()
// Jazz session creation registers its opaque account handle here.
await db.upgradeToLocalFirst(() => import('./local-first-E9R3LSf4.js'))
export { createDb as t }

// local-first-E9R3LSf4.js
export { t as createClient } from './sdk-session.worker-CuZOwsvO.js'
```

Our installed WebKit evaluates that worker entry again when the lazy chunk
imports it. The second evaluation creates another credential WeakMap. The
original session's account handle is present in the first map and absent from
the second, so the second constructor throws `invalid_account_handle`.

This matches [WebKit bug 324459](https://bugs.webkit.org/show_bug.cgi?id=324459).
The [upstream correction](https://github.com/WebKit/WebKit/commit/47b1bf884eb5)
registers the worker's entry module under its actual URL so imports reuse it.
Although that issue is marked fixed upstream, our installed Playwright WebKit
still reproduces it. Do not infer that a browser version label alone proves the
correction has shipped in a particular binary.

## Direct evidence

A minimal reproduction uses no Jazz, IndexedDB, XState or application code:
the module worker exports an object; its message handler dynamically imports a
module that imports that object from the worker entry. Count entry evaluations
and compare the original object with the imported object. A control puts the
object in a separate module imported by both files.

| Installed browser                | Entry imported back: evaluations / same object | Separate shared module: evaluations / same object |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Chromium 156.0.8078.4            | 1 / true                                       | 1 / true                                          |
| Firefox 157.0                    | 1 / true                                       | 1 / true                                          |
| Playwright WebKit reporting 27.2 | 2 / false                                      | 1 / true                                          |

The preserved unminified Finance build was then served unchanged except for
diagnostic counters/logs inserted into the served copy of its worker entry.
No installed SDK file, account data or repository implementation was changed.
Logs record module evaluation number and whether the map contains the handle,
without recording account credentials:

```text
Chromium: entry 1; mint in 1; lookups in 1 true; SDK opened local-first.
WebKit:  entry 1; mint in 1; lookups in 1 true;
         entry 2; lookup in 1 true; lookup in 2 false;
         OPEN (ready): invalid_account_handle.
```

This explains why the earlier inspection finding only one WeakMap declaration
in the worker file was insufficient: the same declaration executes twice.
The failure does not require copying an account handle across threads or
corrupting persisted account selection. The same IndexedDB store and SDK startup
code pass when only the bundling setting changes.

## Why Clipper works

Clipper's Vite config does not override the worker format. The installed Vite
default is `iife`; its existing local production artifact is a single IIFE
bundle, without this lazy import back into its entry. Vite's installed source
sets `codeSplitting: false` for that format. This differs from Finance's explicit
ES-module worker output. See the [Vite worker option](https://vite.dev/config/worker-options).

Clipper's startup registry, account store and lifecycle remain useful reuse
points, but changing those is unnecessary to correct this particular failure.
This investigation did not inspect the user's deployed Clipper asset or Safari
binary; the build comparison concerns the current local source and artifact.

## Build alternatives and results

Each experiment changed one setting in `tooling/jazz-wasm.ts`, ran the existing
`vitest.worker-bindings.config.ts` suite with no test-name filter, then restored
the original file in a `finally` block. No expectations, deadlines or SDK code
were changed. All 30 cases passed in each experiment, including the actual
Finance schema's offline saves and two complete browser-process restarts in
Chromium, Firefox and WebKit, plus the existing native grant/close cases.

1. Set `worker.format: 'iife'`, matching Clipper's default output: **30/30 pass**.
2. Keep `worker.format: 'es'` and add `codeSplitting: false` inside
   `worker.rolldownOptions.output`: **30/30 pass**.

Recommend option 2 as the narrower change: preserve ES-module worker output and
use the supported [Rolldown single-bundle setting](https://rolldown.rs/reference/OutputOptions.codeSplitting).
The pinned Rolldown 1.2.18 types support it. The tradeoff is including lazy worker
dependencies in the initial JavaScript bundle; the Wasm binary remains an emitted
asset. This is a build choice, not another runtime manager or SDK patch.
Keeping code splitting while forcing shared code into a separate module is
another possible approach, but requires additional chunk-layout controls and
was not needed for these successful experiments.

## Handoff

Research scripts and logs are under `/private/tmp/finance-webkit-entry-research/`:
`repro.mjs` / `repro.log`, `sdk-observation.mjs` / `sdk-observation.log`,
`build-experiment.py` / `iife-all-native.log`, and
`es-single-bundle-experiment.py` / `es-single-bundle-all-native.log`.
The diagnostic observation reads the preserved unminified
`.svelte-kit/finance-binding-native-ewC0eU/build` without changing it. Essential
findings and experiment settings are recorded here so temporary files are not
required to understand or reproduce the investigation.

The committed configuration still uses ES output with code splitting. Apply the
chosen correction, inspect its emitted graph and run the affected worker build
and native checks before claiming the blocker fixed on the branch. This does
not establish full application parity, reconciliation, or resolution of the
separate offline-edit CI failure. It provides no reason to add an SDK patch,
replace the IndexedDB AccountStore or extend the old grant/call-owner design.
