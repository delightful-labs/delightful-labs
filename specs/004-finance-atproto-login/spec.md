# Shared AT Protocol login and Finance adoption

Status: implementation verified locally and with a real provider; ready for code review.
Deployment remains outside the current authorization.
Date: 2026-11-20.
Baseline: freshly fetched `origin/main`, `884cb464` (PR #52).

## Outcome and scope

Finance offers the same optional AT Protocol identity login as Clipper, backed by
Jazz and Better Auth. Reusable authentication belongs in `packages/local-first`
(DLF). Both apps consume it; Clipper retains its publication behavior and Finance
requests identity access only. First use, remembered local identities, recovery
phrases and ordinary offline work remain usable without provider connectivity.

This feature does not publish financial data, add AT Protocol repository writes,
share cookies across apps, establish automatic SSO, merge accounts or workspaces,
or change Finance organization membership, ledger permissions or provider-secret
protection. The same provider identity is not permission to read another app's data.
DLF's existing cross-app identity requirements remain binding; cross-app credential
reuse and data access require their own explicit design.

## Current code and constraints

- Clipper's [provider attempt machine](../../apps/clipper/apps/web/src/lib/machines/runtime/atproto.ts)
  owns authorization and attempt-bound callback completion in its worker. Its
  default scope now includes `repo:at.margin.note`; copying that default would
  give Finance unnecessary publication access.
- Its [auth server](../../apps/clipper/apps/web/src/lib/server/auth/server.ts),
  [request machine](../../apps/clipper/apps/web/src/lib/server/auth/request-machine.ts)
  and [completion receipt](../../apps/clipper/apps/web/src/lib/server/auth/completion.ts)
  provide native Jazz storage, request cancellation, origin admission and signed,
  short-lived completion evidence. App name, scope, callback and cookie naming
  are currently Clipper-specific.
- Clipper's [backend](../../apps/clipper/apps/web/src/lib/server/jazz.ts)
  authenticates native Jazz requests using Better Auth sessions, refreshes cookies
  at the HTTP boundary and retains device-account fallback. Jazz owns guest linking,
  returning-user selection and remembered accounts; DLF must not duplicate these.
- Finance's [backend](../../apps/finance/src/lib/server/jazz.ts) currently uses
  `acceptDeviceAccounts`. Its [login form](../../apps/finance/src/lib/components/identity/LoginForm.svelte)
  restores recovery phrases. Its [application worker](../../apps/finance/src/lib/runtime/worker/application.worker.ts)
  already uses DLF session/runtime and recovery composition.
- The lockfile/workspace baseline is Jazz `2.0.0-alpha.67`, Better Auth `1.7.22`,
  AT Protocol plugin `0.3.2` and XState `6.0.0-beta.1`. Clipper's older AT Protocol
  checkpoint describes alpha.60/Better Auth 1.7.18; it is historical evidence,
  not the dependency target. Existing Jazz and provider patches must be inventoried
  and requalified, not silently expanded or assumed upstream fixes.

## Required behavior

1. A new Finance browser opens a usable local account without login. Auth endpoint
   errors, missing optional auth configuration, expiry and network stalls cannot
   block locally available finance data or silently create a replacement identity.
2. An explicit handle submission starts one scoped attempt. Finance requests
   exactly `atproto`; its server rejects publication scopes even if sent by a
   modified client. Clipper explicitly configures its existing approved scopes.
3. Before provider navigation, the application stops admitting affected work,
   drains issued effects, settles acquisition and closes the native session.
   Navigation requires actual close acknowledgment. A failed drain/close remains
   visible and cannot be treated as successful shutdown.
4. On return, completion requires a successful callback receipt matching the
   attempt and current authenticated user. Query parameters or an existing auth
   cookie alone cannot confirm a new sign-in. Invalid, expired, mismatched and
   uncertain completion have explicit outcomes; automatic replay is forbidden.
5. Jazz selects/links the resulting account through its supported native lifecycle.
   Completion evidence does not itself establish Finance workspace readiness.
   Publish ready identity observations only from the native session owner.
6. First linking and returning to an existing identity preserve native Jazz
   semantics. Do not promise transfer of guest transactions into an existing
   account. Preserve both accounts and their data. When login would switch away
   from a local account containing Finance work, explain the switch and require
   explicit confirmation before activating the other account. Cancel keeps the
   current account usable; the original account remains recoverable after a
   confirmed switch. Automatic merging is out of scope. This product decision
   was approved on 2026-11-20; qualify native SDK behavior and the confirmation
   boundary before implementing it.
7. Identity change immediately invalidates old Finance capabilities, queries,
   forms and workspace observations. A late result from A after A → B → A is stale.
   Membership and account grants continue to determine finance access.
8. Sign-out uses DLF's ordered sign-out workflow: Finance resource drain, app auth
   cookie clearance, native Jazz logout. Cookie-clear failure cannot acknowledge
   sign-out. A silently initialized local account does not expose Sign out.
9. Recovery phrase login remains available. Restoring a different account must
   reconcile any existing provider cookie so reconnect cannot select the previous
   identity. Specify and qualify cookie clearance ordering against the real SDK
   before implementation of this mixed-auth path.
10. No Finance amounts, organization names, records, bank credentials, recovery
    material or native account secrets enter provider requests, callback URLs,
    logs or public AT records. AT Protocol login does not unlock SimpleFIN secrets
    or replace passkey requirements.

## Ownership and proposed public boundaries

Use explicit DLF subpath exports, with names finalized in the implementation plan.
Keep server dependencies out of browser/worker import graphs and other DLF users.

| Boundary | DLF owns | Consumer supplies/owns |
| --- | --- | --- |
| `auth/atproto/contracts` | Validated attempt, completion, command and public outcome DTOs | App scope/binding and route intent |
| `auth/atproto/workflow` | Attempt issuance, authorization, deadlines, callback confirmation, cancellation and typed reports | Identity-only or app-approved authorization policy; leaf HTTP/ID/clock capabilities |
| `auth/atproto/server` | Better Auth/provider composition, origin checks, completion receipt and request lifecycle | Canonical origin, secret, app display name, cookie namespace, fixed callback route and explicit allowed/default scopes |
| `backend/jazz/auth` | Native auth schema/policy composition and session authentication/refresh adapters | App-native schema, backend/store acquisition, device-account policy and deployment audiences |
| Optional identity view | Small DUI-based handle/status composition with consumer localization | Screen/layout placement, app navigation and approved copy |

Expose only configuration required by the two consumers. Do not create a general
OAuth framework, backend plugin system or arbitrary hook pipeline. Scope admission
is server-controlled; a browser-supplied string is not an authorization policy.
The reusable default is `atproto`. Publication record APIs, grant interpretation
for publishing, Margin schemas and publication workflows remain Clipper-owned.
If native auth storage includes provider grants, those remain server-private;
storage reuse does not expose publishing capabilities to Finance.

Extract the existing request lifecycle rather than wrapping a multi-stage request
in a promise. Compose auth tables and deny-client-access rules from one canonical
definition, while retaining consumer-generated native schema artifacts and domain
permissions. Preserve table names and stored representation for Clipper; any
schema generator limitation must be demonstrated before choosing an alternative.
App environment parsing, lazy backend singleton ownership, routes and hosting
remain small consumer adapters; no DLF import of app environment variables.

## Lifecycle model

The worker session host owns the provider child for its binding lifetime. Public
commands include begin and cancel; public reports distinguish redirect requested,
callback verified, failed and completion uncertain. Every report carries attempt
and binding generation. Views consume public projections, not private child paths.

| Owner | States / selected progression | Failure and interruption |
| --- | --- | --- |
| Provider attempt | idle → issuing attempt → authorizing → redirect requested; callback entry → confirming → verified | Invalid input, denied authorization, deadline, malformed response, cancel, uncertain completion |
| App session host | active → draining domain work → settling acquisition → closing native session → navigating | Refuse competing restore/sign-out/login; retain outstanding resource custody; late navigation reports ignored |
| Server request | admit origin/path → selected auth handler → validate callback/session → issue or consume receipt → respond | Disconnect, provider/adapter failure, invalid receipt, cleanup and sanitized response |
| Returning session | native acquire/select → local readiness → app workspace readiness | Existing cached identity stays locally useful; remote absence never authorizes destructive repair |

Window code only observes callback location, forwards commands, performs selected
navigation and removes consumed callback parameters. Protocol decisions, validation,
requests and session operations run in the worker. Server requests own finite
request actors and stop them after settlement. Cancellation must not abandon
callback or SDK work that still owns resources. Keep the existing delayed-timer
elapsed-time check as well as state-owned request deadlines.

Receipt validation retains current origin, route, attempt, user, signature and
expiry checks. Use distinct app cookie names with HttpOnly, SameSite and HTTPS
Secure attributes; clear with matching scope. Preserve no-store responses and
same-origin mutation checks. Do not make arbitrary callback destinations or
caller-controlled forwarded hosts trusted configuration. Establish the existing
receipt replay/concurrent-tab behavior and specify any stronger consumption
guarantee honestly before changing storage.

## Finance integration and migration

Add optional provider entry to the existing login/account surfaces while retaining
recovery and destination navigation semantics. Use DUI controls and Paraglide
descriptors; shared machines select outcomes, consumer localization renders them.
Clipper retains i18next through its adapter. Exact strings and catalog generation
receive the repository's separate copy review; this spec proposes no final copy.

Add Finance-local auth route adapters and metadata/callback handling. Configure
Better Auth over the existing Jazz backend, with explicit guest admission and
cookie refresh. Install auth tables through the current native migration path,
preserving account IDs, organizations, transactions, access policies and storage
namespaces. No store reset, new database service, JWT bridge or account registry.
Keep account identifiers distinct: provider DID, Better Auth user ID and Jazz
account ID are separate facts governed by native linking.

Production and preview need separate app auth configuration, canonical callback
origins and secrets. Missing configuration must produce sanitized auth failure
while local startup remains available. Prepare deployment instructions and
rollback/migration compatibility evidence; configuring secrets and deploying are
separate authorized operations. Rollback must not discard newly linked identities
or remove auth tables blindly.

## Delivery plan and cleanup

1. Review this spec, then inventory current SDK APIs, existing patches, auth schema
   generation, native guest/existing-account linking, mixed recovery/provider
   behavior and receipt concurrency. Record state/resource contracts and exact
   configuration before dependent code changes.
2. Extract identity-only contracts, provider chart, request/receipt lifecycle and
   Jazz auth composition into DLF. Consolidate repeated authorization transitions,
   DTO validation and configuration; retain meaningful failure distinctions.
   Use supported SDK APIs first; discuss new patches only for demonstrated gaps.
3. Migrate Clipper to the shared API in the same change sequence. Make its app name,
   cookie namespace, callback and publication scope explicit. Remove replaced
   implementations after locating all consumers. Preserve extension behavior;
   direct extension provider login remains deferred.
4. Integrate Finance's backend and existing worker/session host, resource drains,
   callback entry, identity surface and ordered sign-out. Keep financial policies,
   routes and native domain cleanup app-owned.
5. Review implementation, then add/run the agreed tests under repository gates.
   Update package exports/consumer docs and both apps' identity records. Reconcile
   relevant feature records without overwriting sibling feature selectors.

Cleanup stays within touched authentication code. Avoid a broad session-runtime
rewrite, unrelated formatting, new dependency patches or new localization systems.
Use strict types without assertions or erased actor contracts; retain exact pinned
published XState APIs and one native SDK owner.

## Acceptance and verification plan

These are planned checks, not executed results. Existing Clipper evidence is
provenance, not proof of the extracted alpha.67 integration.

- Package checks demonstrate supported typed exports, server/browser separation
  and two real consumers, without consumer imports into DLF.
- Model/actor coverage exercises deadlines including delayed timers, explicit
  retry/cancel, callback mismatch, failed drain/close, stale bindings, and account
  replacement. Avoid tests that simply mirror internal implementation paths.
- Native Better Auth + Jazz checks cover new linking, existing-user selection,
  auth-table privacy, non-destructive migration and backend reopen, app-session
  expiry/revocation, provider refresh failures and mixed recovery/provider login.
- Finance browser flows cover guest startup, identity-only login/callback,
  same-account reload, returning-device login, recovery, sign-out, destination
  navigation and no exposure of another account's organization data.
- Full browser-process offline restarts reopen the same cached Finance identity
  with app/auth/Jazz unavailable; acknowledged edits survive another restart and
  reconcile on reconnect. Expired cookies do not gate local readiness.
- Clipper regressions cover login, existing publishing scopes and grant handling,
  offline restart and ordered teardown. Preserve documented extension qualification
  limits; green skipped cases do not establish new platform support.
- A separately authorized hosted real-provider check confirms Finance's metadata,
  actual identity-only consent, callback, reload and sign-out. Synthetic provider
  tests cannot establish that result. Do not record secrets or financial content.

Completion requires both apps using the shared identity implementation, Finance
requesting no publication access, preserved local data/access guarantees and
recorded relevant checks. No implementation tests, live login, deployment or
production migration were performed for this specification.

## Technical questions to resolve in implementation planning

- Establish how the native SDK identifies a returning provider-linked account
  and supports confirmation before activating it, while preserving the original
  local account. Confirmation and no automatic merging are approved requirements;
  the mechanism remains to be qualified. If the SDK cannot support this boundary,
  bring the concrete limitation back for review rather than silently switching.
- Confirm ordering for recovery into another identity while a provider cookie
  remains, including offline refusal/failure behavior without identity confusion.
- Confirm schema composition support and receipt replay/concurrent-tab semantics
  with the pinned packages. Preserve current guarantees until stronger behavior
  is designed and qualified.

These questions do not block review of the extraction boundary. They block claims
or implementation choices that depend on their answers.

## Implementation checkpoint — 2026-11-20

The first review batch extracts callback receipt handling and the existing
request/resource statechart into DLF's server-only `auth/atproto/server` export.
Clipper now consumes the shared factory with its existing cookie namespace and
callback route. No publication scope or app domain code moved into DLF, and no
third-party dependency or patch was added. Finance integration remains pending.

Static checks passed: DLF TypeScript, package generation and strict publint,
Clipper Svelte/type diagnostics (zero errors/warnings), workspace dependency
identity checks and whitespace checks. Frozen installation used isolated
node_modules with Node 24.22.2. The localization compiler's network-limited first
generation was repaired by regenerating existing DLF catalogs with plugin access;
no source catalogs or wording changed.

After the user authorized continuation, 27 existing Clipper callback/request/native
session tests passed, including actual Better Auth/Jazz adapter cases. Eight new
DLF receipt cases passed for app cookie isolation, configured callback admission,
forgery/expiry and invalid configuration. This is focused server evidence, not
browser/offline qualification of the complete feature.

The next review batch extracts the provider workflow through
`auth/atproto/workflow`. Its default scope is `atproto`; Clipper explicitly supplies
its publication scope and its existing localized messages. DLF accepts typed
consumer messages so Finance can use descriptors without adopting i18next.
Repeated begin/retry authorization selection now uses one pure helper. The shared
workflow imports no app code or server cryptography. DLF TypeScript and Clipper
Svelte/type diagnostics passed. Provider workflow tests await review of this new
batch under the shared testing guide.

Installed alpha.67 SDK inspection confirms that sessions automatically follow
the backend on startup and subsequent observations; `onSignedOut` only controls
sign-out and is not an account-switch confirmation hook. `linkDeviceAccountOnSignUp`
controls new-user linking, not an existing-user switch. Do not use either as a
general confirmation hook. A supported approach to qualify is confirmation before
starting provider login when local work exists, followed by actual resource close
before leaving the page. Exact destination-account preview is not established by
the current public API. Cross-tab provider changes need explicit review in the
Finance integration design; a prompt after session activation cannot satisfy the
approved requirement. Finance integration and account-preservation qualification
remain pending; no new SDK patch was introduced.

## Shared server checkpoint — 2026-11-20

The user approved the provider extraction. All 16 existing Clipper provider tests
and three new DLF provider tests passed. Native HTTP cases initially failed to
bind a localhost listener under the sandbox (`EPERM`); the same suite passed with
listener access, without test or timeout changes. This covers default identity
scope, consumer feedback, callback correlation, pure admission, cancellation by
owner shutdown and native headers/body deadlines. It does not qualify Finance's
future account-switch integration.

The next review batch moves Better Auth/Jazz server construction to
`backend/jazz/auth` and native tables plus deny-all client permission definitions
to `backend/jazz/auth-schema`. Clipper consumes both, retaining its table names,
stored shapes, auth cookie default and publication scope policy. Its now-unused
app authorization validators were removed; the shared server validates exact
allowed scopes and their default. The identity-only consumer configuration is:

```ts
createAtprotoAuthServer(storage, { origin, secret }, {
	clientName: 'Delightful Finance',
	cookiePrefix: 'finance.auth'
})
```

Neither the default grant nor metadata needs publication scope for this consumer.
The app auth cookie prefix is separate from the callback receipt namespace and
can isolate Finance from Clipper on development hosts. Existing Clipper cookies
retain their current names.

The already-used Better Auth `1.7.22` and AT Protocol plugin `0.3.2` are optional
DLF peers and DLF development dependencies. This preserves consumer package
instances for native adapter integration and avoids installing server auth for
consumers that do not use it. No package versions or existing patches were changed.
Finance runtime dependency declarations and backend adoption remain pending.

Static checks include DLF types, shared library packaging/strict publint, workspace
dependency identities and Clipper's native schema/permission generation check:
all existing generated artifacts remain up to date, with no storage migration
introduced by extraction. Shared server runtime coverage awaits review of this
batch. Next: qualify default-scope refusal and Clipper native regressions, then
adopt the shared backend in Finance before connecting its worker and UI.

## Finance backend checkpoint — 2026-11-20

The user approved the shared server batch. Its seven Clipper auth/permission suites
passed all 37 cases, including two added checks for default identity-only metadata,
actual OAuth PAR scope, publication refusal and invalid default-grant policy.
Native Jazz fixtures required localhost listener access. An existing authorization
test now counts the three rows its operation adds relative to the shared fixture's
starting rows, since the new identity-only case also creates one OAuth state row.

Finance now declares the same approved auth package versions and composes the
shared native tables and deny-all auth permissions. Its backend uses app sessions
when present, retains device-account admission otherwise, and forwards session
refresh cookies. It retains existing storage paths, namespaces and audiences.
The new `/api/auth/[...all]` adapter uses the shared request-handler factory;
Clipper also uses that factory instead of keeping a duplicate HTTP actor boundary.
Finance's app cookie prefix is `finance.auth` and its receipt cookie namespace is
`finance.oauth-completion`. Publication scopes are absent from its configuration.
Unconfigured auth returns a sanitized, no-store 503 without requiring configuration
for device-account startup.

The native generator required a versioned migration. The generated migration
`20261120T111550-atproto-auth-b33f0ec2011b-158daae55415` only creates the six auth
tables. Snapshot comparison confirms every previously existing table is identical;
permission artifact comparison confirms every preexisting table rule is identical.
There are no financial-data transforms or deletions. This is static artifact
evidence, not a persisted-store migration test. No backend was started and no
production or user store was migrated.

Checks passed: Finance Svelte/type diagnostics (zero errors/warnings), Finance
service-worker TypeScript, native schema generation check, DLF types, shared
packaging and strict publint, and Clipper type diagnostics. Existing Finance
localization outputs initially lacked their compiler plugins under restricted
network access; regenerating with plugin access repaired them. Source catalogs
and wording remain unchanged. The native auth route, migration and new HTTP
factory await this batch's implementation review before runtime tests.

Finance's deployment will require its own private `AUTH_SECRET` (at least 32
characters) and canonical `AUTH_BASE_URL` origin. Reuse of Clipper's secret is not
required. Do not expose the secret through public env variables. Metadata and
callback endpoints use `/api/auth`; preview origins need their own valid
configuration. Deployment and secret provisioning remain outside current work.

