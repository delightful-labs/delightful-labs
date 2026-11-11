# Avatar save ownership plan

Status: four-file implementation reviewed and verified. Shared form framework unchanged.

Keep this local to the avatar save flow. Pure schema validation checks the upload/remove draft.
Image processing then runs as part of the existing form operation. The shared form framework and
its validation protocol need no changes.

## Ownership and flow

```text
account integration → existing form controller/submission → avatar save machine
                                                          ├── image preparation and cleanup
                                                          └── existing readiness/write actor

validate draft → choose remove/upload
  remove → canonical removal ───────────────────────────────────────────────┐
  upload → decode → initialize → canvas → resize → encode → read bytes     │
         → validate canonical bytes → cleanup ─────────────────────────────┤
                                                                          ↓
                                                    fresh readiness → save → settle
```

One focused avatar save machine owns preparation, bitmap/canvas cleanup and invocation of the
existing scoped write actor. Its promise actors perform individual platform effects. The write
actor retains fresh readiness, original identity/profile/database scope and actual write settlement.
Use existing finite form outcomes and interruption commands; add no shared contracts or generic
validation actor support. Pass the configured write actor into avatar composition so domain modules
need no circular dependency or copied readiness policy.

On cancellation, scope replacement or shutdown, await any issued preparation effect, dispose acquired
resources and start no write. A late decode still yields a bitmap that must be closed. Keep shutdown
priority while draining. After a profile write starts, retain its existing settlement protocol.
Cleanup failure prevents saving and must not skip disposal of another acquired resource. Clear file,
bitmap, canvas, blob and temporary-byte references on completion. Return only the existing form
result; prepared image bytes are internal data passed to the write child.

## Four production files

1. `src/lib/validation/identity.ts`: make `profileAvatarFormSchema` a pure upload/remove draft schema;
   keep canonical `profileAvatarValuesSchema` alongside it.
2. `src/lib/domain/avatar.ts`: replace the procedural resize workflow with individual platform
   operations and pure dimension calculation, used by the avatar machine.
3. New `src/lib/machines/profile-avatar.ts`: own image preparation, cleanup and the existing write child.
4. `src/lib/machines/profile.ts`: compose the avatar operation and adapt its draft baseline/comparison.
   Keep the save callback typed to canonical prepared bytes.

Shared form/submission/controller files, the account integration, persistence helper and presentation
components need no changes. If implementation exposes a need to expand this scope, revisit the
local design before editing more files.

## Preserved behavior and deliberate change

Keep preview/reset/removal behavior and save eligibility. Represent the internal edit baseline as
an upload draft containing the saved image File when an avatar exists, or a remove draft otherwise.
This lets the existing generic edit contract use the same draft type as pure validation. Uploading
an eligible file remains a change; removal is a change only when an avatar exists. Presentation
continues to receive the existing stored bytes and MIME type.

Keep the 10 MiB upload limit, 256 KiB stored limit, supported MIME types, EXIF-aware decoding,
maximum dimension 256, aspect ratio, no upscaling and minimum dimension one. Request WebP at quality
0.85 and persist the actual supported encoder MIME type. A null encoder result fails safely.

Image processing now appears as **operating**, rather than **validating**. Invalid file drafts retain
schema validation feedback; processing failures use existing operation failure feedback before any
write. This avoids changing the shared framework just to preserve a progress label.

The installed Pica 10.0.3 exposes `init`, `createCanvas`, `resize` and `toBlob`. Initialize before
canvas creation; retain the existing shared Pica service and its internally managed worker pool.
Do not access private worker fields. Await issued resize/encode work before closing the source
bitmap; cancellation intent alone does not establish platform cleanup.

## Review and verification

Inspect the machine and its helpers for hidden orchestration before presenting implementation.
After implementation approval, migrate the existing avatar/schema tests and cover valid upload,
removal, dimensions, MIME fallback, payload limits, late decode, stage/cleanup failures, scope changes,
no write before cleanup/readiness and issued-write settlement. Run relevant profile/shared-form
checks and browser upload/remove/offline coverage.

## Implementation review

The four-file migration is implemented. The avatar operation captures original request metadata
and the draft separately, retains in-flight preparation on interruption, and closes the bitmap before
releasing the canvas. A bitmap cleanup failure still attempts canvas cleanup. Prepared bytes reach
the existing readiness/write child only after successful cleanup; cancellation or failed preparation
prevents that invocation. Once the write child starts, commands are forwarded only while it is live,
and its actual settlement is retained. Scope invalidation and shutdown keep their priority.

Recursive source review covered the actor and platform helpers. Decode, initialize, canvas creation,
resize, encode, byte read, canonical validation and each resource disposal are separate effects.
Dimension calculation and schema validation are pure. There is no procedural resize workflow inside
a promise, and no shared form framework or integration/presentation file changed.

## Verification after approval

Migrated existing platform, schema, profile and avatar form fixtures. The avatar operation has 31
focused tests covering cleanup before persistence, removal without allocation, actual encoder MIME,
encoded payload limits, each preparation and disposal failure, late decode, interruption priority,
scope replacement, fresh readiness, issued-write settlement and shared form success/reset behavior.

- 208 relevant unit tests pass across 12 files; the final typed avatar fixture rerun passes all 31 tests.
- `pnpm check` passes with zero errors and warnings; `pnpm check:tests` passes.
- Three avatar browser checks pass: resizing/replacement/removal/reload and URL disposal, invalid or
  undecodable file retry, and offline upload/replacement/removal followed by remote settlement.
- Nine shared form browser regression checks pass.
- Prettier and `git diff --check` pass.

Browser fixtures now target the current UI library avatar preview and ignore empty live regions.
Corrupt image decoding asserts operation failure feedback, as agreed. Production changes remain
confined to the four reviewed files. Application/session supervision and diagnostics stay deferred.
