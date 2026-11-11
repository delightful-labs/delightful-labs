# Recovery Slice: Future Validation and Finance Adoption

**Status**: Proposed validation guide, not a statement that recovery is implemented. Commands for
future test coverage are intentionally deferred until its implementation is reviewed and approved.

## Current Planning Review

Review [plan](../plan.md), [research](research.md), [model](data-model.md), and
[contracts](contracts.md). Confirm independent entry points, host ownership, explicit locale
messages, and scope invalidation. This planning change runs focused Oxfmt checks and `git diff --check`
only. No runtime code, dependencies, tests, servers, publishing, or Finance files are changed.

## Implementation Prerequisites

After design review, authorize one focused implementation cycle at a time. Use the installed Node 24
and pnpm 10.22.0 baseline. Pin the planned SDK/compiler versions and DUI archive before dependent work.
The current `pnpm check`, `pnpm package`, `pnpm check:consumer`, and `pnpm build-storybook` commands
are static/build checks; extend their package exports and generation prerequisites as needed.

The localization implementation must wire compilation before check/package/Storybook. Generated
modules remain private and declarations must ship. Inspect a packaged import without a host locale
runtime, and inspect emitted JS for unintentional Jazz bundling or eager backend imports. A synthetic
Storybook source demo does not prove that package exports work.

## Coverage to Prepare at Implementation Review

Do not add or run these tests until the implementation they cover has user approval.

| Area         | Required scenarios                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow     | Initial availability; reveal; confirmation only while revealed; acknowledged and ordinary dismissal; reset on reopen; unavailable export; guarded retry                       |
| Scope/races  | Delayed results after hide/shutdown; same-ID handle replacement; session/environment replacement; A → B → A; no generation reset on unrelated render/locale change            |
| Cleanup      | Phrase absent from current context/DOM after close, invalidation and unmount; old actor never reopens; host session remains usable                                            |
| Presentation | Close/Escape/backdrop/acknowledged completion; keyboard/focus return; instance-safe IDs; one loading/error announcement; readonly selectable phrase                           |
| Localization | Complete English defaults; partial English overrides; complete host-owned translation; independent concurrent instances/SSR messages; reactive text changes preserve workflow |
| Packaging    | Actor-free view exports; workflow without Jazz; optional Jazz adapter uses host instance; NodeNext declarations; no Finance imports or secret-bearing inspection              |
| Real adapter | Supported local-first handle; unsupported issuer/absent root; changed account; actual host-issued handle through packed dependency                                            |

Reference coverage to inspect/update during future Finance adoption:

- `src/lib/machines/identity/recovery-phrase.test.ts`: current confirmation reset, delayed result,
  identity/binding replacement, failure/retry, shutdown checks.
- `tests/authentication.e2e.ts`, recovery modal dismissal scenario: four dismissal routes, cleared
  field, reset acknowledgement, and focus return. Other restore/sync fixtures use phrase export and
  must continue working; they are not permission to broaden the slice into login migration.
- `tests/config/base.ts`: actual-account reveal scenarios must disable trace, screenshot, and video
  artifacts rather than relying only on assertions that avoid printing the phrase. Do not collect
  real secret-bearing DOM in CI reports. Synthetic Storybook material can use normal diagnostics.

After approval, select only affected checks from the existing Finance test organization by inspecting
its current configs and scopes. Do not run the entire suite to discover fixture drift. Unit/static
checks finish before browser work so tool-generated environment files cannot invalidate a live server.

## Focused Finance Adoption

A separate authorized Finance change must:

1. Install a reviewed packed library artifact, retaining the same host Jazz and DUI instances. Inspect
   dependency resolution and validate an existing host-issued handle, not a second test-only client.
2. Replace the existing recovery integration at the account page using Finance's current session
   observation. Bind a stable dependency token and advance generation on actual handle changes.
3. Supply library English messages plus Finance-specific warning override if needed. Keep Finance
   route/page labels in Finance catalogs. Remove obsolete recovery catalog keys only after inspecting
   every caller; do not remove shared action/noun templates used elsewhere.
4. Exercise reveal/dismissal, identity replacement, and unmount with protected real-account artifacts.
   Verify an unmigrated interaction, such as editing the profile display name, still uses the same
   host session after closing the recovery interaction. No schema/data conversion is expected.
5. Review the result before public interface stabilization. Reverting the focused dependency/import
   change must leave existing persisted Finance data intact.

When browser work is approved, announce the server and URL before starting it. Use Finance's
`pnpm dev:agent` at `http://localhost:5180` with disposable in-memory Jazz, or a distinct known agent
port with matching Playwright configuration. Never reuse/clear the user's normal 5173/5174 storage or
stop an unidentified server. No server is started by this planning task.

## Acceptance Limits

This slice proves backup disclosure and incremental attachment only. It does not prove actual backup
retention, memory zeroing, recovery from lost credentials, fresh remote permission, cross-app isolation,
workspace membership, generic data persistence, or full MVP completion. Record the observed package
versions, artifact identity, review approvals, exact checks, and remaining limits with the later
implementation review.
