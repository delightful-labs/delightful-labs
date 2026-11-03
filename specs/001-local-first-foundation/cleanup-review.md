# Foundation cleanup review

This PR addresses AR-01–AR-05 and the currently actionable Zod follow-ups T011/T013.
T012 and ZOD-S01/S02 remain with restore/sign-in implementation. No consumer deployment,
storage migration, new journal, new backend or broad validation rewrite is included.

## Evidence and workflow design

- AR-01: creation-owner handles closing/replacing before storing or classifying child output.
  Child errors also skip unresolved classification. Capture results first; unresolved settlement
  takes precedence over closing/replacement. Retain the original operation binding and record.
  An unresolved owner ignores replacement/restart commands; retry requires its original binding.
  A closing owner only finishes after a known outcome. Its final output includes binding/result.
- AR-02: Finance's current reconciliation uses `ReadTier.LocalFirst`; `absent` has no issuance
  evidence. Fresh creation may transact after absent because this invocation has not issued a
  write. Recovery/retry starts with unknown prior issuance. Absence cannot authorize another
  transaction; an explicit host `notStarted` reconciliation result may. Matching must mean the
  host has verified exact content and local durability. Reuse existing journal and stable IDs.
- AR-03: the journal adapter sends TX_ABORTED when abort throws, although only native onabort
  proves abort. Report abort failure and retain the callback actor until native completion/abort;
  do not retry a failed abort recursively. Drain errors take precedence over cancellation.
  IndexedDB close is not transaction rollback. No timer invents transaction settlement.
- AR-04: shared creation inspects Finance attempt fields and initialization consumes Finance
  record names. Keep only generic journal keys/opaque attempts and binding keys. Hosts supply
  binding-match and attempt-ID projections. Normalize initialization observations to identities
  and workspaces; hosts project prepared-attempt identity/workspace IDs. No persisted format is
  rewritten. These are source-breaking API corrections; Finance's pinned package is unchanged.
- AR-05: single-write policy hardcodes locallyPersisted. Require the host to explicitly supply
  its write settlement guarantee, including profile saving. Existing resource-owning persistence
  actors retain their own results. The existing Jazz persistLocal adapter waits on receipt.wait
  with tier local; a mutation's return is not that guarantee. No extra persistence owner is added.

Meaningful resources remain owned by existing XState actors: creation owner -> operation ->
journal/persistence -> transaction. Closing/replacement drains the same invoked child. Pure
projections, schema validation and issue mapping introduce no asynchronous workflow.

## Review and validation

Implementations are presented for review before new regression tests, per AGENTS.md. Existing
consumer fixtures and declarations will be adapted for the changed public contracts. Static
checks and package builds are appropriate before that review; no new behavior is claimed qualified
until its regression cases are approved and run. PR CI runs the repository's existing suite.

## Source evidence

- Pinned `jazz-tools@2.0.0-alpha.59`, `dist/runtime/client.d.ts` (`WriteHandle.wait`) and
  `dist/runtime/client.js` (`WriteHandle.wait` -> `waitForTransaction`), inspected from the installed
  package. DLF's existing `backend/jazz/data.svelte.ts` already supplies `persistLocal`.
- Finance's current `workspace-creation-reconciliation.ts` queries with `ReadTier.LocalFirst`.
  A returned `absent` result therefore carries no conclusive prior-write evidence.
