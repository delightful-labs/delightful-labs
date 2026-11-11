# Data Model: Link Internal Transfers

## InternalTransfer

Represents a single relationship between one expense and one income transaction. The transactions may predate the relationship (when linking synced or manually entered entries) or be created in the same user action as the relationship.

| Field                  | Required | Rule                                            |
| ---------------------- | -------- | ----------------------------------------------- |
| `organizationId`       | Yes      | Same workspace as both referenced transactions  |
| `expenseTransactionId` | Yes      | References an expense transaction               |
| `incomeTransactionId`  | Yes      | References an income transaction                |
| `expenseAccountId`     | Policy   | Snapshot of the expense transaction's account   |
| `incomeAccountId`      | Policy   | Snapshot of the income transaction's account    |
| `expenseAmountMinor`   | Policy   | Amount in the expense account's minor units     |
| `expenseCurrency`      | Policy   | Currency of the expense account and transaction |
| `incomeAmountMinor`    | Policy   | Amount in the income account's minor units      |
| `incomeCurrency`       | Policy   | Currency of the income account and transaction  |

The six policy-fact fields are nullable in the structural schema only to support the additive
migration. New relationships must populate them. Jazz permissions compare each endpoint against
these stored facts; rows missing any fact fail closed and cannot be read, changed, or deleted through
the transfer policy. The application supplies the facts from both current local endpoints inside one
mergeable transaction, which commits locally without waiting for the Jazz authority.

### Insertion authorization boundary

New manual transaction endpoints are authorized by existing account/workspace membership, valid
category/account references, currency/archive rules, and check-reference conditions. Their forward
`internalTransferId` does not have to reference an already admissible transfer at insertion: Jazz
forbids new rows granting one another access in a cycle. Transfer insertion still validates the
complete endpoint facts and requires write access to both accounts, using the factored transfer
account predicate. Existing marker updates and financial-fact restrictions remain enforced.

For linking existing rows, insertion accepts matching endpoint facts with both markers either pointing
to the inserted transfer or clear. Accepted unlinked endpoints provide an acyclic authorization root
for the same atomic link operation. This also permits the supported pending-unlink state; mismatched
facts and endpoints marked to another transfer remain denied. Marker updates still require the actual
matching relationship. Newly staged links populate both sides' account, amount and currency facts.

The user approved this acyclic boundary to retain atomic local-first paired creation. A manually
constructed standalone manual transaction with an orphan marker is consequently an application
integrity error rather than an insertion denial. New provider rows do not gain this exception.
Finance's creation statechart still validates and stages a complete three-row pair in one mergeable
transaction. No migration, separate commit, remote preflight, or SDK shutdown bypass is required.

### Invariants

- Both references exist and belong to `organizationId` in the local view when the relationship is committed. Paired creation stages both transaction rows and this relationship in the same locally atomic mergeable operation; the relationship does not require that the rows existed before the user's action.
- The expense and income are in different accounts.
- When linking existing transactions, both endpoints have the same currency and equal amounts in minor units. Suggestions and links of existing transactions remain same-currency only.
- A pair created at `/transfers/new` may use different currencies and amounts. For every pair, each stored account, amount, and currency fact must match its corresponding endpoint; account IDs must differ. These facts cannot be updated after linking.
- Jazz's positive policies require each transfer to match both endpoint rows and each endpoint's singular `internalTransferId` marker. A local-authority probe proved a positive update guard can prevent replacing an existing non-null marker. A focused delete-policy test found that requiring both endpoint markers to be null denies the current same-transaction unlink. Separate clear-then-delete writes sync successfully when staged in order on one offline replica; if deletion syncs first from another replica, it is rejected and not retried. A disposable positive read-policy probe showed the pending unlink can be visible with a `both linked OR both clear` predicate, but production must preserve read permission on both endpoint accounts. Model ordered writes, partial acceptance, and recovery before using this policy in production. The installed alpha.59 authority rejects negative correlated existence policies and has no unique-index declaration. Two independent offline replicas both had conflicting marker writes accepted after reconnect, so detect stale/conflicting relationships, prevent double counting, and provide permission-respecting recovery. Revisit these limits as Jazz adds capabilities.
- Linking, paired creation, unlinking, and linked deletion use mergeable transactions and complete at local durability. Jazz still enforces access control when mutations synchronize; a later rejection/rollback is reported separately.
- A transfer record is readable only when both endpoints are readable. Creating or removing a link requires write access to both endpoints.
- Deleting one endpoint must resolve the relationship in the same atomic workflow. Delete-both requires delete permission for both; unlink-and-delete requires delete permission for the selected endpoint and write permission for both endpoints to unlink.

## Transaction (existing)

Linking existing entries does not alter transaction values. Paired creation creates two distinct ordinary rows: one expense and one income, with a shared date, separate account IDs, and no provider identity. Same-currency creation stores the shared amount and currency on both rows; cross-currency creation stores each explicitly entered amount and its account currency. The relationship does not replace either row. Existing `paymentMethod: transfer` does not represent this relationship.

## AccountMembership (existing, extended)

Add a distinct account-level delete capability. Existing read/write semantics remain; write permission does not imply delete permission. Administrators can grant or revoke delete authority independently. Workspace owner/admin authority follows existing role policy. Existing grants migrate with deletion disabled unless existing role policy grants administrative authority.

## Suggested Counterpart (derived)

Not persisted. Candidate rows are current-workspace transactions satisfying all of the following: opposite kind; different account; equal currency and amount; within seven calendar days on either side; and not referenced by an internal transfer. Only readable transaction rows are presented.
