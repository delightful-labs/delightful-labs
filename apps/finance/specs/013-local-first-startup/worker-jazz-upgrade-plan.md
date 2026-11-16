# Coordinated Jazz upgrade after PR #39

Baseline: PR #39 merged at `fb380114` on 2026-11-16. Its final head `d8c0820e`
passed every hosted Finance, Clipper and foundation workflow. C1/C2 are complete.
`feat/jazz-native-session-upgrade` starts from that exact merge tree. No SDK pin,
patch, application behavior or deployment setting has changed here. The npm
package-tag endpoint was rechecked: `latest` is alpha.65; `alpha` still selects
alpha.60. Use explicit coordinated pins after qualification.

The [release audit](worker-jazz-release-research.md) remains the implementation
evidence. Qualify this boundary before building C3–C5's application worker/read
slice, so its SDK integration is written once.

The user resolved the preview-data decision: **fresh preview cores are acceptable
for Clipper, but not Finance**. Finance must retain access to its existing data
in previews and production. Clipper's approval does not authorize production data
resets or a Finance destination change.

## Foundation-first execution

- [ ] **U1 — Qualify the existing persistent-worker bridge on alpha.65 in
      isolation.** The unpatched SDK already fails cold worker data retention.
      Adapt the existing patch's worker detection/Window-hook behavior to the
      changed source, adding no preparation callback or per-call owner. Run the
      actual Finance-schema save/edit/close/two-restart fixture with the shared
      IDB store and single-bundle build. Audit the other patch responsibilities
      separately: native device-account APIs do not establish joining-proof,
      extension-origin or offline-retry parity. Discuss any newly required patch
      behavior before implementing it. No workspace pin/backend destination changes.
- [ ] **U2 — Adapt Local First's session boundary and both consumers together.**
      Use `initial: 'device'`, `localFirst: 'now'` with the public client loader,
      `user.accountId`/kind/identity, `exportDeviceKey()`,
      `restoreDeviceAccount()` and `signOut()`. Use `JazzProvider` for the current
      Window-owned applications. Delete Finance/Clipper's explicit SDK-upgrade
      leaves and corresponding opaque-account plumbing. Keep the existing
      session owner, stale binding checks and domain drains; do not create a
      Window SDK session for the future worker UI.
- [ ] **U3 — Establish SDK schema history before persistent-backend startup.**
      Both active apps use `migrations: 'none'`; alpha.65 rejects this on SQLite,
      remote and Vercel stores before opening them. Use the SDK's generated
      initial history/validation tools, preserving domain schemas, permissions
      and app IDs. Test fresh stores and disposable retained alpha.60 SQLite
      stores with records/identities/permissions. This is SDK schema history,
      not the excluded account-selection migration/fallback layer.
- [ ] **U4 — Qualify backend authentication and destinations.** Replace the
      throwing `acceptLocalFirstAuth` stub with public `acceptDeviceAccounts`.
      Clipper's authenticated answer must include actual session expiry in Unix
      seconds. Qualify Better Auth against alpha.65's `~1.7.22` peer and the
      existing auth patch. Preserve Finance's existing core/Drive bindings and
      qualify retained-data access; naming equality alone is insufficient. The
      read-only inventory below identifies two matching destinations and one
      custom qualification destination that must stay out of rollout until its
      data-preserving path is verified. Clipper previews may use fresh cores.
- [ ] **U5 — Switch and qualify the workspace coherently.** Update SDK, matching
      Wasm/native core, library peer and existing patch bindings as one reviewed
      change; preserve one compatible SDK identity per consumer. Run library
      types/packed consumers, both apps' types/unit/build checks, Finance's native
      worker and product/offline/recovery/permissions cases, and Clipper's worker,
      extension, auth and production/offline cases. Include offline retry,
      identity changes, interrupted startup, pending writes and actual close.
      Client-only success does not qualify a Vercel backend or application cutover.