### Finance copy — approved for implementation

The login form currently describes recovery-phrase restoration only. Existing
messages cannot label a provider handle or explain the approved account-switch
behavior. These proposed keys have no interpolation inputs or plural variants:

| Key | Exact proposed text | Use |
| --- | --- | --- |
| `login.atproto_handle` | AT Protocol handle | Provider input label |
| `login.atproto_sign_in` | Sign in with AT Protocol | Provider submit button |
| `login.atproto_working` | Signing in… | Machine-selected operation feedback |
| `login.atproto_failed` | Sign-in could not be completed. Please try again. | Provider failure feedback |
| `login.switch_notice` | Signing in may open another Finance account. Your current account will be kept, and the accounts won’t be merged. | Confirmation before beginning provider login from a device account |
| `login.continue_sign_in` | Continue to sign in | Explicit confirmation action |
| `actions.sign_out` | Sign out | Explicitly authenticated account action |
| `login.sign_out_failed` | Sign-out could not be completed. Please try again. | Sign-out failure feedback |

Reuse existing Cancel and Try again labels. The existing recovery description
remains attached to recovery, and the existing Login navigation label can title
the combined login page. The user approved the backend batch and this exact wording
by directing continuation after the combined review request. These catalog entries
are now implemented; approval does not extend to unrelated copy.

