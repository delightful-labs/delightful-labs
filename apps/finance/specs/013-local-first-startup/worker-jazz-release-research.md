# Jazz alpha.61–65: code audit for worker simplification

Researched 2026-11-16 at the user's request to inspect the actual newer releases
before recommending cleanup. Workspace dependencies and the existing SDK patch
remain unchanged at alpha.60. This is an upgrade proposal, not qualification of
Finance or Clipper on alpha.65.

After PR #39 merged at `fb380114`, the
[upgrade plan](worker-jazz-upgrade-plan.md) records the next compatibility steps
and an additional executed core/Drive naming comparison. Native alpha.65 handles
long Drive names, making Clipper's hashing workaround removable, but its custom
preview cores cannot be addressed by the new namespace rules. Resolve that data
destination choice before deploying the mapping.

## What was inspected

Downloaded the published `jazz-tools` tarballs for alpha.60 through alpha.65,
verified each against its npm SHA-512 integrity, and compared the distributed
JavaScript/declarations. Inspected every path modified by the workspace's
alpha.60 patch, plus session startup, public session API, Svelte provider/store,
account persistence, subscription orchestration and transaction handling.
Checked release notes against that implementation, rather than treating notes
or an exported symbol's existence as proof of supported behavior.

| Version                    | npm publish date (UTC) |
| -------------------------- | ---------------------- |
| alpha.60, current pin      | November 7             |
| alpha.61                   | November 12            |
| alpha.62                   | November 14            |
| alpha.63                   | November 14            |
| alpha.64                   | November 15            |
| alpha.65, current `latest` | November 16            |

The npm `alpha` dist-tag still points at alpha.60; it does not select the latest
published release. Any eventual upgrade needs explicit, coordinated version pins.
All five newer packages were inspected for additions/changed files; the native
browser probe below tests alpha.65 only.

## Cleanup supported by actual implementation

### Open local-first directly

Alpha.61 introduces `localFirst: 'now'`. In alpha.65's
[`session/create-jazz-session.ts`](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.65/packages/jazz-tools/src/session/create-jazz-session.ts),
`openClient` loads and opens the local-first client directly when that option is
selected. Loader failure propagates instead of silently opening thin. The
configuration requires the `client` loader. `initial` is now `'device'`, not
`'local-first'`: that selects the account kind independently of storage mode.

This can replace Finance's `prepareLocalFirstSession()` and its explicit
`db.upgradeToLocalFirst()` preparation invocation after upgrading the shared
integration. Clipper's account adapter has the same redundant upgrade leaf in
`prepare()`. Remove those SDK-upgrade steps, not workspace bootstrap, financial
readiness or PWA shell preparation. A real worker startup still needs the durable
browser-runtime bridge described below.

### Let the session own account operations and observations

Alpha.61 introduces the public session facade in `session/jazz-session.*`:

| Current alpha.60 use                           | Alpha.65 public replacement                             | Relevant local code                                                                |
| ---------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `snapshot.account.id` / opaque `AccountHandle` | `snapshot.user.accountId`, `user.kind`, `user.identity` | Finance's SDK fixture; Clipper's account adapter; Local First restoration/recovery |
| Ask the Db whether it upgraded                 | `snapshot.localFirst`                                   | Application startup observation                                                    |
| Infer native session operation/error recovery  | `snapshot.pending` / `snapshot.recovery`                | Thin native-session status projection; retain domain outcomes separately           |
| `exportLocalFirstSecret(account)`              | `session.exportDeviceKey()`                             | Local First `backend/jazz/recovery-phrase.ts`                                      |
| `session.restoreLocalFirst(key)`               | `session.restoreDeviceAccount(key)`                     | Local First `backend/jazz/restoration.ts`                                          |
| `session.logout()`                             | `session.signOut()`                                     | App identity integration                                                           |
| `JazzSessionProvider`                          | `JazzProvider` with an existing `session`               | Current Window provider compatibility                                              |

`exportDeviceKey()` delegates to the SDK's internal secret export for the current
device account, or the kept key while signed out. The native probe verifies it
is available for the new device session without exposing its value.

Refactor shared recovery/restoration adapters around the session/public user,
instead of retaining private SDK account handles. Keep current session/client
binding and stale-scope checks: the same account id under a different sign-in is
not necessarily the same admitted scope. Keep phrase presentation, explicit
secret lifetime, workspace policy and financial operations in their current
owners.

