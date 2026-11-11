# Browser coverage ownership

Finance browser tests should exercise the application boundary: route/query resolution, translated
feedback, financial validation and formatting, permissions, actual subscriptions, persistence,
offline behavior, and wiring to DUI/DLF. Shared code alone is not evidence that a Finance test can
be removed. Confirm equivalent library coverage and retain application integration checks.

## Cleanup after the presentation extraction

| Removed or shortened Finance exercise                                                  | Coverage retained elsewhere                                                                               | Finance integration retained                                                                                                                                         |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic QueryContent fixture rechecking inert controls, DOM retention and geometry   | DUI `tests/storybook/loading-content.spec.js`                                                             | QueryContent adapter/error precedence in `src/lib/components/shared/loading-content.test.ts`; real category loading/create/reload in `tests/category-loading.e2e.ts` |
| Recovery modal dismissal matrix plus repeated profile save                             | DLF `tests/storybook/recovery.spec.ts` covers Close/Escape/backdrop cleanup and focus                     | Finance route unmount/remount, actual account replacement, cross-device restoration, and profile save/reload in `tests/authentication.e2e.ts`                        |
| Sidebar icon coordinates, padding, border and text-selection styles                    | DUI sidebar-navigation and Details behavior suites; exact Finance CSS values are not behavioral contracts | Finance `tests/navigation.e2e.ts` retains current-route/query scope, disclosure, responsive shell and dismissal behavior                                             |
| Category/tag repeated modal dismissal, icon/button sizing and table keyboard scrolling | DUI Dialog and Table browser suites                                                                       | Creation validation, save feedback, fresh reopen, long-name rendering and reload persistence; real workspace-change resets remain in `tests/creation-modals.e2e.ts`  |
| Three separate invalid-phrase account setups                                           | All three inputs remain named steps in one Finance scenario                                               | Error wording, URL/draft/workspace preservation per input, followed by account-data/reload verification                                                              |

Canonical development discovery decreases from 269 to 264 scenarios: three scenarios removed and
three invalid-phrase scenarios consolidated into one. Two retained category/tag scenarios also
perform fewer browser interactions. This count is not a measured wall-clock improvement.

## Coverage intentionally retained

- Finance financial workflows, permissions, synchronization, offline/cold startup, image processing,
  route transitions, recovery failure handling and real identity/workspace changes.
- Finance generic form-presentation browser fixtures: DLF has form-machine unit coverage, but no
  equivalent generic form-controller browser suite was found. Do not delete the only browser
  evidence merely because the implementation moved to DLF.
- Responsive shell behavior: Finance owns breakpoints, drawer integration, scroll containers and
  content interaction even though DUI provides the primitives.

Use `pnpm check:tests` and `pnpm check:e2e` to validate typing and canonical/focused test ownership.
Run focused browser checks in an isolated checkout with independent dependencies and generated
files when the user's development server is running. No CI timeouts, workers or shards change in
this cleanup.

Validation for this cleanup: browser-test TypeScript, canonical/focused scope audit, formatting
and whitespace checks pass. Seven focused Chromium scenarios pass in the isolated copy (27 seconds,
including server startup): invalid recovery inputs, recovery route remount, account replacement,
profile name persistence, settled category loading/creation, and category/tag modal save/reset/reload.
The full browser suite was not rerun; no overall CI-duration reduction has been measured.
