# Independent worker host close transport

W05/R1 moves Clipper's existing native close-control adapter into the supported
`worker/host-close` export. The existing `worker/channel/workflow` remains the
only owner of admission, close identity, deadlines, late receipts and terminal
outcomes. This extraction adds no actor or second shutdown policy.

The host owns a dedicated control MessagePort, scoped by a UUID. A validated
version-1 `CLOSE_HOST` command selects one synchronous data-host disposal call.
Only successful return permits a matching `HOST_CLOSED` receipt. Native disposal
or posting failure produces no successful receipt; correlated failure facts are
reported when the control port can deliver them. The channel retains its close
deadline and receipt ownership. Callers must supply a disposer that can be called again
if duplicate valid close commands arrive, as in the original Clipper adapter.

The worker-side listener validates incoming receipts, closes rejected transferred
ports and ignores foreign scopes. A transport error reports `CLOSE_FAILED` while
retaining observation of a later genuine receipt. Its explicit disposer removes
listeners and closes the control port; disposing the listener is never evidence
that the data host closed. The channel chart correlates request IDs and chooses
when to release these native capabilities.

`serveHostClose`, `workerHostControl` and the wire version are public native
integration capabilities. `HostCloseIdentity`, `HostCloseFailure` and `HostControlReport`
reuse the worker-channel contract types. No SDK, account selection, browser broker
URL policy, reader/domain policy or IndexedDB commit receipt belongs here.

Wire validation stays private to this native boundary. Local First pins Zod
4.1.11 while Clipper pins 4.6.7; exporting schema objects made Clipper's composed
discriminated unions incompatible during static qualification. The public API
therefore exposes plain contracts and native functions, without Zod schema types.
Clipper retains its own correlation schemas for its separate broker/storage
payloads, using the shared protocol version. Neither dependency changes.

Clipper's existing module re-exports the native functions so its broker, current
storage transport and native fixtures consume one close implementation during
the bounded extraction. Later W05 slices replace the broker and account-store
bindings. The extension sign-in worker and offscreen capture runtime must use
the same IndexedDB binding before either account-store path changes; the latter
currently uses the SDK's default Window store.

## PR #35 review correction: explicit native failure facts

The user identified that the native receiver combined disposal/acknowledgement
and swallowed their failures. The user reviewed the concrete correction and
approved its implementation tests on 2026-11-14. Earlier R1/F3 counts below
remain historical; this correction has its own qualification evidence.

The Window adapter validates a scoped command and performs its selected single
synchronous disposal. A thrown disposal reports `HOST_CLOSE_FAILED` with stage
`dispose`; a failed success-receipt post reports stage `acknowledge`. Both include
the original scope/request ID, and neither includes a raw exception. The native
post helper makes one synchronous attempt and returns a posting fact. It chooses
no retry, timeout or lifecycle outcome. If the control port cannot carry even
the failure report, no additional transport exists here: the owning chart's
original close deadline remains the fallback, not evidence of closure.

`workerHostControl` validates and forwards these native facts. The existing
worker-channel chart owns their admission and meaning:

| Current state / fact                        | Chart decision                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Before closing or foreign scope/request ID  | Do not admit the failure as this channel's close result.                                                                              |
| First matching native failure while closing | Enter `closing.nativeFailed`, retain the correlated fact and notify optional `onCloseFailure`. Keep the independent control listener. |
| Duplicate failure                           | Preserve the first fact without repeating its owner notification.                                                                     |
| Original close deadline                     | Enter `closing.overdue`; do not restart the deadline when native failure arrives.                                                     |
| Failure after overdue                       | Retain/report its new detail without leaving overdue or reporting overdue twice.                                                      |
| Matching genuine `HOST_CLOSED`              | Accept the receipt and settle issued work through the existing protocol, including after native failure/overdue.                      |

The deadline is owned by `closing`, rather than only its `waiting` child, so it
survives the native-failure substate. Generic malformed/control errors retain the
existing `CLOSE_FAILED` transport fact. Broker channel input/options forward the
new optional typed failure report so parent-owned channels and the existing root
facade share this behavior. Existing callbacks remain source-compatible.

This does not put SDK shutdown, financial drains or asynchronous work inside
the Window disposer. Current callers remain synchronous port/listener cleanup.
It does not add a Window domain machine, automatic close retry or success from
failure. Native listener `disposed` guards remain local resource bookkeeping.

