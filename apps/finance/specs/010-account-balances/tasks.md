# Account balances tasks

- [x] Add pure account balance aggregation and signed currency formatting.
- [x] Show calculated balances in the active account list.
- [x] Validate and retain SimpleFIN available balance and balance date on provider links.
- [x] Refresh linked account snapshots during explicit sync through the account import statechart.
- [x] Generate a Jazz migration from deployed schema `2ef8450fd994` to current schema
      `3f5fa6550799`; the edge adds only `availableBalance` and `balanceDate`.
- [x] Review implementation, update focused unit and Playwright coverage, and run relevant checks.

## Sidebar extension

- [x] Reuse workspace-scoped balance aggregation and render per-account sidebar values.
- [x] Review sidebar implementation.
- [x] After approval, inspect/update relevant sidebar browser coverage and run focused checks.
