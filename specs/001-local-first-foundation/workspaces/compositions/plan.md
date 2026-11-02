# Workspace compositions: selector first

Baselines: library main c001cc6, Finance main 56c9ba5. Both use fresh
feat/workspace-compositions branches. DUI main and the installed DUI Select public contract were
inspected; this change does not upgrade DUI, edit its primitives, or introduce styling.

## First implementation review

One pure WorkspaceSelector view, its actor-free props/view contract, a pure directory projection,
and separate package subpaths. Finance adoption and the creation dialog are subsequent review
cycles. The selector composes DUI Select rather than implementing a dropdown.

The host supplies the currently available local directory, requested workspace ID and an explicit
interaction-disable input to the projection. Available names are disambiguated through a supplied
localized formatter only when repeated. A selected ID must be among the displayed entries. A single
unselected workspace remains selectable; a single already-selected workspace needs no switching.
Loading/unavailable/failed directories are not rendered as a confirmed empty directory. Directory
IDs must be unique and nonempty; display names may repeat.

This is pure presentation projection, not a new workflow. There are no asynchronous effects,
resources, actor lifetimes, permission decisions or network reads to orchestrate. The existing
selection statechart remains the sole owner of authorization, invalidation and resource draining.
Directory visibility and a selection callback never grant access. The host dispatches selection
through that owner; it keeps routing and navigation policy.

## Local-first and localization boundaries

Only supplied local observations affect presentation. No SDK import, subscription, session open,
remote preflight, global wait or background freshness signal is introduced. The host can disable
interaction for its existing workflow decisions; the view does not infer connectivity readiness.

As with recovery, all text is supplied through a typed message contract. Consumers can build it with
their existing Paraglide messages for any locale. Required inputs are the field label, selection
placeholder and confirmed-empty text; duplicate-name formatting is also caller-localized. No English
fallback, library locale singleton, catalog/config/generated-file edit or new wording is introduced.
A bundled workspace message factory needs a separate exact-string review before catalog changes.

Forward native select attributes while reserving value/disabled/change ownership to the view. IDs
are instance-safe; caller descriptions and the empty explanation remain associated with the field.
No theme/reset import, CSS property registration, custom layout or decorative styling is needed.

## Affected coverage after implementation approval

- Pure projection: unknown vs empty, one unselected/selected choice, multiple choices, stale selected
  IDs, explicit disabling, duplicate names, and locale-dependent formatting.
- Browser/SSR: native accessible naming, keyboard selection/callback, disabled behavior, duplicate
  IDs/names, associated empty description, multiple instances, and locale update without new actors.
- Package: actor-free contracts/projection imports, Svelte consumer build and public declarations.
- Later Finance adoption: drawer/settings selectors share existing switching commands, original URL
  behavior, offline directory use, unavailable scope and no implicit selection or authorization.

No implementation tests or Finance component changes are part of this first review batch.

## Implementation ready for review

Implemented WorkspaceSelector, its actor-free view/message contracts and pure local directory
projection, with workspace and workspace/presentation package subpaths. Source/Svelte types report
zero errors/warnings; focused lint, formatting/diff checks and package/publint validation pass.
No implementation tests were added or run before review. Finance remains unchanged on its fresh
branch; adoption follows projection/SSR/browser/public-consumer coverage after approval.

The sole-unselected-workspace behavior is an intentional correction to Finance's prior less-than-two
options disable rule. It makes the visible choice operable, without selecting automatically or
bypassing the existing selection owner's access/drain decisions. The component owns no resources,
so it adds no teardown, retry, startup or persistence protocol.

## Approved selector coverage

The user approved continuation with coverage. Added 15 projection/SSR cases, an actor-free packaged
projection consumer, public view/declaration consumer checks, and eight synthetic browser scenarios.
The interactive fixture uses no Jazz/session/real data and the existing DUI theme workbench setup.

Browser coverage exposed a controlled-value defect: native selection visually applied the request
before the host updated its view. The selector now supplies a read-only function binding to DUI and
restores the native field to the applied value while forwarding valid request events separately.
It holds no second selected-ID state. A DOM-only reset was insufficient because DUI's bound value
could reapply the pending request. No private DUI/Svelte APIs were used.

The native keyboard event probe showed typeahead followed by Tab commits a choice on this platform;
arrows/Enter did not emit input/change. The browser check uses the observed native commit sequence,
not synthetic authorization or longer waits. All eight browser cases pass, including wording changes
while the request is pending. IDs/descriptions, independent instances, empty vs unknown, disabled
interaction, duplicate names and host-applied selection are covered.

Finance remains unchanged on its feature branch. Its next review batch will keep the existing local
queries and selection command, supply the translated message contract from existing catalogs, and
adopt the shared selector in the drawer/settings consumers. Creation dialog extraction follows as
its own focused review; no catalog or visual redesign is authorized by this selector work.

## Full selector qualification

Full pnpm verify passes: 256 unit tests (including the 15 new projection/SSR cases), strict
source/Svelte types, lint/formatting, package/publint, NodeNext/runtime/Vite consumers, and Storybook
build. The complete Storybook browser run passes all 24 cases, including eight selector cases and
16 existing recovery regressions. The standalone packaged selector projection runs in Node without
opening a client or importing an actor. No deadline was increased or assertion removed.

The known test-owned static Storybook preview remains at http://127.0.0.1:6014. Its selector stories
contain synthetic host controls (including Apply selection) solely to demonstrate request versus
applied-value ownership; those controls are not a proposed consumer application flow. No user
Finance server/storage was changed and no Finance adoption tests were run for an unbuilt change.

This implementation/coverage, including the controlled-value correction, is ready for review.
Finance adoption is the next focused implementation batch. No commits, pushes, PRs or deployments
were made during this review cycle.

## Finance selector adoption proposed for review

Finance's existing WorkspaceSelector is now a localized adapter over the shared view/projection.
The drawer and settings consumers retain their current callbacks and QueryContent gating. Missing
local query data is preserved as undefined through the existing presentation chain instead of
being turned into an empty array. No queries, actors, routing, catalogs or CSS were changed.

The updated selector archive replaces the private-creation-only archive; package manifest and lock
reference the reviewed snapshot. Source/Svelte types report zero errors/warnings, service-worker
checking and focused formatting/diff checks pass in an isolated checkout without localization
regeneration. Host runtime/SSR/browser verification remains pending implementation review.
