# Shared workspace selector: Finance adoption

Branches: feat/workspace-compositions from Finance main 56c9ba5 and library main c001cc6.
The shared selector implementation and coverage were reviewed before this adoption batch.

## Focused ownership change

Finance's WorkspaceSelector becomes a localized adapter over the shared selector and pure directory
projection. The existing drawer/settings callbacks still request selection through Finance's
coordinator, which retains route composition, exact target access and resource-drain ownership.
The view cannot select a workspace or create a usable lease on its own.

Both call sites already use QueryContent for loading/failure feedback. Preserve missing local data
as undefined through WorkspaceBootstrap → AppShell → AppDrawerSettings → WorkspaceSelector and the
workspace settings page. Do not coerce missing data to an empty directory before presentation.
Explicit empty arrays remain confirmed empty. No query, observer, actor, readiness gate or remote
permission check is introduced. Existing local subscription behavior is unchanged.

The shared projection allows a sole unselected workspace to be chosen and disables a sole already
selected workspace. Duplicate names retain Finance's existing name/ID formatter. Native requests
leave the displayed value under host control until the host applies selection; the view holds no
second selected-ID state. The shared selector's eight browser cases cover that boundary.

## Localization and package boundary

Reuse existing labels.current_subject, actions.select_subject, nouns.workspace and workspace.empty
calls. No catalog/config/generated localization file, wording, theme or CSS change is proposed.
The adapter receives the existing parent-provided label and continues using the current formatter.

The snapshot vendor/delightful-local-first-0.0.0-workspace-selector.tgz has SHA-256
`da360085da86217785aebb0839c55090b4f0ac64f2d5ee2caee3860b3c457f40`.
It contains the reviewed selector, with all 256 library unit tests, 24 Storybook browser cases and
full package/consumer verification passing. The superseded private-creation archive is removed;
manifest and lockfile reference the new artifact without unrelated dependency updates.

## Implementation review and affected verification

The five related presentation files preserve the existing integration/host boundary. There is no
async workflow or resource lifetime to move into a new statechart: directory projection and message
translation are pure, and events are forwarded to the already-owned selection statechart. Unknown
versus empty is input availability, not a newly mirrored lifecycle flag.

After implementation review, add focused Finance adapter SSR/interaction coverage where needed and
inspect existing workspace/authentication fixtures before execution. Cover both selectors, a direct
unscoped chooser with one workspace, duplicate labels, requested versus applied selection, missing
local data versus empty arrays, unavailable targets, history and scope retention, and recovery after
identity replacement. Reuse existing offline/cold checks to ensure locally known choices and saves
remain usable without a response. Do not weaken access or native interaction assertions.

Type checks run in the disposable isolated checkout with its own node_modules and existing generated
localization output. Dependency installation skips lifecycle scripts, and checks invoke the tools
directly to avoid localization regeneration. The user's development server and browser/Jazz data
are not changed. No Finance adoption tests are added or run before this implementation review.

## Static implementation verification

Source/Svelte checking reports zero errors and warnings; service-worker TypeScript checking passes.
Checks used the isolated checkout, raw tool invocations and the existing localization output;
no Paraglide compilation/regeneration was invoked. Frozen installation skipped lifecycle scripts.
Focused Prettier and diff checks pass. The offline package store lacked one pinned tarball, so the
isolated frozen installation fetched it without updating dependency versions.

No Finance runtime tests, commits, pushes or deployments were performed for this adoption review.
The next approved coverage should qualify the real installed DUI/Finance composition, not infer
that the library's synthetic selector tests establish every host navigation/recovery behavior.

## Approved Finance coverage

The user approved implementation and authorized its commit and continuation. Implementation commits
are Finance e0c77d6 and library 78bb8f6. Five new Finance adapter SSR cases pass; the complete focused
adapter/query/navigation run passes 43 cases. The SSR loader now inlines the foundation's Svelte
exports alongside DUI so the adapter is exercised against the real packaged view.

All 22 workspace/recovery browser scenarios pass, including a new sole-workspace explicit chooser
case, synchronized drawer/settings values, duplicate labels, unavailable scopes, history, offline
creation/journal recovery, identity recovery and pending creation across selection. Both strengthened
production cold-start scenarios pass: after every browser/client exits, records remain readable and
writable, a workspace can be created and explicitly selected, and the selected ID survives reload
fully offline and with an unanswered server connection.

The disposable development test app used port 5192 and shut down before the isolated production
preview ran on port 4185. Verification-only Vite runners in the isolated checkout preserve runtime
plugins while omitting Paraglide's compilation/watch writer hooks; existing generated localization
was reused. Normal application/localization configs were not edited. SHA-256 comparison confirms
the generated localization tree remained byte-for-byte unchanged. No cached-user data, production
service, or user's 5173/5174 environment was touched.

Source/browser-test types and focused formatting/diff checks pass. Full serial unit qualification
is recorded below once complete; this section does not claim that a CI run was performed.

## Completed qualification

The complete Finance unit suite passes serially: 124 files, 1,737 tests. Source/Svelte and browser-test
type checks pass, as do focused formatting and diff checks. The 22 development browser scenarios and
both strengthened production cold cases pass. No application code, assertion, or deadline needed
changing during this host qualification.

The generated localization tree hash is unchanged before/after verification. The temporary compiler
hook filter, preview configs and script override exist only in the isolated checkout; they are not
application changes or committed test configuration. The committed Vitest loader adjustment is only
the standard Svelte-package SSR inlining, with the full unit run covering its import graph.

The older agent server at port 5184 was left untouched and still uses the older dependency installed
in the working checkout. Review this branch using the isolated in-memory agent server at
http://127.0.0.1:5192. Normal frozen dependency installation is needed before running this branch in
another checkout. Neither the user's development environment nor browser/Jazz data was reset.

Implementation is committed at the IDs above. Coverage and qualification documentation remain
uncommitted for review; no branches were pushed, no PRs opened, and no deployments performed in
this continuation. Creation-dialog composition remains the subsequent implementation scope.
