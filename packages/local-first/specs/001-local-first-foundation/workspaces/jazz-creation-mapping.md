# Jazz creation SDK mapping

Source evidence is pinned to installed Jazz 2.0.0-alpha.59, using its public runtime exports and
`dist/runtime/db.{d.ts,js}` and `client.{d.ts,js}`. The [qualification record](creation-qualification.md)
and fixture README identify the ten executed policy/browser cases. This mapping proposes no new
journal, production schema or replacement for DLF's existing creation workflows.

| Responsibility                      | Public SDK boundary                         | Evidence limit                                                                                |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Acquire a mergeable transaction     | `db.beginTransaction()`                     | Grouped local writes do not prove cross-device uniqueness.                                    |
| Acquire an exclusive transaction    | `db.beginExclusiveTransaction()`            | The fixture checks a configured isolated authority and a specific immutable collision policy. |
| Read and stage within a transaction | `one`, `all`, `insert` with stable IDs      | Missing rows on an incomplete replica do not prove non-commit.                                |
| Commit once                         | `transaction.commit()`                      | Retain the receipt; issuance precedes eventual transaction-ID availability.                   |
| Local durability                    | Mergeable receipt `wait({ tier: 'local' })` | Mutation return alone is not local persistence or remote acceptance.                          |
| Authority confirmation              | Exclusive receipt `wait()`                  | The implementation falls back to local confirmation without configured upstream authority.    |
| Rollback                            | `transaction.rollback(): Promise<boolean>`  | False, rejection or an unknown result cannot acknowledge successful cancellation.             |
| Later rejection                     | `onMutationError`                           | Live fallback events are not a demonstrated durable historical recovery log.                  |
| Restart observation                 | Read the same intended record IDs           | Complete matching records provide positive evidence; incomplete absence remains unknown.      |

No supported public historical transaction-fate lookup was established by this inspection. Exported
`TransactionFate`/`LocalTransactionRecord` types alone do not establish such an API. Do not use private
runtime methods or cast serialized IDs to manufacture a recovery guarantee.

The browser fixture verifies retained records through Jazz's own persistence. Whether additional
pre-write intent metadata is required must be evaluated against the actual application operation and
existing DLF capabilities; this source mapping does not justify a second persistence layer.
