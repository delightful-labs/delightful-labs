# W01 baseline and reproduction contract

Source: `670fb720e15b15a4b308408c92301bd29a943561` on monorepo `main`,
verified against GitHub and fetched before creating the isolated
`feat/finance-worker-inventory` checkout. See the
[ownership/route inventory](worker-ownership-inventory.md) and
[machine-readable results](worker-baseline-results.json).

These checks measure the current Window-owned Finance application. They do not
qualify the future application worker or any proposed extraction. No application,
library, schema, dependency, catalog or test implementation was changed. Existing
generators ran only as part of frozen install and documented check/build scripts.

## Environment and isolation

- Node 24.22.2; pnpm 10.28.0; Darwin 25.6.0 / arm64.
- Frozen workspace install, independent `node_modules`, generated artifacts and
  disposable browser contexts in the W01 worktree. No shared node_modules symlink.
- Resolved versions: Jazz 2.0.0-alpha.60 with the root workspace patch; XState
  6.0.0-beta.1; Svelte binding 6.0.0-beta.0; Svelte 5.57.2; SvelteKit 3.0.1;
  Vite 8.3.4; Vitest 4.1.11; Playwright 1.64.0.
- User ports 5173/5174 and browser data were not used. PWA fixtures use 4173;
  the disposable application/backup fixture uses 5188. Test runners own their
  fixture servers and stop them on completion.
- Raw local logs and failed-setup diagnostics are under
  `/private/tmp/finance-worker-w01-670fb720`. That directory is temporary; the
  checked-in result summary and commands below are the durable evidence.

## Build and type baseline

Run the existing frozen install and link check first:

```sh
pnpm install --frozen-lockfile
pnpm monorepo:check-links
```

Use the existing build-only configuration to prove no live service is necessary
for compiling the application. The original W01 compile run used the startup
fixture's loopback app ID/server address with no running backend:

```sh
FINANCE_PREVIEW=true \
PUBLIC_JAZZ_APP_ID=77777777-7777-4777-8777-777777777777 \
PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:6193 \
PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false pnpm finance:check

pnpm --filter delightful-finances check:tests

FINANCE_PREVIEW=true \
PUBLIC_JAZZ_APP_ID=77777777-7777-4777-8777-777777777777 \
PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:6193 \
PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false pnpm finance:build

pnpm finance:test
```

The same environment was inherited by the recorded test-type/unit commands.
Application/service-worker checking found zero errors/warnings. Unit baseline:
142 files and 1,940 tests passed. The first production build completed in 8.57s
wall time; this includes command/generator overhead and is not startup latency.
Other measured check durations are retained in the result summary.

| Check                                    | Recorded result                       | Wall time                        |
| ---------------------------------------- | ------------------------------------- | -------------------------------- |
| Frozen install                           | Passed; lockfile resolution unchanged | 20.4s reported by pnpm           |
| Workspace links                          | Passed                                | 0.14s                            |
| Application/service-worker types         | 0 errors, 0 warnings                  | 20.09s                           |
| Browser-test types                       | Passed                                | 3.99s                            |
| Build-only production build              | Passed                                | 8.57s                            |
| Unit baseline                            | 142 files / 1,940 tests passed        | 28.97s command; 26.21s Vitest    |
| Same-origin ephemeral production build   | Passed                                | 6.74s                            |
| Corrected PWA smoke                      | 1 passed                              | 2.92s                            |
| Full production PWA suite                | 16 passed                             | 38.63s command; 38.3s Playwright |
| Existing 521-transaction archive fixture | 1 passed                              | 13.45s command; 13.1s Playwright |

## Production PWA/browser baseline

The PWA suite requires a usable backend during initial preparation. Follow the
existing `.github/workflows/finance.yml` PWA job, not its separate build-only job:

```sh
# Do not carry a legacy PUBLIC_JAZZ_APP_ID override into this same-origin fixture.
FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=same-origin \
FINANCE_EPHEMERAL_JAZZ=true PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false \
pnpm finance:build

FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=same-origin \
FINANCE_EPHEMERAL_JAZZ=true PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false \
pnpm --filter delightful-finances exec playwright test \
  --config tests/config/playwright.pwa.config.ts --workers 1 --max-failures 1
```

This suite covers emitted Wasm precaching with the HTTP cache disabled; full
browser/database-worker exit and retained offline account/income/expense/transfer
detail access; supported versus excluded navigation fallbacks; public-only
caching; localized manifest; and consented update/draft behavior across tabs.
The configured default browser is Chromium. Do not report these results as
Firefox/WebKit/mobile-device qualification or as coverage of a future worker.

