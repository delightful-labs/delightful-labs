# Feature Specification: Jazz beta adoption

**Created**: 2026-11-24

**Status**: Beta integration implemented on latest main `9344dff2`. Dependency,
native account admission, worker ownership, expiry/retry recovery and update
handover changes are installed. Unit, app worker/browser, packaged extension,
backup/restore, historical-store and static/build checks pass as recorded below.
The final reproducible broker's offline run exposed a restored-profile capture
observation failure. Its native-query correction is implemented for both list
and pending-content subscriptions; all affected final suites pass. Actual
schema-driven handover passes in both apps, and current-main
local Finance/Clipper data passes exact comparisons and snapshot recovery. The user
excluded the older alpha.60 annotations store from migration; its original and
complete snapshot are preserved. The first hosted qualification found Finance
startup, transfer-feedback and workspace-browser failures; their investigation
and corrective qualification are recorded below. Hosted production, retained
browser profiles and external chunk recovery remain release gates. No production
deployment has been made.

**Input**: Upgrade the Delightful Labs monorepo to Jazz beta, using Jazz as
intended. Behavior changes are acceptable. Earlier implementation choices and
tests included assumptions about Jazz and must not become requirements merely
because we already implemented them.

## Outcome and scope

Finance, Clipper web and extension, and Local First adopt a coherent Jazz beta
release through supported APIs and native lifecycle behavior. The researched
target is `2.0.0-beta.1`, from the active `2.0.0-alpha.67` baseline. Any later
target requires a recorded source/package delta review before adoption.

The feature favors removing custom SDK behavior and unnecessary integration code.
It preserves concrete product outcomes: existing identity and data, private
authorization, offline durability, useful extension capture and truthful write
outcomes. Application runtimes and Jazz sessions remain in workers, as the user
explicitly confirmed after implementation began. Lookup-only guest admission, custom retry
timing and exact patch hooks are not requirements. Any SDK customization still
needs a demonstrated limitation of supported Jazz behavior in that topology.

Keep this feature's requirements, decisions, research evidence, backlog and
implementation status in this spec. Update the sections below as work proceeds.
Source inspection and static checks are not runtime qualification.

Existing root and app feature selectors remain unchanged, following the
cross-project specification precedent. This file does not authorize production
deployment, destructive data operations or changes to unrelated product scope.

## User Scenarios & Testing

### User Story 1 - Keep existing work through the upgrade (Priority: P1)

As a Finance or Clipper user, I can upgrade and continue using my existing account
and data, including work saved while offline.

**Why this priority**: Adopting native behavior must preserve user work and access.

**Independent Test**: Upgrade isolated copies of representative retained stores
and browser profiles, compare exact data and identity, then edit through complete
offline process restarts and reconcile after reconnecting.

**Acceptance Scenarios**:

1. **Given** retained account, schema history and app data, **when** the candidate
   opens the store, **then** the same identity and authorized data remain usable,
   including exact Finance amounts, audit metadata and attachment bytes.
2. **Given** a previously usable local account and cached data, **when** all app,
   authentication and Jazz endpoints are unreachable, **then** a full browser
   restart permits supported offline reads and edits; another full restart
   retains those edits and subsequent reconnect reconciles them.
3. **Given** a failed or incompatible upgrade, **when** opening or validation is
   refused, **then** the original store is preserved and no reset, empty
   replacement store or silent identity replacement is used as recovery.
4. **Given** a write whose remote outcome is unknown, **when** connectivity or
   session state changes, **then** the app distinguishes local durability from
   remote acceptance and does not replay the write automatically.

### User Story 2 - Use native Jazz accounts and authorization (Priority: P1)

As a Clipper user, I can start with a device account and use guest-capable
features without custom account-registration prerequisites.

**Why this priority**: Native admission removes an existing SDK customization
while keeping access decisions in Jazz permissions and explicit domain rules.

**Independent Test**: Exercise guest gateway admission and permission-scoped
requests with new and existing device accounts, backend users and invalid proofs.

**Acceptance Scenarios**:

1. **Given** a valid device proof with no existing registry assignment, **when**
   the guest-capable gateway admits it through Jazz, **then** native account
   creation is allowed and the resulting account has only its authorized access.
2. **Given** a valid device account, **when** a request uses `forReqUser`, **then**
   native permission-scoped device access is allowed; the app does not infer
   backend login from whether that method succeeds.
3. **Given** an absent, malformed, tampered, expired, foreign-audience or revoked
   credential, **when** protected gateway admission is attempted, **then** native
   verification refuses it without exposing private data.
4. **Given** a feature with an explicit provider-identity requirement, such as
   Clipper publication, **when** a caller has only a device account, **then**
   native device admission does not satisfy that separate domain requirement.
5. **Given** accounts A and B, **when** either uses gateway, invitation or data
   operations, **then** permissions and membership rules prevent unauthorized
   access, including stale results after an identity switch.

### User Story 3 - Open, recover and update through native lifecycle (Priority: P1)

As an app user, I can open, recover, sign out and move between app builds without
the app's integration fighting Jazz's session and storage lifecycle.

**Why this priority**: The existing worker, proof and retry patches reflect one
integration design; their mechanisms are not themselves user needs.

**Independent Test**: Exercise the selected supported integration across startup,
expiry, retry, sign-out, multiple tabs and old/new app builds with pending work.

**Acceptance Scenarios**:

1. **Given** normal startup, **when** the app opens its session, **then** ownership
   of the session, broker and storage follows supported Jazz behavior and the app
   exposes accurate local readiness and failure states.
2. **Given** an expired credential or interrupted connection, **when** native
   renewal, retry or reopen runs, **then** recovery preserves identity and durable
   work without additional speculative retry or proof-management infrastructure.
3. **Given** a new compatible app build and an older open tab, **when** Jazz hands
   over the local store, **then** accepted writes are preserved through the
   supported lifecycle, the correct Window can reload, and an older cached build
   does not cause an endless reload cycle.
4. **Given** issued work during sign-out, identity change or shutdown, **when**
   the app releases its resources, **then** it accurately reports settlement and
   cleanup; stopping an actor alone is not proof of native close.

### User Story 4 - Keep extension capture working (Priority: P1)

As a Clipper extension user, I can capture into my intended account through the
supported integration selected for beta.

**Why this priority**: Extension capture is a product capability; its current
direct extension-origin transport is an implementation choice.

**Independent Test**: Run the packaged extension against the candidate web/backend
integration with existing identities and accepted/refused capture requests.

**Acceptance Scenarios**:

1. **Given** an existing connected identity, **when** capture runs, **then** it
   reaches that account and does not silently provision an unrelated identity.
2. **Given** an untrusted origin or invalid identity proof, **when** a request
   attempts capture, **then** the supported request flow refuses unauthorized
   access without wildcard or general opaque-origin admission.
3. **Given** an extension connection during web deployment or reconnect, **when**
   the native lifecycle changes, **then** capture outcomes remain accurate and
   pending work is not duplicated by automatic replay.

### Edge cases

- A socket opens but never answers; local readiness must not imply remote success.
- A retained identity has partial cached data, expired credentials or later
  permission rejection; distinguish unavailable data from an empty result.
- An identity changes A → B → A while earlier work remains in flight; stale
  capabilities and results cannot act as the current binding.
- A previous app build remains cached or cannot be ordered by schema history;
  handle the native wait/refusal outcome without destructive repair.
- Multiple tabs or an extension still hold native resources during close;
  distinguish waiting, actual release and forced disposal.
- Promoting an old deployment leaves a newer Vercel core in place; recovery must
  not depend on deployment promotion being a data downgrade.

## Requirements

### Functional Requirements

- **FR-001**: Active Jazz consumers MUST use one reviewed beta release, including
  Local First's development/peer pins, Clipper's explicit `jazz-napi` dependency,
  matching native/Wasm/worker artifacts and the root lockfile.
