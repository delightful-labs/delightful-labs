# Transaction custody across teardown

Creation and invitation transaction machines still use CANCEL/SHUTDOWN to drain issued work before
returning a finite result. Prefer that protocol; stopping an actor supplies no settlement evidence.

## Capability migration

Both WorkspaceCreationTransactionCapability and InvitationAuthorityTransactions now require a
`retainDetached` callback. It must synchronously transfer the private receipt to a host owner whose
lifetime outlasts this workflow, without throwing. A no-op callback does not satisfy the contract.
Use the host's existing resource/recovery actor, for example:

```ts
retainDetached: (receipt) => owner.send({ type: 'TRANSACTION_DETACHED', scope, receipt })
```

Capture the exact operation/account/environment scope in the host binding. Sending to an already
stopped actor is not custody retention. This package does not create another global owner or recover
handles across browser/process termination. Native promises and handles are private runtime data;
never persist, inspect, log or serialize this actor tree or the handoff. Durable intent remains a
separate host journal responsibility.

The Jazz invitation adapter also requires a second argument:

```ts
createJazzInvitationAuthority(client, (accountId, receipt) =>
	owner.send({ type: 'TRANSACTION_DETACHED', accountId, receipt })
)
```

The account ID is obtained from verified request admission. The host must distinguish environments
and operations through its own fixed binding; no credentials or invitation codes are handed off.
These are required API changes. Finance's source has not been migrated in this change; its existing
creation capability needs custody retention before adopting the rebuilt package. Current sibling
vendor artifacts remain unchanged. DLF's packaged consumers demonstrate the new signatures.

## Receipt facts and recovery boundaries

DetachedTransaction contains:

- `acquisition`: the actual native acquisition promise, including late resolution after stop.
- `pending`: the latest native call promise. Wait for it to settle before acting on its transaction.
- `commit`: the commit-call promise if issue was attempted, including synchronous throw/rejection.
  Creation resolves to Write; invitation authority resolves to the existing `{ write }` envelope.

The host must observe fulfillment/rejection of the receipts. Presence of commit is not evidence of
persistence or authority acceptance. Do not automatically rollback or replay an uncertain commit;
reconcile through existing capabilities and the recorded operation intent. A failed acquisition
may hand off a rejected receipt with no usable transaction. Nothing here proves a successful native
disposal or supplies an application recovery policy.

The charts relinquish receipts after confirmed local persistence/authority confirmation or safe
confirmed rollback. Creation retains receipts when its final settlement is unresolved, including
an uncertain commit followed by a positive rollback report. Invitation already returns native
resources in its unknown-settlement output: that explicit output handoff remains the single owner,
so normal unresolved completion does not also call retainDetached. Abrupt invitation teardown uses
the callback because no reliable normal output was delivered.

The custody helper records one native call at a time. It does not choose retry, commit, rollback,
settlement or eligibility. Its fixed callback scope disposes custody on ordinary actor stop and
observes the owner error notification too. XState 5.33.2 can orphan invoked children when a machine
transition throws, so depending only on callback disposal would lose the handoff on that path.
Error observation transfers receipts without waiting for orphan disposal; it does not fix XState's
actor bookkeeping generally. The custody record clears its receipt references after the handoff. Hosts still
need normal supervision of root actor errors.

## Qualification

Historical v5 XState tests cover stop during acquisition/read/stage/commit, owner transition crashes,
confirmed graceful completion without detachment, uncertain rollback custody, and the invitation
output handoff without a second owner. The Jazz adapter fixture additionally opens a real exclusive
transaction, stops its workflow, awaits the handed-off pending read, and rolls it back from the
host. This qualifies that bounded SDK boundary, not arbitrary host recovery policies or process
termination. See the active feature implementation notes for final run results.

The v6 candidate retains the owner-error observation workaround until it is
requalified. Receipt state now lives in a closure behind a frozen interface with
readonly getters and explicit recording/clearing methods, so development context
freezing does not freeze a mutable receipt holder. The workflow still owns all
settlement decisions. The historical checks above are not v6 qualification.
