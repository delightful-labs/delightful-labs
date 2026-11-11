# PWA update notice implementation plan

Mount `PwaUpdateIntegration` inside the drawer, composing the props-only `PwaUpdateNotice` presentation component immediately above online status. The shell renders the drawer directly; update state and callbacks stay inside the integration and its presentation component. Keep the existing design and localized controls. Unsaved-edit checks and draft preservation remain deferred.

## Machine-first gate

This is a workflow: acquire the existing registration, observe waiting updates and controller changes, decide whether activation or only reload is needed, request activation, await controller change, then reload. Failures and a 15-second activation timeout permit retry. Dismissal suppresses the same observed worker for the page session. Another tab's activation offers reload without requesting it automatically.

The integration component binds browser dependencies and owns the actor. The machine owns registration acquisition, observer lifetime, eligibility decisions, activation, timeout and reload. Promise actors are individual leaf operations. The observer attaches browser listeners and returns synchronous cleanup; shutdown exits it and cancels timers before reaching a final cancelled state. No acquired data resource needs rollback; an already posted activation request cannot be undone on shutdown. No partial durable operation is introduced.

## Constitution compliance

Use the native service worker with public-shell-only caching. Do not alter Jazz data/auth/sync or gate updates on network access. Keep presentation in the props-only notice component, platform binding in the integration, complex decisions in XState, and all visible text localized. No new styling direction, dependencies, schema changes, tests before review, or commits.

## Review cycle

Implementation files: update machine, browser integration, pure update notice, drawer composition, service worker activation message, and English messages. The shell needs no update wiring. Run formatting and application/service-worker type checks only. Present implementation before adding focused machine and production PWA browser tests.
