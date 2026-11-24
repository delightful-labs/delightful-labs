# Feature Specification: Jazz beta adoption

**Created**: 2026-11-24

**Status**: Beta.1 integration implemented on main baseline `9344dff2`, retaining
worker ownership. Application/native/offline/extension and recovery checks pass
within the scope below. All 33 PR checks passed on `683dc411`. Subsequent review
removes one-off investigation programs and consolidates this spec; those changes
require their own CI result. Production deployment is not authorized.

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

Draft [PR #56](https://github.com/delightful-labs/delightful-labs/pull/56) targets
main from `feat/jazz-beta-upgrade`, based on
`9344dff27b0cf41e79750d0e3a7564a7e85a66da`. The user's implementation, testing,
commit/push and draft-PR authorizations persist. Merge, production rollout and
unapproved data acquisition remain separately gated. Original checkouts,
selectors, user servers and data are preserved.

### Implemented

- Pin the four active Jazz consumers and Clipper's explicit NAPI dependency to
  beta.1, with a coherent root lock. Remove the obsolete SDK peer allowance;
  preserve unrelated dependency records and the separate provider patch.
- Use native device-account gateway admission, keeping publication's explicit
  provider checks. Update device-auth fixtures to the native account kind.
- Preserve existing storage paths, app identities, namespace functions and
  `iad1`; derive Clipper's runtime/cache version from the installed SDK.
- Route `onNewerBuild` through existing worker shutdown owners and reload only
  after clean closure. A per-build Window marker bounds cached-old-build loops.
- Retain only demonstrated worker-platform, extension-origin and proof/retry SDK
  fixes. The beta patch changes 12 files, as did the alpha patch; native backend
  account admission is unpatched. Six files bridge Window-only primitives, one
  bounds explicit extension-origin normalization, and five carry proof/retry and
  matching broker changes. The broker verifier remains necessary for the shipped
  generated artifact.

| Owner | Update progression | Completion rule |
| --- | --- | --- |
| Finance application worker | `NEWER_BUILD` → existing CLOSE/domain drain/session-store-broker close | Window reload only after acknowledged clean completion. |
| Clipper realm host | `NEWER_BUILD` → existing SHUTDOWN/surface-acquisition-session drain | Publish reload only after clean terminal output, including extension consumers. |
| Window | Reload and retain the old immutable worker-build marker | Refuse a second reload from the same cached old build. |

No domain runtime moves into Window. SDK sessions, generation choice, build
ordering, admission verification and accepted-write draining remain native.
Competing shutdown/navigation and failed cleanup do not become successful reloads.

### Corrections established by failures

| Failure | Correction and retained requirement |
| --- | --- |
| Clipper document arrived before reverse capture metadata; throwing from projection ended its observer. | Root list and pending-content queries at `documentCaptures`, with native required document includes and the existing pending filter. Keep all four record guards, permissions and histories. Native late-metadata/completion and malformed-link cases pass; the old query fails the regression. |
| A joining tab reused an expired broker-owner proof; visible retry demanded remote sync through that proof. | Forward the joining proof through native verification and use local flush for explicit retry. The smaller worker/origin-only patch failed five of 33 unchanged native cases; the final patch passes all 33. |
| Finance transaction reads waited on an established but silent remote connection. | Explicit native LocalFirst reads for transaction edit/tag/check operations. Original offline persistence assertions pass. |
| Transfer controls disappeared before unlink feedback was rendered. | Keep the existing machine-selected feedback visible after editor deselection. Original unlink assertions pass. |
| Workspace test helper dispatched a redundant same-value selection and raced navigation. | Skip an already-selected matching route; otherwise await the actual navigation commit. Preserve all permission assertions and sanitized diagnostics. |
| Clipper CI sampled a newly bound library before its asynchronous ROWS observation. | Observe the exact original saved ID in both documents under the existing 15-second deadline. Keep all six engine/build cases, one reload, cached-old-build refusal and release acknowledgements. A nonexistent-ID control still fails. |

The four original Finance save workflows pass without retries. Their historical
intermittent unknown-save failures are not claimed comprehensively fixed; preserve
existing unknown-outcome protections and diagnose actual future error evidence.

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


### Hosted CI and previews

All 33 [PR checks](https://github.com/delightful-labs/delightful-labs/pull/56/checks)
passed on `683dc411`: Finance's 18 jobs, Clipper's six and Foundation's four, plus
status/title checks. Clipper's corrected hosted worker job reports 33 worker,
six handover, 12 offline and two sample-data passes; the same full job passes
locally. Its previous head failed the immediate saved-row sample; the aggregate
red check reported that same failure. Source correction `995f80c7` also qualified
the Finance runtime fixes. Earlier superseded/canceled runs are not counted as
successful workflows.

Protected READY previews for Finance (`dpl_71Uc64c7A4DNjy8j4Jp2uhY9zJgv`, source
`995f80c7`) and Clipper (`dpl_F489SGH4T4d3Yw1bNNjr44BfzViy`, source `743c6926`)
use the verified projects in `iad1` and per-project namespace
`preview-feat-jazz-beta-upgrade-ed86022e`. Private CLI OIDC authentication produced
native account HTTP 200 and SharedWorker WebSocket 101 responses. Fresh-profile
Finance account save/reload and Clipper example.com resolve/extract/save/reload
pass with no page errors or foreign-origin requests. Worker CDP authentication
must detach after handshake so it does not keep the old broker alive across
navigation. Temporary profiles were removed; no protection setting or public
share link was created. These are fresh-profile previews, not hosted recovery.

### Actual retained-data and recovery evidence

The user explicitly approved brief local store pause/copy/resume, then selected
**“Upgrade main; preserve the older store and snapshot.”** Complete captures,
identity files, WAL/shared-memory/local blobs, integrity manifest and the excluded
legacy schema/runtime metadata are preserved privately at
`/Users/matt/Backups/delightful-labs/jazz-beta-2026-11-24-uv60_ng2`.
Only scratch copies were opened with beta. Original bytes matched before/after;
Finance and older Clipper resumed after 34 ms and 33 ms pauses. Current-main
Clipper was captured closed under a native-compatible OS lock.

| Input | Observed result and scope |
| --- | --- |
| Current-main Finance store | Same identity, 29 tables/37 rows and all four audit values match alpha.67/beta.1. No binary cells. Beta probe write/reopen and fresh alpha snapshot restore pass. |
| Current-main Clipper store | Same identity, 22 tables/28 rows, audit values and three binary cells/121,582 bytes match. Beta probe write/reopen and fresh alpha snapshot restore pass. |
| User's latest Downloads export | `finance-backup (4).dlf`, November 7, 2026, 3,344,779 bytes. User states no data changes since export. Native envelope integrity and Finance v2 graph validation pass. Actual worker-owned Restore Workspace UI preserves all 619 records: 542 transactions, 22 accounts, 16 categories, eight transfers, ten tags, 20 links and one workspace. Original payload/history bytes match, including the 1,118,293-byte embedded history attachment. Full browser restart and another restart offline with HTTP cache cleared preserve the rows and new identity. No page errors/foreign requests; source file unchanged and temporary profiles/copies removed. |
| Native mixed-version Finance clients | Alpha.67 and beta.1 concurrently exchange exact fields/audit values through a beta core, reconcile an offline edit and refuse writes after revocation. Backend users, separate device accounts and beta opening alpha's unchanged opaque AccountStore pass. Revocation-negative control fails. This does not qualify Clipper's full mixed-version graph, a persistent alpha browser or installed extensions. |

The export restore intentionally creates new row IDs, owner membership and current
Jazz audit values, while preserving original attribution/history as inert source
bytes. It provides a verified Finance recovery route without locating an old
browser, not old sign-in credential recovery or an original-profile upgrade.
No live restoration destination was changed. The localhost test app and its
in-memory data were discarded. LAN exposure was rejected; the accepted rehearsal
used only `127.0.0.1`.

Recovery selects the snapshot's actual baseline SDK, compares candidate data
before writing, verifies a committed probe after reopen, and restores a fresh
untouched copy. A modified store is refused as a restored snapshot. Beta-created
preview data requires beta-to-beta recovery; an older deployment is not rollback.
Default file and SQLite blobs pass; unsupported external/custom layouts and
missing chunks are refused. No original store or profile is opened under beta.

The excluded annotations worktree uses alpha.60 at `d2f21c8f`. Alpha.67 refuses
its disconnected migration graph; beta's native migration diff refuses its
required/optional `notes.documentId` change. Highlight relations also differ.
A future upgrade needs a separately scoped staged additive/data-copy migration,
not an invented history edge or reset. The user selected preservation. See
[native migration rules](https://github.com/garden-co/jazz/blob/c73bed9a4e868071f10de490ae3f753f3081772f/crates/jazz-codegen/src/migrations.rs).

### Investigation scope and reproducibility

The completed archive, mixed-version and recovery investigations do not require
new permanent operator programs in the upgrade PR. Their results remain above;
the exact programs and full run record remain in the
[qualified investigation commit](https://github.com/delightful-labs/delightful-labs/tree/683dc4113bfadac81361a88bfd70cc82578522bb/apps/finance/tests/worker-upgrade)
and its [spec record](https://github.com/delightful-labs/delightful-labs/blob/683dc4113bfadac81361a88bfd70cc82578522bb/specs/005-jazz-beta-upgrade/spec.md).
The final diff removes `backup-file.mjs`, `mixed-version.mjs` and
`retained-recovery.mjs` (759 lines) and restores the archive fixture's original
contract. CI-backed native handover, direct bug regressions, existing upgrade
fixtures and the shipped broker's reproducibility verifier remain maintained.
No runtime requirement is removed to reduce the diff.

Maintained commands, from `apps/finance` unless scoped otherwise:

```sh
node tests/worker-upgrade/run.mjs --schema
node tests/worker-upgrade/run.mjs --clipper-schema
node tests/worker-upgrade/run.mjs --worker
node ../../scripts/jazz/verify-beta-broker.mjs /path/to/jazz-source-checkout
node tests/worker-upgrade/retained-prepare.mjs /path/to/qualified-finance-artifacts
node tests/worker-upgrade/retained-prepare.mjs /path/to/qualified-clipper-artifacts --clipper
node /path/to/prepared-readers/retained-compare.mjs /path/to/snapshots finance
pnpm --dir ../clipper test:worker
pnpm --dir ../clipper test:offline
pnpm --dir ../clipper test:extension
```

Preparing readers does not authorize data acquisition. Existing static, package,
workspace-link, native-generation and selected application checks retain their
normal project commands; root defaults target the website.

## Implementation backlog and release gates

| Order | Status | Required evidence |
| --- | --- | --- |
| B1 | Implemented | Native account/lifecycle behavior; every residual worker/origin/proof patch tied to a demonstrated limitation. |
| B2 | Implemented | Coherent beta dependencies, native pins, schemas, identities, namespaces and regions. |
| B3 | Authorized and completed for implemented scope | Reviewed implementation and subsequent explicit instructions to continue implementation/testing. |
| B4 | Selected checks pass | Shared packed consumers, both apps' native/offline/handover/permission coverage and packaged extension; latest-head CI must resolve. |
| B5 | Local and fresh-preview scope passes; hosted recovery open | Exact native snapshot comparisons/recovery and actual Finance export restoration pass. Hosted complete-store/chunk recovery remains unqualified. |
| B6 | Not authorized | Review compatibility, complete recovery and the intended live user destination before merge/production rollout. |

Remaining release work:

1. Acquire authorized complete hosted preview/production snapshots, including
   external chunks, and rehearse recovery. Read-only inventory found separate
   project Drives in `iad1`; reported 1 GiB is capacity, not measured usage.
   Proposed preview-only readers use same-project/region read-only Drive snapshot
   mounts, ephemeral one-vCPU Sandboxes, five-minute limits, no ports or outbound
   network, and scratch copies before SDK opens. Automatic approval review refused
   creation because local-copy approval did not cover hosted data in new compute.
   No Sandbox was created; this approval remains pending. Production data access
   is separately unauthorized. Never resume/stop an original core to inspect it.
2. Review coordinated backend/browser/extension compatibility and choose the live
   Finance recovery route: retain an existing identity or restore a new workspace
   from the verified unchanged export. Original-profile upgrade and full Clipper
   mixed-version/installed-extension rollout remain unqualified.
3. Preserve unknown-outcome protections and actual error diagnostics. Passing the
   original save workflows does not resolve every historical intermittent failure.
4. Obtain explicit merge/production authorization after the namespace, identity,
   region and recovery review. Preserve the excluded annotations store and snapshot.
