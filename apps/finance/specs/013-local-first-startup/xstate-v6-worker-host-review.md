# Finance migration: native worker-host foundation

Status: foundation committed as `5daf37a`; approved transport tests pass. The worker remains inactive and browser/runtime qualification remains pending.
Branch: `feat/xstate-v6-worker-runtime`, based on merged main `2cfba58`.

## This review batch

The first migration batch prepares the Window-only compatibility boundary required
by the approved UI/application-worker split. It does not move the current Finance
session, queries, financial writes, WebAuthn or provider work into a second owner.
The connected v6 conversion and controlled session handoff remain subsequent
review units. XState, framework bindings and shared artifacts stay on their
existing versions until a complete connected graph can move together.

Production files in this batch:

- `src/lib/runtime/worker/host-protocol.ts`: strict runtime DTO schemas, version,
  scope, request identity, sequence and payload/resource bounds.
- `src/lib/runtime/worker/window-host.ts`: only fixed-key account storage reads
  and writes, fixed-key broker generation storage, and opening the explicitly
  bound same-origin broker URL/name. No SDK or finance policy runs in Window.
- `src/lib/runtime/worker/host-client.ts`: private-port correlation, typed SDK
  broker capability, deadlines, failure observation and orphan-port cleanup.
- `patches/jazz-tools@2.0.0-alpha.60.patch`: the required Clipper worker-host
  mechanisms, retaining Finance's existing Vercel local-first patch verbatim.
- `pnpm-lock.yaml`: only the SHA-256 identity of that patch changes. Package
  versions, archive references and package integrity values remain pinned.

The adapter functions implement individual native operations and their transport
cleanup; they do not contain a business workflow. The future account-store chart
must own `lock -> read -> transform -> write -> release`, including interruption
and uncertain acknowledgement. This batch deliberately supplies raw read/write
ports rather than hiding that workflow in an async `update` callback.

## Admission and resource ownership

All requests/replies carry protocol version 1, a binding UUID, request UUID and
positive safe-integer sequence. The private host port only accepts its own scope
and the next sequence, consuming it before an effect so duplicate messages cannot
repeat a write or broker open. Invalid/stale replies cannot settle a current call.
A fresh binding needs fresh ports and a fresh scope; do not reuse a scope after
A -> B -> A replacement. The scope is correlation, not user authorization.

The binding supplies the exact existing account storage key, broker asset URL and
broker base name. Account requests cannot choose another storage key; broker
requests cannot select another script, physical namespace or generation key.
The Window host restricts the URL to its actual origin and opens only generation
suffixes of the bound name. SDK runtime configuration continues to choose the
physical storage root; application code does not import internal naming helpers.

Bounds: 1 MiB account-store strings, 65,536-character namespace/generation-read
strings, eight outstanding native calls, 32 broker handles per bridge and a
10-second request deadline. These are protocol bounds pending native qualification,
not measured startup/performance budgets. Generation values are returned raw for
SDK parsing; the host does not select recovery generations.

A matched write acknowledgement means only that the selected `setItem` returned.
An issued write whose port/deadline fails is reported as `unknown`; it is never
retried here. A rejected/unissued request is distinguished from that uncertainty.
Broker script errors and message decoding failures report sanitized host failure;
no credential, raw exception, private snapshot or finance payload is logged.
A silent port loss is bounded when a request is outstanding; the future worker
owner must additionally observe Worker errors/message errors and lifecycle loss.

The SDK owns transferred broker ports through its shutdown. The Window bridge
owns its listeners and its private host port; closing the bridge does not assert
that the SDK drained or that a financial write rolled back. The future runtime
must acknowledge SDK/financial drain before disposing the bridge or terminating
its worker. Unexpected, duplicate and stale transferred ports are closed.

## Exact patch and identity lineage

Reference: Clipper `e6757cc832a3a3270ac35ad0cce9abba2571a80f`, using
`jazz-tools@2.0.0-alpha.60`.

Only these worker support changes were extracted:

- Dedicated-worker browser-runtime selection in runtime client, DB and default
  runtime source.
