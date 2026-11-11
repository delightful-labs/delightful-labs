# Tasks

## Preview modal review cycle

- [x] Replace shared DUI hover controls with a preview modal and consumer action close callback.
- [x] Integrate existing draft/saved transaction editors and avatar cropper; preserve downloads and replacement.
- [x] Review the preview-modal implementation.
- [x] After approval, update and run relevant DUI and Finance browser coverage, including keyboard/focus, permissions, deletion, replacement, and editor cancellation.

Preview-modal verification: nine DUI image/avatar browser tests, 46 Finance unit tests (avatar processing, cropper lifecycle, and draft selection), and 12 Finance browser tests passed. Browser coverage includes avatar preview/edit/cancel/apply/replacement/removal/recovery, draft and saved transaction editing, offline Apply, viewer preview/download without mutation actions, attachment deletion retaining file contents, native form submission/reset, Escape and focus restoration. Finance browser-test TypeScript checks and touched-file formatting/diff checks passed. Full suites were not run.

- [x] Implement DUI InputRange and contrast-popover Storybook example.
- [x] Verify range binding, keyboard bounds/steps, disabled state, FormData/reset, and popover keyboard use in focused browser tests.
- [x] Implement geometry, pixel rendering, and imageEditorMachine.
- [x] Review the processing core before adding tests or presentation.
- [x] Add and run isolated geometry, pixel, platform, and machine unit coverage after review: 50 tests passed, including late bitmap/canvas acquisition, encoding cancellation, codec failure, and cleanup.
- [x] Implement pure editor presentation with movable handles, keyboard controls, grayscale toggle, contrast popover, and preview, plus an actor integration that drains on destruction.
- [x] Review the editor presentation; then cover its capabilities, display failures, focus/keyboard behavior, preview and cleanup with tests.
- [x] Integrate a consumer-owned transaction image editor modal.
- [x] Integrate editing of new transaction image selections without modifying originals before Apply.
- [x] After integration review, cover selection-owner cancellation/permission races and the real info-popover -> editor -> apply/cancel -> save browser flow.
- [x] Implement saved-attachment editing with preserved attachment identity, complete local-content checks, and an atomic metadata/parts/link replacement owner.
- [x] Review saved-image editing; then verify writer/viewer/cross-account permissions, actual Jazz byte staging, rollback/uncertain settlement, offline edits, and persisted download contents.
- [x] After presentation/integration approval, update and run relevant attachment/avatar Playwright scenarios and editor accessibility coverage.

## Verification

- 70 focused unit tests passed (60 unrelated permission tests skipped): geometry, pixels, platform resources, editor capabilities, draft ownership, native Jazz permissions, atomic byte replacement, rollback, uncertain settlement, and observed permission/replacement/removal cancellation.
- Three editor browser scenarios passed: draft edit/preview/save with exact pixel verification; saved perspective edit/cancel/offline Apply/reload/download; viewer download access without edit capability.
- Four existing attachment browser scenarios passed: creation/download/shared-reference removal, adding saved images, count limit, and file type/size validation.
- Eleven focused DUI browser tests passed for image tiles, focus restoration, range input, and contrast popover.
- Finance type checks and browser-test TypeScript checks passed.
- Saved image information/download controls render outside the disabled financial fieldset; explicit permissions continue to gate image mutation controls.
- Four avatar browser scenarios passed against the final DUI package: upload/replace/remove/reload, invalid input and retry, offline edits, and cross-device recovery.
- Fixed stale preview errors during file replacement by isolating thumbnail nodes by URL and recording the URL that failed.
