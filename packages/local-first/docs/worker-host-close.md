# Independent worker host close transport

W05/R1 moves Clipper's existing native close-control adapter into the supported
`worker/host-close` export. The existing `worker/channel/workflow` remains the
only owner of admission, close identity, deadlines, late receipts and terminal
outcomes. This extraction adds no actor or second shutdown policy.

The host owns a dedicated control MessagePort, scoped by a UUID. A validated
version-1 `CLOSE_HOST` command selects one synchronous data-host disposal call.
Only successful return permits a matching `HOST_CLOSED` receipt. Native disposal
or posting failure produces no receipt; the channel retains its existing
overdue/blocked behavior. Callers must supply a disposer that can be called again
if duplicate valid close commands arrive, as in the original Clipper adapter.

The worker-side listener validates incoming receipts, closes rejected transferred
ports and ignores foreign scopes. A transport error reports `CLOSE_FAILED` while
retaining observation of a later genuine receipt. Its explicit disposer removes
listeners and closes the control port; disposing the listener is never evidence
that the data host closed. The channel chart correlates request IDs and chooses
when to release these native capabilities.

`serveHostClose`, `workerHostControl` and the wire version are public native
integration capabilities. `HostCloseIdentity` and `HostControlReport` reuse the
existing worker-channel contract types. No SDK, account selection, browser broker
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

The user reviewed this slice and authorized its tests by asking to continue.
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
