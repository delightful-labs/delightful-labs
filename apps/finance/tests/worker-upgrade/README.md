# Isolated Jazz alpha.67 qualification

Finance, Clipper and Local First now use the same alpha.67 source and dependency
pins. Finance's actual SvelteKit root creates its application worker. This branch
still requires full application qualification before PR46 may merge.

Run from `apps/finance`, after building the public Local First and UI packages:

```sh
node tests/worker-upgrade/run.mjs --worker
node tests/worker-upgrade/run.mjs --schema
node tests/worker-upgrade/run.mjs --clipper-schema
node tests/worker-upgrade/backend.mjs /path/to/reported-clipper-artifacts --auth
```

The runners copy canonical application/library source into disposable projects.
They verify the published SDK tarball integrity and native/Wasm version identity,
then use packed public library exports. There is no second maintained application
implementation or source-overlay patch set. Additional historical upgrade cases
live under `fixtures/`, outside the ordinary unit-test project.

The alpha.60 historical producer is frozen at Git commit `51b8e878`, including
its schema and native migration history. It remains a comparison control, never
a live application dependency. Older results remain in the research records;
they do not qualify the current integrated batch.

`worker-bridge.patch` retains the previously approved six-file SDK worker bridge.
The canonical alpha.67 dependency patch includes that same behavior and existing
backend compatibility hunks. Backend qualification extracts those backend hunks
and reuses the existing provider correction with unpatched negative controls.
No new SDK workaround is introduced.

`--worker` includes schema checks and the native Worker/Svelte fixture across
Chromium, Firefox and WebKit. It complements the actual SvelteKit application,
permissions, bank, image, backup/restore and PWA browser suites. A bounded fixture
pass alone is insufficient to declare the migration finished.

Retained snapshot comparison remains separate: `retained-prepare.mjs` prepares
native alpha.60/66/67 readers; `retained-compare.mjs` reads scratch copies of
previously authorized snapshot mounts. These tools print counts/comparison
booleans, not private rows, and do not authorize new cloud access or production
writes. `vercel-names.mjs` is a historical alpha.66 source-only check.

See the [resource decision](../../specs/013-local-first-startup/worker-session-resource-decision.md),
[upgrade plan](../../specs/013-local-first-startup/worker-jazz-upgrade-plan.md)
and [remaining tasks](../../specs/013-local-first-startup/worker-migration-tasks.md).
