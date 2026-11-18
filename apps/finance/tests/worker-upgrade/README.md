# Isolated Jazz alpha.67 candidate

The maintained candidate is `jazz-tools@2.0.0-alpha.67`. The active application
and workspace remain on alpha.60. These commands use temporary projects, exact
installed dependency versions and packed public libraries; they do not change
workspace pins, production routes, stores or deployment destinations.

Run from `apps/finance`, with current Local First and UI builds:

```sh
node tests/worker-upgrade/run.mjs --worker
node tests/worker-upgrade/run.mjs --schema
node tests/worker-upgrade/run.mjs --clipper-schema
node tests/worker-upgrade/backend.mjs /path/to/reported-clipper-artifacts --auth
```

`--worker` includes the Finance schema checks, native worker/session cases and
actual Finance Worker/Svelte cases across Chromium, Firefox and WebKit. It
exercises account creation/archive, transaction entry/editing, balances, bounded
ledger pages, offline process restarts and draining writes before close. It
reuses the existing Finance domain charts, validation, forms and translations.
`--schema` runs the Finance schema/permission/backup/restore checks alone.
`--clipper-schema` runs Clipper's schema/reading checks; the separate backend
command covers gateway admission, the actual auth entry and expiry/read-only
negative controls. These bounded checks do not establish complete application
parity or authorize coordinated activation.

The old explicit `--sdk=2.0.0-alpha.67` argument remains accepted. Older candidate
versions and the alpha.65-only default Clipper session runner have been retired.
Their source and results remain in Git and the linked research records, rather
than remaining alternative maintained implementations. This does not retire the
alpha.60 comparison baseline or the legacy compiler used to compare schema
identity. Complete Clipper session adoption on alpha.67 remains an open gate.

## Source ownership

New candidate implementations and qualification cases live as normal source in
[`candidate/`](candidate/):

- `finance/` and `clipper/` hold new native transforms, runtime query bindings and
  upgrade/restore cases.
- `backend/` holds the native Better Auth expiry/refresh case, copied only for
  backend qualification with `--auth`.
- `fixture/` holds the native actor and Svelte fixtures.
- `local-first/` holds the private native Jazz session adapter.
- `worker/application.worker.ts` is the candidate Finance worker entry. The
  active alpha.60 entry remains a build-only import catalog.

The runners copy maintained application/library source, apply the remaining
version-specific source modifications, then copy these candidate additions.
`finance-worker.patch` is no longer needed. Candidate code is not enabled in
normal application builds. Moving existing source out of patches changes no
schema shape, permissions, workflow or settlement behavior.
The alpha.60 test TypeScript project excludes this candidate directory; the
runner copies its files into the alpha.67 projects' existing strict TypeScript,
Svelte and native test checks instead.

The remaining schema/session/fixture patches adapt existing alpha.60 source while
both SDK versions coexist. They remain maintenance debt, rather than becoming
shared compatibility APIs. The Clipper schema overlay now preserves merged PR51's required note document,
same-document highlight policies and native migration history. A fresh alpha.67
run passes 61 cases, including an actual alpha.60 historical store opened with
new native bindings. Both schema hashes and the permission bundle match exactly;
this qualifies the schema port, not complete Clipper session/backend adoption.

## Dependency changes and qualification limits

`worker-bridge.patch` carries the existing six-file worker host bridge into the
candidate SDK. An unpatched alpha.67 Chromium control retained account identity
but lost the saved/edited row after process restart. The bridge has not gained
new behavior. Backend qualification extracts the existing alpha.60 backend
hunks and reuses the existing provider correction, with unpatched negative
controls. No installed workspace dependency patch changes here.

Against the schema reconciled with merged PR51, the backend command passes eight
gateway and 34 auth cases plus strict selected types. All five negative controls
still fail as expected: unpatched extension origin, registered device admission,
provider callback, missing expiry and refreshing admission. The auth count comes
from Vitest's JSON report. The expiry case is unchanged source moved out of the
auth patch; the no-op readiness adapter formatting patch has also been removed.
This qualifies the bounded gateway/auth integration, while complete Clipper
session/backend adoption and live Vercel admission remain open.

The runner verifies the published SDK tarball's SHA-512 integrity, SDK/native/Wasm
version identity, generated schema identity, strict types and Svelte checks.
It retains sources, exact dependency locks and diagnostic artifacts in the
printed temporary directory. Reports must distinguish local candidate results
from ordinary CI and production acceptance.

Retained snapshot comparison remains separate: `retained-prepare.mjs` prepares
independent native alpha.60/66/67 readers from a successful Finance schema
artifact. `retained-compare.mjs` operates on scratch copies of authorized
read-only snapshot mounts and prints counts/comparison booleans, not private
rows. It does not authorize new cloud access. `vercel-names.mjs` remains a
historical alpha.66 source-only check against retained artifacts.

See the [resource model](../../specs/013-local-first-startup/worker-session-resource-decision.md),
[upgrade research and retained-data evidence](../../specs/013-local-first-startup/worker-jazz-upgrade-plan.md),
[alpha.66/67 source audit](../../specs/013-local-first-startup/worker-jazz-alpha66-research.md)
and [remaining migration work](../../specs/013-local-first-startup/worker-migration-tasks.md).
