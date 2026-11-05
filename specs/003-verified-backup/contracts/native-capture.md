# Native Jazz export replacement

The 2026-11-05 native experiment supersedes the writer-admission and graph-comparison design.
The user requested a fresh implementation. PR #28's implementation is archived outside the
repository and removed from this working tree before starting the replacement.

The portable archive codec, profile validation, encryption and independent reader remain useful.
The new native export must not call the old source/lease or admission workflows.

## Cleanup scope (2026-11-05)

Remove the merged source/lease protocol and its capture, export and retry-cleanup machines, rather
than keeping them beside native export. The native machine becomes the sole export workflow at
`backup/export/workflow`. Shared binding validation/equality moves to `backup/binding`; restore
coordination continues using those pure contracts without depending on an export implementation.
Native export owns its handoff types and payload validation.

Delete the synthetic test app's in-memory lease simulator. Restore test inputs are known, prebuilt
payloads: prepare them through the existing envelope request/machine directly, with test-owned file
I/O. They are archive generation fixtures, not evidence of native source capture. Keep their profile
validation and independent retained-file restore checks. Actual source capture, conflicts, pending
writes and source preservation are qualified by real-Jazz tests and persistent browser downloads.
No new application workflow is needed for pure fixture construction. The native export chart and
its resource ownership remain unchanged. Remove obsolete protocol tests, and retain equivalent
applicable coverage on the sole native owner. No compatibility aliases or alternate export modes.

## Ownership and statechart before implementation

Review fixes: during protection, CANCEL/SHUTDOWN/invalidation keep the encryption child invoked,
revoke private inputs and forward its existing cancellation command. The parent enters cleanup
only after that child finishes draining native crypto. Abrupt actor stop still detaches native
crypto, whose issued call retains and clears its own copies; it is not a graceful acknowledgement.

Payload preparation uses the codec's existing normalization and bounded deterministic serializer
once, returning their paired immutable payload and encoded bytes internally. The envelope retains
both from preparation; sealing starts at attachment verification instead of parsing its own bytes.
Native capture performs its domain/binding checks against that same prepared payload before commit,
then invokes protection only after the native verdict. Opening an external file still parses and
validates it independently. No alternate export path or trusted caller-supplied validation flag is
added. Cancellation or rejection releases the prepared envelope and its private data.

One finite export owner invokes one consumer reader twice. Hydration queries the live Db at the
remote tier. Capture queries one native exclusive transaction. The reader receives only read
capabilities, binding, limits and an AbortSignal; it never receives a writable Db/transaction.
It keeps domain data privately and deposits a payload only during capture.

`hydrate -> open exclusive -> read -> validate -> commit with zero application mutations ->
await native verdict -> prepare protection -> protect -> hand off -> clean -> complete`.

The reader owns schema-specific queries, bounded byte reads, owner authorization and domain
validation. DLF owns transaction acquisition/rollback, native query receipts, exclusive acceptance,
private payload/password custody, protection and file handoff. Both hydration and capture must
read the complete declared scope; a cold snapshot alone can omit existing data.

On conflict, access loss, invalid data or unavailable reads: discard this capture and clean up.
No automatic retries. A new attempt starts with remote hydration and a new native transaction.
On CANCEL/SHUTDOWN/invalidation: abort the reader, discard payload/password immediately, drain
issued native calls, roll back an uncommitted transaction, then complete. A committed read-only
transaction is observed through its native receipt; it is never rolled back or replayed.
An abrupt stop or child crash gives cleanup to the request's native resource custodian, without
waiting for an acknowledgement from that child. The normal shutdown path awaits cleanup.

Binding validity is rechecked before native commit and before file dispatch. Native failures are
classified once; only a positive exclusive verdict may reach file protection. A browser dispatch
acknowledgement means download started, never that the file was retained by the user.

## Verification

Reuse the independent native experiment as evidence, then test the actual new export owner with
real Jazz: complete scope/bytes, source and audit preservation, conflict/cold/permission failure,
pending writes, cancellation at native query/acquisition/confirmation/protection, abrupt stop,
reader crash, scope replacement, private snapshots and protected/unprotected independent reopening.
Use disposable Node clients and Chromium persistent SharedWorker storage. Keep Finance within
about five or six integration files; no mutation-path changes or global writer registry.

## Implementation and evidence

The replacement keeps one native resource boundary, its public API and the sole export machine.
Public consumers use `backend/jazz/backup` and `backup/export/workflow`; restore/export binding
contracts are at `backup/binding`. The former generic export runtime and source simulator are deleted.
`prepareJazzArchiveExport` takes the native database, exact attachment binding, profile validator,
protection, file handoff and a pure binding-validity observation. The machine invokes the same
domain reader in `hydrate` and `capture` modes. Its read capability fixes the native scope and
remote tier; its digest capability retains issued native work until settlement. The consumer
retains responsibility for complete schema-specific coverage, byte bounds and owner checks.

The archive declares `jazz-exclusive-transaction` consistency. The native owner enforces that
declaration and the positive verdict before protection. The old quiescent declaration remains
readable for existing archives. Neither declaration is an authority signature over the file.

Cleanup qualification on 2026-11-05 with pinned Jazz `2.0.0-alpha.59`:

- Formatting/lint, strict Svelte/TypeScript, **922 unit cases**, package/publint, built-package
  consumers, independent-reader checks, 12 retained-file/profile cases and Storybook build pass.
- Twenty-three native export-owner cases cover protection, exact bytes/source preservation, conflicts and
  fresh attempts, interruptions, stale binding, late reads, offline confirmation, reader/owner crashes,
  abrupt stop, single use, invalid profiles, identity/permission changes and handoff custody/outcomes.
- Review regressions hold key derivation pending during CANCEL/SHUTDOWN/invalidation and require
  protection to finish draining before the root completes. Both protection modes prepare once with
  no payload reparsing; independent reopening still parses. Additional envelope checks cover caller
  mutation after preparation, exact escaped-JSON byte limits and immediate clearing on release.
- `pnpm check:native-backup`: 18 independent SDK probes plus two real persistent-Chromium downloads
  through the built public package pass; both files reopen in Node with exact bytes and unchanged source.
- `pnpm check:backup-restore`: **69 functional cases pass**; seven opt-in performance cases are skipped.
- Fifteen built-package browser journal cases pass after moving the binding contract and removing
  the synthetic export browser fixture. The native download checks replace its capture claims.

The old generic capture/export/cleanup runtime and in-memory source simulator are deleted. Existing
restore actors change only their binding import; their workflow and destination policies are retained.
The optional synthetic performance harness now reports sealing/open/restore timing, not native capture
latency. No Finance-size or new performance measurements were run for this cleanup.

Finance's reader, settings interaction, actual graph-size performance and other browser engines
remain unqualified. This shared replacement does not complete T008 or T004.