- [IndexedDB abort steps](https://w3c.github.io/IndexedDB/#dom-idbtransaction-abort) throw
  InvalidStateError during committing/finished; they do not imply abort occurred. The journal keeps
  its native handlers until completion/abort rather than fabricating a cancellation event.

## Compatibility and consumer migration

This is a source-breaking correction of extracted APIs, not a persisted-data migration. Existing
journal database/version/store/keyPath and host record schemas remain unchanged. Do not clear old
records or relabel them notStarted: prior issuance stays unknown unless there is actual evidence.
Finance remains pinned to its existing package until a separate adoption change.

- `CreationBinding` requires only `key`. Hosts may extend it and pass that Binding as the final
  generic argument to creation operation/owner. The key must include every identity, profile and
  backend dimension that invalidates an operation; host binding-match policy remains required.
- Creation operation requires `matchesBinding(record, binding)` and `attemptId(record)`.
  Finance can supply its existing user/profile comparisons and organization ID projection in its
  wrapper; DLF no longer reads those fields. Journal factory also accepts `attemptId(record)`.
  Clear requests now carry `attemptId` instead of `organizationId`.
- Retry requests carry `settlement: 'notStarted' | 'unresolved'`. The owner passes its known result;
  retrying a creation cancelled before issuance therefore remains available. After restart, a
  recovered record has unknown issuance until reconciliation supplies evidence. A bare missing row
  is not such evidence. Persistence input carries `issuance: 'new' | 'unknown'` from that decision.
  A host may return reconciliation `notStarted` only for the exact attempt with conclusive evidence;
  do not rename LocalFirst `absent` to this new outcome. `matching` requires exact content and local
  persistence verification. No remote wait is introduced for a genuinely fresh local creation.
- On unresolved settlement the owner retains `context.operation`, `context.record` and
  `context.result`. Supervisors observe that state as recovery required, rather than waiting for a
  clean shutdown acknowledgement. Replacement observations update the desired binding without
  dropping the original operation. RETRY reconciles the original record only under its binding.
  A child crash without a returned record can reload the existing journal by the original key.
- Initialization discovery projects host rows into `identities: [{ id, initialWorkspaceId }]`,
  `workspaces` and `serverConfigured`. `selectReady(attempt)` projects prepared IDs into
  `{ identityId, workspaceId }`. Ready outcomes use those generic names; unavailable reasons use
  `identityMissing` and `duplicateIdentities`. Finance's wrapper can translate these into its current
  public result names. The notebook compile-only consumer shows generic creation composition.
- `createSingleWriteFormOptions` requires `settlement: 'locallyPersisted' | 'confirmed'`.
  `createProfileFormOptions` requires `saveSettlement` for both save callbacks. This is a declared
  host guarantee, not an SDK receipt inferred from arbitrary promise completion. For Jazz local
  writes, host save leaves await the existing `persistLocal(receipt)` adapter before resolving.
  Resource-owning persistence actors continue to return their own actual settlement results.
- Optional `forms/zod` exports `zodFormIssues` for the existing injected `validationIssues` slot.
  It copies issue paths/codes only; consumer localization supplies messages. Other validators and
  existing schema injection remain supported. No message strings or input values are copied.

## Profile draft review (T013)

Retain the current checks. Name dirtiness compares a partially edited string after trim/empty-to-null
normalization; avatar dirtiness distinguishes a nonempty selected File from remove/unchanged.
These are simple comparisons, not submission validation. Reusing submission schemas would run
transformations/reject incomplete drafts at the wrong boundary; a second permissive schema would
add machinery without simplifying these checks. No Zod conversion or behavioral change is needed.

## Regression qualification after implementation approval

- Creation owner: unresolved completion and child crash during replacement/shutdown; retained
  binding/record; replacement observations cannot discard recovery; known notStarted retry.
- Operation/persistence: fresh absent can create; unknown absent cannot issue another transaction;
  exact matching and conclusive notStarted recovery; cancellation/read errors retain unknown fate.
- Native journal: abort during committing followed by actual completion; actual abort; close/open
  errors; no fabricated TX_ABORTED and no cancellation masking a failure. Use actual browser
  IndexedDB for native ordering rather than mocks that never produce a terminal event.
- Form policy/profile: declared guarantee passed through; host receipt resolution before local
  durability must not be used as a valid locallyPersisted save implementation.
- Zod adapter: field/array paths and codes, unknown errors, absence of values/messages; built public
  subpath and notebook type compatibility. Keep the current profile dirty checks unchanged.

No new regression tests were added or run before this implementation review. Existing initialization
examples/assertions were mechanically adapted to the renamed contract. Static Svelte/TypeScript,
Oxlint, formatting, package/strict Publint and public consumer declaration checks are run locally;
the PR's normal CI runs the pre-existing suite. Passing that suite does not replace these new cases.
