# Shared skip controls — reviewed, verified in connected Chrome

Replace DeveloperMenuDialog's native trigger and local focus-reveal CSS with DUI's SkipButton.
The shared library also exports SkipLink for native fragment navigation. Both share a private
presentation frame; Finance continues to own the developer label, debug gating, dialog ID,
open state, inspectors and sample-transaction content.

The trigger remains a native non-submit button with aria-haspopup="dialog", aria-controls
and the existing onclick handler. Keyboard focus reveals it at the logical top/start corner.
The existing localized label is reused; no Paraglide changes or generation are needed.

Refresh the vendored DUI archive and lockfile in this change, removing the superseded archive.
Work in isolated feature checkouts to preserve the user's development environment.
The snapshot includes the latest merged DUI changes and their XState 5.33.3 dependency;
Finance's own XState version remains pinned by the existing lockfile to 5.33.2.

## Static verification

DUI's Svelte/TypeScript checks, changed-file ESLint/Prettier checks, package validation and
Storybook build pass. Finance's changed-file formatting, frozen lockfile validation and
service-worker TypeScript check pass. Finance's full Svelte check reports 17 errors in eight
unchanged files because the available generated Paraglide messages are stale. The changed
developer dialog has no reported diagnostics. No Paraglide files were regenerated.

## Focused verification

- DUI: four SSR checks pass. Four Storybook tests cover native link/button contracts, focus reveal and
  blur hiding, fragment navigation, Enter/Space activation, disabled state and dialog return focus.
- Finance: inspected the developer-menu scenarios in tests/debugging.e2e.ts and
  tests/pagination.e2e.ts. Their accessible button/dialog locators and sample fixtures remain
  compatible with the extraction, so no assertion or fixture changes are required.
- No Finance unit test directly covers this presentation trigger. Shared control coverage belongs
  in DUI; Finance retains integration coverage of debug gating and dialog behavior.

The user approved implementation and testing. Playwright execution is blocked by sandbox
restrictions: the review server cannot bind port 6014, Chromium cannot start, and the session
rejects sandbox approval requests. These are infrastructure failures before browser assertions.
Finance integration tests could not run; regenerating stale Paraglide output also requires
separate explicit authorization under AGENTS.md.

## Connected-browser verification

The connected Chrome browser verified a standalone local HTML preview of the actual
DeveloperMenuDialog component using the new vendored DUI package and existing generated
messages. Tab reveals the developer trigger; Enter and Space open the associated dialog.
The diagnostic fields, inspector link, inspector callback and caller-owned sample content
remain available. Escape and the Close button return focus to the developer trigger.
No Paraglide files were regenerated. This verifies the presentation integration independently
of Jazz startup; the full debugging and pagination application scenarios remain unverified.

DUI's link reveal/blur, fragment focus and next-Tab behavior, dialog keyboard activation,
return focus and disabled-button behavior also pass in connected Chrome. The preview is
available under the sibling DUI checkout's test-results/skip-controls-review/index.html.
