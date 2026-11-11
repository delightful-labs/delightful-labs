# Attachment scalar investigation

> Historical slice/research record. The complete test app workflow, fresh comparison and activation
> are now implemented in PR #26. Use [the current task ledger](tasks.md#current-handoff) and
> [completion evidence](restore-completion-design.md) for present status; bounded single-step
> descriptions and dated test totals below describe their original scope.

Requested after preparation commit `bba5f49`, before attachment-writer implementation.
The user explicitly authorized isolated tests and inspection of the actual pinned SDK code.
This is research, not implementation qualification or permission to skip implementation review.

## Questions and probe ownership

Inspect alpha.59's schema types, transaction insertion/commit, byte materialization and native
streaming paths. Probe complete scalar bytes (including empty values), transaction input custody,
bounded relation reads, policy checks at commit, rollback, and same-browser recovery with no replay.
Use synthetic records and a fresh disposable Jazz authority only.

The temporary harness under `.svelte-kit/attachment-research/` owns its Vite host, disposable Jazz
authority and Chromium persistent profile. The test driver sequences individual SDK leaves:
create control -> acquire/read transaction -> stage scalar bytes plus metadata -> commit -> observe
local/global separately -> fresh read/compare -> reload/read or graceful restart/read -> cleanup.
Policy-denial probes classify only the actual SDK rejection type. Source inspection and the test
driver do not add an application workflow or restore machine. Every acquired server/browser/profile
is disposed by test teardown, including failures. Expected outcomes are exact bytes, explicit
permission rejection, or an unsupported/failed probe retained as a limitation; never assumed success.

The evidence file records only synthetic sizes/digests and safe outcome summaries. No source user
data, credentials, decrypted backup or production environment is involved. Temporary harness files
are generated/ignored artifacts and may be cleared by later builds; durable findings follow below.

## Actual source findings

Inspected the installed `jazz-tools@2.0.0-alpha.59`, not a newer SDK or an assumed API:

- `dist/dsl.d.ts:94,229` and `dist/schema.d.ts:38` describe `schema.bytes()` as a BYTEA
  column with `Uint8Array` values. `dist/typed-app.d.ts:420` defaults selection to all base columns,
  including that byte column.
- `dist/runtime/db.js:791–798` transforms and stages `Transaction.insert` through the original
  bound transaction. Its `readAll` at 872–900 carries the same open transaction ID and deferred
  local delivery; `one` applies a one-row limit. These APIs do not establish universal snapshot
  isolation or conclusive absence under read policies.
- `dist/runtime/native-runtime/native-runtime-adapter.js:748–778` encodes the cells and calls native
  `insertInTransaction` immediately. `dist/worker/jazz-broker-worker.js:1421–1429` copies that encoded
  buffer into WASM. The original JS value alone is not the native storage representation.
- `native-runtime-adapter.js:789–795` explicitly rejects streaming mutations inside a transaction.
  Streaming would require a different ownership/atomicity design; it is unnecessary for this slice.
- `native-runtime-adapter.js:4834–4837` copies the decoded BYTEA payload with `slice()`;
  `dist/runtime/row-transformer.js:181–182` returns it as a byte array.
- `dist/runtime/client.d.ts:131–146` distinguishes local durable storage, global authorized
  acceptance and remote reads without pending local writes. Probes below exercise these differences.

The source was used to select public APIs. No SDK internals were patched or used as application APIs.

## Probe results — 14 passed

Command:

```sh
pnpm exec tsc --noEmit --project .svelte-kit/attachment-research/tsconfig.json
pnpm exec vitest run --config .svelte-kit/attachment-research/vitest.config.ts
```

Both passed. The final run passed all 14 cases in about seven seconds. The host used localhost:6201;
its temporary Jazz authority, Vite server, Chromium process and persistent profile were shut down or
removed by teardown. Raw synthetic evidence remains in
`.svelte-kit/attachment-research/evidence.json`, alongside the probe test, schema and browser host.
The policy fixture deliberately permits its owner to activate the control row solely to test a
read/stage/commit race; this is not a change to the test app's production-candidate policies.