## Login/confirmation checkpoint — 2026-11-20

The approved Finance backend now passes three focused tests: sanitized unavailable
auth; six-table auth-record privacy against guest and external client sessions;
and persisted migration plus session restart. The migration proof opens the frozen
generated app, permissions and app file from monorepo `884cb464`, creates an actual
organization/account/category/transaction, closes it, then opens the same SQLite
store through the new app's migration. The ledger, organization owner and app ID
are unchanged. It creates a native Better Auth session with the Finance cookie
prefix, reopens again, and verifies the session and ledger. The supported
`JAZZ_APP_DIR` setting selects each fixture's matching app file during native
binding checks; no check is bypassed. Three existing Finance permission suites also
pass all 128 cases. All storage used by these checks is disposable.

The new login/confirmation implementation awaits review before its implementation
tests, as required by the shared testing guide:

- DLF's provider workflow accepts optional confirmation before attempt issuance.
  Confirmation is an explicit state; cancel performs no authorization/navigation.
  Consumers decide when it is needed. Clipper leaves it off and retains its worker
  view shape through its adapter.
- Finance requests confirmation for every active device account, conservatively
  including empty accounts. This avoids a remote or incomplete-local-data probe
  and occurs before authorization can cause Jazz to select another identity.
  There is no automatic merge or second account-selection registry.
