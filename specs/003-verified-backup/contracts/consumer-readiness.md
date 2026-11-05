# Consumer readiness before Finance adoption

The user approved preparing DLF first on 2026-11-05 after review of the oversized Finance
prototype. Finance should need about five or six integration files. Preserve its approved copy;
archive the prototype and restore unrelated workflows before replacing the integration.

The shared prerequisites are:

1. Mutation admission belongs to actual finite operations, with explicit admitted/denied results.
   Creating or restoring an idle page actor must not reserve a writer. Preserve ordinary offline
   writes, and keep unresolved native receipts distinct from a completed workflow.
2. Capture has one resource owner. Reserve admission -> drain current operations -> recheck owner
   -> invoke the consumer graph reader -> validate/compare -> release. Cancellation can reopen
   admission while issued read-only calls drain, but must discard their late results. A child
   error or authority change must never require the failed child to acknowledge its own cleanup.
3. Use a clean source-built package. Qualify Finance's current public API against that package;
   do not splice compiled modules from different revisions into a consumer tarball.

DLF owns reusable admission, source/export lifecycle integration, privacy-safe capture custody,
file handoff, and cleanup. Finance owns schema-specific queries, explicit field/domain validation,
attachment representation, and its settings presentation. Avoid generic ActorLogic interception,
implicit database extraction from arbitrary scopes, and duplicate export-owner protocols.

Start with the public resource contracts and statechart, then verify initial-final actors, busy
admission, cancellation, unexpected child errors, authority replacement at read completion, and
ordinary writes after failed capture. Use a real consumer compatibility check before returning to
Finance integration. Existing archive/encryption/inspection APIs and tests remain the baseline.

## Shared statechart and ownership

`createMutationAdmission()` owns one native session's admitted operation tokens and retained
native receipts. Its chart is `open -> capturing -> open`, with a retired admission state
`closed`. Existing writers may retain their already-issued receipts while capture waits. An
unresolved writer/receipt is evidence that capture cannot proceed; it does not disable ordinary
offline editing. Call `write()` at an actual finite operation boundary and explicitly handle its
admitted/denied result. Call `retain(receipt)` before releasing the operation. Completing a local
save does not imply that its native remote receipt has settled.

The export's capture chart now owns:

`authority -> acquire admission -> drain -> authority -> invoked domain reader -> validate ->
consistency -> authority -> release`.

`createAdmittedArchiveSource()` binds the reservation directly to the export's AbortSignal.
Cancellation reopens admission immediately; late read-only I/O still drains. The optional reader
passed to `createArchiveExportMachine({ reader })` is a finite machine with typed read/cancelled/
failed output. It receives binding/limits/signal, `issue(nativeLeaf)` and `accept(payload)`.
Every native read must use `issue`; it transfers the lease into the existing native-call custodian
until the real promise settles. A reader crash therefore cannot lose that promise or require an
acknowledgement from the failed reader. `accept` discards cancelled results. Keep domain graph
and byte data in private custody, rather than actor snapshots. Batch concurrent native queries
as one issued leaf; do not hide query/check/query orchestration inside that leaf.

Consumers with a single native graph-read leaf can retain the original source/lease API. An
admitted source may instead supply its single `read` leaf without creating a domain machine.
No dummy `read`, drain acknowledgement, child reply bridge or ActorLogic lifecycle interception
is required for a multi-stage reader.

The admission owner outlives page attachments and workspace generations sharing the same native
session. Do not replace it to clear unresolved evidence or retire it merely because a dialog
unmounts. Retirement blocks new admissions; it does not claim that existing native writes stopped.

These contracts do not discover SDK writes automatically. All writer paths must participate
before a consumer can claim its source is quiescent. Finance's normal forms, background workers,
transaction and attachment operations still need explicit admission/receipt wiring; their old
prototype wrappers were removed. Jazz's public Db surface has no general pending-write flush
used by this implementation. A matching local/remote graph alone cannot replace native receipts.

## Compatibility qualification

Build the complete package from source with `pnpm package`; never assemble compiled modules
from old and current revisions. The original generic QuerySubscription/QuerySubscriptionOne
constructor surface delegates to the same native instances as the current factory functions,
preserving local-first defaults without application-owned classes.

The isolated Finance declaration check against the clean current build has **14 errors in 11
existing files** after resolving Jazz/XState declarations to Finance's own peer dependencies.
These are real pre-existing package migration requirements: explicit form settlement, generic
initialization identity/workspace selectors, durable creation attempt/issuance/binding ownership,
detached transaction custody, and profile dependency binding. One affected form test also reads
an old private child shape. This is not a compatible drop-in package upgrade yet. Resolve that
prerequisite without weakening the newer durability/binding requirements before adding Finance's
backup integration. Finance's original locked dependency was restored after prototype removal.

Verification records belong below after checks complete; consumer/platform T004 and the Finance
integration T008 remain open. No production data or identity was read, changed or cleared here.

## Verification on 2026-11-05

- The complete `pnpm verify` sequence passed before opening the PR: formatting, lint,
  Svelte/TypeScript, all 969 unit tests, package/publint, consumer checks and Storybook build.
  Jazz integration suites required local-listener access outside the restricted sandbox.
- 78 focused unit tests passed across admission, export and native subscription compatibility.
  This includes both post-acquisition authority observations interrupted by abrupt owner stop,
  initial-final and explicitly failing readers, pending native reads after child crashes,
  immediate cancellation release, stale lease release, unresolved writers and receipt drain.
- TypeScript passed for the library and the strict built-package consumer. The consumer supplies
  an actual typed reader machine through the built public declarations.
- `pnpm package` passed, including strict publint. `pnpm check:consumer` passed its Node runtime,
  browser bundling, independent reader and test-app checks. The test app's 18 export/source tests
  remain green. A separate standalone package-consumer runtime exercises the admitted single-read
  source through public exports.
- The final `pnpm pack` archive was extracted into a separate temporary consumer with only its
  required XState/Zod peers. Its standalone admitted-source export completed through the packed
  public entrypoints. No legacy compiled modules were copied into the archive.
- Oxlint and formatting checks cover the changed implementation. These results qualify the shared
  library contract, not Finance's as-yet-unimplemented replacement integration or production data.