The native Svelte `sessionState(session)` uses an ordinary readable store and
`JazzProvider` accepts a caller-owned session. This is useful for the current
Window integration's upgrade, but it does not turn a worker session into a
cloneable object. Finance's worker UI still needs a bounded command/view boundary;
do not create a second SDK session on Window just to use that provider.

### Prefer the upstream fixes where they apply

- Alpha.64 changes broker asset construction and tree shaking. The isolated
  alpha.65 probe emits one broker worker and one Wasm binary. This removes the
  duplicate unused broker artifact observed during the earlier alpha.60 proof;
  it does not establish that our worker bridge can drop explicit asset admission.
- Alpha.65's `observed-jazz-client.js` watches sync-link transitions into
  `connected` and invokes `SubscriptionsOrchestrator.retryRejected()` for live
  rejected framework subscriptions. Do not add an application-wide reconnect
  subscription manager for this. No corresponding Finance workaround was found
  that can be deleted immediately on the strength of this fix.
- Alpha.65's callback transaction helper uses `commitUnlessEmpty()` and returns
  `EmptyTransactionWriteResult` for a no-op. This is useful, but an empty result
  has no transaction id. Do not remove Finance's real operation/transaction
  identity or uncertain-write handling. No deletion of a specific Finance
  empty-transaction workaround is established by this audit.

## Important negative result: unpatched worker durability

Created an isolated project outside the workspace with the published alpha.65
SDK, its matching alpha.65 Wasm, and a tarball of our unchanged Local First IDB
AccountStore/build helper. Installation used `--ignore-scripts` and disabled peer
auto-installation. The expected alpha.60 Local First peer warning is not an
upgrade qualification; runtime use here is limited to the store/build exports.
No workspace package, lockfile or installed SDK file was changed.

The same SDK leaf runs on Window and in a real dedicated module Worker:

- Explicit IDB AccountStore, `initial: 'device'`, `localFirst: 'now'`, normal
  public loader and default persistent driver. No `browserWorkerHost` patch.
- Shared single-bundle ES-module output, preserving the WebKit correction.
- Static assets only; app/auth/Jazz endpoints return 404 throughout.
- Open the SDK, confirm public ready/local-first observations, set browser
  networking offline, insert a note and await local settlement, read it back,
  close SDK/store, close the full browser process, then reopen the same profile
  and verify the original account and row offline.

| Browser  | Window after full restart      | Dedicated Worker after full restart |
| -------- | ------------------------------ | ----------------------------------- |
| Chromium | Same identity and row retained | Same identity; row missing          |
| Firefox  | Same identity and row retained | Same identity; row missing          |
| WebKit   | Same identity and row retained | Same identity; row missing          |

Every initial open reports `ready`, `localFirst: true`, a device user and one
loader call. All initial local writes/readbacks succeed. Thus merely checking
`localFirst` is not a worker-durability test. Each case has one full process
restart; this is a focused API probe, not the full Finance schema/parity suite.
A focused diagnostic repeats only the worker cases and records exact query
results: one matching row before close and zero rows after reopening in each of
the three browsers. This distinguishes missing data from a value/id mismatch.

The implementation explains the difference: the three browser-runtime predicates
in `runtime/client.js`, `runtime/db.js` and `runtime/default-runtime-source.js`
still require Window. A dedicated Worker therefore misses browser persistence
and foreground-lease admission. The default runtime creates its local native
schema view without browser mode; native Wasm local operation alone does not
make those rows durable across browser processes.

Alpha.65's `RuntimeSourcesConfig` has no public `browserWorkerHost` callback.
Broker construction still uses `new SharedWorker`, and generation selection
still reads/writes Window localStorage. No native public replacement for our
dedicated-worker persistent bridge was found in alpha.61–65. Keep the bridge and
the IndexedDB AccountStore unless a separately verified supported path replaces
them; do not remove the patch on the strength of new session readiness fields.

## Existing patch audit

The patch changes 13 distributed files. None can be declared obsolete merely
because its surrounding file changed upstream:

| Patch responsibility                                      | What alpha.65 source actually shows                                                                                                                  | Disposition                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Worker runtime detection and Window SDK hooks             | Window-only predicates; no `browserWorkerHost`; direct native constructor/storage calls                                                              | Still a demonstrated gap; unpatched worker data probe fails persistence               |
| Keeping live host callbacks out of cloned configuration   | No host field exists upstream to exclude                                                                                                             | Part of carrying the existing hook, not an upstream replacement                       |
| Explicit Chrome-extension origin admission                | `new URL(origin).origin` still rejects opaque `null` origins                                                                                         | Do not drop Clipper's qualified behavior without its native admission tests           |
| Device/guest proof lookup in `accountFor`                 | Still authenticates a backend user and calls `existingAccountOf(user.userId)`; no equivalent guest-proof branch                                      | Do not assume the gateway patch is upstream                                           |
| Current joining-peer proof at native subscriber admission | Broker still calls `acceptPeer` without a joining proof; adapter uses its stored proof                                                               | No matching replacement found; expiry/rejoin behavior needs its existing native tests |
| Offline-safe retry shutdown                               | Session lifecycle was refactored; retry goes through native core retry, whose ordinary replacement uses `stopPastRefusal`, initially requesting sync | Not proven equivalent to our retry patch; test offline retry before removal/rebase    |
| Vercel guest-admission core option                        | The patched `allowLocalFirstAuth` entry is absent from the returned core options                                                                     | Needs matching core/deployment review; no Vercel runtime test performed here          |

## Upgrade boundary and order

This is not a drop-in version bump. The published `removed-api.js` exports
throwing stubs for several names we use, including `JazzSessionProvider`,
`exportLocalFirstSecret` and `acceptLocalFirstAuth`. Do not mistake those exports
for compatibility. The session's private `.account` is no longer public, and
`initial: 'local-first'` is rejected.

Clipper's backend currently returns `{ userId }`; the new `AuthenticatedUser`
requires `expiresAt` in Unix seconds. Its `better-auth` peer changes from exact
1.7.1 in alpha.60 to `~1.7.22`; the workspace currently uses 1.7.18 with its own
qualified auth patch. The workspace's compatibility allowance applies only to
alpha.60. `jazz-napi`, Wasm, library peer pins, the gateway and backend APIs need
coordinated qualification too. Two additional blockers are present in the actual
app code:

- Both `apps/finance/src/lib/schema.ts`'s active `app` and Clipper's active
  `backend/jazz/schema.ts` use `migrations: 'none'`. Alpha.65's persistent-backend
  admission rejects this for SQLite, Vercel and remote stores. The successful
  client-only probe does not exercise that backend gate. Establish supported SDK
  schema history before upgrading those backends; this is distinct from adding
  an account-selection migration layer, which the user explicitly excluded.
- Both apps' Vercel store configurations omit the newly required `namespace`
  and may pass the older `name` option. Map their existing core/destination
  selection explicitly rather than changing where production data lives as a
  side effect of upgrading.

No schema history, storage reset or deployment-destination change was performed
in this investigation. The user's no-account-store-migration decision remains
intact.

Recommended sequence for review:

1. Plan a coordinated alpha.65 upgrade through Local First's native-session
   adapters and both consumers, with an explicit existing-patch disposition.
   Do not start a second worker framework or extend the grant/call population.
2. Use native immediate local-first startup and session account operations;
   remove only the corresponding redundant upgrade/handle plumbing.
3. Requalify the patched persistent worker with the actual Finance cold-restart,
   failure, identity-change and shutdown cases, plus affected Clipper/backend
   cases. The unpatched probe does not qualify the patched alpha.65 combination.
4. Resume the selected worker-owned read slice and obsolete-prototype cleanup.
   Keep financial workflows and durability outcomes distinct from SDK session
   status.

## Evidence and limits

Artifacts live under `/private/tmp/finance-jazz-release-research/`: six verified
SDK tarballs, per-release changed/added file inventories, metadata and an isolated
`probe/` with browser source, build/runner, profiles and logs.
`probe-results.log` records the Window/worker controls;
`probe-worker-details.log` records the explicit row counts. The essential
settings, outcomes and code paths are recorded here so temporary files are not
needed to understand the findings. Preserve the profiles if investigating the
worker data loss further.

Primary references: [alpha.61](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.61),
[alpha.62](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.62),
[alpha.64](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.64),
[alpha.65](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.65).
Release notes were cross-checked against the published code. No repository
dependency upgrade, SDK rebase, production deployment, Vercel core probe or full
application qualification is claimed.