Coverage now exercises disposal/post failure facts, wrong/duplicate correlation,
failure before close, unchanged deadlines, malformed packets, both-report post
failure, late genuine success, absent/throwing failure observers and parent-owned/root
consumers. The generated channel contract includes failure correlation/stages,
first notification and the original deadline as independent external observations
(seed `20261113`, 400 runs, up to 24 commands, full event/state/transition coverage).
The actual-tarball close consumer and Clipper's native Window browser fixture
both exercise failed disposal followed by a later explicitly requested genuine close.
The production chart never automatically retries the close command.

For this correction, production library types pass with zero errors/warnings and
the package builds with strict publint. Changed-source formatting/lint, workspace
guidance/link consistency and diff whitespace checks also pass. These static
checks do not qualify the native failure/deadline behavior.

Approved correction qualification passes on the `bde9b78d` checkpoint plus this
review change, including main `d279e7ef`:

- All 1,170 Local First unit tests in 56 files, including 87 focused
  broker/close/channel cases and the expanded generated contract above.
- The full public-consumer suite, including three actual-tarball close/root-broker/
  owned-broker consumers with strict declarations, native MessagePorts and
  self-contained module-worker builds.
- All 2,006 Finance unit tests in 145 files and 12 production-built native
  binding cases across Chromium, Firefox and WebKit, including cold IDB reuse.
- All 872 Clipper unit/native tests in 134 files and 30 component cases in six
  files; all 32 worker/browser, 12 packaged-extension and eight production offline
  cases against two fresh builds. The updated Window fixture verifies correlated
  disposal failure before genuine closure and prevents writes after that receipt.
- Full library/test/consumer and affected app/service-worker/extension types,
  library packaging/publint, formatting/lint, workspace guidance/peer links,
  whitespace checks and all 13 workspace tooling tests.

Logs are retained as `/private/tmp/finance-worker-pr35-close-failure-*.log`.
The prior uploaded checkpoint's hosted Foundation, Finance and Clipper workflows
all passed at `bde9b78d`; the correction requires fresh checks on its uploaded head.

The first expanded model run exposed an error in the new oracle, not a production
change: advancing virtual time from 1 to 7 delivers a request timeout at its
actual deadline 5, so its ten-unit close deadline is 15, not 17. The shrunk sequence
was one query admission followed by elapsed steps `1, 6, 7, 1`. The independent
oracle now uses that absolute request deadline; observation arrays are copied to
keep replay observations immutable. The failure replay is retained locally under
`.xstate-test/worker-channel-lifecycle/a2d5a26e92c0.json` (seed `20261113`, path
`25:3:3:9:7:9:8:8:12:15`). Production code was unchanged after review.

Initial full-suite attempts inside the sandbox could not bind their disposable
Jazz/HTTP listeners. Those startup failures are retained in the logs; native
qualification runs use the permitted isolated listeners and browser profiles.

## Earlier R1 qualification

The user reviewed the earlier R1 extraction and authorized its tests by asking to continue.
Existing Clipper coverage identifies
the acceptance boundary: rejected envelopes/resources, native close failure,
foreign scopes, late receipts and listener disposal. Qualification must also
cover the public packed export, repeated valid close, actual native MessagePorts
and Clipper's broker consumer. Static/package checks alone are not that evidence.

Static review completed against foundation PR #29 (`c79d4ea9`, based on main
`02f886be`) on branch `feat/finance-worker-integration`:

- `pnpm build:libraries` and final `pnpm dlf:package` pass strict publint.
- `pnpm --filter delightful-local-first check:library` passes with zero errors
  and warnings; `pnpm clipper:check` passes coordinator, web, service-worker and
  extension types with zero errors and warnings.
- Changed-source Oxfmt/Oxlint, workspace-link/guidance checks and `git diff --check`
  pass. The final declaration exposes no Zod schema types.

Logs remain in `/private/tmp/finance-worker-w05-*.log`, including the initial
schema-version type failure and final corrected checks.

Approved R1 qualification passed before the subsequent R2 extraction:

- All 1,120 library tests in 54 files, including the seven close tests moved from
  Clipper, two new duplicate/failed-post cases and the existing channel coverage.
- All 88 Clipper worker-runtime unit tests in 14 files; the 32 real Clipper
  worker/browser cases pass through its shared close adapter on a disposable
  server at `127.0.0.1:5480`.
- A consumer extracted from the actual package tarball passes strict public
  types, real native MessagePort late-receipt handling and a self-contained Vite
  browser build. The reproducible packed check runs in `check:consumer` and CI.
- Full library/test and public-consumer types, library format/lint and workspace
  consistency checks pass. No app storage binding changed.

R2 shares these private wire schemas with its broker transport in an internal
module. After its separate concrete review/continuation, full library and real
worker/extension qualification passed again. See the
[broker extraction contract and evidence](jazz-worker-broker.md).
