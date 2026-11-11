# Transaction image editor

## Requested behavior

- Support square, unrestricted rectangular, and perspective crop selections through a reusable editor. Transaction receipts use unrestricted/perspective selections; the avatar keeps its square behavior.
- In perspective mode, four independently movable corners outline a convex quadrilateral. Applying maps this selection to a rectangular image. This corrects a flat document photographed at an angle; curved paper is outside this feature.
- Support an optional black-and-white treatment and adjustable contrast. The initial interpretation is grayscale, with contrast from 0% to 200% and 100% neutral. Pure binary thresholding is not selected.
- Expose contrast through DUI InputRange inside a button-triggered Popover. Preserve pointer, touch, and keyboard access to crop handles.
- Preview and export must use the same transformation and pixel adjustments, always derived from the original working pixels. Changing adjustments must not repeatedly degrade a previous preview.
- Keep editor state local until Apply succeeds. Cancel, closing the modal, changing scope, or an export failure must not replace the transaction's image.
- Preserve supported file type and filename, avoid stretching an unrestricted rectangular crop, and bound the output to the existing 2048-pixel attachment limit. Perspective output proportions are estimated from the longest opposing edges; no document size is inferred.
- Editing a saved image replaces its immutable file reference on the existing attachment, preserving attachment identity and filename. Stage the new file, byte parts, and link update together; retain previous file contents. Local Apply is independent of the main transaction form save.
- Manual corner selection is in scope. Automatic edge detection, OCR, curl correction, and sync-status UI are outside this change.

## Image preview modal

- Draft transaction images, saved transaction images, and selected/saved avatars open a DUI modal when the whole thumbnail is activated, without hover controls or an information icon.
- The modal shows a large, uncropped preview, the filename, permitted removal and consumer-owned editing actions, and Close. Saved transaction filenames retain their download link.
- Finance supplies Edit through an actions snippet and closes the preview before opening its existing editor. DUI does not own crop/rotate processing or persistence.
- Read-only images remain previewable/downloadable; existing mutation capabilities remain authoritative. Avatar replacement remains available from the preview.

## Review cycles

1. DUI InputRange and contrast popover example: implemented and browser-tested.
2. Geometry, pixel rendering, and resource-owning editor machine: current implementation review.
3. Accessible editor presentation and consumer-owned modal integration.
4. Transaction integration, including in-place saved attachment edits that preserve identity and retain the previous file.
5. Focused unit/browser coverage after each implementation review.