- The existing Finance worker owns the provider child. It admits requests against
  the current native binding, revision and source pathname. Confirmation checks
  that admission again. Identity replacement and leaving the initiating route
  cancel pending provider work. Private state is not copied into a second lifecycle;
  the public selector is the child-view observation boundary.
- A validated redirect retains its exact URL, invokes the existing Finance drain
  path, and waits for session, account-store and broker close receipts. Only then
  does a dedicated state request Window navigation. Failures do not acknowledge
  successful close/navigation; explicit navigation retries retain the same URL.
  Window code handles the selected location effect and receipt-verified callback
  parameter removal, with no Jazz construction or account decisions.
- The login page uses DUI input, status and dialog controls with the approved
  Paraglide copy. Recovery remains a separate form. Machine-selected descriptors
  carry both message key and severity; the page only renders them.

Static checks pass for Finance and Clipper (zero Svelte/type diagnostics), DLF,
shared packaging/strict publint, service-worker TypeScript, native schema artifacts
and workspace dependency identities. No login/confirmation implementation tests
or browser/provider checks have run for this new batch. No service was deployed.

Remaining work includes confirmation/cancel and stale-scope model coverage,
native worker/browser drain/navigation tests, offline process restarts, explicit
sign-out, and recovery/provider-cookie coordination. In particular, recovery into
another identity must clear or reconcile an existing provider session through an
owned workflow before native restoration; this is not yet implemented. Signing
back in from a signed-out native session also needs qualification with sign-out
integration. These gaps block release and full-feature completion.