- **FR-002**: The integration MUST prefer documented native APIs and lifecycle.
  Each retained patch MUST have a concrete product need, a demonstrated failure
  of the supported integration and a bounded, reviewed disposition. An old test
  or absent custom hook alone is insufficient justification.
- **FR-003**: Guest-capable gateway admission MUST adopt native device-account
  semantics, including account creation for a valid proof, using
  `accountFor(request, { deviceAccounts: true })`. Lookup-only admission is no
  longer a required behavior.
- **FR-004**: Permission-scoped `forReqUser` device access MUST be accepted.
  Feature-specific provider identity and membership requirements MUST remain
  explicit and independently enforced.
- **FR-005**: Jazz MUST verify identity proofs and authorize data access. The app
  MUST NOT substitute decoded token claims for verified native admission.
- **FR-006**: Application/domain runtimes and Jazz session ownership MUST remain
  in workers. Window adapters MUST stay limited to required browser primitives
  and rendering/navigation effects. Reassess extension transport, proof renewal,
  retry and update handover before retaining custom behavior; preserve the
  minimal worker-host bridge where beta cannot supply those primitives directly.
- **FR-007**: Existing identities, recoverable accounts, schema history, exact
  business data and binary values MUST survive the upgrade without resetting or
  silently switching the destination.
- **FR-008**: Supported local reads and durable edits MUST survive full offline
  browser-process restarts and reconcile after connectivity returns.
- **FR-009**: Local durability, remote acceptance, rejection and unknown outcomes
  MUST remain distinct. Unknown writes MUST NOT be automatically replayed.
- **FR-010**: Session changes and close MUST preserve explicit resource ownership,
  settlement and stale-binding protection through the chosen native lifecycle.
- **FR-011**: Production app identities, namespaces, storage paths and regions
  MUST be preserved. The existing Vercel cores require explicit `region: 'iad1'`;
  environment/branch namespace selection MUST keep the same destinations.
- **FR-012**: Tests MUST verify product outcomes and selected native semantics.
  Replace superseded registration, request rejection and topology expectations;
  preserve invalid-proof, permission, durability and data-loss controls.
- **FR-013**: Qualification MUST cover Local First's public packed consumers,
  Finance, Clipper web and the packaged extension. Root website checks alone
  MUST NOT be reported as workspace upgrade qualification.
- **FR-014**: Retained-data upgrade and recovery MUST be rehearsed on disposable
  copies before production. The recovery procedure MUST account for Vercel's
  newest-core behavior and protect the originals.

### Key Entities

- **Device account**: A native Jazz account controlled by a device-held key;
  valid admission may create its registry assignment.
- **Backend identity**: A user verified through application authentication, with
  separate feature-specific provider and membership requirements.
- **Session binding**: The current native account/session resource lifetime;
  observations and operations must not outlive its authority.
- **Retained store**: Existing identity, schema/history, rows and binary values,
  together with the deployment destination and required storage metadata.
- **Patch disposition**: Evidence that a customization is removed, replaced by a
  supported API, deferred with an accepted limitation or narrowly retained.

## Success Criteria

- **SC-001**: Every active consumer resolves the selected Jazz release with
  matching runtime assets; relevant package, type, generation and build checks
  pass, including public packed Local First consumers.
- **SC-002**: Every responsibility in the current patch has a recorded
  disposition. Zero retained customizations are justified solely by historical
  architecture or tests; zero lookup-only gateway patching remains.
- **SC-003**: New and existing device accounts pass native gateway/request
  acceptance scenarios; invalid credentials and unauthorized private-data
  access are refused. Provider-required features retain their explicit checks.
- **SC-004**: Chromium, Firefox and WebKit qualification demonstrates retained
  offline edits through two full process restarts and successful reconciliation.
- **SC-005**: Selected native session recovery, close, old/new build handover and
  packaged-extension capture pass without silent identity replacement, lost
  durable work or automatic replay of unknown writes.
- **SC-006**: Representative retained-store comparisons preserve exact identities,
  row values, financial amounts, audit metadata and binary bytes; a recovery
  rehearsal succeeds on isolated copies without modifying original stores.

## Implementation decisions and boundaries

Worker placement is selected. Extension request flow and any residual patch
beyond the minimum worker-host bridge are design decisions to resolve against
the researched native API, not reasons to build another compatibility layer.
Record the selected design, changed behavior and actual remaining limitations before implementation
qualification. Native retry timing may differ from the old integration.

Existing app-specific financial, provider-secret, publication and identity-switch
requirements still apply. If a concrete requirement conflicts with a supported
native behavior, document the exact conflict rather than assuming either the
old architecture or a weaker product guarantee is mandatory.

Use the B1–B6 backlog below for design, coherent dependency adoption,
implementation review, consumer qualification, retained-data rehearsal and
production review. Existing implementation/test review and release gates apply;
this specification records intended behavior and does not claim those gates
have passed. Do not change active selectors or unrelated shared-workspaces work.

## Out of scope

- Hosting migration, new backend providers or a universal SDK facade.
- Unrelated framework/auth dependency upgrades or new pending-upload UI.
- Account/workspace merging, expanded publication rights or weaker tenancy rules.
- Mechanical preservation of old patches, test assumptions or internal protocols.
- Automatic production deployment, storage resets or destructive rollback.

## Assumptions and evidence limits

The recorded beta.1 source and published package are the design baseline.
Previous alpha qualification is historical evidence, not a beta pass. The local
beta results below establish only their exercised fixtures and environments;
production compatibility and recovery require the remaining retained-data gates.

## Research evidence

The source audit used monorepo `e7b8f5e7de7fc30bae132d8a980e213b0186983b`;
implementation uses the newer main baseline recorded below. Research counts
refer to that audit and are not claims of completed migration.

### Sources and package integrity

