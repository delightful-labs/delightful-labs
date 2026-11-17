# Isolated Jazz alpha.65 worker proof

From Finance, with the workspace's Node/pnpm and installed Playwright browsers:

```sh
node tests/worker-upgrade/run.mjs
```

This reuses `tests/worker-bindings`, the actual Finance schema/validation and
the current built public Local First package. It creates a temporary project
with separate dependencies and browser profiles. It downloads the exact
alpha.65 SDK, checks npm's SHA-512 integrity, applies the inactive candidate,
checks types and runs the native suite. The generated dependency lock, SDK
metadata, versions and sources remain in the printed artifact directory.
The Local First `dist` output must be current before packing.

- `worker-bridge.patch` carries only the existing worker detection, Window hooks,
  asynchronous generation operations and clone exclusion into six alpha.65 files.
  The newer SDK's store-deletion helper also awaits that generation reader and
  broker open; otherwise changing the shared reader to async would break that
  caller. No reset policy or new hook is introduced.
- `fixture.patch` adapts the maintained SDK leaf to immediate local-first startup,
  public user/account IDs and the new emitted broker location. It retains exactly
  one hashed broker asset and adds loader-failure and native session-adapter
  qualification cases per engine. Reports contain booleans, never keys or phrases.
- `session-adapters.patch` ports shared recovery/restoration to the public session
  methods and exposes native `starting` status. The runner compiles those source
  adapters and their contracts against alpha.65, updates a temporary library
  tarball, and tests the normal public package exports.
- `run.mjs` supplies dependency/build isolation; it adds no application runtime,
  actor owner, RPC layer, workspace package or CI job.

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