## Sign-out/recovery checkpoint — 2026-11-20

The user approved login/confirmation testing and continuation. The existing
Finance worker suite passed all 72 cases before new cases were added. Its expanded
76-case suite then passed, including confirmation-before-provider-work, waiting
for all close receipts before navigation, route/identity invalidation and native
close failure. DLF's six provider cases passed, including confirmation admission,
cancel without provider work and suppression of late canceled authorization.
These are real-actor unit checks, not browser/offline qualification.

The following new implementation is ready for review before runtime tests:

| Operation | Owner and progression | Interruption / failure |
| --- | --- | --- |
| Explicit Finance sign-out | Finance admits the current backend identity and revision → existing financial/recovery drain → DLF ordered provider/native sign-out → observe native identity and resume Finance | App close records a close continuation while retaining issued work. Provider failure prevents native logout. Changed native identity is not logged out by a late request. |
| Recovery with provider session evidence | DLF validates phrase → Finance acknowledges domain drain → DLF clears provider session → native restore → read resulting identity | Failed clearance does not issue native restoration. Cancellation retains the clearance invocation until settlement, then clears the private credential and declines restoration. |
| Returning login after sign-out | Finance retains the native signed-out binding as an observed fact; a scoped login can start without creating another guest | Binding/revision replacement invalidates pending admission; repeated reports for the same signed-out binding retain it. |

