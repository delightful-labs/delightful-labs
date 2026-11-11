# Quickstart: Link Internal Transfers

This guide describes the focused validation to run after implementation review and approval. Do not run tests before the user reviews the implementation they cover.

## Scenarios

1. Create an expense and an income with the same currency and amount in separate accounts, dated within seven days. Edit either transaction and confirm the other appears as a suggestion with date, account, description, and amount.
2. Confirm a suggestion. Verify the two original IDs and transaction details remain and no third transaction is created.
3. Record a transfer between two same-currency manually maintained accounts in one submission while offline. Verify the shared amount appears on exactly one expense and one income, with one relationship locally durable together, and the UI reports local completion. Separately record a transfer between USD and TZS accounts with distinct amounts; verify both account currencies and amounts are retained without conversion. Verify a later Jazz policy rejection rolls back and reports a sync issue.
4. Confirm same-account, different-workspace, already-linked, different-amount, different-currency, same-direction, and out-of-window transactions are not suggested. Confirm paired creation rejects same-account, cross-workspace, or non-writable account selections.
5. Verify linked entries remain in account history but leave workspace and categorized totals. Unlink and verify they return to those totals.
6. Attempt link/unlink with write access to only one account and confirm the operation is rejected. Read one linked account only and confirm no counterpart details are available.
7. Attempt amount/account changes that invalidate a pair and verify the pair cannot be left invalid.
8. Exercise delete-both and unlink-and-delete with the required per-account delete permissions; verify denied and permitted outcomes and resulting totals.
9. Disconnect from the Jazz authority and verify link, unlink, and paired creation still complete locally. Simulate two devices independently linking the same transaction while offline; verify the conflict is detected after sync, totals count neither transaction twice, and the repair flow preserves Jazz authorization.

## Focused checks (after implementation approval)

- Update the relevant domain, transaction persistence, permission, and component coverage after inspecting the final code and fixtures.
- Run the targeted Vitest files for internal-transfer rules, transfer state transitions, transaction save/edit integration, reporting, and permissions.
- Run the focused Playwright transaction edit/reporting scenarios using the documented disposable Jazz agent configuration if visible browser behavior or real permission enforcement changed.
- Run the repository type and formatting checks for the changed files. Do not reset Jazz data or publish a schema as part of these checks.
