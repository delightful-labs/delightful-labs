# Full E2E verification after XState cleanup

Status: in progress. The user requested the whole suite, then authorized continuing
failure investigation and corrections. Earlier 54-scenario results were a focused
regression selection, not the full suite.

## Inventory and baseline

- 141 application scenarios across 14 files, including `src/routes/finance.e2e.ts`.
- 6 production/PWA scenarios in `tests/pwa.e2e.ts` (pending).
- Full application baseline: **126 passed, 15 failed, 0 skipped**.
- Baseline machine-readable report: `/tmp/full-e2e-app-results.json`.
- Baseline trace/screenshot directory: `test-results/full-app/`.

The default Playwright config excludes authentication, permissions, workspace and
PWA files. Temporary `.full-e2e.config.ts` selects all application E2E files, only
excludes PWA, and runs one worker with a 120-second test timeout on port 5181.
The isolated server uses `vite.e2e.config.ts` with an in-memory Jazz database.
Permission tests now derive secondary-context origins from the test page rather
than connecting to a different server on port 5173.

## Confirmed test corrections

- Successful account dialogs have Close; unsaved dialogs retain Cancel.
- Modal/navigation labels match the current localized Add Account, Add Category,
  Add Tag and Manage Accounts labels.
- One account hides order editing, per the approved spec; adding a second enables
  editing and still exercises ordering with unavailable browser storage.
- The locale component fixture supplies the current typed archiveView contract.
- Pristine workspace Save is disabled; changing and reverting the name verifies
  both transitions while retaining the navigation/session assertion.
- Account archive success is located specifically, since creation readiness may
  legitimately render another status message on the same page.
- Sidebar content padding is checked on its child section after the committed
  drawer styling change moved it off the outer disclosure container.
- PWA account creation selectors use the current Add Account label.

Four baseline failures involving workspace rename synchronization or setup writes
passed on the first focused rerun without application changes. Their initial
cause is not established; the fresh full run checks for recurrence.

The focused rerun passed **14 of 15**; its remaining failure was the old padding
container assertion, subsequently corrected. Report:
`/tmp/full-e2e-retry-results.json`; artifacts: `test-results/full-retry/`.

## Current verification

Test TypeScript checks pass. A fresh run of all 141 application tests is running:
`PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/full-e2e-final-results.json pnpm exec playwright test --config .full-e2e.config.ts --reporter=line,json`

Progress log: `/tmp/full-e2e-final.log`. Artifacts: `test-results/full-final/`.
After it completes, build production using the isolated database's public URL and
app ID, then run all six PWA tests on port 4173. Do not build while application
browser tests are running because generated environment files are shared.

Changes remain uncommitted. Temporary configs and the owned test server need
cleanup after verification. No application implementation changes were needed
for the confirmed failures so far.
