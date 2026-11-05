# Native Jazz export replacement

The 2026-11-05 native experiment supersedes the writer-admission and graph-comparison design.
The user requested a fresh implementation. PR #28's implementation is archived outside the
repository and removed from this working tree before starting the replacement.

The portable archive codec, profile validation, encryption and independent reader remain useful.
The new native export must not call the old source/lease or admission workflows.

## Ownership and statechart before implementation

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

The replacement adds three runtime files: the native resource boundary, its public API and the
finite export machine. Public consumers use `backend/jazz/backup` and `backup/jazz/workflow`.
`prepareJazzArchiveExport` takes the native database, exact attachment binding, profile validator,
protection, file handoff and a pure binding-validity observation. The machine invokes the same
domain reader in `hydrate` and `capture` modes. Its read capability fixes the native scope and
remote tier; its digest capability retains issued native work until settlement. The consumer
retains responsibility for complete schema-specific coverage, byte bounds and owner checks.

The archive declares `jazz-exclusive-transaction` consistency. The native owner enforces that
declaration and the positive verdict before protection. The old quiescent declaration remains
readable for existing archives. Neither declaration is an authority signature over the file.

Verified on 2026-11-05 with the pinned Jazz `2.0.0-alpha.59`:

- `pnpm verify`: formatting/lint, strict Svelte/TypeScript, **962 unit tests**, package/publint,
  built-package consumers, independent-reader checks, test app exports and Storybook build pass.
- Fourteen new export-owner cases cover both protection choices, exact byte reopening and unchanged
  source, conflicts/fresh attempts, interruptions, stale binding, late reads, offline confirmation,
  reader/owner crashes, abrupt stop and handoff custody.
- Eighteen independent native probes establish the SDK behavior recorded in the experiment README.
- Two real persistent-Chromium downloads, protected and unprotected, reopen in Node with the expected
  profile and exact original bytes while preserving the source.
- `check:native-backup` type-checks and runs the native/browser matrix in CI after Chromium setup.

Finance's reader, settings interaction, actual graph-size performance and other browser engines
remain unqualified. This shared replacement does not complete T008 or T004.