- The `RuntimeSourcesConfig.browserWorkerHost` capability contract.
- Broker opening and persistent generation access through the Window host,
  including port release after an opening races connection shutdown.
- Removal of live host handles before config cloning, session validation and
  broker/WASM-prefetch message forwarding.

Clipper's backend create-Jazz auth/origin changes were excluded. Finance's earlier
Vercel local-first patch remains unchanged. New Finance patch SHA-256:
`8ac0c63ad8035cefef8a5cf7bf52d4cf26383b891568623dbeb4782c4fcad08f`.

Finance's installed SDK actually uses `jazz-account-selection-v1:` keyed by its
registry URL and encoded environment. Its browser store also has earlier-selection
fallback/scrubbing and a Web Lock on that storage key. Clipper's custom worker
adapter uses a different `v2` key and app environment. Do not copy that adapter's
namespace or claim identity reuse from a matching account ID. This first bridge
accepts the existing binding key without inventing one. The subsequent account
store integration must preserve or explicitly migrate fallback/scrubbing and
Web Lock ownership before worker session activation.

## Review and qualification

Completed static checks:

- Frozen-lockfile installation with scripts disabled applies the exact patch.
- Strict TypeScript checks of all three new files, including the broker object's
  `satisfies` check against the installed SDK host contract.
- Syntax checks of all five patched SDK JavaScript files.
- Focused Prettier and `git diff --check`.
- Existing Finance patch prefix is unchanged, and the lockfile patch references
  match the patch's SHA-256. No XState patch or declaration override was added.

Checks ran with Node 25.2.1/pnpm 10.22.0 for this static review. Finance's supported
Node 24 runtime, full application behavior and browser support remain unqualified
for this change. No Paraglide files were regenerated. No tests were added or run,
and no commit was made, following AGENTS' implementation-review gate.

After this implementation is approved, add focused host protocol/transport cases:

- Reject malformed/version/scope/sequence/URL/key mismatches before native effects.
- Correlate exact acknowledgements; close orphan/duplicate/stale broker ports.
- Distinguish pre-issue rejection, acknowledged storage writes and lost write
  acknowledgement; preserve bounds, timeouts and explicit close cleanup.
- Observe asynchronous broker errors without exposing identity material.
- Exercise the real patched broker from a dedicated worker and prove the same
  persistent store is visible after all clients close and a cold page restarts.

Affected existing coverage to inspect before running it:
`src/lib/runtime/jazz-session.test.ts`, runtime/application-readiness fixtures,
`tests/startup-stalled-remote.e2e.ts`, `tests/authentication.e2e.ts`,
`tests/pwa-cold-start.e2e.ts` and the workspace restore/startup suites. The patch
also changes the Window broker path, so its existing cold/offline startup must
remain an acceptance gate even before activating an application-worker session.

Next review unit: preserve identity-store/lock semantics and record the complete
connected v6 session/workspace graph and its UI-host capabilities before changing
the global runtime/framework/shared-artifact pins. Generated `@xstate/test`
campaigns enter with that connected v6 graph, after implementation review.

## Review approval and focused transport qualification

The user approved this foundation with “Commit and continue.” It is committed as
`5daf37a`. The approved transport implementation now has 17 passing cases in
`host-protocol.test.ts` and `host-channel.test.ts`, using real native MessageChannels
and controlled native storage/broker boundaries. Strict test/source types pass.

Reproduce with Node 24.22.2 and pnpm 10.22.0:

```sh
pnpm exec tsc --project tsconfig.worker-host.json
pnpm test:worker-host
```

The dedicated config avoids SvelteKit/Paraglide generation and the user's dev
server. Cases cover invalid/oversized commands, exact namespace binding,
generation-key and broker admission, native error sanitization, duplicate-write
rejection, asynchronous broker failure, stale replies, bounded pending calls,
explicit close and unknown write acknowledgement. These are native transport
checks, not browser persistence or worker SDK acceptance evidence.

The next v6 account-store graph is documented in
`xstate-v6-account-store-review.md`; its implementation awaits its own review
before tests, and is not yet connected to the live Finance session.
