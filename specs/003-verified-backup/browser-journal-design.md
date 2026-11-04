# Browser restore journal — reviewed scope

Branch `feat/backup-restore-journal`, based on PR #21 merge `04f3203`.

The user approved same-browser recovery and keeping IndexedDB for operation IDs, destination
mappings and progress. Jazz owns the restored application data. Resuming requires selecting the
backup file again; the journal does not retain the backup contents or password. Recovery on another
browser/device is outside this slice. No destination writes or restore coordinator are implemented.

## Ownership and transaction flow

```text
application binding/access owner
  finite browser journal actor
    private single-use request: binding, immutable metadata, DB, transaction, borrowed result
    native callback child: READ / WRITE / COMMIT / ABORT and native terminal events

claim -> open namespace -> acquire strict readwrite transaction
  initialize -> validate store -> commit
  read -> validate complete intent and revision -> decide
    absent + create -> add
    matching load/create or exact update already stored -> observe
    valid update -> put
    missing/conflicting/malformed -> abort
  stage -> commit -> native completion/abort -> drain -> close -> output
```

The native read, decision and write stay in one transaction, without an asynchronous gap after the
read callback. IndexedDB serializes readwrite transactions on the store; revision comparison and
successor checks prevent stale updates. There is no additional Web Lock: a lock held only for a
journal request would add no protection to the later Jazz writes.

`initialize` explicitly provisions version 1 of a host-selected database with one out-of-line-key
`restoreOperations` store. Load/create/update abort an unexpected upgrade rather than silently
recreate a missing database. The operation key encodes application/environment/identity/operation
as a JSON tuple. Expected intent also binds the destination, archive, profile, digests and complete
mapping/plan. Malformed or incompatible rows are preserved. There is no reset/delete API.

Each update expects revision N and supplies N+1. The successor guard retains completed receipts
and issued-write evidence, including known transaction IDs and settlement observations. The exact
candidate already present returns `existing`, allowing reconciliation after a lost response without
another write. Metadata cannot supply destination authority or prove a missing destination write.

Input and decoded records are validated, normalized and frozen. Internal checks reuse those records
rather than repeatedly parsing the full mapping table. The codec validates unknown input and bounds
wire size; encoding serializes once. Native resources and metadata stay out of machine snapshots.
The borrowed output view remains readable until request `release()`; its JSON form is a descriptor.

## Settlement and cancellation

The adapter requests/checks IndexedDB's `strict` durability hint. A request success only means staged;
`committed` requires the native transaction's complete event. The hint does not promise retention
after browser-data deletion or universal power-loss safety. Journal persistence is separate from
Jazz local persistence and remote acceptance.

CANCEL/SHUTDOWN/scoped INVALIDATE revoke admission, request abort and await native settlement before
closing. Cancellation after commit starts cannot undo the commit; output retains the actual journal
settlement. A duplicate claim cannot release the original owner's resources. Native completion
handlers outlive the callback subscription. Abrupt release aborts where possible and closes late
acquired connections once outstanding native work settles. Graceful shutdown should finish before
actor stop. No independent cleanup-retry API or alternate storage abstraction is needed here.

## Complete review and focused qualification

Review covered the schema/codec, successor rules, native resource owner, entire actor tree, public
exports, consumer fixtures and handoff documentation. Removed redundant Web Locks, the unused
alternative lease/storage interfaces and a speculative cleanup-retry API. Kept atomic revision checks,
issued-write evidence, native settlement and ordinary same-browser recovery.

Before the attempt/completion extension, focused qualification passed:

- 89 journal unit tests: existing 87 codec checks plus ordinary successor progression and rejection
  of stale revisions, changed intent and erased evidence.
- Five Chromium tests through the built public package: codec, create/update/exact replay/stale CAS
  and page reload, cancellation during staging and committing, missing namespace/key and malformed
  row preservation. Disposable database deletion also checks that connections are closed.
- Package/strict Publint, public consumer declarations, Svelte/strict TypeScript, lint and formatting.

These checks establish page-reload recovery in Chromium, not a browser-process crash or a completed
Jazz restore. No live database is used. T006/T012 remain open for restore integration and qualification.

The subsequent [attempt/completion change](restore-journal-design.md#focused-attemptcompletion-change--implementation-review-2026-11-03)
is implemented and locally qualified after review approval. The existing browser transaction owner applies its updated
successor guard; its state/resource ownership is unchanged. The extension permits a new attempt
only after a known server rejection, retains the most recent rejected attempt, and distinguishes
remote-content completion from transaction acceptance. Above runtime results do not qualify the new
representation; subsequent qualification adds 16 unit cases and one native Chromium case, bringing
current totals to 833 unit tests and 51 Chromium tests. The new native case qualifies rejected retry,
blocked uncertain retry, remote-content completion and exact metadata retention after reload. See
the linked design for evidence and limits. No production fix was needed during qualification.