Finance exposes Sign out only for its current backend-authenticated identity; a
silently initialized device account does not expose it. The account page uses the
approved label and failure message. Workflow-selected feedback carries the label,
loading/error severity and result; the view renders it without status-to-key maps.
No new product strings were added in this batch.

The parent retains the selected close/resume continuation as request data; states
own drain, sign-out and resumption. When resuming, Finance refreshes native identity
facts and its observed route/selection generation rather than reopening an old
workspace view. Normal application closure still closes session/store/broker.
Sign-out keeps that runtime available for subsequent login after the native logout.

DLF exports a single `clearAtprotoAppSession` HTTP leaf. Clipper now consumes the
same leaf. The existing ordered sign-out chart retains provider-before-native
ordering and actual settlement. DLF restoration adds optional
`clearProviderSession` capability with explicit preparation/clearance states.
Its failure result now accurately permits `mutation: 'notStarted'`; that field
describes native restoration, not whether cookie clearance itself took effect.

Finance supplies clearance for recovery from a backend identity or an unresolved
provider callback. Ordinary guest recovery without provider evidence keeps the
existing offline path. When provider-session clearance is required, offline or
unavailable auth refuses the restore instead of selecting a local identity that
the old provider cookie could replace on reconnect. No SDK patch, speculative
cookie manipulation, parallel account registry or global logout was introduced.

