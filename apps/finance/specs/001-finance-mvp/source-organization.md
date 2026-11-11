# Source organization follow-up

The user requested completing the remaining source grouping and previously authorized
larger review batches and verification within this thread.

## Requirements and layout

- Group all existing components by feature or shared presentation responsibility under
  `src/lib/components/`: accounts, banks, classification, diagnostics, filters, forms,
  identity, reports, samples, shared, startup, transactions, transfers, workspaces and PWA.
  Preserve the established navigation, image-editor and photo-cropper directories.
- Group machine definitions, unit tests and fixtures together under `src/lib/machines/`:
  accounts, forms, identity, images, management, persistence, PWA, runtime, samples,
  transactions (including attachments), transfers and workspaces. Retain bank-sync's
  existing directory.
- Group logging/inspection under `src/lib/diagnostics/`, session/context/lifecycle helpers
  under `src/lib/runtime/`, and shared form, filter and authorization helpers under their
  corresponding library directories.
- Colocate image-editor unit coverage with the modules it exercises; keep genuinely shared
  image-editor test adapters under `src/lib/testing/image-editor/`.
- Keep `src/lib/schema.ts`, `src/lib/permissions.ts`, their deployment-compatible tests,
  `src/lib/data.ts`, migrations and framework route files at their established entry paths.
- Update static imports, typed dynamic imports, test mocks, browser-side module paths and
  the inspector's HMR URL/accept paths together. Do not add compatibility barrels.

## Behavior and machine-first review

This is a relocation-only change. No actor body, workflow decision, state, event, lifecycle,
resource cleanup, schema, permission rule, visible text, component markup or styling changes.
Existing actor ownership and Jazz subscriptions stay with their existing integration components;
those components are moved whole. No new asynchronous workflow requires a new statechart.

Compare every changed code file with its pre-move version after resolving old/new paths to the
same original module identity. Parse TypeScript for comparison and compare component markup
separately. This also checks helpers recursively: no hidden orchestration is introduced.

## Verification

- [x] Move 216 files and update 59 additional callers.
- [x] All 275 changed code files compare equal after resolving relocated paths; component
      markup is unchanged. Generated Paraglide imports use their stable library alias.
- [x] Source checks pass with zero errors/warnings; recursive test TypeScript checks pass.
- [x] All 1,387 unit tests across 109 suites verified. The initial concurrent sandbox run
      passed 1,296; the six suites affected by listener restrictions or process-start contention
      then passed serially with local-process permissions (101 tests, including 10 already passed).
      No assertions or timeouts were changed.
- [x] E2E discovery remains 249 unique development scenarios in 41 owned files; all 15
      focused selections match canonical coverage. Browser paths and HMR query/accept URLs updated.
- [x] Ten browser checks pass: three debug/inspection/startup-retry cases including HMR,
      followed by seven bank-offline, account/expense, image-editing, transfer, profile, category
      and workspace-settings workflows. This is targeted verification, not a full E2E rerun.
- [x] Touched-file formatting and whitespace checks pass.

Previous E2E runtime improvements and their verification remain recorded separately in
`test-organization.md`. This follow-up does not change scenario selection or test budgets.
