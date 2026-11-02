# Component composition memory

Read before designing or extracting reusable library components.
Adapted on 2026-10-31 from Finance `8ff72f6` (identity/workspace compositions and
XState memory) and DUI `9bc5405` (README.md and public exports).

## Responsibility boundaries

- DUI owns generic buttons, fields, dialogs, popovers, loading/status feedback, and content primitives.
- This library owns reusable identity/session/workspace behavior and their embeddable compositions.
- Consumers own routes, screens, layout, navigation, domain schemas/rules, and domain workflows.

Integration components bind subscriptions and dependencies, attach/own actors, forward scoped typed
observations, and compose imported views. They may access the documented backend integration layer;
SDK calls remain in its adapters. Pure presentation accepts typed data/view models and callbacks,
not database clients, subscriptions, actor refs, or raw snapshots from which it reconstructs policy.
Keep simple draft/disclosure state local; reusable complex state follows xstate.md.

Do not create a component merely to relocate a page template or move a script into a controller.
Extract a coherent reusable responsibility, and extract shared helpers only for actual reuse.
Keep canonical validation and derived form adapters together; entity validation filenames match
schema filenames. Library validation must not absorb Finance-specific entities or policies.

## Native Svelte 5 composition

Use `$props`, typed callback props/native callbacks, and child/named snippets supported by the actual
DUI version. Do not assume old slots, bundled triggers, locale providers, or undocumented props.
Forward appropriate native attributes, events, class/style and accessible descriptions through
wrappers without overriding consumer names or creating duplicate IDs. IDs must be safe for multiple
instances. Inspect the public contract before adding a wrapper or proposing a missing primitive.

DUI Dialog provides native modal behavior and a required caller-owned heading; callers supply triggers
and close controls. Native close/cancel/toggle events must stay synchronized with the interaction
owner. Every dismissal route, including unmount and scope invalidation, requests the same idempotent
cleanup. Native dialog focus behavior does not guarantee focus for internal step changes; the
composition owns meaningful step/error focus and the consumer owns its return target.

Use Popover for lightweight contextual choices and a dialog/embedded view for longer sensitive flows.
Do not force full screens or a router. Support usable keyboard paths and manual alternatives to
optional clipboard/QR features. Closing does not imply mutation rollback or clipboard erasure.

## Feedback and localization

Reuse ButtonContent for icon/loading button content when supported by the pinned DUI artifact.
It renders presentation only; operation readiness and pending state come from the workflow owner.
Reuse StatusMessage/LoadingScreen/LoadingSpinner and FieldFeedback for their documented purposes.
Do not nest live announcements. Field guidance describes fields; operation feedback has one status
owner. Keep an announcement region mounted when updates need announcing rather than assuming initial
render text is announced. Label buttons explicitly; decorative icons/spinners remain hidden from
assistive technology.

All visible text and accessible labels follow localization.md. Views translate descriptors and use
consumer-compatible localized messages. Never show recovery secrets in announcements or diagnostics.
Recovery disclosure does not require a saved-phrase acknowledgement. Keep the Close control at
the bottom; dismissal never records a successful backup. Clear sensitive material on every terminal/scope-change path.

## Review and reference limits

Source patterns are extraction evidence, not proof of complete runtime correctness. Finance's
vendored `0.0.25-details-animation` archive and DUI's `0.0.25` checkout can expose different APIs;
pin and inspect actual exports before adoption. Generic missing behavior belongs in a DUI proposal,
not a duplicate library primitive. SDK/toolchain versions and detailed packaging require planning.
Identify affected actor/view/browser tests at implementation review and add/run them only after
approval. Follow this repository's Oxlint/Oxfmt policy, not copied reference-repo formatting commands.

## Extracted Finance compositions

Shared form/profile compositions accept typed views, callbacks, snippets and caller-translated
labels. Their controllers and policy/resource machines are separate public imports. Finance
retains its schema bindings, existing Paraglide callbacks, diagnostic sink, icons and cropper.
Do not import Finance modules or its locale catalog into the library. See `docs/next-app.md`.
