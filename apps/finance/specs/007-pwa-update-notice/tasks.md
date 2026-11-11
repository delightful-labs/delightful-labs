# PWA update notice tasks

- [x] Implement the focused drawer update workflow, with formatting and static checks. Ready for implementation review.
- [x] After implementation approval, add and run focused machine and production PWA browser coverage, including multi-tab activation, dismissal, failure/retry, and deferred unsaved-edit checking.

Review evidence: `pnpm check` passes with zero errors/warnings, including service-worker TypeScript. Changed-file Prettier and whitespace checks pass. Actor/helper audit: registration acquisition -> observation -> guarded activation/reload decision -> activation request -> controller-change wait -> reload. Activation and reload each have a 15-second timeout; failures permit retry. Shutdown releases observation listeners and timers through state exit. Promise actors perform one platform operation each; observer callbacks only bridge browser observations. No tests were added or run, no development server was started, and no commit was made. Production runtime behavior remains unverified pending review and focused coverage.

## Approved verification

The user approved testing. All 14 focused machine tests pass, covering suppression/replacement, latest-worker selection, repeated acceptance, activation/reload failures and timeouts, observer acquisition/failure/retry, unsupported registration, shutdown cleanup and late registration completion. The platform contract now describes only the browser capabilities used by the machine, allowing typed fakes without casts.

All four new Chromium production PWA scenarios pass: the initially empty status element retains its identity, keyboard dismissal survives client navigation and reload rediscovers the update; acceptance reloads once and preserves saved account data while discarding unsubmitted input without confirmation; activation failure offers working retry; another tab retains its draft and reloads only on its own explicit acceptance. Existing offline, cache-boundary, manifest and waiting-worker regressions also pass.

Latest full PWA run: nine passed, with the older transaction-detail scenario failing on an obsolete text-content link locator. After correcting that locator to use its accessible name, its focused rerun passes. All ten scenarios are therefore verified across those runs. The older cache route and save/detail assertions were also updated for the current `/income` route, navigation after save, and editable detail form. No production behavior changed in those areas.

Application/service-worker and browser-test type checks, production build, changed-file Prettier and whitespace checks pass. Production verification used a disposable in-memory Jazz database from `pnpm dev:agent` on port 5180 and temporary production preview on port 4173. The initial build with an empty database URL could not start finance workflows; rebuilding against the disposable server resolved that configuration issue. Generated worker fixtures were restored. Test preview and disposable agent server were stopped; no persistent server/data was changed and no commit was made.
