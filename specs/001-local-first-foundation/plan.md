# Implementation Plan: Jazz-First Foundation

**Current branch**: `feat/workspace-invitations` | **Spec**: [spec.md](spec.md)
**Status**: The existing Finance extraction milestone is merged (library PR #10, Finance PR #45).
Recovery/restoration, session lifetime, forms/data boundaries, workspace creation/initialization/
selection/naming and profile editing are shared. The next focused slice is
[invitation redemption](workspaces/invitations/plan.md): its public contract/client statechart are
implemented for review; backend authority, issuance, invitation UX and member administration remain.
The full Jazz-only MVP is incomplete. The original first-slice plan below is historical context;
the slice-specific plans and extraction audit record current implementation.

## Summary

Incremental adoption began with recovery phrase reveal, hide, and cleanup. The shipped view has one
Close action and no saved-phrase acknowledgement checkbox.
Extract Finance's workflow and DUI-based view behind typed, independently consumable interfaces.
Finance keeps its existing Jazz provider/client, identity subscription, login/restore, navigation,
workspace lifecycles, schemas, and permissions. A narrow Jazz adapter uses the host account handle;
it must not start another client or receive ownership of the session.

This replaces the old multi-backend plan as the active planning entry point. It plans only the first
slice, not the whole MVP. The root research/data-model/contracts/quickstart/qualification/UI-discovery
artifacts remain historical input, not executable current contracts. Git history retains the prior
plan. Current slice artifacts live under `recovery/` and take precedence for this slice.

## Technical Context

| Area         | Baseline / decision                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Toolchain    | Node 24, pnpm 10.22.0, TypeScript 6.0.3, Svelte 5.57.2, Vite 8.3.0; retain current repository tooling                |
| Packaging    | Existing svelte-package 3.0.2, publint 0.3.25, strict checks, built-package consumer fixture                         |
| Workflow     | XState 5.33.2, matching Finance's declared version; pin development resolution during implementation                 |
| Localization | Paraglide 2.27.0, the version resolved in Finance; explicit locale calls, English initial catalog                    |
| Backend      | Jazz 2.0.0-alpha.59; optional peer for the backend entry, external and shared with host                              |
| Presentation | DUI 0.0.25 from Finance's exact `details-animation` archive for initial compatibility, Svelte peer                   |
| Storage      | None added. Phrase and acknowledgement are transient; no schema, workspace write, backup marker, or migration        |
| Platform     | Existing browser session; SSR renders hidden/no-secret UI without reading Jazz context                               |
| Verification | Static/package checks before review; unit and browser coverage only after implementation approval                    |
| Performance  | Local conversion only; no remote answer, readiness sweep, or added service needed                                    |
| Scope        | One workflow, one reusable view, one integration, one Jazz adapter, library-owned messages, one future Finance mount |

The current tooling baseline is installed. XState, Paraglide, Jazz, DUI, and test dependencies are
proposed additions, not installed or runtime-qualified by this plan. Initial validation pins versions;
do not claim a wider compatibility range from a single baseline. Jazz must remain a host-shared
external module: its module-private credential map makes duplicate copies incompatible with a
host-issued handle. Matching version strings alone are insufficient.

DUI archive SHA-256: `22485ae89113fd218af3d2d8f3211b16a8aa3a6428f09aeabd1568003bf038e2`.
No new DUI feature is needed: use Dialog, Button, Textarea, Checkbox, and StatusMessage.
Do not update Finance's DUI archive as part of recovery adoption. A reproducible development
archive can be vendored in this repo later; consumer resolution must retain Finance's instance.

## Constitution Check

| Gate                                         | Before research | After design                                                                                        |
| -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| Jazz-only v1; SDK access in backend boundary | Required        | Preserved; no generic plugin or second backend                                                      |
| Strict typing and no casts/switch            | Required        | Actor-free contracts and typed adapter, no runtime code in this change                              |
| Machine-first orchestration                  | Required        | Statechart and ownership protocol defined before effects                                            |
| Domain/presentation separation               | Required        | No Finance domain types; DUI primitives reused                                                      |
| Accessible localized composition             | Required        | Explicit messages, per-instance IDs, focus/dismissal ownership                                      |
| Identity authority and local guarantees      | Required        | Reveal is local, available only for supported host handles; no new permission or persistence claims |
| Incremental adoption and one lifecycle owner | Required        | Host owns session; library owns only recovery lifetime                                              |
| Review before implementation tests           | Required        | Only documentation checks in this phase                                                             |

No constitutional exception is requested. This slice does not complete identity restoration,
second-device connection, workspace/private-access qualification, ordinary data operations, or the
full MVP's minimal domain-record demonstration. Those requirements remain separate later slices.

## Project Structure

Current design documents:

- [Research and decisions](recovery/research.md)
- [Transient data and statechart](recovery/data-model.md)
- [Public contracts and ownership](recovery/contracts.md)
- [Future validation and adoption guide](recovery/quickstart.md)

Proposed source locations, to implement only after design review:

```text
src/lib/contracts/recovery-phrase.ts
src/lib/machines/identity/recovery-phrase.ts
src/lib/components/identity/RecoveryPhraseView.svelte
src/lib/integrations/identity/RecoveryPhrase.svelte
src/lib/backend/jazz/recovery-phrase.ts
src/lib/localization/recovery.ts
src/lib/paraglide/                       # private generated output
messages/recovery/en.json
project.inlang/settings.json
stories/RecoveryPhrase.stories.svelte    # synthetic material only
```

Entry points are deliberately narrow: `recovery` for actor-free view/contracts, `recovery/workflow`
for advanced machine consumers, `recovery/svelte` for owned composition, `backend/jazz/recovery`
for the host-handle adapter, and `recovery/messages` for localized text. Importing a view must not
load Jazz or a session provider. Do not expose raw generated Paraglide runtime or backend handles
through root barrels. Package exports and optional peer metadata change in their reviewed
implementation cycle; this plan does not stabilize names prematurely.

## Delivery and Review Boundaries

These are proposed review cycles, not generated execution tasks. Finish and present each before
starting the next. Keep each implementation batch to a small related set of files; discuss
necessary packaging/localization batches before editing them.

1. **Contracts and workflow**: implement actor-free scope/view types and the machine against a
   supplied leaf capability. Present the statechart and recursive orchestration audit. No Jazz,
   Svelte, or domain requirements belong in the machine contract.
2. **Localization and pure view**: compile owned catalogs, add explicit message resolution and a
   DUI view with synthetic Storybook examples; settle packaging declarations and IDs/accessibility.
3. **Integration and Jazz adapter**: attach to supplied host observations, own only recovery actor
   cleanup, isolate SDK calls and optional peers; validate built subpath imports.
4. **Focused Finance adoption**: separately authorize a small Finance change at its existing account
   recovery mount. Replace the recovery integration only; leave login/session/workspaces untouched.
   Verify real host-handle compatibility and one unmigrated Finance interaction before stabilizing
   public interfaces. Do not keep parallel active recovery implementations after adoption.

For each cycle, identify tests at implementation review, then add/update/run relevant coverage only
after approval. No test suite is created or executed by this plan. Worktree-local Finance changes,
vendored package updates, and server startup need their normal focused review; no deployment is
included. The scoped verification guide records acceptance and artifact handling.

## Open Work and Design Limits

The [current contract map](contracts/foundation.md) replaces the retired portable-schema/plugin
proposal. Jazz alone is required for v1; no second-backend conformance gate applies. Implemented
capability plans and package exports govern recovery, restoration, session ownership and selection.
Explicit private-creation transaction ownership and its Finance adoption are implemented and
qualified on feature branches. Shared workspace compositions, naming/access administration, and
concrete consumer data operations remain. An independent minimal consumer and broader MVP qualification remain.
Do not infer qualification of those unbuilt boundaries from Finance's focused adoption results.

## Progress and next review

The recovery reveal implementation and approved coverage are merged into library main through
`42d001c`. The UI uses a single Close action without acknowledgement. Earlier acknowledgement
references above describe the original plan; the current view contract and adoption notes govern
shipped presentation. The advanced workflow's legacy confirmation states are not part of the UI.
Finance recovery adoption PR #35 and restoration adoption PR #37 are merged.

The subsequent [identity restoration slice](restoration/plan.md) is implemented and merged while
Finance retains workspace draining, application lifetime, and navigation.

## Session startup continuation

Library startup PR #3 and Finance adoption PR #38 are merged at library main `7909ec2` and Finance
main `bf38397`. Acquisition ownership and per-application attachment are shared; SDK session status
observation and acquired-session retry coordination remain Finance-owned.

Approved verification passed: 31 library workflow/backend tests and package consumer checks;
62 Finance readiness/runtime unit tests; 11 authentication browser scenarios; two production cold
restart scenarios (unanswered authority and offline reads/saves); full source and browser-test types.
The startup debug diagnostic fixture was subsequently corrected and passed with debugging both on
and off. Finance's existing SDK provider, domain workflows, and workspace cleanup remain intact.

## Acquired session readiness and workspace continuation

Library readiness PR #4 and Finance adoption PR #39 are merged at library main `9372e0a` and Finance
main `f83be67`. Status observation and issued SDK retry now use the shared workflow; Finance retains
pre-drain authorization, restoration, navigation, and domain resource ownership.

Approved verification passed: 33 library workflow/backend cases and built-package consumer checks;
68 Finance readiness/runtime unit cases; 11 authentication browser scenarios; debug on/off startup
diagnostics; two production cold/offline read/save scenarios; full source and browser-test types.
The subsequent transfer fixture correction preserves the active workspace and checks live conflict
invalidation; it passed three isolated cases with two workers. These are qualification results for
those tested paths, not proof of complete workspace extraction or universal offline query coverage.

The [workspace lifecycle slice](workspaces/plan.md) now implements selection/switching and its
Finance handoff. The [private-creation transaction slice](workspaces/creation/plan.md) is implemented
and adopted in Finance with focused local-first qualification; reusable compositions remain next. Earlier first-slice proposals above are
historical; current slice artifacts and shipped contracts govern implemented behavior.

## Current priority after naming merge

Library naming PR #9 and Finance PR #44 are merged (library ed96a79, Finance e04bdf4). Selector and
creation-dialog compositions are also merged. Earlier text describing these as unbuilt is historical;
the current exports and [contract map](contracts/foundation.md) govern shipped capabilities.

The user now prioritizes [completing existing Finance extraction](finance-extraction.md) before
implementing new collaboration behavior. Start with shared scoped operation/form contracts and
readiness ownership; then progress through the audited data, initialization, creation recovery and
profile/identity boundaries. Keep each implementation/adoption cycle focused and reviewed. New
invitations/member administration and the full new-app MVP demonstration follow that milestone.
This reordering does not authorize automatic commits or waive the implementation-before-tests gate.