U1 can proceed independently of the retained Finance destination work. U2–U4 form one
coordinated compatibility change; U5 must not publish a partially upgraded graph.
After this checkpoint, implement C3/C4/C5's one worker-owned read view, then C6's
existing financial workflow. Do not build more alpha.60 integration glue that the
native alpha.65 API will replace.

An initial `git apply --check` against the pristine published alpha.65 package
finds four files whose alpha.60 patch hunks need rebasing: `runtime/context.d.ts`,
`runtime/native-runtime/browser-shared-worker-connection.js`, `session/state.js`
and `worker/jazz-broker-worker.js` under `dist/`. No hunks were applied. Textual
applicability of the other files is not behavioral qualification. The check log
is `alpha65-existing-patch-check.log` in the research artifact directory.

## Native Vercel naming: additional code proof

Executed actual alpha.60 and alpha.65 JavaScript exports without constructing a
Sandbox or contacting a backend. Inputs are the existing Clipper
`jazz-core-name.test.ts` project/branch fixture. Compared alpha.60's
`defaultCoreName` and Clipper's current `jazzCoreName` with alpha.65's `coreName`,
`perBranch`, `driveName` and `refuseVercelName`.

| Case                         | Observed result                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default production           | `namespace: 'production'` selects the same core and `<core>-data` Drive; the fixture's Drive name is 53 characters.                                               |
| Default preview              | Native `perBranch(branch)` produces the old SDK's default preview core name.                                                                                      |
| Clipper's shortened override | Its `clipper-preview-…` name is outside the new required `jazz-<project>-<namespace>` form. No namespace reaches that same core.                                  |
| Long preview Drive           | Alpha.65 allows 128-character Sandbox names and natively truncates/hashes the Drive name to 64 characters. The tested preview works without Clipper's workaround. |

This supports removing Clipper's custom preview hashing helper after adopting
native namespaces. The user permits Clipper previews to start with fresh data
where the old version used a custom override. Old cores/Drives stay untouched;
their contents do not move automatically. This approval does not extend to
Finance. Preserving access to a non-addressable Finance destination needs a
supported retention path; do not default to another SDK patch or a data-copy layer.

Evidence: `/private/tmp/finance-jazz-release-research/core-name-compatibility.json`.
The inputs, functions and outcomes above keep the handoff independent of temporary
files. Source: [alpha.65 Vercel store](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.65/packages/jazz-tools/src/backend/vercel-store.ts).

## Read-only Finance destination inventory

The connected Vercel account identifies `delightful-finances`, project
`prj_XRyQmkRAdDV2xUZGPeXcFBSfgHVa`, in `mjamesderochers-projects`, with
`finance.delightfullabs.com` among its domains. The paginated Sandbox and Drive
listings each return exactly three records with no next page. No core was
started, created, renamed, attached or deleted; no data or settings were changed.

| Existing core                                                 | Existing mounted Drive                       | Alpha.65 namespace comparison                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-production`            | Same name plus `-data`                       | `production` yields the exact same core and Drive names.                                                                   |
| `jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-preview-mono-d7de34b1` | Same name plus `-data`                       | `preview-mono-d7de34b1` yields the exact same core and Drive names.                                                        |
| `finance-alpha60-preview-qualification`                       | `finance-alpha60-preview-qualification-data` | No namespace reaches this custom name. Preserve both and defer this destination's rollout until retained access is solved. |

The comparison executed the actual alpha.65 `coreName` and `driveName` functions
against the observed project/core/Drive names, without opening a backend. It
establishes name identity for the first two rows, not schema, auth, row or
credential compatibility. Retained-store tests remain required. Do not silently
redirect the qualification destination to an empty replacement.

The project-level environment listing returns no variables and zero hidden
production variables. This does not establish the absence of historical
deployment-specific overrides; inspect those when a particular destination is
upgraded. Keep Finance's local SQLite path and browser account selection unchanged
until their independently qualified SDK integration is ready.

Sanitized metadata and executable comparison results are in
`finance-core-inventory.json` and `finance-core-compatibility.json` under the
research artifact directory. No secrets or application records were read.