The initial W01 PWA attempt incorrectly reused the build-only configuration,
which pointed to an absent backend. Its snapshot showed “Your workspaces could
not be prepared” and workspace settings, rather than the required Accounts page.
The run was stopped after 10 startup failures, one interrupted case and five
unrun cases (exit 130). This is a rejected fixture setup, not evidence of a
production regression. After reading the failure and actual CI job, the build
was corrected to same-origin + ephemeral Jazz. One Wasm/offline smoke case then
passed before the broader suite was started. No assertions or product code were
changed to obtain that result.

## Representative data/performance baseline

Reuse the existing `tests/features/workspace-settings.e2e.ts` case named
“downloads and independently reopens a Finance none backup without changing
source”. It seeds 521 transactions and an exact eight-byte binary attachment,
downloads and independently validates the archive, compares the unchanged source,
restores through the application-owned UI, then checks the restored graph. It
already attaches `finance-backup-measurement` and `finance-restore-measurement`.

Recorded single-sample results: 536 records/references, eight attachment bytes,
1,051,291 archive bytes; export plus independent open 1,088ms; longest observed
main-thread task 74ms; restore of 521 transactions 1,549ms. The assertions passed
for the source comparison and restored graph. The dev run also logged an HTTP
401 `backend-user` response and ignored-event diagnostics (`NAVIGATION_STATUS`,
`FORM_CAPABILITY_REPORTED`, `INTEGRITY_STATUS`, `CONNECTIONS_CHANGED`, `CANCEL`,
`OBSERVE`). This baseline does not establish the causes or harmlessness of those
diagnostics; preserve them for scope/lifecycle comparison in later work rather
than describe the runtime as warning-free.

Run after production checks, since dev generation replaces build-time environment
modules. The existing agent config creates an in-memory same-origin backend:

```sh
PUBLIC_JAZZ_SERVER_URL=same-origin FINANCE_EPHEMERAL_JAZZ=true \
PUBLIC_FAKE_DATA=false PUBLIC_DEBUG=false FINANCE_E2E_PORT=5188 \
pnpm --filter delightful-finances exec playwright test \
  --config tests/config/playwright.workspace.config.ts \
  --grep 'downloads and independently reopens a Finance none backup without changing source' \
  --workers 1 --max-failures 1
```

Leave `FINANCE_PREVIEW` unset for this dev fixture: that flag disables the
development backend attachment plugin. Do not run builds/checks concurrently
with this server in the same checkout.

This is a single desktop/dev-server workload, not a statistical benchmark or a
production startup budget. Export/open and restore timings include automation,
SDK/native persistence and runtime costs. The longest-task measurement covers
Window long tasks observed by the existing fixture; it does not profile every
worker, Wasm CPU time, memory, storage/quota or physical mobile device.

Before changing each later feature, capture the corresponding existing fixture
on that feature's actual pre-change baseline, retaining source revision, exact
dataset, browser/versions, cache/network conditions and measured milestone. For
startup use heading/action usability rather than DOM load alone; distinguish
first use, warm repeat and full cold/offline restart. Large-list/balance/import
and password-protected archive performance require their own matched before/after
samples when those paths change. No improvement or numerical target is claimed
by W01; the startup and acquisition files elsewhere in this spec remain dated
historical measurements, not fresh results for this commit.

## CI and hosting reconciliation

- PR #23 (`b7d887c5` merge) changed the Foundation, Finance and Clipper push
  filters from `master` to `main`. Current source retains their existing PR/manual
  triggers, jobs and transitive affected-project selection.
- The user authorized correcting Vercel after live CLI inspection found Website
  and Finance on `master`, with Clipper already on `main`. Website and Finance
  were changed through the scoped branch API and read back as `main`. Their repo,
  root/build and protection settings were verified unchanged. All three connect
  to `delightful-labs/delightful-labs`; roots remain `apps/website`, `apps/finance`
  and `apps/clipper/apps/web`. No deployment/promotion was requested by this
  baseline. Historical cutover records retain their original `master` snapshots.
- Future changes should target current `main`. References to `master` in earlier
  migration checkpoints are historical, not a reason to change the workflows back.

## Remaining qualification limits

The inventory maps existing coverage; it does not claim every listed feature
was rerun here. W04–W06 still need actual native crash/storage/identity evidence,
W07–W11 need new boundary qualification, and W20 needs the complete served
worker application across supported browsers. The inventory, corrected
browser/data baseline and rejected-setup disposition are now recorded, completing
W01. This does not approve W02/W03 implementation designs or establish broader
browser/performance acceptance.
