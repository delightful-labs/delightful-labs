# Native IndexedDB AccountStore qualification

Run from the workspace root on its pinned Node/pnpm versions:

```sh
pnpm --filter delightful-local-first test:account-store
```

The command packages current library source, type-checks the fixture, then runs
Chromium, Firefox and WebKit cases. Install that package's Playwright browsers
when missing; CI's Local First image already matches its pinned Playwright.
The same suite runs in Local First `verify` and the monorepo CI job.

The fixture packs a tarball, extracts it into a disposable independent consumer
under `.svelte-kit`, resolves the public AccountStore subpath, checks its SDK
interface with TypeScript, and builds a self-contained native module worker.
A build guard requires the packed public entry in its module graph. Two
forced-actor-stop cases also import internal source solely to create test-owned
roots; production consumers continue using the public package subpath.

Browser contexts/profiles and database names are disposable. An inert document
is fulfilled at a synthetic HTTPS origin with no HTTP server, and the emitted
worker bytes are supplied through a Blob. Requests outside that fixture origin
are refused. The fixture document/module bytes are bootstrapped before offline
mode; every AccountStore construction/read/write then runs offline. HTTP(S)-only
routing avoids intercepting WebKit's local Blob loads. This qualifies store/native-worker execution and packed exports,
not an application's production worker-URL delivery or service-worker precache.
Cold-reopen cases launch new persistent browser processes against the same
fixture profile, retain a value, edit it offline, and reopen it again.

Native tests include concurrent workers in two tabs, actual transaction abort
following successful put, thrown transform, oversize/corrupt values (including
stored undefined), late native open, version change, close failure, reentrant
actor stop, native transaction-creation stop, and whole-worker termination before
issue, at put success, and after commit. The middle crash permits either exact
old or exact new bytes; it must never expose a partial record or block replacement
writes. The after-commit case requires the committed value.

Quota and close errors are explicit fault injections into real native methods;
this is not evidence of physically exhausted disk/quota. Commit/abort and close
ordering observers register before production callbacks so native dispatch's
microtask checkpoints cannot make the oracle observe a terminal event too late.

The source owner unit suite separately runs deterministic lifecycle regressions
and 300 generated schedules against an independent demand/result ledger. Its
seed, bounds, coverage assertions and shrinking key are retained in the test.

No legacy import, fallback, dual writes, cleanup, migration marker or old-version
compatibility logic is tested or introduced. Finance/Clipper adoption, actual
SDK startup/replica persistence and PWA delivery remain separate work.
