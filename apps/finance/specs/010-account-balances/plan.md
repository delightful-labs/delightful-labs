# Account balances implementation plan

## Scope

Display per-account net transaction balances in the accounts list and retain the latest SimpleFIN
available balance and timestamp on the provider link. Provider snapshots are not shown in this
feature. Calculated balances begin at zero because no opening balance is currently modeled.

## Implementation

1. Add a pure signed-minor-unit account balance calculation and exact signed currency formatting.
2. Subscribe to organization transactions in the accounts route and pass calculated values to the
   pure AccountList component, with a localized calculated-balance column.
3. Extend SimpleFIN response validation and provider summaries with optional balance fields. Store
   available balance and balance date on `simplefinAccountLinks` when links are created or changed.
4. Add an explicit snapshot update state to the existing per-account import machine. It runs after
   the mapped account has been resolved and before transaction import; failures remain explicit
   sync failures, preserving already settled imports and existing idempotency.
5. Add an additive Jazz migration. Do not publish or deploy it as part of this task.

## Architecture and integrity

The account page retains Jazz subscription ownership. Balance aggregation is a pure domain
transformation over authorized transaction observations and never writes Jazz data. Money remains
integer minor units; provider decimal strings are retained without floating-point conversion. The
available-balance snapshot is metadata for later reconciliation and never substitutes for the
transaction-derived value shown now.

The XState change adds one explicit `savingBalanceSnapshot` state to the existing account import
workflow. A guard skips the leaf write when the provider omits a usable snapshot or the account is
unmapped. The existing machine handles cancellation, failure, and the subsequent transaction loop.

## Review gate

Implementation review precedes test edits and execution. Expected coverage includes unit cases for
signed sums and provider value parsing, plus an account-list browser case using saved transactions.

## Sidebar extension

WorkspaceBootstrap subscribes to all readable transactions in the active workspace,
reuses the existing balance aggregation, and passes nullable balances through AppShell
to AppDrawer. Render a formatted value beside each account and a dash when the balance
query is loading or failed. Keep account filtering usable independently. This adds no
async workflow or writes. Review before updating or running sidebar browser coverage.