Static checks pass for Finance, Clipper, DLF, shared packaging/strict publint,
schema artifacts, service-worker TypeScript and dependency identities. The new
sign-out/clearance behavior has not yet had implementation tests run. Remaining
qualification covers its settlement and failure interleavings, recovery regressions,
signed-out login, actual browser controls/focus, native worker navigation,
offline browser-process restarts and a separately authorized real-provider check.
No deployment or live-provider login was performed.


## Local verification checkpoint — 2026-11-20

The user approved the sign-out/recovery implementation and remaining local
verification, including fixes discovered during that work. Earlier checkpoint
statements about awaiting review or unrun coverage describe those earlier batches;
this checkpoint supersedes them.

The shared Jazz authentication/refresh hooks now live alongside the server factory
as `createJazzAuthHandlers`. Both apps use the same native session checks,
device-account fallback and refreshed-cookie forwarding. App backend acquisition,
storage, audience policy and environment configuration remain app-owned. The
optional public auth entries and recovery clearance contract are documented in
`packages/local-first/docs/next-app.md`.

Verification found and fixed two application issues: the confirmation trigger must
remain focusable while its dialog is open, and removing the verified callback
parameter must notify both location and route observers. Otherwise subsequent
workspace navigation can retain the old callback URL as its expected source.
A same-binding native session observation now also updates authentication facts,
so backend login metadata is not discarded. Regression coverage preserves these
behaviors. Fixture fixes wait for actual post-callback workspace readiness, open
the relevant drawer sections, and close unavailable sync upgrades rather than
leaving a dead socket open. Assertions and timeout limits were retained.

Passing focused checks:

- DLF: 112 cases across six suites cover provider attempts/completion,
  restoration/provider-clearance settlement, ordered sign-out and native
  restoration behavior.
- Finance: 82 worker cases plus three native auth/schema migration cases.
  The persisted migration starts from the frozen pre-auth baseline and preserves
  existing identity, native tables and the migration ledger. The previously
  qualified 128 permission cases also pass.
- Clipper: 65 cases across 11 affected auth, gateway, sign-out and permission
  suites pass after the shared hook extraction.
- Finance and Clipper production builds pass, as do both apps' Svelte/type checks,
  DLF library types and strict package validation, Finance test/service-worker
  types, native schema generation checks, scoped formatting/lint, workspace
  dependency identity checks and `git diff --check`.

The focused six browser cases now pass in Chromium, Firefox and WebKit. They use
real application workers, native Jazz storage/backend sessions, signed completion
receipts, cookies and the production service worker with a disposable asset
manifest. The provider authorization redirect is synthetic; these checks do not
claim live-provider OAuth interoperability. The flow verifies existing-account
switching without merging or exposing the previous account's wallet, provider
cookie clearance before recovery, signed-out re-login, full browser-process
restart without a provider cookie, two fully offline process restarts with retained
local writes, and reconciliation after reconnecting. The separate native offline
restoration-refusal/remount regression also passes in all three engines.

The full 72-case native browser regression suite passes across Chromium, Firefox
and WebKit (237.89 seconds). This includes the existing Finance workflows and the
new confirmation/account-switch/sign-out/recovery/offline scenarios. A final type
cleanup uses direct narrowing for the optional callback attempt instead of a
non-null assertion; the six provider workflow cases and library types pass again.

No user store, existing server, production configuration, deployment or
live-provider session was changed. Hosted rollout still needs the app-owned
`AUTH_BASE_URL` and `AUTH_SECRET` configuration, and an end-to-end check against a
real AT Protocol provider. No commit, push or deployment was performed.


## Setup and native session follow-up — 2026-11-20

Following the user's request to continue, Finance now documents the supported
server environment, origin/cookie boundaries, additive storage migration, account
switching and recovery behavior in `apps/finance/docs/atproto-login.md`, linked
from its README. The guide includes an isolated real-provider verification
procedure and distinguishes process environment variables from Vite env-file
values. It introduces no product copy or hosting changes.

Finance's current native auth suite now directly qualifies the extracted
`createJazzAuthHandlers` hooks: admission does not renew a near-expiry session;
the native refresh request renews it, forwards cookies and returns the expected
backend subject; revoked and expired sessions are rejected; the linked native
account survives those credential changes. This closes a current-integration
coverage gap previously represented by an older upgrade fixture.

All four Finance auth tests pass with disposable native stores, and Svelte/type
checks pass with zero errors or warnings. Scoped formatting and diff checks pass.
The preceding 72-case browser result remains applicable: this follow-up changes
only documentation and native test coverage, with no runtime code changes.
A hosted real-provider round trip remains open; no commit, push, deployment,
production configuration or live-provider session was changed.


