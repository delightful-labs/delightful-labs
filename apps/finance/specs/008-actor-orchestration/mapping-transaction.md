# Mapping transaction ownership

Scope: account write, its new transaction child, account creation, mapping, unlink,
and the operation's mapping state. Six production files; review before adding/running tests.

The existing commit promise is a workflow: open a transaction, read provider links,
decide whether creation is already satisfied, read destination/account, validate,
choose account/link writes, commit, and await persistence. It must become a machine.

Ownership:

```text
operation (holds bank lock)
└── mapping
    ├── account write
    │   └── transaction (owns one mergeable transaction)
    └── account creation
        └── account write
            └── transaction
```

The installed Jazz `Transaction` supports explicit `beginTransaction`, reads and staged
writes across awaits, `commit` returning a write handle, and asynchronous `rollback`.
`Db.transaction` uses the same mergeable transaction API; no transaction kind change
is intended. `rollback` cannot run while commit is pending. A write handle's local
wait can reject; that does not establish rollback. SDK sources inspected:
`runtime/db.js` (`Transaction`, `runInTransaction`, `Db.beginTransaction`) and
`runtime/client.js` (`WriteHandle.wait`).

Statechart before effects:

- Parallel control region: active → cancelling → closing, with shutdown taking
  precedence and no late event reopening work.
- Work region: open → read provider links → guarded duplicate/existing-creation
  checks → read destination/account → guarded conflict/account eligibility checks
  → choose/stage account creation → choose/stage link insert/update → commit → settle.
- Each acquisition/read/stage completion checks interruption before starting the next
  effect. Each promise performs one leaf operation. No promise chooses write policy.
- Existing creation needs no write; close that transaction through rollback and return
  unchanged. Policy/read/staging failures also roll back before returning.
- Cancellation before commit waits for the current leaf, then rolls back. Cancellation
  during commit or settlement waits for actual settlement. Failed settlement attempts
  rollback to release a transaction that the SDK may still retain after commit failure;
  failed/unconfirmed rollback remains unresolved.
- Finite outcomes: succeeded, unchanged, failed, cancelled, closed. Settlement facts:
  notStarted, rolledBack, locallyPersisted, unresolved. Terminal states publish once.
- Account write consumes child output, keeping existing `Result<undefined>` contracts
  for mapping callers. Cancellation maps to the existing disconnected result. The
  transaction output retains exact settlement for subsequent protocol improvements.
- Mapping and creation forward cancellation only to their live owned write workflow.
  Operation's mapping invocation survives working/cancelling/failing substates. A
  later lock failure cannot override cancellation; a lock failure must still wait for
  mapping cleanup. No acknowledgement is requested after child output/error.

Keep preflight authorization and existing eligibility checks; repeat transaction-time
checks on the same transaction snapshot before writes. Preserve atomic account/link
creation, deterministic IDs, existing-creation idempotency, original scope and current
mergeable transaction semantics. No new retry/provider request behavior.

Unlink has no open transaction; cancellation during its issued-delete wait enters a
draining substate and retains that invocation until output/error. It does not start
another delete after cancellation. The mapping owner retains that finite child,
rather than stopping it and claiming rollback. Import, disconnect, and outcome
persistence cancellation remain separate work.

## Implementation review

Implementation was reviewed and committed as `bf1f214` before tests were added/run.
The approved verification is complete; no production changes were needed during testing.

The recursive actor/helper review found no hidden read/check/write orchestration:
all new effect actors open, read, stage one chosen write, request commit, wait, or
request rollback. The destination/account query pair is one related snapshot read.
`resource`, `linkWrite` and `required` only transform/narrow inputs; the create-stage
input invariant repeats a guarded kind decision. Existing authorization and preflight
policy remain unchanged, and transaction-time policy repeats those checks on the
owned transaction before staging.

Callers inspect child liveness only when forwarding interruption. They do not inspect
private transaction state or wait for a second acknowledgement after output/error.
Operation owns the cancellation/failure intent and its lock lifetime; transaction owns
rollback/settlement. The agent server used for the prior review was stopped before
the static check; the user's persistent environment was untouched.

## Verification

62 relevant unit tests passed across transaction ownership, the real mapping actor
chain, operation and bank owner tests. The 39 new tests cover atomic creation and
account reuse, remapping, duplicate/provider/destination conflicts, missing/archived/
foreign accounts, currency checks, existing-creation idempotency, storage failures,
interruption at acquisition/read/staging/commit/settlement/rollback boundaries,
confirmed/unconfirmed rollback, original scope, authority rejection, cancellation/
lock-failure priority, a mapping actor crash before transaction acquisition, completed
child command forwarding, and unlink's issued-delete settlement.

The fixture composes the real operation→mapping→creation/write→transaction machines,
with real authorization decisions and controlled storage/platform leaves. This proves
that cancellation reaches the resource owner and lock release waits for its output;
it does not replace a live Jazz concurrency test. The completed-child test checks the
domain cancellation command specifically; XState can also emit an already-queued
completion notification after the deliberately injected actor crash.

Four Playwright checks passed against disposable in-memory Jazz: explicit connection/
provider-account creation/idempotent import, lock startup failure/recovery, cancelled
passkey creation with late completion, and mapping/remapping existing accounts with
reload persistence, no duplicates and no extra provider requests. Unlink currently
has no visible bank control; its cancellation/settlement contract is covered at the
actor boundary. No UI control or browser database-delay hook was introduced for tests.

`pnpm check`, `pnpm check:tests`, focused Prettier and `git diff --check` passed.

```sh
pnpm exec vitest run src/lib/machines/bank-sync/account-write-transaction.test.ts src/lib/machines/bank-sync/mapping.test.ts src/lib/machines/bank-sync/operation.test.ts src/lib/machines/bank-sync/index.test.ts
pnpm check
pnpm check:tests
pnpm dev:agent --host 127.0.0.1 --strictPort
# Wait for http://127.0.0.1:5180/ to return 200 before starting Playwright.
pnpm exec playwright test --config playwright.bank-sync.config.ts tests/bank-sync.e2e.ts --grep 'connects explicitly|maps and remaps|lock actor startup failure|cancelled passkey creation'
```

This is focused verification, not a full application/PWA rerun. Import, disconnect,
and outcome persistence settlement and correlated availability reports remain pending.
