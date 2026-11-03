# Notebook backup consumer

This disposable nonfinancial consumer exercises the public backup contracts without Jazz, identity
credentials, UI or financial models. After implementation review, local tests qualify notebook
export and independent inspection of real retained files. Restore and its durable journal remain
unimplemented; no full export/restore round-trip or Finance readiness is claimed.

`profile.ts` is a trusted exact `dlf-notebook` v1 registration for the existing inspector. Its validator
must receive a generically validated payload; it does not hash attachments or grant permissions.
`dataset.ts` supplies a notebook and three notes: shared notebook/attachment relationships, archived
content, combining Unicode, line breaks, embedded NUL, an empty body and four binary attachment bytes.
The source codec preserves these contents exactly; a later round-trip must prove destination fidelity.

`source.ts` supplies the capture leaves. All fixture writers are synchronous, and an exclusive lease
blocks `replace()` while capture owns the source. `checkAuthority`, acquisition, drain, read and
consistency checks each perform one bounded leaf step. The shared invoked capture machine sequences
them and releases the lease before protection/handoff. This is an in-memory model; it provides no
persisted journal, cross-instance locking, remote confirmation or Jazz consistency guarantees.

`export.ts` creates an **unstarted** root actor, request and source. The application supplies a full
binding, protection choice and one file-handoff capability. Start the returned actor and observe its
tags/output through normal XState APIs. The handoff receives a borrowed copy-only file handle and the
original binding; it must check current authority immediately before its one dispatch effect and
respect the signal. It owns any byte copies it takes. Return `dispatched`, `rejected` or `unknown`;
dispatch means only that effect was observed, never that the user retained/validated a file.

On `handoffRetry`, send `RETRY_HANDOFF` with the exact original binding to retry only dispatch, using
the same completed bytes. Rejected attempts cannot erase an earlier unknown dispatch. A request is
single-use and cannot restart capture after completion or invalidation. A new export needs a new
operation ID and request. Metadata including identity/workspace/operation IDs is private recovery
context, never telemetry.

On access/session change, immediately send scoped `INVALIDATE` with the original binding and update
the source's observed binding. Increment generation for every binding replacement, including
A → B → A. For graceful teardown, send `CANCEL` or `SHUTDOWN` and await actor completion before
stopping. Cancellation drains already issued calls; native crypto and dispatched files cannot be
undone. Call request `release()` as abrupt-stop cleanup, then stop; stopping alone is insufficient.
If the result is `captureCleanupFailed`, retain the request and explicitly retry cleanup with
`retryCleanup()`, awaiting its bounded lease-release result. The abrupt `release()` fallback alone
does not provide a graceful drain acknowledgement.

Build and run the notebook/public-package verification:

```sh
pnpm package
pnpm check:backup-notebook
```

This compiles the fixture and its Node tests into ignored `.svelte-kit/backup-notebook/` output, then
runs 13 cases. Two export actual plaintext/password files, independently inspect them in separate
processes with common network APIs disabled and only PATH in the environment, compare exact records,
relationships, archived content and attachment bytes, and verify original source/file preservation.
The remaining cases check lease exclusion/binding/limits and exact profile allowlists. The trusted
notebook validator is registered by test code, never loaded from archive contents.

`pnpm check:consumer` includes these cases and builds the browser fixture. Three Chromium cases under
`tests/storybook/backup-export.spec.ts` verify real downloads (saved bytes equal produced bytes),
native envelope/profile opening and late-lease invalidation. They are included in the normal browser
suite. The normal package-consumer TypeScript check covers the notebook implementation through its
entrypoint; Node test types are checked by the notebook project. Root unit/source checks do not depend
on prebuilt package output.

See [qualification evidence](../../specs/003-verified-backup/lifecycle-design.md#export-qualification)
for full counts and limitations. Restore/write owners and a concrete versioned Zod journal (T012)
are the subsequent implementation slice.