## Hosted preview checkpoint — 2026-11-20

The user explicitly approved committing, pushing and creating an isolated Finance
preview for provider qualification. The implementation was rebased onto freshly
fetched main `614d8d40` without conflicts, then committed and pushed as
`e7d4c785` on `docs/finance-atproto-login`. The incoming main changes were
unrelated documentation and Finance test-fixture fixes.

Vercel project `delightful-finances` built the branch successfully. Preview-only,
branch-scoped `AUTH_BASE_URL` and an independently generated sensitive
`AUTH_SECRET` were configured. The branch alias is
`delightful-finances-git-docs-fi-b29966-mjamesderochers-projects.vercel.app`.
Production settings and storage were not changed. A request using the API target
`staging` was rejected by automatic approval review; the documented safer preview
operation (omitted target, reusing the verified preview source) was accepted and
returned `target: null`.

Authenticated metadata checks exposed an actual production-only failure:
Better Auth's IP validator called `z.validate`, but Finance's built server had
externalized Zod imports to Finance's older Zod 4.1.11. Better Auth's own pinned
Zod 4.6.7 supplies that API. Native source tests preserved the proper dependency
resolution, and requests without forwarded IPs did not reach the failing branch.
Temporary sanitized diagnostics identified the TypeError and bundle source
location; they have now been removed and branch debugging has been disabled.

Finance SSR now bundles Zod so each importer keeps its compatible installed
version. There is no dependency upgrade, override, SDK patch or disabled rate
limiting. A new `check:auth-build` check runs the actual emitted route in production
mode with a forwarded IP: it reproduced `500 !== 200` before the rebuild and
passes after the fix. Finance CI runs this check after its existing production
build. Five native auth cases, the production build and Svelte/type checks pass.

Anonymous provider metadata discovery still redirects to Vercel Authentication.
A temporary exception for only the branch-preview alias has been requested but
has not been granted. No protection exception or real-provider login has been
performed. The Vercel connector created temporary authenticated share access for
agent verification; that does not make metadata publicly fetchable by a provider.


Hosted fix verification: deployment `dpl_516639M21ptFgMonfq7DuEhSTdwZ` of
commit `6b9976dd` is READY in Preview (SvelteKit, Node 24, iad1; build 71.3 seconds).
Through authenticated access to the branch alias, the metadata endpoint returns
200 with the exact Finance client name, branch-origin client/callback URLs and
`scope: atproto`. A fresh disposable Chromium context successfully opened the
hosted login page, displayed both the AT Protocol handle input and sign-in button,
and observed no failed HTTP responses. The context was closed after this check.
No provider authorization or sign-in was issued. Real-provider qualification
remains pending the requested preview-alias protection exception and owner login.


## Real-provider verification — 2026-11-23

The user authorized continuing the real-provider test, including the temporary
preview-alias access exception previously explained, and supplied their full
AT Protocol handle. Only the known Finance branch alias received the exception;
project-wide protection and production were unchanged. Anonymous metadata returned
200, advertised Delightful Finance with exactly `atproto`, and pointed to the
same preview origin for its callback.

The owner completed provider authentication directly in Chrome; no password,
recovery phrase, cookie, provider token or financial content was collected or
saved as evidence. An initial attempt using an assumed handle suffix failed
before provider authentication; using the owner's full custom-domain handle
resolved the account and completed the real Bluesky authorization flow.

Observed results in the deployed browser:

- The device-account switch confirmation appeared before authorization.
- The provider returned successfully to Finance, the callback parameter was
  removed from the address bar, and the account page exposed Sign out.
- Reloading retained the signed-in account and Sign out control.
- Sign out removed authenticated account controls; the login form remained usable.
- Signing in again reached Bluesky's password page. After the owner completed it,
  Finance reopened the same personal workspace and exposed Sign out again.

The owner completed the provider pages; a separate consent-screen screenshot was
not captured. Scope evidence is the served metadata plus the earlier native
provider-request tests. This real-provider check supplements, rather than
replaces, the 72-case browser regression and offline/cross-account qualification.
No financial transactions or profile changes were made during the live check.

Afterward, the alias-only protection exception was revoked. An anonymous metadata
request again returned 302 to Vercel Authentication, confirming cleanup. The owner
was left signed in to the test Finance account. The tested app deployment remains
`dpl_516639M21ptFgMonfq7DuEhSTdwZ`, runtime commit `6b9976dd`.
Real-provider sign-in/reload/sign-out/returning-login qualification is complete.
Nothing was merged or deployed to production; the branch is ready for code review.