| Question                                                           | Actual observation                                                                                                                                                                                                                                                                                                                                            | Consequence                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do scalar inserts/readbacks carry all bytes?                       | Empty, four nontext bytes `00 ff 80 0a`, 128 KiB, 1 MiB and 8 MiB all came back as complete `Uint8Array` values. Every byte matched the source, and Web Crypto results matched independently computed Node SHA-256 digests. Exact filename text, combining Unicode, emoji, embedded NUL, media type and lengths survived.                                     | Use an ordinary BYTEA scalar in one transaction with its metadata. No external file service, chunk protocol or second write is needed for the observed cases.                                                           |
| Can caller-buffer mutation change a staged write?                  | Zeroing the four-byte input immediately after staging, and separately after commit issuance, did not change the accepted remote contents.                                                                                                                                                                                                                     | The tested path copies staged input into native storage. Still retain owned input/native custody through the normal drain protocol; this small probe does not authorize early resource teardown generally.              |
| Can control and the mapped file be read together?                  | A filtered reverse include returned the parent with zero visible children before insertion; after insertion, one remote query and one transaction query each returned the parent and the complete four-byte child.                                                                                                                                            | Prefer one bounded parent-plus-selected-attachment graph read per eligibility/reconciliation stage. Keep missing parent, no visible child and conflicting child distinct. An empty child list is not replay permission. |
| Does rollback publish bytes or metadata?                           | Native rollback after staging returned true; a fresh remote read returned no attachment.                                                                                                                                                                                                                                                                      | Roll back the single owned transaction before commit. Do not treat a stopped actor as that rollback acknowledgement.                                                                                                    |
| Does the server recheck isolation after staging?                   | The owner staged an attachment while the control row was incomplete, then separately changed the row to active before committing the attachment transaction. The attachment locally persisted, but global wait returned `PersistedWriteRejectedError`, `permission_denied`, correlated to its actual transaction ID. A fresh remote read found no attachment. | The tested policy protects commit acceptance against that race. Preserve local persistence and remote rejection separately; admission/read success is not acceptance.                                                   |
| Can a stored digest conceal different bytes?                       | The server accepted four zero bytes paired with the digest of `00 ff 80 0a`. A fresh read retained that declared digest but returned different bytes and a different independently computed digest.                                                                                                                                                           | Compare actual byte contents and exact metadata. A declared digest is untrusted metadata, not a content-match receipt.                                                                                                  |
| Does mutating an earlier read contaminate fresh reads?             | Zeroing a returned four-byte `Uint8Array` did not change the next remote result.                                                                                                                                                                                                                                                                              | Read afresh for reconciliation and keep observed buffers privately owned. Do not compare through a stale shared view.                                                                                                   |
| Can data be read after reload without replay?                      | A fresh page read exact 128 KiB contents with no surviving JS write handle and zero replacement commits.                                                                                                                                                                                                                                                      | Actual remote bytes can support content reconciliation; this does not recover the original transaction's acceptance receipt.                                                                                            |
| Is the accepted scalar locally retained across a graceful restart? | After a complete Chromium close and same-profile reopen, with the Jazz authority stopped, a local read returned the same exact 1 MiB bytes and metadata. Zero replacement commits were issued.                                                                                                                                                                | This supports local retention for this accepted scalar and graceful restart configuration. It does not qualify offline restore, pending-write recovery, forced termination or power-loss safety.                        |

Each scalar success separately awaited native local persistence and native global acceptance. Exact
comparison inspected all returned bytes, not only row counts or the stored digest field. Synthetic
raw data and identifiers were kept out of diagnostic summaries.

## Recommendation for the next implementation

Keep the proposed one-attachment-step slice. Store native bytes and metadata in the same row and
transaction, under the already fixed mapping/write ID. Reuse the journaled write-step owner and
preserve the completed prefix. Do not add streaming or a new attachment storage abstraction.

Simplify reads to a bounded control-row query including only the mapped attachment. That concrete
query works in both remote and transaction contexts. The machine can guard on a validated
`parent + zero/one attachment` observation, avoiding a procedural helper that performs two reads.
If the implementation elects to use separate reads, keep both explicit in the same transaction owner.

Use named pure predicates for control/operation/owner binding, incomplete status, exact metadata and
byte-for-byte equality. Because the checked archive already binds the expected bytes and planned
digest, exact equality need not reserialize large base64 strings merely to compare them. Workflow
routing, issuance, write/rollback, separate settlement and checkpointing remain machine states.

A null result, empty visible child set, unavailable read or missing separately required local
observation still cannot resolve an issued uncertain attempt. The tests add no retry permission.
Final full-graph/relationship/byte comparison before activation remains a separate unimplemented
requirement.

## Qualification limits

These are isolated SDK/policy investigations. They do not qualify an attachment restore coordinator,
journal prefix advancement, full test app round-trip or Finance adoption. The actual implementation
must be reviewed and tested through the built package and concrete test app entry point later.

The largest scalar round-trip was 8 MiB; the joined-read case used four bytes and the stopped-authority
restart case used 1 MiB. No peak-memory or responsiveness measurements were taken. Existing T004
performance work remains open. The persistent profile was gracefully closed; no forced crash,
power loss, pending-write offline restart or platform matrix was tested. The test server/schema and
all records were disposable. No production code, configuration, dependencies, commit or publication
changed during this investigation.
