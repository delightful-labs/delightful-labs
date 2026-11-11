# Account balances

## User goal

Show a calculated balance for each active account in the accounts list. The displayed value is
the net of saved transactions for that account: income adds and expenses subtract. With no opening
balance feature, the calculation starts at zero and is explicitly a transaction-derived total, not a
claim about the financial institution's current balance.

For SimpleFIN-linked accounts, retain the provider's available balance and balance date for future
reconciliation work. These provider values remain separate from the displayed calculated balance.
Use the available balance when supplied, or the provider balance when the protocol omits the
available balance. Save discovery values when the user adds or maps an account, and refresh
snapshots during explicit sync operations.

## Design

The account route owns the organization-scoped transaction subscription alongside its existing
account subscriptions. A pure domain calculation groups saved transactions by account and sums
signed integer minor units. AccountList receives the resulting balances and formats them with the
account currency. No Jazz write is made for the calculated value.

Add optional available-balance text and balance-date timestamp fields to SimpleFIN account links.
Provider response validation accepts the protocol's optional balance fields. Existing mapping and
creation transactions store a snapshot with the link, while explicit sync refreshes snapshots for
mapped accounts as part of the account import statechart. Existing accounts and links remain valid.
No usable credential or provider response is persisted.

No new multi-step workflow is introduced. The existing account import machine owns the additional
readiness decision and snapshot write state; its update actor performs one already-decided leaf
write. Account creation and mapping continue to use their existing transaction owner and cleanup
states.

## Review and verification

- [x] Review the implementation before adding or running tests.
- [x] After approval, test signed totals, empty accounts, currency isolation, and provider snapshot
      parsing/persistence. Add account-list browser coverage for manual and linked accounts.
- [x] Update bank-sync mapping/import fixtures and transaction write/import tests for the new
      snapshot fields; add account-list assertions in the account archive and bank-sync browser
      scenarios.
- [x] Run relevant schema/type checks and approved focused tests.

## Sidebar balances

Show the same transaction-derived balances beside individual accounts in the sidebar,
formatted in the account currency and current locale. WorkspaceBootstrap owns the
workspace-scoped transaction subscription and reuses calculateAccountBalances; AppShell
passes the data to the pure AppDrawer. Account/date filters do not affect balances.
Loading or failed balance queries display a dash without blocking account selection.
Reuse the calculated-balance label as the value's title. No new workflow, promise actor,
write, or lifecycle policy is introduced; this is a pure projection of subscribed rows.

- [x] Implement the subscription and sidebar presentation in three related files.
- [x] User review before test changes or execution.
- [x] After approval, inspect existing account balance unit coverage and sidebar/account
      browser coverage; verify signed/zero totals, filter independence, reactive saves,
      workspace isolation and loading/failure presentation.

## Sidebar approved verification

The user approved session-wide testing. All 52 focused browser checks pass. Sidebar
coverage compares positive, negative, zero and EUR balances with the table, checks the
12px balance text, filter independence, offline reactive updates and reloads on mobile
and desktop. A focused rerun of four strengthened category/sidebar scenarios also
passes, including workspace isolation and online/offline footer status. Existing
account-order assertions now target labels so balances do not change their intent.
All 125 focused unit tests pass, including balance aggregation and signed money
formatting. No production fixes were needed. Type, fixture, formatting and whitespace
checks pass. Tests used disposable in-memory Jazz on agent port 5182.
