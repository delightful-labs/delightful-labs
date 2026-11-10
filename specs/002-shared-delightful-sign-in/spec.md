# Feature Specification: Shared Delightful sign-in

**Feature Branch**: `research/atproto-jazz-auth` (follow-up to merged PR #14)

**Created**: 2026-11-03

**Status**: Clipper native identity implementation merged; shared adoption, hosted qualification and publication remain open

**Input**: One Delightful identity can sign into independently deployed apps, initially Finance and Clipper, while preserving each app's existing accounts, ownership, recovery and domain policies. Explore Jazz-native application storage with AT Protocol identity and independently optional, explicit social publication. This task authorizes specification and research only.

**Subsequent direction — 2026-11-03**: The user currently operates these apps for themselves and
requests proceeding with a working, data-preserving implementation. Target Jazz's merged
backend-owned authentication with AT Protocol identity. A reproducible pinned source build is
acceptable; do not require a published Jazz release before implementation or consumer adoption.
Follow [the implementation and data-preservation sequence](delivery.md). Existing focused-review,
implementation-before-tests, commit/publish authorization and live-data protection agreements remain.
The original specification-only authorization above records history, not a prohibition overriding
this later instruction. Publication of Clipper content remains a separate consumer slice.

## Current implementation checkpoint — 2026-11-10

Clipper [PR #20](https://github.com/delightful-labs/delightful-clipper/pull/20) is
merged at `168cd0b`, including extension fix `152d679`. This checkpoint supersedes
historical Netlify/JWT/Neon/source-build preparation below. It records implemented
consumer behavior, not completion of shared DLF adoption or public publication.

| Area               | Current result                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime/hosting    | Released Jazz `2.0.0-alpha.60`, XState `6.0.0-beta.1`, Clipper's existing Vercel backend/frontend. No additional persistent-host selection is needed for this identity slice.                                                                                                                                                                                                     |
| Identity           | Immediate local use; optional web AT Protocol sign-in through Better Auth `1.7.18` and `@kingironman2011/better-auth-bsky` `0.3.2`. The explicitly approved plugin compatibility patch adapts Better Auth's changed account-lookup API.                                                                                                                                           |
| Auth persistence   | Native Jazz Better Auth adapter and six backend-only auth tables, with native schema migration. No Neon/Postgres or custom JWT/JWKS bridge; old disposable Neon records are not imported or deleted.                                                                                                                                                                              |
| Account ownership  | Jazz's native guest linking, existing-account following and remembered selection. DLF startup/readiness/restoration remain reused; no parallel Clipper account-selection coordinator. Native switching does not transfer or merge local work.                                                                                                                                     |
| Provider lifecycle | Worker-owned authorization and attempt-bound callback completion; application drain/acquisition settlement/native close before navigation. Sign-out clears this app's provider cookie before native logout. Broader cross-app logout is not implemented.                                                                                                                          |
| Extension          | Worker-owned settings/recovery sign-in, existing SDK account key/Web Lock and trusted Chrome confirmation. Direct AT Protocol provider login remains deferred. The hidden offscreen capture owner is retained.                                                                                                                                                                    |
| Local evidence     | 663 unit/native tests, six worker cases, 12 macOS/Chromium extension cases including offline restart and 24 settings teardown/capture cycles. Eight production offline cases cover linked/existing/expired credentials, two full browser restarts with app/auth/Jazz unreachable, preserved edits and reconciliation. Provider identities in browser qualification are synthetic. |
| Still unqualified  | Further hosted lifecycle checks (returning-device provider sign-in and the direct-reader failure described below), deployed persistence/refresh/revocation cases, Linux extension qualification, Finance/cross-app adoption and complete shared DLF provider/server interfaces. Jazz's published pending-write/account-switch limits remain explicit.                             |

Implementation and bounded evidence: [native auth review](https://github.com/delightful-labs/delightful-clipper/blob/main/docs/reviews/atproto-native-alpha60.md),
[extension investigation](https://github.com/delightful-labs/delightful-clipper/blob/main/docs/reviews/extension-startup-2026-11-09.md)
and [deployment instructions](https://github.com/delightful-labs/delightful-clipper/blob/main/docs/atproto-proof-deployment.md).
Do not equate the implemented Clipper consumer with a finished reusable DLF
AT Protocol integration or Finance migration.

### Hosted Clipper round trip — passed 2026-11-10

With user-approved production auth configuration, merge `168cd0b` on deployment
`dpl_5qUpzSiG7Y8APNfgrW1rSQgQ9XD9` passed real Bluesky sign-in on
`https://clipper.delightfullabs.com`. The user completed provider authentication
in a separate visible Chromium context; Clipper returned an authenticated
session and three reloads retained the same remembered Jazz account and visible
library. Existing Playwright was used because Chrome MCP was unavailable.
No password, token, cookie or recovery material was recorded; the browser was
closed after verification.

This passes the real-provider callback/reload check, not all hosted lifecycle
qualification. The live-identity restart follow-up below now supplies offline evidence. Refresh,
revocation, backend restart and returning-device provider sign-in remain open. The eight
synthetic-provider offline cases remain separate evidence.

### Live-identity offline restart — passed with a separate reader gap, 2026-11-10

Using the same production deployment, a dedicated browser profile signed in at
Bluesky through the real user flow. One marked synthetic article was saved through
the existing application; extraction responses were supplied by the test, while
authentication and Jazz persistence/sync used production services.

After closing the entire browser, two new browser processes reopened the same
profile with network access disabled, DNS blocked and HTTP cache cleared. Both
reopened the same account and readable saved article. A favorite added offline
survived the second process restart. On reconnect, a fresh local replica using
the same app session received the article and favorite; opening from its library
also rendered the saved text. The session was reused only within this app and was
not printed/exported. This does not qualify a new-device OAuth flow, expired live
credentials, backend restart, or revocation.

A separate production failure remains: direct URL navigation in a fresh replica
reported the article unavailable while online, whereas opening from the library
worked. It reproduced twice with a 30-second reader assertion. Corrected local
cold-reader coverage passes without an application change, so no app/SDK cause or
fix is established. A proposed wait-only change was removed. Do not mark all
reader/release qualification complete. The native test profile remains local for
continuation; no profile or credentials are included in repository evidence.

### Accepted publication direction; implementation remains open

Initial public publication is deliberate. For already-published items, accepted
Jazz changes synchronize automatically after server acceptance; Trash/deletion
requests public removal, and restoring a previously published item restores its
public address subject to conflict/deletion pauses. Explicit unpublish retains
local content and stops further publication until chosen again. External content
edits/deletions pause rather than silently overwrite/import/recreate. Unknown
requests retain their original destination/version and reconcile before retry.
Offline unissued publication follows the latest saved version of the selected
item; issued requests remain bound to their actual version.

Clipper's accepted vocabulary is shared `at.margin.note` plus independently
addressable highlight/note companions: required Margin `subject` URI/CID and
public `article` URI, optional reciprocal `note`/`highlight` links. Organizational
tags and Jazz IDs stay private. Conditional grouped synchronization and group-wide
companion-conflict pause are accepted. Namespace, exact public keys/discovery,
private intent/binding/attempt shapes, scheduling/writer ownership, consent upgrade
and companion cleanup remain for review. There is no implemented publication
engine, live companion Lexicon or qualified Margin interoperability.

Clipper owns these domain decisions; see its [accepted product decisions](https://github.com/delightful-labs/delightful-clipper/blob/main/specs/001-jazz-clipper/design-decisions.md)
and [technical proposal](https://github.com/delightful-labs/delightful-clipper/blob/main/docs/reviews/margin-sync-technical-proposal.md).
Shared DLF work must not adopt Clipper's domain schema or turn the backup journal
into a publication queue without separately evidenced reuse.

Remaining sequence: finish the remaining hosted lifecycle checks; review/extract only
reusable DLF boundaries and qualify Finance separately; finish Clipper's local
annotation model/editor; resolve the remaining publication choices with the user;
then implement and qualify PDS synchronization. Existing backend availability is
not proof of continuous background execution on Vercel. Local-work transfer/merge,
provider-loss/unlinking recovery, restricted/private PDS publication and automatic
inbound synchronization remain deferred. No new interface, shape or process is
selected by this status update.

## Clipper-first continuation — 2026-11-06

Clipper is the first consumer for AT Protocol integration; Finance follows after the shared
behavior is demonstrated in Clipper. The user confirms Clipper has no real data because development
has just started. Design its initial identity experience from scratch, including first use and
returning access; existing-data migration is not the starting use case. Explicit publication of
selected Clipper content remains a subsequent, separately designed slice. Finance retains its
existing-data preservation requirements. Clipper still requires deliberate recovery, permissions
and local-first behavior as new work is created.

This continuation authorizes specification work. The user requires consultation before making
new decisions and explicitly reserves data shapes and exact processes. Existing scenarios below
record earlier requirements; they are not approval of a new Clipper screen sequence, account
mapping representation, callback flow, recovery process or publication schema. Do not infer those
choices from this change of consumer order.

### First-release scope reduction — approved

The user approved deferring transfer of local work into an already-existing library, including
its bring-or-discard interaction, retry and interruption processes, and later real merging.
The first release covers:

- Immediate local Clipper use without a startup choice or sign-in gate.
- Optional AT Protocol connection, available in settings, to the library started locally.
- Returning access to that connected library on another device with no local work.
- Web app only; AT Protocol sign-in for the browser extension is deferred. Existing extension
  admission behavior is not changed by this slice.

A device with local work signing into a different existing library is outside this first-release
scope. How the app handles that unsupported situation must be decided with the user before
implementation; do not silently transfer, discard or strand local work. This scope reduction does
not change the immediate-local-use entry decision or authorize a new onboarding gate.

The local-work transfer decisions and shared responsibility boundary recorded below are retained
for future DLF work, not first-release implementation requirements. If that transfer fails in the
future capability, preserve local work for retry; discard only when the user explicitly chooses it.
Detailed retry, interruption, completion and cleanup processes remain deferred. Publication and
separate Clipper recovery also remain deferred.

### Clipper baseline inspection — first-release preparation

Read-only inspection of the current Clipper checkout finds:

- `apps/web/src/lib/backend/jazz/account.ts` already uses DLF's startup registry and
  `initial: 'local-first'`; direct local entry does not need a new onboarding workflow.
- That integration already uses DLF recovery/restoration adapters. Deferring a new separate
  recovery option does not require removing those existing capabilities.
- The existing library root is keyed and owned by the Jazz account. Connecting identity must
  preserve access to it; no library schema change or transfer is selected by this inspection.
- `apps/web/package.json` pins Jazz alpha.59 and a vendored DLF package. Existing research finds
  a version gap between this baseline and the candidate backend-owned authentication API.
  Current upstream/package availability has not been reverified in this inspection; web fetches
  failed. Do not treat the historical candidate API as available in the installed version.
- The extension has a distinct existing-account admission requirement. The user selected web-only AT Protocol integration first; extension AT Protocol sign-in is
  deferred. Web-first work must not silently change extension admission.

The next technical preparation proposal is to verify the supported Jazz authentication boundary
and exact compatible build in isolation, before changing Clipper dependencies or designing a new
account process. This is not build selection, installation approval or implementation readiness.
No application code, dependency, account data or service was changed by this inspection.

### Compatibility follow-up — source inspection, not build selection

After the user approved web-only scope, GitHub source access succeeded. Current default-branch
`packages/jazz-tools/src/backend/create-jazz.ts` exists (file blob
`c7323642cd376e227fa35af6c261deb83e066db4`) and its storage API differs from the historical
inspection: it includes SQLite, memory, remote and Vercel store configurations. The current source
package manifest still declares `2.0.0-alpha.59` (manifest blob
`904faeff21d763eacba6068a95b36c2d23592839`). A source manifest version does not prove that the
published alpha.59 package includes this code. npm registry verification has not completed.

Do not use the package version string to equate current source with Clipper's installed package.
Next investigation must pin a repository commit and compare the actual public authentication API
and compatible artifacts, before proposing a build. No dependency, build, storage or host is selected.
The initial source-file findings are not a full authentication or runtime compatibility assessment.

### Approved unreleased Jazz candidate — isolated qualification

The user reaffirmed the existing decision to use unreleased Jazz. Published release discovery is
not a gate. Source inspection identified candidate commit
[`11bcbf6367e62eca399d13da1fda939b2ae6ef36`](https://github.com/garden-co/jazz/commit/11bcbf6367e62eca399d13da1fda939b2ae6ef36).
The following files were inspected at that exact commit, rather than a floating branch:

- `packages/jazz-tools/src/backend/create-jazz.ts` exposes `authenticate` for app-owned verified
  identity and `acceptLocalFirstAuth` for local-first guests. Its `guestKeyAfterLink` option makes
  retaining versus revoking the original device key an explicit choice; no option is selected here.
- `packages/jazz-tools/src/accounts/enrollment.ts` implements `linkWithBackend` and
  `loginWithBackend`. Linking connects the existing guest account to the authenticated user;
  it explicitly refuses a user already assigned a different account and does not transfer data.
  This distinction fits the reduced scope without introducing deferred transfer machinery.
- The same enrollment source retains remembered backend-user identity/account facts for reopening;
  its comments describe offline reopening. This is source evidence, not a qualified offline restart
  result for Clipper or the DLF adapter.
- The root `package.json` supplies `build:core` covering Rust, WASM, native packages and artifact
  verification. A JS-only source replacement is not sufficient evidence of a coherent build.
- The candidate includes upstream PR #4902's fix for sign-in behind host JSON body parsers.
  Neither that fix nor its upstream tests establishes AT Protocol integration in Clipper.

The user approved this commit for isolated source-build qualification. This is not consumer adoption
or deployment approval. No build
has been made or adopted, and no Clipper/DLF dependency has changed. Build provenance, compatible
JS/WASM/native outputs, actual DLF adapter compatibility, account preservation and offline restart
remain to be demonstrated. Source inspection does not select OAuth routes/session data, stable
identity mapping representation, hosting or exact connection process.

### Isolated build preparation status

The approved candidate checkout could not be created: shell GitHub access failed with DNS resolution
error (`Could not resolve host: github.com`). GitHub connector reads work but do not supply a local
build checkout or package downloads. No source build or runtime qualification has run.

Pinned `rust-toolchain.toml` requires Rust 1.93.1. Node, pnpm, rustup/cargo/rustc are present on
this machine; `wasm-pack` is absent from PATH. The pinned root toolchain script names
`wasm-pack@0.13.1` and the `wasm32-unknown-unknown` Rust target. The user subsequently approved installing the required build tools. No installation or application
dependency change has been made; installation remains blocked by shell network restrictions.

### Build environment diagnosis

The user authorized required build-tool installation and requested network diagnosis. Shell tests
show hostname lookup failure for GitHub, npm and atproto.com; direct TCP connections to numeric
IP addresses also fail with `PermissionError: Operation not permitted`. This establishes an egress
restriction beyond DNS lookup. The task's permission profile explicitly restricts shell network
access and disables sandbox escalation. GitHub connector requests succeed through their separate
transport. These observations do not establish a host-wide internet outage or justify changing the
user's DNS/Tailscale configuration.

Resume checkout and approved tool installation in a shell execution context that permits network
access. Install toolchain artifacts in task-owned writable storage if the current filesystem
restrictions remain; the ordinary home Rust directories are outside the writable roots. Preserve
the approved candidate commit and keep consumer dependencies/services unchanged until qualification.
No network configuration, toolchain or consumer code has been changed by this diagnosis.

### Pinned source build — passed

The user completed `pnpm build:core` in the isolated checkout at approved commit
`11bcbf6367e62eca399d13da1fda939b2ae6ef36`. Inspection found a clean tracked working tree,
generated backend/session declarations, and the final successful build message:
`package hand-off: jazz-tools matches release WASM and NAPI artifacts`.
The log is `/Users/matt/Projects/jazz-atproto-11bcbf6-build.log`.

Build setup required Rust 1.93.1, wasm-pack 0.13.1, LLVM and CMake. The successful shell put
`/opt/homebrew/opt/llvm/bin` and the user's Cargo bin directory on PATH. No upstream source patches
were needed. Built session declarations expose `linkWithBackend()` and `loginWithBackend()`.

This proves source-build completion and the build's artifact compatibility check, not runtime
qualification of AT Protocol, DLF adapters, Clipper, account connection or offline cold restart.
Consumer manifests and running services remain unchanged. The next proposed review slice is DLF's
adapter boundary for these built APIs; exact process and public contract decisions still require
user input. No implementation or tests of that adapter have been added.

### Built DLF adapter compatibility review — process decision pending

Inspection of the built declarations at approved commit `11bcbf6` found a concrete startup API
change. DLF currently imports `createJazzSession` and `JazzSessionConfig`; the new browser-facing
API is `createJazzClient` with `JazzClientConfig`. Client configuration no longer accepts `appId`;
it scopes the client by endpoint, with a documented scope compatibility option. Do not silently
translate existing app/environment configuration or change live endpoints.

The new client defaults to thin/server operation unless given a local-first client loader. Its
comments describe background upgrade and subsequent retained offline startup. Preserve the chosen
local-first product requirements explicitly; a successful build or `initial: 'local-first'` alone
is not offline qualification.

The built session still supplies snapshot/subscription/retry and distinct `linkWithBackend` and
`loginWithBackend` actions. DLF's existing session lifetime owner and readiness boundary are reuse
candidates; recovery restoration remains separate. No new owner, token registry or graph-transfer
layer is justified by this comparison.

Process-relevant SDK behavior requires user review: `JazzClientConfig.linkGuestOnSignUp` defaults
to automatic linking when the backend user has no account; it can be disabled to let the app choose
an explicit linking action. The browser session follows backend user changes. Do not add a second
DLF sign-in controller on the assumption these observations are passive. Decide the desired local
library connection experience with the user before choosing configuration or statecharts.

Proposed first adapter slice, not implemented: adapt DLF startup to the built client API while
retaining one application-lifetime session and explicit local-first requirements. Keep authentication
verification/session storage in the backend integration and domain library records in Clipper.
Exact DLF public types, endpoint/scope mapping, session-following policy, guest key retention and
connection sequence remain unselected. No tests or implementation changes were made in this review.

### Connection confirmation decision — no second confirmation

The user selected the recommendation: after choosing Connect AT Protocol in settings and completing
sign-in, connect the current local library immediately, without another confirmation, when the
verified identity has no existing Clipper library. The settings action expresses that connection
intent. This does not authorize connecting merely because a backend session happens to exist,
connecting a different library after a stale callback, or transferring local work into an identity's
already-existing library. That transfer remains deferred.

This selects the user-facing outcome, not the SDK auto-link configuration, callback correlation,
public types or exact statechart. Determine whether SDK automatic behavior can honor explicit
settings intent before selecting it; a convenient default is not sufficient evidence.

### Explicit-intent review of the built Jazz watcher

At approved commit `11bcbf6`, `session/follow-user.ts` and `session/backend-watch.ts` actively
observe backend identity at startup, focus, cross-tab events and explicit reauthentication.
With default configuration, a local guest is linked when the observed user has no account,
regardless of whether a DLF settings Connect action initiated that observation.

`linkGuestOnSignUp: false` suppresses that automatic linking when the observed user has no account,
while retaining the public session's explicit `linkWithBackend()` action. This is a candidate
configuration for honoring the approved Connect intent, not yet selected.

Important limit: disabling automatic linking does not disable automatic sign-in to a user who
already has an account. The watcher can call `loginWithBackend()` in that case, including after a
link refusal. It does not check whether the local library has work. Therefore that option alone
cannot enforce the approved first-release exclusion of switching from local work to another
existing library. Do not advertise it as a complete connection safety boundary.

Before implementation, review how the app-owned backend session and the active Jazz watcher are
admitted under explicit intent. Keep local work safe and do not silently adopt deferred transfer
behavior. No session credential shape, gating protocol, SDK patch or exact callback process is
selected by this finding. The smallest immediate configuration proposal is to disable SDK automatic
linking and use its explicit link action under DLF's approved intent; broader watcher admission
still needs a separate design decision before implementation.

### Revised connection decision — use Jazz-native behavior first

The user approved leaning on Jazz's built-in automatic linking and backend-session following to
get the first version working faster. This supersedes the earlier fresh-settings-intent restriction
and the proposal to disable automatic linking. A local library may connect when Jazz discovers an
authenticated app session, without a new settings action or second confirmation, when that user has
no existing Clipper account. Use the SDK's native connection/session behavior as the selected design
direction rather than adding a parallel DLF linking controller.

The user also accepted keeping the case of local work plus another existing library outside the
supported first version. This does not qualify data transfer or merging: Jazz may switch to the
existing account, but does not bring local work along. Do not claim the earlier future bring-or-discard
outcomes are implemented. Existing local work must not be described as transferred or discarded
without evidence. No custom account-switch blocking or transfer process is selected here.

DLF still owns the reusable integration boundary; consumers retain domain schemas and policies.
Preserve direct local entry and explicitly qualify local-first client loading, retained account
restart and offline work on this build. Default SDK configuration is not proof of these outcomes.
Backend OAuth integration, hosting, public DLF types and data shapes remain unselected. This
revised direction authorizes no consumer dependency change, deployment or implementation tests.

### Initial experience decision — start locally

The user selected local use first. A person can begin clipping and writing in Clipper without
AT Protocol sign-in. Connecting an AT Protocol account is optional and available later; starting
local work does not require an existing AT Protocol account. This selects the product entry model,
not account data shapes, recovery setup, connection timing, screens or a linking protocol.

### Connection capability decision — library access across devices first

The user selected optional AT Protocol connection for returning to the same Clipper library on
another device as the first integration capability. Jazz remains responsible for library storage
and synchronization. Public publishing follows separately and is not required for connection or
cross-device library access. This decision does not select the connection, device sign-in or
recovery process, nor any identity/account data shape.

### Recovery scope decision — separate Clipper recovery deferred

The user considers a separate Clipper recovery option useful but defers it beyond the first
Clipper integration slice. Do not design or require a new independent recovery method for that
slice. This supersedes broader independent-recovery requirements below only for the initial
Clipper scope; Finance's existing recovery preservation requirements remain.

The first slice must not promise an independent way to regain library access on a new device
when the connected AT Protocol account is inaccessible. Existing device data and supported local
use remain subject to the local-first requirements; external account loss is not evidence that
local work was deleted. No recovery mechanism, credential revocation behavior or exact loss-of-access
process is selected here. Any existing Clipper recovery behavior must be inspected before proposing
changes; this deferral does not authorize removing it.

### Connection discovery decision — available in settings

The user selected making optional AT Protocol connection available in settings, without proactive
suggestions or prompts to connect. Local clipping and writing do not require passing through a
connection invitation. Exact settings placement, text, controls and the connection process remain
undecided.

### App entry decision — immediate local use on every device

The user selected opening directly into a usable local Clipper experience, including on a new
device. Do not show an initial choice between starting locally and signing in to an existing
library. Optional account connection and returning sign-in are available through settings rather
than an onboarding gate. Exact settings controls and the process for accessing an existing library
remain undecided. In particular, do not infer what happens to work created on a new device before
signing in to a previously connected library.

### Deferred local-work decision — join the existing library through shared DLF behavior

When a person creates work locally on a new device and then signs into an existing Clipper
library, the user requires that local work to join the existing library. It must not remain in a
separate local library as the chosen result. This behavior belongs in DLF as a standardized
capability reusable across apps, rather than separate Finance and Clipper processes. Consumers
retain responsibility for their own domain schemas and permissions. This requirement concerns
bringing local work into a library; it does not authorize merging or reassigning identity mappings.

Before selecting a design, assess reuse from the existing shared backup work. No record shapes,
transfer algorithm, duplicate/conflict policy, source cleanup, transaction boundaries, timing or
confirmation process is selected by the required outcome.

#### Duplicate handling decision — keep both initially

The user accepts keeping both the local item and any corresponding item already in the destination
library for the first version. Content deduplication and real merging are deferred future shared
DLF work, not app-specific behavior. Matching rules, merge semantics and data shapes remain
undecided. Keeping both is a content policy; it does not authorize duplicating the same transfer
on retry or claiming that uncertain writes failed.

#### Confirmation decision — required before bringing local work into a library

The user requires confirmation before local work is brought into an existing library when signing
in. Signing in alone does not authorize that transfer. If the user declines bringing local work along, discard that local work and continue into the
existing library; do not keep a separate local library or cancel the switch as the selected
product outcome. Confirmation wording and screen sequence remain undecided. The choice must
communicate that declining discards the local work. Deletion mechanics and timing remain open;
this decision does not authorize deleting the destination library or executing any deletion
during specification work. This is shared DLF behavior, with
consumer-supplied domain presentation where needed; no exact interface or data shape is selected.

#### Existing backup reuse evidence — inspection only

The [backup specification](../003-verified-backup/spec.md) already separates reusable DLF lifecycle
behavior from consumer-owned capture, validation, relationships and destination operations.
Existing implementation includes capture boundaries, retained source-to-destination mappings,
restore progress/reconciliation, and destination verification. These are candidates to assess for
shared data-transfer behavior, not an approved design or a promise that the current restore API
can be used unchanged.

Current backup restoration targets a new workspace and leaves existing workspaces unchanged;
importing into an existing workspace is explicitly deferred in that feature. Joining local work
to an existing library therefore needs additional design and qualification. Do not silently change
the backup contract, require a downloaded archive, or introduce a separate app-specific transfer
engine. Determine the smallest reusable boundary and bring choices to the user before selecting
processes or data shapes.

- First use supports a new local Clipper library and clipping/writing without AT Protocol sign-in.
- Optional identity connection connects the locally started library without losing its work;
  transfer into a different existing library is deferred.
- After optional connection, sign-in on another device reaches the same Clipper library through
  Jazz, without accidental duplicate accounts; content availability remains distinct from sign-in.
- Sign-in or connection failures do not discard local work. Exact supported failure processes
  require user input; detailed transfer recovery remains deferred.
- Supported offline reopening and editing remain available under the existing requirements.
- Sign-in and ordinary saving perform no public content writes and require no publication grant.

These are acceptance outcomes, not a selected process or a claim of runtime qualification.
Cross-app sign-in is later reuse evidence; Finance is not the prerequisite first consumer.

### Decisions requiring user input

Local-first entry and optional connection for cross-device library access are selected above.
A separate Clipper recovery option is deferred above. Clipper connection, returning sign-in and app-local logout use the merged native path described
in the current checkpoint. Shared interfaces, broader recovery and unsupported account-switch
cases remain open. Do not infer those processes
or data shapes from the selected capability.

App entry is immediate local use on every device; connection and returning sign-in are available
in settings without proactive prompts. Local work joins the existing library through shared DLF
behavior; assess backup reuse before proposing a design. Keep both content copies initially; real
merging is deferred, and bringing local work into an existing library requires confirmation.
Declining discards the local work and continues into the existing library. Obtain user decisions
on account
conflict choices, cancellation/interruption handling, recovery and logout scope. Ask before choosing
any exact process. Data shapes, identity mapping representation and public interfaces remain open;
publication has the accepted direction above, while its namespace, remaining shapes and exact
execution mechanics still require review. Clipper runtime/hosting choices are already adopted;
do not reopen those as unresolved decisions.

## Direction and MVP boundary

The 2026-11-03 continuation selects an architecture to explore: Jazz remains the application
database and synchronization authority; AT Protocol supplies a candidate external identity and
an optional public publication destination. A PDS does not replace Jazz storage or its account
registry. Clipper has implemented native backend authentication on Jazz alpha.60/Vercel;
shared DLF adoption, other consumers and deployed compatibility retain their qualification gates.

| Consumer context | Identity use                                                          | Application storage                                       | Publication boundary                                                                                      |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Finance          | May use verified AT Protocol identity for shared sign-in              | Existing Jazz financial records and policies              | No social publication requirement or repository-write grant; identity use must stand alone                |
| Clipper          | May use the same verified AT Protocol DID through its own app mapping | Jazz-native notes, highlights and other app-owned records | User explicitly publishes selected notes/highlights as public records; app owns schemas and content rules |

Unpublished Clipper work stays in its existing app storage/access scope. “Keep in app” and
“Publish publicly” are the MVP choices; unpublished does not mean encrypted from infrastructure
operators or restricted from existing authorized workspace members. Permissioned publication to
selected recipients through AT Protocol Spaces, private PDS backup, and a Jazz–PDS storage bridge
are deferred. This deferral does not remove existing Jazz private-workspace requirements.
Public publication is independently adoptable and does not gate shared sign-in delivery. These
consumer cases constrain the shared boundary; they do not authorize either app's implementation.

## Hosting and deployment direction

Clipper uses its existing Vercel application/backend with Jazz alpha.60's `vercel`
store and native Better Auth adapter. Auth records share the backend-owned Jazz
store; local development uses SQLite. Netlify frontends and a separate persistent
service were earlier candidates, not current Clipper deployment requirements.
Other consumers retain their own deployment/storage decisions and qualification.

DLF remains a reusable library, not a standalone login app, central credentials
service or new service repository. Each consumer owns routes, secrets, origins,
backend admission and domain permissions. Deployment qualification still covers
real provider consent, durable auth across restarts and safe multi-instance refresh.
Backend hosting does not implicitly authorize storage relocation or supply a
continuous publication scheduler. Historical evidence remains in [hosting](hosting.md);
current Clipper setup is linked in the checkpoint above.

## Required local-first behavior

The backend establishes identity and supports authorized synchronization; it does not make every
supported application read or edit an online request. After successful setup, a retained eligible
local account MUST reopen with locally available data, accept supported offline edits, and preserve
those edits across browser closure and restart. Reconnection synchronizes under existing domain
policies, distinguishing local durability from remote acceptance and rejection.

Initial external sign-in on a new device, new account linking and remote identity recovery require
connectivity. Expired backend/provider sessions or a provider, backend or Core outage MUST NOT by
themselves discard local data, create an empty replacement account, or prevent already-authorized
supported local work. Local continuation does not assert fresh remote authentication or override a
known account revocation, explicit logout or domain policy. Reauthentication can be required before
remote operations resume; retained local recovery authority remains subject to the reviewed link policy.

Local first is not a promise that every record or attachment has been downloaded. Consumers MUST
distinguish locally available data, unavailable content, loading/failure, and true empty results.
Public PDS publication is a separate explicit online operation; offline intent, local source saving
and confirmed public acceptance remain distinct. Finance has no publication dependency.

These are required outcomes, not claims already proven by source inspection. Qualify offline cold
restart after linking, durable offline edits, expired sessions, separate service outages, reconnect,
rejection/conflicts and recovery on the exact adopted build before calling the integration complete.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Preserve an existing local-first account (Priority: P1)

A person with an existing local-first account explicitly connects shared sign-in without losing their work or changing ownership. This remains a preservation requirement for Finance and for any later local-account connection supported in Clipper; it does not select Clipper’s initial onboarding model.

**Why this priority**: Introducing sign-in must not strand existing users or create an apparently empty replacement account.

**Independent Test**: Start with a local-first account containing private records, link an external identity, restart and sign in again. The same app account and records remain accessible under unchanged permissions.

**Acceptance Scenarios**:

1. **Given** a current local-first account and an unassigned external identity in this app, **When** the user confirms linking after seeing the account and authority disclosure, **Then** shared sign-in resolves to that existing account; ownership and recovery remain intact.
2. **Given** external identity E already maps to account B in this app and the current local account is A, **When** linking is requested, **Then** the app reports a conflict, preserves both accounts and their data, and offers cancellation or an explicit, separately confirmed sign-in to B after transition safety checks. No merge or reassignment is offered in this scope.
3. **Given** a linking response is lost after submission, **When** the user returns, **Then** the outcome is unknown until reconciled against authoritative account mapping; no automatic account creation, replacement or repeated mutation is inferred from a timeout or empty local data.

### User Story 2 - Sign in across independent apps (Priority: P1)

A new user signs into one app and later uses the same Delightful identity in another app on a different origin. Each app retains its own account mapping and data policies.

**Why this priority**: This is the shared identity benefit, without coupling domain data or browser storage.

**Independent Test**: Use two separately deployed consumers with distinct Jazz app IDs and origins, initially empty browser storage, and the same external identity. Verify separate account mappings and independent permissions.

**Acceptance Scenarios**:

1. **Given** no retained app account and no existing mapping, **When** first sign-in succeeds, **Then** an account is established in this app only, with recovery and provider dependency accurately explained.
2. **Given** an established Delightful provider session from Finance, **When** the user chooses sign-in in Clipper, **Then** the provider may reuse that session according to its policy; Clipper independently resolves or establishes its mapping. Finance's storage and credentials are not inputs to Clipper.
3. **Given** a returning identity already mapped in Clipper, **When** sign-in completes on a fresh browser, **Then** that mapping is used rather than creating a duplicate; data discovery and availability are reported separately from authentication.
4. **Given** a retained local account, **When** shared sign-in is chosen, **Then** the user must explicitly choose preserving it through linking or accessing another account. Automatic provider admission must not bypass that choice.

### User Story 3 - Leave or change accounts safely (Priority: P1)

A user signs out or changes provider accounts without old work, credentials or delayed callbacks entering the next account's session.

**Why this priority**: Shared provider state makes accidental identity replacement more likely.

**Independent Test**: Exercise sign-out and account changes while writes, sign-in and linking are pending, including A → B → A and late provider callbacks.

**Acceptance Scenarios**:

1. **Given** pending work, **When** sign-out or account replacement begins, **Then** the existing owner coordinates settlement and resource release before admitting the next account. An unresolved outcome remains visible and correlated to its original account.
2. **Given** a successful local logout and failed provider logout, **When** the result is shown, **Then** the user sees partial completion and provider-session status; stale provider notifications cannot silently sign them back in.
3. **Given** an old identity generation, **When** its delayed operation returns after an account change, **Then** it cannot grant access or update the current account's state.

### User Story 4 - Recover and continue through interruptions (Priority: P1)

A user can distinguish existing app recovery from provider recovery and retain supported local use during outages.

**Why this priority**: Shared sign-in must preserve existing local-first guarantees without promising unavailable remote authentication.

**Independent Test**: Restore an existing local-first identity using its established recovery flow in the same app/environment; separately exercise provider recovery and outages.

**Acceptance Scenarios**:

1. **Given** an existing local-first recovery phrase, **When** recovery is explicitly completed in its original app/environment, **Then** the intended account is restored under existing ownership and cleanup rules. No phrase is sent to another app or the provider.
2. **Given** an external-only account, **When** recovery is requested, **Then** the supported provider recovery path and its limitations are disclosed; no local-first recovery phrase is fabricated or promised.
3. **Given** a qualified retained local session and a provider or registry outage, **When** the app opens offline, **Then** supported local work remains available; fresh sign-in, linking and remote authority claims remain unavailable or pending rather than being reported successful.
4. **Given** canceled sign-in, **When** provider work later completes, **Then** it cannot silently select another account. Already-issued registry work remains owned until its result can be reconciled.
5. **Given** an existing linked account and locally available records, **When** backend/provider sessions expire and all remote services are unavailable, **Then** offline cold restart preserves the selected account, supported reads and edits; those edits survive another restart without fresh sign-in.
6. **Given** durable offline edits, **When** connectivity returns and reauthentication is required, **Then** the app retains the edits while sign-in proceeds, synchronizes under the original account, and reports acceptance, rejection or conflicts separately without silent loss.
7. **Given** a referenced attachment not retained locally, **When** it is opened offline, **Then** the app reports unavailable content rather than an empty attachment or complete offline availability.

### User Story 5 - Use identity without social publication (Priority: P1)

A Finance user signs in with AT Protocol identity without exposing financial records or granting
the application authority to publish. A Clipper user can also sign in and keep all work unpublished.

**Why this priority**: Authentication must be useful independently of social participation.

**Independent Test**: Sign in to separate Finance and Clipper consumers without repository-write
permission, then create private sentinel records and restart. Neither consumer publishes them.

**Acceptance Scenarios**:

1. **Given** a qualified AT Protocol sign-in path, **When** Finance authenticates a user, **Then**
   it resolves its own Jazz account without requesting repository-write permission or writing
   financial data to a PDS, public feed or social profile.
2. **Given** a Clipper user who declines publication authorization, **When** they sign in and save
   a note or highlight, **Then** supported Jazz use continues and nothing is published.
3. **Given** the same verified DID with a changed handle or migrated PDS, **When** sign-in is
   repeated through the qualified integration, **Then** identity continuity is preserved; neither
   handle text nor hosting location creates a new app account. An unverified DID assertion fails.

### User Story 6 - Publish selected Clipper work deliberately (Priority: P2)

A Clipper user reviews a selected note or highlight, chooses public publication, and sees whether
the public write was accepted independently of whether the source was saved in Jazz.

**Why this priority**: Public sharing must not turn sign-in or ordinary editing into disclosure.

**Independent Test**: Keep two items unpublished, publish only one selected revision, then edit its
source and interrupt a later public write. Verify exact disclosed content and distinct outcomes.

**Acceptance Scenarios**:

1. **Given** an unpublished item, **When** the user confirms publication, **Then** they first see
   the exact public content, attribution, destination DID and disclosure consequences. Consent selects that item and destination. Before first issuance, the approved latest-saved
   behavior may advance its source version after Jazz acceptance; once issued, the request
   retains its exact version and owner.
2. **Given** a published revision, **When** the Jazz source changes, **Then** the accepted change synchronizes to its already-public counterpart after relevant Jazz server
   acceptance. Unpublished items remain unpublished; destination changes and unresolved
   content/deletion conflicts block automatic issuance.
3. **Given** Jazz persistence succeeds but PDS publication fails or its response is lost, **When**
   the result is shown or the app restarts, **Then** source persistence and public acceptance have
   separate statuses. Retained operation identity supports reconciliation without duplicate posts.
4. **Given** a published item, **When** the user requests removal from the publishing repository,
   **Then** the app reports that operation's confirmed, failed or unknown result and explains that
   third-party copies may remain. Trash/source deletion requests public removal but does not assert acceptance or network-wide
   erasure. Explicit unpublish preserves the Jazz source and stops later synchronization;
   logout/revocation does not prove deletion.

### Edge Cases

- Two tabs/devices race to link the same external identity to different accounts; only an authoritative accepted mapping wins, with an explicit conflict for the other account.
- Linking the already-linked identity to the same account is distinguished from a conflicting account, subject to actual registry behavior qualification.
- The provider changes account while a token is being obtained or refreshed; reject stale credentials and invalidate prior scoped decisions.
- A link is accepted remotely but client opening fails; report linked-but-session-unavailable rather than assuming rollback.
- Provider session expiry, revoked credentials, account deletion, signing-key rotation, denied consent and blocked popups/redirects have distinguishable outcomes and supported retry paths.
- Storage eviction or an empty replica is not proof of an unmapped identity. Losing a provider account is not proof that app data is deleted.
- Offline logout cannot promise global remote revocation or erase another device's retained data.
- Preview origins, unexpected redirect destinations, wrong issuer/audience and malformed identity claims must not receive production authority.
- A handle changes owner or an account migrates PDS; identity continuity follows the verified DID, not a cached handle or server URL.
- Publication is declined, authorization expires, or PDS access fails while Jazz remains usable.
- Source content, source access, destination DID or account binding changes during review/publication; unissued intent follows the approved latest-saved rule only within the selected item, while destination/authority changes and unresolved pauses block issuance. Issued work cannot change version or identity.
- PDS accepts a write but Jazz cannot record its receipt; restart and another device must reconcile the same publication identity rather than blindly create a second record.
- A previously published source is deleted or unpublished locally; third-party public copies may persist and must not be described as private again.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Finance and Clipper MUST retain separate Jazz app IDs, registry namespaces, domain schemas and authorization policies. Shared provider sign-in MUST NOT imply a shared Jazz account UUID or data permission.
- **FR-002**: Shared identity MUST be represented by verified provider identity within an explicit environment, distinct from each app's account mapping. Email, display name and coincidentally equal UUIDs MUST NOT be used as proof of identity equivalence. Pairwise provider subjects MUST be accommodated or ruled out through verified configuration, without inventing an identity broker.
- **FR-003**: Consumers MUST reuse Jazz's selected native account following: an unassigned authenticated user can link the local guest and an existing user opens its account. The earlier mandatory separate connect/login/register controller is superseded for Clipper. Account switching is not domain transfer or merging; local-work transfer into another library remains deferred.
- **FR-004**: Successful linking MUST retain the original app account identifier, domain ownership, permissions and supported local-first recovery. Authentication MUST NOT be represented as migrating domain data.
- **FR-005**: Mapping conflicts MUST NOT silently merge accounts, reassign ownership, transfer or delete domain data. Follow supported authoritative Jazz behavior; distinguish opening an existing account under native following from merging local work into it. Do not invent an app-side account registry or unsupported reconciliation.
- **FR-006**: Shared sign-in MUST work across independent origins without shared local storage, direct sibling-cookie access, or app-to-app credential transfer. Recovery phrases, signing roots and bearer tokens MUST NOT be passed between consuming apps. Each app obtains its own provider-authorized credential through a verified supported integration.
- **FR-007**: Provider authentication, Jazz registry assignment, local client readiness, data discovery, local persistence and remote acceptance MUST remain distinct outcomes. Missing data and network failure MUST NOT authorize creation or replay.
- **FR-008**: Sign-in, linking, account replacement, logout and recovery MUST reuse the existing session/recovery ownership boundaries. A binding and generation MUST scope callbacks, subscriptions and decisions. Cancellation MUST invalidate admission intent without pretending an issued remote request was undone.
- **FR-009**: Pending domain operations MUST remain owned and correlated to the original account through settlement. Unknown outcomes MUST retain recovery facts, prohibit blind replay, and prevent a transition from being reported complete while its required safety obligations remain unresolved.
- **FR-010**: Offline behavior MUST preserve only qualified existing local capabilities; it MUST NOT claim fresh remote authentication, linking acceptance, remote revocation or provider recovery while unavailable. Outages MUST NOT manufacture replacement identities.
- **FR-011**: Recovery MUST distinguish provider recovery from existing local-first recovery and from data availability. Existing local-first secrets MUST stay transient and excluded from logs, URLs, persisted workflow snapshots and provider payloads. External-only accounts MUST disclose their actual recovery dependencies.
- **FR-012**: Clipper sign-out MUST drain app work, clear this app's Better Auth cookie, then perform native Jazz logout; failure must not be reported as completion. No global provider, sibling-app or other-device logout is implied. Broader logout and provider-loss/unlinking recovery remain deferred designs.
- **FR-013**: The first implementation MUST document its supported provider, version and host. Clipper has adopted Jazz alpha.60, Better Auth with its existing AT Protocol plugin, the native Jazz adapter and Vercel backend. Other consumers and additional methods need independent qualification; historical Netlify/source-build prerequisites do not block this implemented slice.
- **FR-014**: Production, development and disposable previews MUST isolate provider trust configuration, app registrations, Jazz app IDs, registry/storage scope, callbacks and test identities. Untrusted previews MUST NOT receive production credentials or identity/data authority. Preview teardown MUST revoke/remove its configuration without deleting production identities. Wildcard trust for arbitrary preview origins is prohibited.
- **FR-015**: DLF MUST expose reusable intent, lifecycle and typed outcome capabilities while delegating credential verification, registry assignment and persistence to supported SDK/provider boundaries. It MUST NOT create a duplicate identity registry, secret store or authentication protocol.
- **FR-016**: Apps MUST retain domain authorization and pending-write/drain responsibilities; DUI MUST retain generic presentation. Library use MUST NOT require Finance schemas, Clipper schemas or app-owned routes. User-visible messages MUST remain localizable and interactions accessible under existing rules.
- **FR-017**: Shared sign-in MUST disclose provider dependency and cross-app identity correlation. It MUST NOT claim that authentication encrypts domain data from hosts or grants data access to another app.
- **FR-018**: Qualification MUST use pinned SDK behavior and real registry/provider configuration; unsupported collision reconciliation, credential compatibility or durability MUST block the corresponding capability claim rather than introduce a custom exchange.
- **FR-019**: Jazz MUST remain the application persistence/synchronization authority. AT Protocol identity and optional publication MUST NOT require mirroring private application records to a PDS, replacing Jazz synchronization, or treating PDS acceptance as Jazz acceptance. Supported local work MUST remain independent of publication availability.
- **FR-020**: AT Protocol identity MUST derive from a verified OAuth flow and stable DID, with a documented mapping into the selected Jazz authentication boundary. Handle, PDS URL, browser-supplied DID or decoded access-token claims alone MUST NOT establish control. PDS migration MUST NOT change the logical app mapping. Raw AT Protocol credentials MUST NOT be assumed compatible with Jazz admission. A supported provider/backend integration and its operator must be qualified; DLF MUST NOT invent a token exchange or duplicate account registry.
- **FR-021**: Authentication and publication authorization MUST be separate capabilities and user intents. Finance MUST require no publication permission; Clipper MUST remain usable without it. Publication authorization MUST be limited to the required collections/operations and obtained through a supported consent flow. Sign-in, account linking, recovery and saves of unpublished items MUST NOT trigger initial public publication. Previously published items follow the accepted update/removal rules in FR-024.
- **FR-022**: Clipper MUST own publication eligibility, schemas and disclosure. Initial confirmation selects the item, reviewed content and destination DID; the approved latest-saved behavior may advance an unissued version after Jazz acceptance. Each issued write MUST retain its exact content version, destination and authorized scope. Payloads MUST exclude unselected private content, organization, credentials and capability-bearing links; approved bounded public quotation context is disclosed in the preview. Destination/authority changes or unresolved conflict/deletion pauses block new issuance; issued effects retain their original owner.
- **FR-023**: Public publication MUST have its own retained operation identity, selected source revision, target record identity and receipt/reconciliation facts. Local intent persistence, Jazz remote acceptance, PDS acceptance and later public discovery MUST remain distinct. Unknown writes MUST be reconciled at the original target before retry; no blanket exactly-once or cross-service atomicity claim is permitted. A later Jazz rejection MUST NOT be represented as undoing a public write. Exact issuance eligibility and multi-device coordination require consumer design and qualification.
- **FR-024**: Initial publication MUST be deliberate. For selected published items, Jazz changes MUST propagate after relevant server acceptance without separate republish confirmation. Source deletion/Trash MUST request public deletion; restoring previously published Trash items reuses their public address subject to conflict/deletion pauses. Explicit unpublish retains local content and stops later synchronization until explicitly published again. External content edits/deletions MUST pause for resolution rather than silently overwrite/import/recreate. Deletion requests MUST distinguish acceptance from unknown outcomes and MUST NOT promise erasure of third-party copies.
- **FR-025**: MVP publication MUST support remaining unpublished and explicit public publication without depending on AT Protocol Spaces. Restricted-audience publication, private PDS storage, end-to-end encrypted publication and bidirectional Jazz/PDS synchronization are deferred. Existing app storage permissions MUST remain enforceable; neither sign-in nor being unpublished is a new confidentiality guarantee.
- **FR-026**: DLF MUST keep reusable verified-identity, session and consent/capability boundaries independently adoptable. Clipper owns public-content models, publication workflow, durable journal and retry/removal policy; Finance owns financial models and has no publishing workflow. Generic publication infrastructure MUST NOT be added to DLF without separately evidenced reuse and review.

- **FR-027**: Each consumer MUST own its backend integration in its existing repository, with no central login app or shared credential service. Clipper's selected Vercel deployment uses the existing Jazz store and native auth adapter; a separate Netlify frontend or Neon database is not required. Secrets and durable OAuth state remain server-side; deployed restart and refresh coordination require qualification.
- **FR-028**: The selected host MUST support the adopted Jazz transport and resource lifetime. Callback success alone MUST NOT be described as qualification of sync, storage durability or multi-instance operation. A remote Core, where used, needs independent compatibility evidence and MUST NOT imply storage migration. The Vercel backend MUST NOT be assumed to supply always-running public synchronization jobs.
- **FR-029**: After setup and linking, supported offline reads and edits MUST use retained local data/authority without per-operation online authentication. Offline edits MUST survive browser closure and cold restart. Expired remote sessions and service outages MUST NOT alone erase local data, replace the selected account or discard edits; reconnect MUST preserve pending work and report remote outcomes separately. Fresh-device sign-in and new linking require connectivity; known revocation and explicit logout follow the qualified policy rather than being bypassed.
- **FR-030**: Consumers MUST expose actual local record/attachment availability and MUST NOT equate local-first storage with a fully downloaded workspace. Qualification MUST exercise cold restart, durable offline edits, expired sessions, provider/backend/Core outages, reconnect and recovery on the exact adopted build before completion claims.

### Key Entities

- **Shared identity**: Environment-qualified provider identity; verified issuer/subject semantics and subject stability are required. It is not a Jazz account ID.
- **App account mapping**: Registry-authoritative association between an external identity and a Jazz account within an app/environment; existing local-first identity may remain another route to that account.
- **Session binding**: One selected app account, dependency configuration, resource owner and generation. A replacement creates a new scope even when returning to the same account ID.
- **Transition outcome**: Confirmed success, failure, cancellation before issuance, conflict, partial completion or unknown acceptance; includes only nonsensitive correlation facts.
- **Environment**: Explicit production, development or disposable-preview trust boundary, with its own permitted registrations and storage scope.
- **AT Protocol identity binding**: Verified DID and supported authentication-boundary mapping; mutable handle/PDS discovery is separate metadata, never a replacement identity key.
- **Publication intent and receipt (consumer-owned)**: Explicitly selected source revision, approved public payload/destination, retained operation/record identity and observed public-write outcome. Contains no authentication secrets and is not a shared DLF domain schema.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In every qualified two-app scenario, one external identity resolves independently in both apps; zero records become accessible solely because both apps recognize that identity.
- **SC-002**: All existing-account linking and recovery scenarios preserve the original account identifier, record ownership and permissions, with zero silent account replacements or discarded records.
- **SC-003**: Every conflict, cancellation, outage and unknown-outcome case in the qualification matrix produces an explicit bounded outcome; zero uncertain operations are blindly replayed.
- **SC-004**: Every stale-generation and environment-isolation case rejects the obsolete or foreign authority; no secret appears in captured URLs, application diagnostics or persisted workflow snapshots.
- **SC-005**: Every supported logout and recovery journey reports its actual scope and completion status, including partial failures and offline limitations.
- **SC-006**: Every identity-only Finance and unpublished Clipper scenario performs zero PDS content writes and requires zero repository-write permissions while retaining qualified Jazz functionality.
- **SC-007**: Every publication scenario retains the selected item/destination and the exact issued version. Unpublished items produce zero automatic public writes; published-item updates follow accepted Jazz versions without bypassing scope or conflict/deletion pauses.
- **SC-008**: Every interrupted publication/removal scenario retains its original target and explicit outcome across restart; reconciliation creates zero duplicate records in the qualified scenarios and never claims deletion of third-party copies.

- **SC-009**: Every qualified post-link offline cold-restart scenario retains the original account and locally available data; supported edits survive a second restart with zero discarded edits or replacement accounts, including expired remote sessions.
- **SC-010**: Every reconnect scenario preserves original pending operations and reports actual remote acceptance, rejection or conflict; unavailable attachments are never reported as complete locally available content.
- **SC-011**: Each consumer can deploy its backend integration from its existing repository on its selected host (Clipper: Vercel); transport and cross-instance OAuth/session qualification is recorded without requiring a new central login application.

## Assumptions

- This feature starts a separately authorized scope beyond foundation FR-006's deferral of automatic SSO. It does not reinterpret that historical scope as already implemented. Foundation recovery is app-scoped here; recovery material is never a shared-sign-in transport.
- Initial consumers are browser apps on independent origins. Native applications require separate qualification before any support claim.
- Shared sign-in and safe linking remain the first implementation scope. Explicit publication is an optional subsequent consumer slice; no consuming-app change, authentication/publication implementation, dependency upgrade or service provisioning is authorized by this specification task.
- Existing foundation review findings remain outstanding. Transition safety depends on actual settlement evidence, not an assumption that those findings have been fixed.

## Responsibilities and capability boundaries

| Owner                 | Responsibility                                                                                                                                                       | Boundary                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DLF                   | Reusable identity intent, safe linking/recovery orchestration, session lifecycle and typed outcomes; optional publication-capability separation                      | Reuse existing session owner; no second registry, credential transport or Clipper publication engine           |
| Consuming app         | App ID/environment, routes, domain data/policies, disclosure integration and domain write settlement; Clipper's public payloads, consent, journal and reconciliation | No shared identity implies domain authorization or public disclosure; Finance needs no publication integration |
| Jazz SDK and registry | Account handles, app-scoped assignments, link protocol, credential admission, runtime persistence/synchronization                                                    | Client source observations do not prove deployed registry behavior                                             |
| Identity provider     | Authentication, provider session, supported credentials and provider recovery                                                                                        | No ownership of app domain policies; app session hosting is consumer-owned                                     |
| DUI                   | Generic accessible presentation                                                                                                                                      | No identity policy or credential ownership                                                                     |

Public DLF capabilities must expose actual readiness, recovery and lifecycle outcomes while
delegating account following/linking to Jazz. They must not require a second manual
connect/login coordinator. Exact shared interfaces remain for review. Provider credential acquisition stays behind an explicit adapter boundary; raw secrets are not UI or actor snapshot fields. Exact interfaces and statecharts belong to a later approved design, after provider and registry qualification.

## Deferred cross-app data access

Future access requires explicit authorization for a named requesting app, granting app/account, resource scope, operations, duration and revocation behavior. Identity correlation alone, matching email or a provider session is insufficient. App-owned policies must enforce least privilege and preserve auditability, consent withdrawal and offline revocation limitations. No cross-app grants, shared directory, data migration, account merging, token brokerage or speculative sharing platform is designed in this feature.

Explicit public publication is a separate consumer-owned export, not a private cross-app data grant.
Its opt-in boundary is specified above; it does not authorize another app to read the Jazz source.

## Implementation decisions and sequence

See [research](research.md) for pinned SDK evidence and provider candidates,
[AT Protocol integration research](atproto-research.md) for current code/spec findings and version
limits, [authentication feasibility](auth-feasibility.md) for the published-version comparison,
registry evidence and conditional recommendation, and [qualification](qualification.md) for required evidence. Provider/bridge choice,
persistent backend operator, domains/callbacks, stable DID-to-Jazz mapping, supported Jazz
admission, recovery availability and logout scope must be resolved before identity implementation
planning claims readiness. Publication additionally needs a separately reviewed Clipper design for
public Lexicons, exact source eligibility, consent, durable operation ownership, reconciliation and
removal. Clipper's Margin-plus-companion direction and grouped synchronization subset are selected; no
live companion namespace or Bluesky feed integration is selected. Provider compromise/migration
and unlinking require an explicit later recovery design; no unlink/delete/merge capability is implied.

The [single-user delivery direction](delivery.md) supersedes research recommendations to wait for
a published release or choose a separate JWT-provider bridge by default. Exact source/artifact
pinning, existing-data preservation and supported backend integration are implementation work to
complete and demonstrate. They are not reasons to defer the project awaiting upstream publication.
