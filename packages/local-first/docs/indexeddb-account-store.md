# IndexedDB AccountStore

`backend/jazz/account-store/indexeddb` exports `createIndexedDbAccountStore`.
It creates one retained XState/native storage owner and exposes Jazz's public
`AccountStore` plus `close(): Promise<void>`. It opens no SDK session and has no
localStorage import, fallback, migration marker, dual write or legacy cleanup.
The consumer supplies a stable `databaseName` and record `key`, and can inject
an `IDBFactory` for its native environment. There is no app-specific default.

```ts
import { createIndexedDbAccountStore } from 'delightful-local-first/backend/jazz/account-store/indexeddb'

const store = createIndexedDbAccountStore({
	databaseName: 'example-app-account-selection',
	key: 'example-profile'
})
// Supply this stable capability as JazzClientConfig.store. The existing session
// owner drains/closes the SDK before awaiting store.close().
```

The capability must be created at the SDK/application host boundary. Do not
construct a new store on every render or SDK call. The example is configuration
only; this slice adds no Finance or Clipper startup caller.

## Native behavior

- Schema version 1 contains a `selections` object store. Only an absent record
  returns `null`; existing non-string or oversized records fail. The SDK validates
  its own selection format. Selection
  strings are bounded at 1,048,576 UTF-16 code units, matching the previous bound.
- At most eight calls including current work are admitted. One owner processes
  its calls FIFO; native read/write transactions serialize conflicting clients
  using the same database/object store. Different record keys are logically
  isolated, although IDB transaction scheduling is at object-store scope.
- An update reads the latest record, invokes the SDK's synchronous transform and
  puts its bounded replacement in the same active callback. No await or message
  round trip interrupts it. Strict transaction durability is requested; updates
  are refused if the native transaction does not report strict mode.
- `put` success is not update success. Only the original transaction's complete
  event resolves the SDK call. Abort/error preserves the old record and reports
  failure. The implementation never retries a transform or unknown write.
- Native slots are registered before transaction creation, including synchronous
  reentrancy. The native owner keeps completion/abort handlers through actor
  disposal, so forced stop cannot manufacture a settlement receipt.
- Close refuses new calls, rejects queued calls as not issued and drains current
  work. The connection closes after that work; cancellation of pending open
  retains its original request and closes a late acquired connection. A blocked
  open may keep native close pending; it is not an empty account or safe-close
  receipt. Version changes revoke admission and close the native connection while
  original transaction receipts remain observed.
- Graceful `close()` returns the original native close receipt, also reachable
  after an actor error. It proves pending native open/transactions were settled
  and native connection close was issued. It does not prove financial work or
  the SDK session was closed, and it never transforms an unknown result into
  successful persistence. Normal IDB close has no asynchronous close event.

Errors contain generic text and execution facts (`reason`, `writeOutcome`), not
selection contents or original transform/native error payloads. Native abort is
separate from a conservative unknown result. Raw records and transforms are
worker-local and are not diagnostic/view/checkpoint data.

## Qualification

The user reviewed the implementation and explicitly approved its tests. Full
library/test types, 1,111 unit tests in 53 files, packaging/strict publint and
changed-source format/lint pass. The 13 new owner tests include a 300-run generated
campaign (seed 20261113, up to 24 commands) against an independent demand ledger.

`pnpm test:account-store` packages current source, checks the fixture and packed
SDK interface, builds a worker from the tarball's public export and runs 60 native
cases: 20 each in Chromium, Firefox and WebKit. These cover real cross-tab/worker
updates, abort after put success, errors/corrupt values, native close and late
open, version change, actor/worker termination and two browser-process restarts.
The stored-undefined regression caused the implementation to use an exact-key
cursor, distinguishing corruption from genuine absence.

The command runs in library verify and monorepo CI. See
[the native fixture](../fixtures/indexeddb-account-store/README.md) and
[Finance's W04 evidence](../../../apps/finance/specs/013-local-first-startup/worker-account-store-verification.md)
for commands, setup corrections and limits. Only fixture code bytes are
bootstrapped before going offline; every AccountStore construction/read/write
runs offline. This is native store qualification, not actual app/PWA asset delivery.

Finance adoption, connected SDK startup/replica persistence and removal of its
superseded transports remain W05/W06 work. The user deferred Clipper's account
store/hidden capture-runtime conversion to a separate follow-up. No migration or
production startup hookup was added. Existing user browser storage is not read,
changed or deleted by this slice.