- Baseline SDK: [alpha.67, commit 27eb8f5](https://github.com/garden-co/jazz/tree/27eb8f54165460aa397a198466ddc4bc1b0aebda).
- Candidate SDK: [beta.1, commit c73bed9](https://github.com/garden-co/jazz/tree/c73bed9a4e868071f10de490ae3f753f3081772f).
- [Published npm metadata](https://registry.npmjs.org/jazz-tools/2.0.0-beta.1)
  and its tarball were downloaded independently. The tarball's SHA-512 matches
  its registry integrity:
  `sha512-1bMX10i3XyeaUobVg5vBG19NLV3vcVd9iIaWE5TQitCj2MbeT26gwL7QVDYrfu8aGO8e3kpDrFwfpm8eOnMLwQ==`.
- [Upgrade instructions](https://jazz.tools/docs/operating/backups-and-upgrades)
  and the tagged source under `docs/content/docs/operating/backups-and-upgrades.mdx`.
- Historical baseline patch: [alpha.67 patch](../../patches/jazz-tools@2.0.0-alpha.67.patch).
  Historical alpha.60 reconciliation describes its origin, not its current contents.

Temporary inspection material is in `/private/tmp/jazz-beta1-upgrade-research`
(tagged Git checkout) and `/private/tmp/jazz-beta1-package-research`
(metadata, verified archive and extracted published files). These directories
are reproducible research material, not required repository dependencies.

### Dependency and API findings

The coherent active update comprises:

| Manifest | Change |
| --- | --- |
| `packages/local-first/package.json` | Jazz development dependency and optional peer pin |
| `apps/finance/package.json` | Jazz dependency |
| `apps/clipper/apps/web/package.json` | Both `jazz-tools` and the explicit `jazz-napi` dependency |
| `apps/clipper/apps/extension/package.json` | Jazz dependency |
| `pnpm-workspace.yaml` and `pnpm-lock.yaml` | Patch selection, version-specific peer rule and coherent resolution |

The two Clipper experiments still use alpha.60 but are outside the root workspace
package globs. Preserve those historical experiments and vendor archives; they
are not active beta consumers.

The published beta requires Node >=22.18 and still accepts Better Auth ~1.7.22,
Svelte ^5, Vercel Sandbox >=3.9.0 and Vercel Functions >=3.10.0. The apps already
pin Better Auth 1.7.22, Sandbox 3.9.1 and Functions 3.11.0. No related upgrade is
required by these peers. Keep the separate Better Auth provider patch.
Implementation uses the prescribed Node 24.22.2 and pnpm 10.28.0.

All ten `jazz-tools` package subpaths imported by active source remain exported
in the published beta. This checks entry points, not every named export.
Both app schemas already use `s.defineSchema`, auth uses `acceptDeviceAccounts`,
and the shared runtime uses `createJazzClient`. The old schema/auth codemod is
not a prerequisite. Generic `getSession` matches in Better Auth and local helper
callbacks must not be mistaken for the removed Jazz Svelte hook.

A literal scan found 41 `authMode: 'local-first'` fixture values across 25 files:
3 Local First files, 9 Finance files and 13 Clipper files. Update those values
to `device-account`. Neither active app's generated permission JSON contains
`authMode`, and their policy source does not compare it. This removes the
previous assumption that their production policies necessarily need that rename.
Preserve `tier: 'local-first'`, package paths, JWT issuer and wire identifiers.

### Patch disposition

The evidence column identifies differences from our implementation. An absent
hook proves that our current integration cannot run unchanged; it does not prove
that Jazz needs that hook or that we should port its patch. Worker ownership is selected; other custom behavior still requires a
demonstrated product need.

| Responsibility | Beta evidence | Planned disposition |
| --- | --- | --- |
| Dedicated-worker browser detection | `runtime/client.ts` still requires Window/document; `runtime/db.ts` and `default-runtime-source.ts` still require Window/Worker. | Keep session ownership in the application worker. Retain the minimum browser-worker runtime detection required by this confirmed topology. |
| Window-owned SharedWorker creation and generation storage | `RuntimeSourcesConfig` has no `browserWorkerHost`; broker creation directly calls `new SharedWorker`; generation directly uses `localStorage`. Session option validation still excludes only the existing internal port/session fields before checking cloneability. Published declarations and JS agree. | Keep the existing narrow Window host for open/readGeneration/writeGeneration. A six-file beta platform patch supplies that missing boundary while Jazz retains storage and generation policy. |
| Fresh proof when joining an existing broker | `acceptPeer` still takes claims, epoch and identity, then uses `this.selfSignedClientProof`. `connectTab`/`attachTab` do not retain the joining proof for that call. | The worker/origin-only patch failed fresh-tab admission after the owner proof expired. Forward the joining tab's proof while pinning app, author and peer identity; native signature/expiry checks remain authoritative. The unchanged expiry/refusal cases now pass. |
| Retry without requiring remote sync | `session/state.ts` still routes replacement through `stopPastRefusal`, which starts with `shutdown({ waitForSync: true })`. The exact alpha.67-to-beta diff does not change this branch. | The native visible retry failed with `GracefulShutdownSyncError` through an expired proof. For explicit retry only, close with `waitForSync: false` to flush locally before replacement. Other shutdown/sign-out behavior stays native. Expired, forged, foreign-audience and identity-mismatch recovery cases pass. |
| Explicit Chrome extension origins | Backend settings still take `new URL(origin).origin` and reject `null`, which Node returns for Chrome extension URLs. | Retain the existing bounded origin fix for the current worker/extension transport: beta rejects the explicitly configured Chrome origin during backend configuration. Restrict admission to the configured 32-character extension ID; qualify native transport and refusal controls. |
| Resolve a registered device account for gateway admission | Beta adds `accountFor(request, { deviceAccounts: true })`, but calls `deviceAccountOf`, then admin `found-local-first`, rather than lookup-only `resolve`. | Adopt the native option, including its account-creation behavior. Remove lookup-only SDK patching and replace the obsolete unregistered-proof rejection expectation with native admission and permission-isolation coverage. |

Primary source boundaries:
[runtime context](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/context.ts),
[broker connection](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/native-runtime/browser-shared-worker-connection.ts),
[native admission](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/native-runtime/native-runtime-adapter.ts),
[broker core](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/worker/jazz-broker-worker-core.ts),
[session replacement](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/session/state.ts),
[backend requests and origins](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/backend/create-jazz.ts).

This disposition first tried the supported lifecycle with only the required
worker/origin bridge. The two retained recovery changes follow the concrete
browser failures recorded below. The broker bundle was rebuilt from beta modules
with those changes and checked against the matching beta WASM; the old alpha
bundle was not transplanted.

### Native account semantics

The gateway now opts into `accountFor(request, { deviceAccounts: true })`.
Beta's `deviceAccountOf` invokes `found-local-first`; the registry's
`FoundDeviceAccount` operation calls `register_inner` if no assignment exists.
See the [pinned registry implementation](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/crates/jazz/layers/types/src/account_registry.rs).
The old unregistered-proof rejection expectation must change. Native
`forReqUser` device access is also accepted; publication's explicit Better Auth
and linked AT Protocol identity checks remain separate.

### Update handover and retained data

Beta orders builds by schema history, drains accepted local writes, releases the
store and invokes `onNewerBuild`; its default reload and loop marker require
Window `location` and `sessionStorage`. Use the supported callback through the
existing worker/Window lifecycle. SDK build ordering and draining stay native.
See [handover](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/connection-manager/browser-connection-manager.ts)
and [reload behavior](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/newer-build-reload.ts).

Vercel's startup script retains the highest core version seen by its Drive and
removes older native addons. Promoting an older deployment does not downgrade
that core. The upgrade guide has no supported Vercel core backup/export workflow;
revisit historical Finance snapshot-reader techniques only on isolated copies.
Preserve namespaces, app identities, SQLite paths and `iad1`. Rehearse recovery
with complete SQLite/large-value snapshots and isolated chunk storage before
production. Use the documented detach procedure where copies run alongside
originals. See the [Vercel store source](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/backend/vercel-store.ts).
The four original Finance save workflows now pass unchanged on beta, as recorded
below. Their intermittent historical failures remain unresolved; passing workflows
and generic transaction fixes do not establish a root-cause fix.

## Implementation status

Started November 24, 2026 on `feat/jazz-beta-upgrade`, based on freshly fetched
`origin/main` `9344dff27b0cf41e79750d0e3a7564a7e85a66da` (PR #55), in
`/Users/matt/Projects/delightful-labs-jazz-beta`. Main's shared workspace
resource/seed owners and app binding changes are included. Unrelated work in the
original checkout and all user servers/data are preserved. After reviewing the
completed 74-file diff, the user explicitly authorized committing it, pushing
`feat/jazz-beta-upgrade` and opening a draft PR to main on November 24. That
authorization covers publication for review; merge and production deployment
remain separately gated. The review description is maintained below.

### Implemented

- Updated the four active manifests and Local First peer, including Clipper's
  explicit `jazz-napi`, with the coherent root lockfile. No unrelated package
  records changed and no active alpha Jazz package remains in that lockfile.
- Replaced the alpha Jazz patch selection with the beta worker bridge, bounded
  Chrome extension-origin fix and demonstrated proof/retry recovery fixes;
  removed the redundant Better Auth peer allowance. Kept the separate provider
  patch and historical Jazz patch file.
- Added `region: 'iad1'` to both Vercel store configurations without changing
  namespace functions, app identities or storage paths.
- Adopted native device-account admission in the guest gateway.
- Derived Clipper's runtime/cache asset version from installed SDK metadata,
  replacing its stale alpha.60 constant.
- Wired `onNewerBuild` into Finance and Clipper worker owners. Update intent
  travels through their existing clean-close progression; only terminal clean
  output requests Window reload. Competing shutdown/navigation is not overridden.
- Added a Window-only reload primitive on the existing public broker subpath.
  It records the old immutable worker URL in session storage to prevent cached
  old-build reload loops and reports refusal/failure to the existing UI owner.
  When session storage is unavailable it follows Jazz's best-effort reload
  behavior; it does not add another persistence or retry mechanism.
- Updated native gateway expectations: default account lookup stays signed-in
  only, opt-in lookup and `forReqUser` support device accounts, and a valid new
  device proof may create its account while invalid proofs remain refused.
- Migrated 44 device-auth fixture values across 25 files on the latest-main
  baseline. The earlier source-audit count was 41 before PR #55's added coverage.
- Added nine focused handover checks: three per application owner and three for
  the Window reload effect. They cover acknowledged close, failed close,
  competing close, cached-build loops and unavailable storage/reload effects.
- Qualified actual SDK schema-ordered handover through both application workers
  in Chromium, Firefox and WebKit. Finance holds an accepted archive operation
  before release and verifies exact ledger rows/identity after reload. Clipper
  retains a saved URL through its real worker/client. Both exercise a delivered
  descendant build and a cached old build bounded to one reload. Clipper's
  `test:worker` entry point now includes this native handover suite.
- Removed the Finance session-retry capability when reload is refused after the
  worker has already closed. The UI no longer offers an unusable retry command;
  the native cached-build cases verify this state.
- Updated the existing upgrade harness to beta. Replaced its removed private
  upgrade helper with exact native alpha.67/beta schema compilation and permission
  comparison, including relations and binding-source identity. Historical
  alpha.60 stores and archives remain independent inputs. Its packed application
  fixture uses the current app's installed dependencies, existing provider patch,
  chart peer declarations and standalone page-adapter types.
- Updated retained readers to compare the current alpha.67 app with beta on
  scratch copies, preserving each snapshot's local blob mode and using its app's
  copied schema files for native source checking. Added disposable-copy recovery
  with a committed beta write/reopen followed by exact baseline snapshot restore.
  External blob snapshots are refused until complete local materialization is available.
- Fixed three untyped callback parameters in two Finance component tests found
  by the full standalone TypeScript check; that check now passes.
- Added a read-only, reproducible broker verifier using the exact pinned upstream
  WASM/ABI checker and installed SDK dependencies. Review found that the first
  rebuild retained working-directory-relative module names inside lazy
  initializers. Identifier minification in the first bundling pass removes that
  machine-dependent metadata. The final broker matches across working directories
  and all four installed consumers; its readable SDK changes remain the same.
- Replaced the upgrade fixture's stale alpha.67 README with a pointer to this spec.
  Commands and current decisions remain here; historical research remains linked.
- Corrected article-list and pending-content subscriptions to use native capture-rooted required
  includes after a restored-profile failure proved that reverse capture metadata
  can arrive later than its document. Two real-native cases cover continued
  observation and malformed capture refusal; the old query fails the new
  late-metadata regression. Record guards, schemas and permissions are unchanged.

### Review scope

PR title: **`feat(jazz): adopt beta.1 with worker-owned sessions`**.

Finance, Clipper web/extension and Local First move from alpha.67 to beta.1 while
keeping domain runtimes and SDK sessions in workers. Clipper now uses native
device-account admission, including valid new-device creation. Both apps close
their existing owners before reloading for a schema-ordered newer build, with a
per-worker-build marker bounding cached-old-build reloads. The retained SDK patch
is limited to the demonstrated worker-host, extension-origin and proof/retry gaps;
the generated beta broker is reproducible from its readable modules.
Clipper's live list and pending-content queries now start from capture metadata
and use required forward
includes, so a document arriving before its reverse metadata does not permanently
end observation. Existing scope and record checks remain enforced.

Review includes exact schema/history preservation, matching SDK/native/WASM
artifacts, packed consumers, the listed unit/native/browser/offline/extension
checks and real current-main local-store comparison/recovery. The separate
alpha.60 annotations store is excluded and preserved by explicit user choice.
The original four Finance save workflows pass unchanged; their intermittent
historical failures are not claimed fixed. No financial mutation/replay policy,
production destination, active feature selector or unrelated shared-workspaces
work is changed.

This is the review description, kept here as the single feature record. Hosted
CI/preview results must be collected after publication; local verification does
not establish production acceptance. Production rollout remains separately gated
by the retained hosted-store/profile/chunk evidence and authorization below.

### Selected worker boundary

| Realm | Responsibility |
| --- | --- |
| Window | Rendering, SharedWorker creation and generation storage through the narrow host; reload/navigation effects. |
| Application worker | Jazz session, native app bindings, domain actors, queries, transactions, validation and projections. |
| Jazz broker SharedWorker | Jazz-owned durable replica, cross-tab coordination and upstream sync. |

### Restored-profile capture observation correction

Final-artifact qualification reproduced a list failure after a complete offline
restart and reconnect. Temporary, sanitized record-boundary probes isolated
`record.capture:too_small@captures` on the restored profile. Its document had
arrived while the reverse capture relation was still empty. The app's
`captureDocumentRecord` requires one capture row; throwing from that subscription
callback permanently ended the existing article-collection observer. This is an
application query/projection assumption, not evidence that broker minification
caused the failure or that Jazz refused the account.

The list owner remains the existing article-collection machine and subscription;
the pending-content owner remains the existing article-worker host.
Select from native `documentCaptures`, including its document with
`requireIncludes()`, rather than assuming every locally observed document already
has its reverse capture metadata. Before that metadata arrives the native query
has no eligible captured document; subsequent native updates publish the record
through the same observer. This is local availability, not global absence, and
does not trigger initialization, repair, a write or a remote preflight.
Apply the same capture-rooted query to `subscribePending`, keeping its native
document `attachmentId: null` filter. Metadata arrival admits pending content;
successful content attachment removes it through the native query update.

Keep the complete document/capture projection and all identity, scope, canonical
capture-link and malformed-record validation. No retry layer, guessed metadata,
schema/history edit or permission relaxation is selected. The native SDK's
required-include behavior filters unresolved non-nullable forward references;
it does not make reverse relations complete. See the
[pinned include documentation](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/docs/content/docs/reading/includes-and-relations.mdx)
and [query translation](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/query-adapter.ts).
Qualification must exercise a real document-before-capture interval and the full
unchanged production offline/reconciliation case. Diagnostic-only source probes
are restored after building and are not included in the implementation.

The selected query is implemented in `queries.ts` and the existing article-list
subscription. Native policy-test coverage passes for a document inserted before
its capture row: the observer publishes no eligible captured rows, then publishes
the valid record after a separate native metadata commit. Reinstating the old
query makes that exact regression fail. The same native case now observes both
list and pending-content subscriptions, then completes content through the real
save machine and verifies that the pending query empties while the list remains
readable. A second native case still refuses a
capture whose identity does not match its document. All four existing projection
guards remain unchanged. Final Clipper types pass with zero Svelte warnings;
all 1,029 unit, 34 component, 33 worker, six handover, 12 production-offline and
12 packaged-extension cases pass. The full 68-case historical/schema fixture also
passes with the final queries and expanded arrival/completion regression.

The installed [beta patch](../../patches/jazz-tools@2.0.0-beta.1.patch) changes
12 SDK files: six worker-platform files, one backend origin-normalization file,
two peer-admission files, the session retry module, broker core and broker bundle.
The bridge
adds worker runtime recognition; declares the existing `browserWorkerHost`
primitives; awaits host-created ports and generation operations; and excludes
live functions/handles from configuration cloning and broker messages. It retains
late-port cleanup and SDK-owned generation selection. There is no Window-host
migration, domain data proxy or worker-rule exception.

The seventh file admits only an explicitly configured Chrome extension origin:
32 lowercase characters from `a` through `p`, no credentials, query, fragment or
non-root path. Other opaque origins and wildcards remain refused. It does not
change authentication.

The remaining five files forward the joining proof, retain native verification
and identity/audience fences, flush locally for explicit retry, and ship the
matching rebuilt beta broker. Backend account admission is unpatched. All 12
installed files match across the four SDK consumers. Native WASM instantiation
and the minified broker's WASM ABI checks pass.

### Verification

Node 24.22.2 and pnpm 10.28.0 were used. The user's subsequent instructions to
continue implementation and complete larger slices authorize the implementation
and verification reported here. No release authorization is inferred.

| Check | Observed result |
| --- | --- |
| Root install and dependency graph | Final `pnpm install --frozen-lockfile --ignore-scripts` passes. Coherent beta.1 graph with no active alpha Jazz dependency or unrelated package-record changes. Existing unrelated layerchart/runed peer warning remains. |
| Patched artifact comparison | All 12 patched files match across Local First, Finance, Clipper web and extension. The maintained read-only verifier rebuilds the broker byte-for-byte from readable modules, independent of working directory, using pinned upstream actual WASM instantiation and minified ABI checks. Its optional output refuses an existing file without changing its bytes. |
| Library packaging and public packed consumers | UI/Local First package generation and publint pass. Final Local First `check:consumer` passes public declarations, backup readers, archive cases, native ports and ES-module worker execution/builds. |
| Workspace identity | `pnpm monorepo:check-links` passes across all consumers. Final fetch confirms `origin/main` remains `9344dff27b0cf41e79750d0e3a7564a7e85a66da`. |
| Native generation | Finance and Clipper `generate --check` pass; generated application schemas, permissions and binding files are unchanged. |
| Final static checks | Local First library strict TypeScript, Finance app/service-worker/standalone TypeScript, and Clipper coordinator/web/service-worker/extension checks pass. App Svelte checks report zero errors/warnings. |
| Full unit suites | Local First: 1,362 cases in 66 files; Finance: 1,849 in 140; final Clipper: 1,029 in 155. Total: 4,240 passing cases, including nine handover cases and two native capture-observation regressions. |
| Clipper component suite | 34 cases in seven files pass. |
| Finance native application-worker browser suite | 84 cases pass across Chromium, Firefox and WebKit, including six actual schema-driven handover cases. |
| Packed Finance application | Historical upgrade 200, native bindings 69 and application-worker 84 cases pass in the isolated packed fixture. Its 1,298 app input files match current source; the standalone service-worker configuration is the intentional fixture override. |
| Finance native worker bindings | 69 cases pass across the three browser engines; test TypeScript also passes. |
| Clipper native worker suite | Combined `test:worker` passes all 33 existing worker cases plus six actual schema-driven handover cases across the three engines. Covers broker-owner proof expiry, refused proofs, visible retry, late-port cleanup, resource release, descendant delivery and cached-old-build loops. |
| Clipper production offline suite | Final implementation: all 12 cases pass, including source edits through complete offline restarts, HTTP-cache-cleared readers with endpoints down, existing/restored/expired identities, shell updates, native annotations and restored-profile reconciliation. The captured reverse-metadata failure is corrected by native query selection; no original assertion or timeout was weakened. |
| Packaged Clipper extension | Build and all 12 Chromium cases pass, including offline capture/browser restart, explicit restoration, hostile messages, stale account connections and repeated settings teardown. |
| Production builds | Final Finance production build passes locally. Both Clipper production offline builds pass with the Netlify adapter; the extension test build passes. Subsequent preview evidence is recorded below; no production deployment occurred. |
| Native backup/export | All 20 cases pass. |
| Backup/restore | All 72 functional cases pass; seven existing opt-in performance measurements are skipped. Exact fields, relationships, full object sets and attachment bytes are covered. |
| IndexedDB account store | Packaging/types and all 60 native browser cases pass. |
| Historical Finance upgrade | Updated schema harness passes all 200 cases. Actual alpha.60 native records and v1 archives open under beta, with exact amounts/identity/attachment assertions and native close/reopen writes. |
| Historical Clipper upgrade | Final schema harness passes all 68 cases, including historical production-schema migration, retained reading state and both capture-observation regression cases. |
| Native schema identity | Alpha.67 and beta compile identical current schemas, complete histories, migrations and transforms for both apps; generated permission tables match exactly. Historical alpha.60 schema hashes remain in their histories. |
| Retained-reader fixture rehearsal | Three disposable destination fixtures pass exact comparison across all 29 Finance tables, audit fields, identity and 1,048,583 attachment bytes each. Both default file-backed and SQLite-backed blob stores pass. Every source snapshot byte remains unchanged. Destination names are fixture labels, not production/preview qualification. |
| Retained-reader refusal controls | Unsupported external blob storage and missing file chunks are both refused. Source snapshots remain byte-identical, and temporary scratch stores/HMAC keys are removed after failure. |
| Original Finance save workflows | All four unchanged Playwright cases pass on beta, with zero retries: imported expense/income edits offline with exact provenance/tag assertions; income check edit plus both account IDs; workspace rename/reload followed by USD → TZS save/reload and an account using that default. Traces retained. Historical intermittent failures remain unresolved. |
| Actual current-main retained Finance | Exact identity and all 29 tables/37 rows, including all four audit fields, match alpha.67 and beta. This store has no binary cells. |
| Actual current-main retained Clipper | Exact identity and all 22 tables/28 rows, audit fields and three binary cells totaling 121,582 bytes match alpha.67 and beta. |
| Actual local recovery | Both main stores pass a committed beta probe write and reopen, then exact identity/rows/audit/binary recovery under alpha.67 from a fresh copy of the untouched snapshot. Snapshot bytes remain unchanged; scratch stores and HMAC keys are cleaned up. |
| Older annotations store | Its alpha.67 baseline open refuses a disconnected migration graph; pinned beta native schema diff also refuses the required/optional column change. User selected preservation rather than migration. Complete snapshot, schema, permissions and pinned alpha.60 runtime metadata are preserved privately. |
| Shared-lockfile regressions | UI static check and 131 unit cases pass. Website static check, 152 unit cases, production build and built-route/feed/sitemap verification pass. |
| Changed-file quality | Existing per-project formatters and Local First/Clipper lint pass. Staged source/docs pass whitespace checks; the generated SDK patch applies to the pristine beta tarball with `--check --whitespace=error-all`. Local spec links, shared guidance and all 23 monorepo tooling cases pass. |

The initial seven-file worker/origin-only patch passed 28 Clipper worker cases
and failed five expiry/refusal-recovery cases. A new tab could not join after
the broker owner's proof expired (`token expired`), and visible retry failed with
`GracefulShutdownSyncError` while demanding remote sync through that expired
proof. These actual failures justify the bounded proof forwarding and retry
changes. The rebuilt final patch passes all 33 unchanged worker cases; no
refusal checks or timeouts were weakened. Earlier offline runs alternated between
11/12 and 12/12; passing did not establish that the SDK patch fixed reconciliation.
Final-artifact qualification reproduced the failure and isolated missing reverse
capture metadata. The native capture-rooted list/queue queries address that observed
application assumption; the final unchanged offline suite passes all 12 cases.

One backup/restore run had 71 passes and one page-context failure because a
concurrent library packaging command caused Vite to reload the fixture. After
packaging finished, the unchanged isolated suite passed all 72 functional cases.
Earlier listener restrictions were resolved using disposable listener access.
Neither environment correction is reported as a product fix.

Historical-store harness qualification exposed its obsolete private
`dist/upgrade/index.js` import. The replacement invokes each SDK's native
`schema compile` and compares the complete results; it does not invent a hash
model or rewrite migration history. Retained-reader qualification also exposed
a forced SQLite blob setting. The reader now preserves `files`/SQLite mode,
including the native rule that no blob-store record means SQLite, and refuses
unsupported external/custom blob layouts before opening them.

The packed application fixture also needed its existing Faker, Better Auth and
chart dependencies plus the unchanged provider patch and root chart peer
declarations. Its standalone SvelteKit page adapter now has the correct shallow
URL type, and its test shell derives the route store reactively. These changes
correct fixture packaging/types; no product diagnostic or assertion was disabled.

The following remain unqualified: hosted Vercel production stores, retained user
browser profiles and complete external chunk-store
recovery. The known intermittent Finance unknown-save failures remain unresolved,
although their four original workflows pass unchanged on beta. The real local-store
comparisons/recovery and disposable browser fixtures qualify their recorded scope;
they do not establish hosted production or retained-profile recovery.

## Implementation backlog

| Order | Work | Completion evidence |
| --- | --- | --- |
| B1 | Design the smallest supported Jazz integration: adopt native gateway/account semantics; preserve worker ownership with the minimum browser host, then assess extension flow, proof renewal and retry. Trace each proposed retained constraint to a product need rather than an old patch/test. | Reviewed architecture and behavior changes, removal candidates, and concrete evidence for any remaining SDK limitation. |
| B2 | Prepare the beta integration on an isolated feature branch/worktree; update the four manifests, native pin, root patch/peer configuration and lockfile coherently. Update fixture auth modes and add the two explicit regions. | Diff shows only necessary compatibility work; generated schema/migration identity and native dependency versions are recorded. |
| B3 | Review the concrete implementation before adding/running its implementation tests, following the workspace test gate. | Reviewed SDK/app changes and the exact selected regression cases. |
| B4 | Qualify shared integration, then Finance and Clipper including extension. | Matching SDK/Wasm/native/broker artifacts, packed consumers, actual persistent offline browser restarts, identity preservation, native expiry/retry, close/cancellation, valid new-device gateway admission, invalid-proof refusal, new/old build handover and permission isolation. Obsolete implementation-specific expectations are replaced. |
| B5 | Rehearse retained-store upgrade and recovery on disposable copies; verify preview destinations. | Exact row/amount/audit/attachment comparisons; recovery demonstrated without relying on deployment promotion. No original data modified. |
| B6 | Review rollout evidence and obtain production deployment authorization. | Same production namespace, app identity and region; coordinated backend/browser/extension compatibility and explicit recovery procedure. |

Current progress: B1–B2 are implemented, including native account behavior and
the minimal worker/recovery patch supported by actual negative controls. B3's
continued implementation/verification is authorized by the user's subsequent
instructions. B4 passes the selected local suites, including actual schema-driven
handover in both apps, native capture-metadata arrival, persistent offline restart
and restored-profile reconciliation, and packaged extension checks. B5's
current-main local-store comparisons and snapshot recovery are complete with
explicit snapshot authorization. Preview project/namespace/region, private worker
transport and fresh-profile save/reload checks pass. Production destinations,
retained browser profiles and external chunks remain open. The user explicitly
excluded the older annotations store's migration. B6 has not started; production deployment
is not authorized.

The implemented update-handover path uses these existing owners:

| Owner | Selected event and progression | Completion/failure rule |
| --- | --- | --- |
| Finance application worker | SDK `onNewerBuild` reports an update intent to the application machine; reuse its CLOSE → domain drain → session/account-store/broker close progression. | Request Window reload only from acknowledged clean completion; failure stays visible. |
| Clipper realm host | SDK callback reports update intent to the host; reuse SHUTDOWN → application/surface drain → acquisition settlement → session/store/broker close. | Publish reload only after the host's clean terminal result, including extension-host consumers. |
| Window | Perform the selected reload effect and keep a per-build loop marker in session storage. | An unchanged cached old build must not reload indefinitely; the SDK's Window-only default cannot be invoked from the application worker. |

Keep update intent in the owning machine, preserve identity/binding correlation,
and refuse new domain work during release. Do not reload directly in the SDK
callback or hide shutdown orchestration in a promise. The owner handlers accept
update intent only while running/accepting, record
the old worker build in machine context, and reuse existing close events. Nine
dedicated owner/effect cases pass, covering acknowledged/failed/competing close
and reload-loop/failure behavior. Twelve additional actual schema-driven browser
cases pass across both apps and all three engines, including cached-old-build
loop prevention and data preservation through native release/reload.
These fixtures use two schema-ordered beta builds. They do not establish live
alpha/beta application-worker coexistence or rollout of a retained user browser
profile. The separate native wire/account-store evidence below covers a narrower
mixed-version path; browser/extension rollout remains unqualified.

Remaining release work:

1. Qualify hosted production and preview destinations on authorized complete
   snapshots, including every external chunk, and rehearse their recovery without
   relying on an older deployment/core. Local file/SQLite recovery is complete.
2. Qualify representative retained user browser profiles through the coordinated
   backend/browser/extension rollout. The disposable browser and packaged-extension
   suites already pass; retained user profiles have not been opened or modified.
3. Preserve Finance's existing unknown-outcome protections and failure diagnostics.
   The four original workflows have passed on beta without retries; keep the
   intermittent issue open for actual error evidence rather than repeating green
   runs or inferring a fix.
4. Review deployment compatibility, same namespace/identity/region and the complete
   recovery evidence before requesting production authorization. Migrating the
   excluded alpha.60 annotations experiment requires separately scoped work.

### Hosted PR qualification and corrections

Draft [PR #56](https://github.com/delightful-labs/delightful-labs/pull/56) was
opened from `feat/jazz-beta-upgrade` at `743c6926`, after the user's explicit
commit/push/draft-PR authorization. Main was fetched again and remains `9344dff2`.
The first hosted runs passed all Foundation and Clipper jobs, including Local
First consumers/browser qualification, UI, website, Clipper web, packaged
extension, workers/offline/sample data and tooling. Finance's types/unit/build,
PWA, restore, feature flags, authentication, permissions, application-1 and
presentation passed. Application-2 failed two unlink-feedback assertions;
startup failed one stalled-connection save; workspace failed three account cases.
These failures remain qualification evidence, not green checks inferred from
local runs. The original artifacts were retained and inspected before changes.

The stalled-connection test reproduced with its unchanged 15-second success
assertion. Temporary stage-only diagnostics showed the edit stopped at its
transaction reads, before commit. Beta's published `ReadTierOptions` and
`resolveEffectiveQueryExecutionOptions` document a five-second initial remote
preference for implicit browser reads; explicit `local-first` reads default to
zero initial remote wait. The ordinary save's transaction-local edit/tag/check
reads now select this supported option explicitly. See the
[pinned SDK read-option lowering](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/packages/jazz-tools/src/runtime/client.ts).
Transaction ownership, eligibility checks, atomic writes, local durability and
later rejection tracking are unchanged. The original stalled-connection scenario then passed, as did its
17 persistence unit cases. The complete seven-case production-startup suite also
passes, including full browser restart, silent established/new connections,
offline saves, later authority rejection and retained bank history. No SDK patch
or timeout increase was introduced.

The unlink artifacts showed the transaction already unlinked and the suggestions
panel absent. Its existing machine retained `transferSaved`, but the component
hid the panel whenever the editor became `unselected`. Keep the machine's
selected feedback visible even after linked-only controls disappear. Both
original failing browser scenarios pass with their success and persistence
assertions intact. No new copy or domain state was added.

Account permissions passed sequentially, then reproduced a timeout under the
hosted two-worker setting. Full sanitized machine diagnostics distinguish the
expected member `partial/profileLink` assessment from an SDK exception: all
three record counts were one and no error was present. The shared selection
helper always dispatched `selectOption`, including an already-selected workspace,
then accepted an already-matching URL without waiting for the resulting history
commit. It now avoids that artificial same-value change event and, when a change
is needed, waits for its actual main-frame navigation commit. The unchanged five
permission scenarios pass with two workers, as do all 55 cases in the complete
workspace scope. All 1,849 Finance unit/native cases pass again with disposable
listener access. A sandboxed run could not bind its native fixture listeners;
it was stopped and diagnosed before the permitted run. This does not establish
a cause for every earlier save or browser teardown failure. Account cases retain
sanitized diagnostic attachments.

Both Vercel deployments are READY previews for the exact PR head and verified
project/team. Runtime logs show `iad1` and native namespace
`preview-feat-jazz-beta-upgrade-ed86022e`, separate per project. Existing private
CLI OIDC authentication supplies the documented Trusted Sources header. The
connector's share-link operation was rejected by automatic approval review
because it would grant publicly shareable access; no such link was created and
no protection or Trusted Sources setting was changed. The installed native CLI
misparsed `env run` child arguments, so its installed JavaScript CLI was used.
Fresh disposable browser profiles and origin-restricted requests were used.

Browser context headers did not reach Jazz's SharedWorker WebSocket: observed
handshakes returned protection's 302 while account HTTP responses were 200.
Applying the same private authentication to the verified same-origin worker via
CDP produced 101 handshakes, Finance's Overview and Clipper's Saved articles with
`Private library synced.`. Hidden sidebar controls and an incorrect generic
Library heading were corrected in the temporary verification harness. These were
harness failures, not app fixes. Keeping a debugger attached also kept the old
broker alive during a hard navigation and prevented a normal reopen. Detaching
after the authenticated handshake restored native worker lifetime. With that
harness correction, a synthetic Finance account save/reload and a Clipper
example.com capture/reload both passed. Clipper's real resolve/extract API
responses were 200 and each reopen negotiated a new 101 connection. No page
exceptions or foreign-origin requests were observed. These preview checks used
new disposable identities; the profiles were removed. No user browser or
production store was used. This is hosted startup/transport and fresh-profile
write/reload evidence, not complete production or retained-profile qualification.

The corrective source commit is `995f80c798fa6794b6efa48a5bb773328cc73b1f`.
Its Finance preview `dpl_71Uc64c7A4DNjy8j4Jp2uhY9zJgv` is READY in `iad1` for
`prj_XRyQmkRAdDV2xUZGPeXcFBSfgHVa`; its new disposable identity also passed account
save and hard reload with three authenticated 101 connections and no page errors.
Clipper source was unchanged by that commit; its qualified preview remains
`dpl_F489SGH4T4d3Yw1bNNjr44BfzViy`. Unaffected Clipper/website rebuilds were
canceled by the existing deployment selector. Current hosted evidence is linked
from the [PR checks](https://github.com/delightful-labs/delightful-labs/pull/56/checks).
After that source commit, this spec was reconciled and the test-only diagnostic
collector was hardened to settle console-handle failures immediately if its
worker disappears. Product code, dependencies and schemas are unchanged. The
collector preserves partial diagnostic results without an unhandled rejection.
Test TypeScript and the five permission cases with two workers pass after that
test-only change. On the corrective source commit, Foundation and Clipper have
passed again; Finance's hosted startup and complete workspace scopes also pass.
All 18 Finance jobs on corrective source `995f80c7` ultimately reported success,
including the last application-2 shard's 87 cases. The complete same shard also
passed locally with CI's two-worker setting (87 cases, 2.3 minutes), including
the original unlink assertions and imported offline edits. The hosted shard took
11.2 minutes. Its run was superseded and the overall workflow was marked canceled;
individual job conclusions and logs were verified through both the connector and
GitHub's API before reporting these passes. A planned cancellation refused that
already-completed run; only two obsolete documentation-head workflows were
explicitly canceled. The final head's CI refresh remains separate evidence in
the linked checks. No canceled or queued check is reported as passing.

Head `1af09e3b` subsequently completed all three hosted workflows successfully:
Finance (18 jobs), Clipper (six jobs), and Foundation (four jobs), plus PR-title
checks. This is exact-head hosted evidence, separate from the earlier superseded
workflow. Main was fetched again and remains `9344dff2`.
The subsequent native mixed-version fixture head `119df554` also completed all
three workflows successfully: Finance (18 jobs), Clipper (six jobs), and
Foundation (four jobs), plus PR-title checks.

### Native mixed-version wire and account-store qualification

The mixed-version investigation uses the existing prepared
alpha.67/beta.1 Finance readers, their exact current schema and permissions, and
matching published SDK/native versions. The maintained
`apps/finance/tests/worker-upgrade/mixed-version.mjs` starts a disposable beta core
and two separate Node client processes through public `createJazzClient`,
`localFirst: 'now'`, AccountStore and database APIs. No administrative credential
is given to a client; the SDK test authority seeds and revokes access.

All three scenarios pass against the unchanged Finance policy:

| Session path | Native identity setup | Observed result |
| --- | --- | --- |
| Backend users | Separate users enrolled by the beta test backend; each SDK uses its documented bearer callback. | Both versions remain active, exchange accepted edits and observe identical fields and all four audit values. |
| Device accounts | Each SDK creates its own device account through the beta gateway, using an explicit test-only memory AccountStore. | Both versions read/write the shared authorized workspace; alpha's offline local edit reaches beta after reconnection. |
| Retained alpha device account | Beta receives the exact opaque AccountStore record produced by alpha, without a manual metadata or key conversion. | Beta retains alpha's account ID; both active SDKs exchange edits, reconcile the offline edit, and refuse writes after their shared membership is revoked. |

Every scenario verifies global acceptance, an offline edit remaining local until
reconnection, later cross-version readback and permission refusal without
changing the stored memo. Removing actual membership revocation makes the native
negative control fail with `Missing expected rejection`; the passing source is
restored byte-for-byte afterward. Each SDK session and child process closes and
the disposable core stops before success is reported. The final three-scenario
run completes with no remaining fixture process.

The first probe incorrectly supplied a bearer string instead of the documented
callback and was refused by the SDK. A later fixture-cleanup attempt awaited a
child `close` notification that did not settle after IPC disconnection; awaiting
the actual child exit corrected it. These are fixture corrections, not product
or SDK changes. The probe uses no new dependency, application behavior, SDK patch,
original store, user browser profile or persisted test key. AccountStore values
stay opaque and transient; logs contain versions and comparison booleans.

This establishes native wire/account metadata compatibility for the current
Finance schema with a beta server and these two SDK versions. It does not
qualify Clipper's full document/blob graph across versions, a persistent browser
replica, application-worker/broker handover, installed extensions, original user
profiles or complete hosted/chunk recovery. Those release gates remain open.

The maintained fixture commands run from `apps/finance`:

```sh
node tests/worker-upgrade/run.mjs --schema
node tests/worker-upgrade/run.mjs --clipper-schema
node tests/worker-upgrade/run.mjs --worker
node ../../scripts/jazz/verify-beta-broker.mjs /path/to/jazz-source-checkout
node tests/worker-upgrade/retained-prepare.mjs /path/to/qualified-finance-artifacts
node tests/worker-upgrade/retained-prepare.mjs /path/to/qualified-clipper-artifacts --clipper
node tests/worker-upgrade/mixed-version.mjs /path/to/prepared-finance-readers
node /path/to/prepared-readers/retained-compare.mjs /path/to/snapshots finance
node tests/worker-upgrade/retained-recovery.mjs /path/to/finance-readers /path/to/snapshots finance finance
node tests/worker-upgrade/retained-recovery.mjs /path/to/clipper-readers /path/to/snapshots clipper-main clipper
node tests/worker-upgrade/inspect-retained-drive.mjs /path/to/read-only-mounts preview
node tests/worker-upgrade/retained-recovery.mjs /path/to/finance-readers /path/to/copied-preview-snapshots preview finance beta1
```

The prepared `retained-compare.mjs` uses separate scratch copies for alpha.67 and
beta.1, with the same current app and a temporary HMAC key. It prints comparison
booleans/counts rather than rows, credentials or digests and removes scratch
copies/key on completion. It requires complete local default-file/SQLite blob
snapshots; unsupported external/custom layouts are refused. Historical
alpha.60 compatibility is covered by the independent schema/archive fixtures.
Preparing readers does not authorize production access or snapshot acquisition.

### Hosted snapshot preparation and explicit recovery baseline

Read-only Vercel inventory identifies separate production and preview Drives for
both verified projects, all in `iad1`. The shared preview environment is
`preview-feat-jazz-beta-upgrade-ed86022e`; each project's native Drive name is
truncated and hashed independently. The reported 1 GiB is maximum capacity, not
measured data usage. No production core was resumed, stopped, mounted or opened.

The concrete proposed preview rehearsal uses one disposable Sandbox per app in
its existing project and region, one vCPU, a five-minute timeout,
`persistent: false`, no exposed ports and `networkPolicy: 'deny-all'`. The
installed Sandbox SDK's `Drive.snapshot()` produces a read-only snapshot mount;
it is distinct from snapshotting/stopping an existing Sandbox. Vercel also
documents [read-only Drive snapshots](https://vercel.com/changelog/drives-for-vercel-sandbox-are-now-in-public-beta)
and the subsequent [general-availability release](https://vercel.com/changelog/vercel-drives-is-now-generally-available).
The new reader would mount only the existing app's preview Drive at
`/retained/preview`, inspect fixed layout/version metadata, and copy the complete
capture into disposable scratch space before opening any store with Jazz.
Cloud credentials stay in the caller, never inside the reader VM. Cleanup must
stop and discard each reader even after a refusal. The prepared readers include
matching Linux x64 native addons, so the VM needs no outbound package download.

Automatic approval review rejected the attempted Finance reader creation: it
would expose potentially sensitive hosted preview data to new cloud compute,
whereas the user's earlier snapshot authorization covered local stores. No
Sandbox was created. The user has been asked to approve this exact preview-only
procedure for both apps. Production snapshot acquisition remains separately
unauthorized; there is no attempt to route around the rejection through the SDK
or a Drive fork. The retained-user-browser rehearsal is also waiting for the
user to identify the browser and profile; no original profile has been opened
or copied.

The preview stores already run beta, so alpha.67 cannot silently stand in for
their pre-rehearsal baseline. `retained-recovery.mjs` now accepts an explicit
`alpha67` or `beta1` final argument (default `alpha67` preserves the approved local
procedure). It validates the installed SDK version and compares every row,
audit field, byte value and application identity under the candidate before
making its synthetic write. It then verifies that write after reopen and restores
a fresh copy of the original snapshot with the selected baseline. Success reports
both SDK versions. It never treats an older deployment or a downgrade of the
modified store as recovery.

On Node 24.22.2, the strengthened alpha.67-to-beta.1 procedure passes again on
both approved main-store snapshots with exact pre-write comparisons, committed
probe reopen, exact restored comparisons and unchanged snapshot bytes. A separate
disposable Finance fixture containing binary attachment data was opened and
written by beta, then passed beta-to-beta recovery. The inspector accepts an
explicit `preview` destination and refuses external/custom blob layouts and
paths outside the snapshot root; an unknown recovery baseline is also refused.
These refusal controls pass. A native negative control deliberately attempted to
restore the modified probe store instead of the untouched snapshot; exact restored
data comparison refused it. The source was restored byte-for-byte afterward.
Mismatch errors report fixed failure descriptions without dumping private HMAC
comparison values or file fingerprints. The temporary qualifier initially parsed
native store logging as JSON; selecting the final summary line corrected that harness
error. All final checks used the pinned Node version. Scratch stores and keys
were removed. These are local tooling checks, not hosted recovery evidence.

The proposed cloud capture must still establish its actual blob descriptor and
complete chunk coverage. Current app configuration and a successful fresh-profile
save do not establish the contents or recoverability of an existing Drive.

### Approved and completed local retained-data rehearsal

The user explicitly approved briefly pausing Finance on 5173 and Clipper on 5188,
capturing their complete local stores and immediately resuming them. The user then
selected: **“Upgrade main; preserve the older store and snapshot.”** This excludes
the separately running alpha.60 annotations worktree from migration.

Read-only listener/file-descriptor inspection identified these stores on November
24. The Finance listener on 5186 held no native store and was untouched.

| App | Live listener / observed PID | Source | Observed size |
| --- | --- | --- | --- |
| Finance | 5173 / 84804 | `/Users/matt/Projects/delightful-labs/apps/finance/.jazz/alpha60/finance` | 8 files, 5,357,202 bytes |
| Older Clipper annotations | 5188 / 8023 | `/Users/matt/Projects/delightful-labs-clipper-annotations/apps/clipper/apps/web/.jazz/alpha60/clipper.sqlite` | 8 files, 5,197,409 bytes |
| Current-main Clipper | Closed store; native-compatible lock held during capture | `/Users/matt/Projects/delightful-labs/apps/clipper/apps/web/.jazz/alpha60/clipper.sqlite` | 6 files, 1,630,338 bytes |

The capture helper verified PID birth/cwd/store ownership, refused already-stopped
processes, confirmed suspension and copied the complete store, WAL, shared-memory,
identity and local blob files into private directories. Before/copy/after bytes
matched. A `finally` resume and independent timeout/disconnect watchdog were
qualified against a disposable writer, including helper termination. Actual pauses
were 34 ms for Finance and 33 ms for the older Clipper process. Both resumed and
their listeners were verified. Current-main Clipper was captured while closed,
under its native-compatible exclusive OS lock without opening the original with
an SDK. No server was terminated/restarted and no namespace/configuration changed.

Only independent scratch copies were opened for comparison/recovery. Current-main
Finance and Clipper passed the exact comparisons and recovery in the table above.
The recovery procedure committed a synthetic beta row, verified it after reopen,
then restored a fresh copy of the untouched snapshot under alpha.67 and compared
identity, every row/audit field and binary bytes. It did not attempt a downgrade
of the upgraded directory. Temporary comparison keys and scratch stores were removed.
Captured snapshots remained byte-identical. No original store was opened with beta.

Complete captures and comparison/recovery results are preserved outside the repo:
`/Users/matt/Backups/delightful-labs/jazz-beta-2026-11-24-uv60_ng2`.
The private directory contains `finance`, `clipper-main` and
`clipper-alpha60-annotations`, plus a manifest recording source, SDK, main commit,
scope decision and store-tree integrity checksums. The legacy folder also preserves
its exact schema snapshot, bundled app/permissions and alpha.60 dependency metadata.
No private rows, credentials or comparison digests were printed or added to git.
This fulfills the [testing guide](../../docs/engineering/testing.md)'s preservation
requirement within the user's explicit snapshot authorization.

### Excluded older annotations store

The separate annotations worktree runs alpha.60 at
`d2f21c8fc772071969dd57c7b7551c90488746e7`. Its schema root
`364d90a798f1f95152c905ce4478cfa0cf5e6acea7cf98fc33c4c2b3a6fcc63d`
is disconnected from current main's
`8a5130d42577e05e2062aca65376e44c00cce9203db9c5a1ed806bc9d1967088`.
The alpha.67 baseline refused its scratch copy with `disconnected_migration_graph`.
The old root was reproduced from the exact source with its pinned alpha.60 CLI;
no original source or data was rewritten.

The schemas also differ in `notes.documentId` nullability, highlight tables and
relations. Beta's native `migrationDiff` on their public schema JSON refuses the
required/optional column change. Its advice is a staged additive column/data-copy
migration with old-client compatibility, rather than a direct conversion. See the
[pinned native migration implementation](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/crates/jazz-codegen/src/migrations.rs)
and [migration-graph validation](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/crates/jazz/src/tools/deployment/compatible.rs).
This finding is baseline-open plus native-diff evidence, not a claimed beta open
of the legacy store. A guessed history edge or reset was not attempted. Per the
user's scope decision, the live legacy store and its complete durable snapshot
remain preserved; a future legacy migration requires its own staged design.

Static/package commands include `pnpm build:libraries`,
`pnpm monorepo:check-links`, `pnpm dlf:check`, `pnpm finance:check`,
`pnpm clipper:check`, native Jazz generation checks and packed-consumer checks.
The selected unit, native backup/restore, Finance application/binding and Clipper
worker/offline/extension suites have run as recorded above. Root defaults cover
the website; root lock and
configuration changes also select the conservative all-project CI.
