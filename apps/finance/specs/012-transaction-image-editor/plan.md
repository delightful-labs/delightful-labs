# Editor processing design

## Preview modal integration

Replace DUI's shared thumbnail information popover/hover controls with a whole-tile native button and the existing DUI Dialog. Disclosure is simple local UI state; existing editor actors, resource cleanup, permissions, and persistence remain unchanged. Modal actions receive a close callback instead of a popover ID. Finance uses that callback before opening draft/saved transaction editors or the avatar cropper. Pass localized Close labels through both inputs and saved attachment tiles. Keep the avatar's native file input synchronized with its form and expose replacement inside the preview.

Verification after implementation approval: update DUI image-input browser expectations and Finance transaction-image-editor, attachment, and avatar browser scenarios for preview -> edit/delete/replace, keyboard/Escape/focus, read-only downloads, and cancellation. No new async operations or changed actor helpers are introduced.

## Mandatory machine-first gate

This is a workflow: decode -> read working pixels -> release bitmap -> interact -> render -> allocate export canvas -> paint -> encode -> release resources -> terminal result. Preview is a separate render invocation returning to interaction; it does not encode or persist. Independent failure and cancellation boundaries require a machine rather than a branching promise actor.

Ownership:

- The consumer/integration component owns the editor actor and a consumer-side modal, forwards source-coordinate pointer and keyboard events, and requests SHUTDOWN before stopping it. Pure presentation receives data and callbacks.
- `imageEditorMachine` owns a decoded bitmap, immutable working source pixels, the selection/adjustments, optional preview pixels, and the export canvas. It never queries Jazz or uploads data.
- Promise actors perform single platform operations: decode, read a bounded raster, allocate a canvas, paint, encode, or release one resource. Temporary scratch-canvas cleanup stays inside the single raster-read platform adapter; it contains no policy decisions or commits.
- Pure domain functions own bounded geometry, convexity, homography, bilinear resampling, grayscale, and contrast. There are no new dependencies.

States: validating -> decoding -> readingSource -> closingSource -> editing.idle/dragging; previewing renders then previewReady; applying renders then creatingCanvas -> painting -> encoding -> cleanup -> applied/cancelled/closed/failed. RESET and EDIT return to the original source-based editing flow.

Cancellation during an issued platform operation records the requested terminal result and waits for settlement. Every successful acquisition is assigned before testing that request. Late decode/canvas/encode completion therefore goes to cleanup. A SHUTDOWN request takes priority over ordinary cancellation. Cleanup attempts both resource releases even if one fails; an existing cancellation/closed result is preserved. No actor is manually spawned or started inside a promise adapter.

The working raster and exported image are bounded to 2048 pixels per edge. Pixel rendering is a synchronous pure operation on bounded buffers, invoked at explicit preview/apply boundaries; continuous full-resolution rendering during pointer motion is not planned. UI geometry moves without rendering. If measured preview latency requires it, move this same pure renderer to a worker in a later reviewed change.

Constitution: financial data and permissions stay with existing transaction owners. The processing core has no Jazz/schema changes, network dependencies, localized messages, or presentation styling. New presentation uses Paraglide and DUI controls. New machine definitions live under src/lib/machines. Unit and browser tests follow implementation approval.

## Verification after review

Keep the editor unit tests separate from other image-processing tests. Geometry coverage includes identity and four-corner homography mappings, convex/crossed/concave/degenerate quads, one-pixel bounds, independent corners, rectangle/square invariants, and bounded translation. Pixel coverage includes known color fixtures, grayscale coefficients, neutral/zero/maximum contrast, alpha interpolation, output dimensions, and source immutability. Machine coverage includes preview/edit/reset, keyboard/pointer commands, cancellation and shutdown during late resource acquisition/encoding, null or wrong-MIME encoding, native failures, and cleanup before every terminal output. Type checks establish type consistency only; these runtime cases remain unverified until reviewed tests run.

## Presentation boundary

`imageEditorPresentation` projects root snapshots into viewport data and explicit control capabilities; components do not inspect actor states. The actor integration creates one editor per file and drains SHUTDOWN on unmount before stopping it. Pure View, Surface, and Controls components accept this presentation and callbacks. Surface owns only DOM pointer capture, source-coordinate conversion, keyboard adaptation, and canvas painting. Native painting failures emit DISPLAY_FAILED while interactive; loading/cleanup states do not expose a viewport. The eventual transaction consumer owns the modal and keys the editor by file. Contrast uses the reviewed DUI InputRange inside DUI Popover. Native popover disclosure stays with the browser.

## Transaction draft owner

`TransactionImageInput` binds native input/form updates, observations of editability, and a consumer-owned DUI Dialog. Its `transactionImageSelectionMachine` owns the draft File array and invokes one editor for the selected File. The existing ImageEditor integration can observe a provided child actor without starting or stopping it; its standalone mode retains ownership of its own root actor. DUI exposes a pure imageActions snippet inside the existing information popover, preserving the two overlay icons.

Selection readiness is explicit (ready/locked); editing retains the invocation across open/cancelling/shuttingDown substates. A close, replacement selection, editability loss, or teardown requests child cleanup before leaving the compound editing state. Apply commits only from editing.open when the original File is still selected, editability is current, and the returned file passes MIME/size validation. Cancellation and shutdown cannot commit late successful output; terminal child status is checked before sending interruption so completed children receive no stale commands. Scope/reset changes destroy the keyed input owner, which unsubscribes form reporting and drains SHUTDOWN. No Jazz writes or saved attachment mutation are performed by this draft owner.

Tests affected by this integration: add isolated selection-owner machine coverage; extend editor presentation/error/lifecycle tests; inspect transaction-edit and transaction-polish attachment browser scenarios for the information popover's filename links, source selection editing, cancellation, FormData synchronization, and saving the edited bytes. Run them only after this integration review.

## Saved attachment replacement

Apply updates the existing attachment's file reference, preserving attachment identity and filename. A new immutable file and its ordered byte parts are staged together with that update in one mergeable Jazz transaction. The previous file/parts are retained. The installed SDK's transaction supports plain byte-valued inserts but not streaming inserts; bounded 256 KiB byte chunks can be staged in this transaction. The ordinary streaming upload actor continues serving new attachments.

Machine-first gate: a replacement owner opens a transaction, reads the expected attachment/transaction/file, guards scope and expected file identity, stages already-decided metadata/parts/link update, commits, waits for local settlement, or rolls back. Every operation is a separate invocation. Cancellation before commit rolls back; cancellation after commit waits for the issued write and reports its actual settlement. The SDK's exclusive transaction wait requires authority confirmation, so ordinary offline edits use mergeable transactions. The expected-file check detects already observed changes; it is not a global compare-and-swap guarantee across concurrent offline replicas. Simultaneous remote edits follow Jazz merge semantics.

A saved-image editor owner hydrates the attachment and all local byte parts, guards complete contents and scope, invokes the shared editor, reads edited bytes, and invokes replacement. Its editor and persistence children stay invoked while closing/shutting down. It never changes the existing link before Apply. A consumer integration observes current IDs/file IDs and editability and owns the modal. The page retains Jazz subscriptions and permission observations. The saved tile's information popover exposes the same Edit image action as draft tiles.

The new update permission requires write permission for the old and new transaction relationship and a new file belonging to the target transaction. It does not permit mutating shared file contents. Verify writer/viewer/cross-account outcomes, multi-row byte staging, offline local settlement, stale file identity, rollback, and uncertain settlement after implementation review before declaring the mutation path verified.
