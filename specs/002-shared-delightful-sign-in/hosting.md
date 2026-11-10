# Hosting and local-first architecture direction

**Current status (2026-11-10):** [Merged Clipper implementation and remaining work](spec.md#current-implementation-checkpoint--2026-11-10) supersede historical source-build, JWT/Neon, Netlify-only and snapshot-publication instructions below. Jazz alpha.60/Vercel and native Jazz-backed identity are implemented in merged Clipper PR #20; shared DLF/Finance adoption, hosted live-provider qualification and public publication remain open. No existing research edits were discarded.

## Historical investigation and decisions

Recorded 2026-11-03 following the user’s request to incorporate the hosting and offline discussion.
This is a selected direction with unrun deployment qualification, not a working hosting integration.

## Deployment feasibility research — 2026-11-06

This review responds to the user's request to establish what is possible before requesting more
choices. It uses the approved, successfully built Jazz commit
[`11bcbf6367e62eca399d13da1fda939b2ae6ef36`](https://github.com/garden-co/jazz/commit/11bcbf6367e62eca399d13da1fda939b2ae6ef36),
its implementation/tests, current official platform documentation, and upstream issue evidence.
It does not select a provider, session format, public API, or exact authentication process.
The older direction and evidence below remain historical; this review qualifies their claims.

### Main findings

1. **Self-hosting the Jazz database is optional.** The pinned `remote({ url, appId, secret })`
   store explicitly supports Jazz Cloud. A separately operated core is also supported. The app
   backend still sits between browsers and the core and names authenticated users.
2. **Our backend is more than an OAuth callback.** It admits sync connections, supplies trusted
   user identity/claims, serves account lookup/link/sign-in routes, and forwards sync to the core.
   Moving OAuth alone to Netlify does not remove that sync role.
3. **A conventional persistent Node service is a straightforward candidate, not the only possible
   host.** Vercel WebSockets became generally available on 2026-10-20, and this exact Jazz source
   includes a Vercel WebSocket handler. Earlier reasoning must not generalize Netlify's limits to
   every function platform.
4. **An all-Netlify deployment is not established for this build.** Functions can serve OAuth
   requests with durable external state, but Jazz's HTTP sync fallback retains session objects in
   a process-local map. Follow-up requests must reach the same process. A remote database or durable
   OAuth store does not move that live socket/session object into shared storage.
5. **Keeping the Netlify frontend is feasible as an architecture, but the split origin is real
   integration work.** Default Jazz account and HTTP-stream fetches use `credentials: 'same-origin'`.
   An origin allowlist alone does not make browsers send cookies to a different origin. Endpoint,
   cookie, credentialed-fetch and WebSocket behavior must be checked together.

### What the pinned source proves, and what it does not

| Evidence                                                                                                                                                                                       | Finding                                                                                                                                  | Limit                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Remote store and backend implementation](https://github.com/garden-co/jazz/blob/11bcbf6367e62eca399d13da1fda939b2ae6ef36/packages/jazz-tools/src/backend/create-jazz.ts)                      | `remote` connects to an external core, including Jazz Cloud; forwards a backend credential on HTTP and WebSocket requests                | Does not prove the deployed managed Cloud tenant accepts this unreleased protocol    |
| [Remote-core integration tests](https://github.com/garden-co/jazz/blob/11bcbf6367e62eca399d13da1fda939b2ae6ef36/packages/jazz-tools/src/backend/create-jazz.integration.test.ts)               | Synthetic remote core supports backend-fronted reads/writes, shared accounts across backend instances, guest use and reconnect scenarios | Tests inspected, not run here; core is a local server, not managed Jazz Cloud        |
| [Server backend-credential tests](https://github.com/garden-co/jazz/blob/11bcbf6367e62eca399d13da1fda939b2ae6ef36/crates/jazz-server/tests/admin_secret_credential.rs)                         | Matching core understands `X-Jazz-Backend-Credential` and stated access                                                                  | An older deployed core need not support this API                                     |
| Backend `streams` map and `ownStream`                                                                                                                                                          | Unknown process-local session returns an error explicitly requiring one instance or sticky routing                                       | HTTP streaming support by itself does not qualify a function host                    |
| Backend `nextHandler`                                                                                                                                                                          | Integrates `@vercel/functions.upgradeWebSocket` with `acceptSocket`                                                                      | No generic equivalent Netlify handler was found; not a deployed Vercel qualification |
| [Browser account requests](https://github.com/garden-co/jazz/blob/11bcbf6367e62eca399d13da1fda939b2ae6ef36/packages/jazz-tools/src/accounts/registry-client.ts) and HTTP-stream implementation | Default HTTP credentials are same-origin; account configuration permits a supplied fetch implementation                                  | A custom account fetch does not automatically change the stream's own global fetches |
| Built artifact manifests                                                                                                                                                                       | Coherent JS/WASM/native build at approved commit; native target is `aarch64-apple-darwin`                                                | That native addon cannot simply be shipped to a Linux backend                        |

The pinned Cloud documentation has stale calls (`createJazz({ appId })` and `remote` without
`appId`). The implementation now requires app ID in `remote` and rejects it at the top level.
[Upstream issue #4773](https://github.com/garden-co/jazz/issues/4773) independently records these
same documentation defects. Use pinned code/public declarations when examples disagree.

### Hosting choices

| Deployment                                                              | Feasibility for this build                                                                        | Additional work / limitation                                                                                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Netlify frontend + one Node backend on Railway/Render + Jazz Cloud      | Strong candidate using existing Jazz remote and socket APIs                                       | Managed Cloud protocol acceptance, split-origin auth and matching Linux artifacts need demonstration; OAuth state still needs durable storage                                          |
| Netlify frontend + Node backend with Jazz SQLite on a persistent volume | Supported source architecture; avoids managed Cloud version dependence                            | Operates the database and attachments as well as auth; durable disk, native Linux build and server backup responsibilities increase                                                    |
| Vercel backend + Jazz Cloud                                             | Credible serverless alternative with an explicit pinned SDK WebSocket adapter                     | Function-lifetime reconnects, correct adapter entry point, durable auth storage and Linux/native packaging need qualification; this is not an automatic SvelteKit/Netlify adapter swap |
| Vercel backend + Jazz `vercel()` store                                  | Explicit SDK implementation using Vercel Sandbox/Drive                                            | More platform-specific infrastructure; unreleased custom build requires a compatible Linux core tarball URL, not a download of published alpha.59                                      |
| Netlify Functions for OAuth + separate Jazz backend/core                | OAuth is request-based and can fit                                                                | Splits cookies/session verification and deployments without removing the Jazz backend; not the shortest default path                                                                   |
| Netlify Functions for the whole backend + Jazz Cloud                    | No unchanged working deployment established                                                       | Remote storage solves database durability, not process-local stream affinity or finite function lifetime                                                                               |
| Netlify Edge Functions for the whole backend                            | Not a drop-in path                                                                                | Deno runtime, 50 ms CPU budget, Node-native imports and missing qualified socket/server adapter; listed WebSocket client API does not prove inbound server upgrade support             |
| Browser-only OAuth + direct browser-to-Cloud Jazz                       | AT Protocol OAuth alone supports SPAs; this combination is not the selected Jazz auth integration | A browser-asserted DID is not trusted Jazz backend authentication; would require a separately supported admission architecture                                                         |

[Railway networking](https://docs.railway.com/networking/public-networking/specs-and-limits) supports
WebSockets without its HTTP duration/inactivity limits. [Render WebSockets](https://render.com/docs/websocket)
remain open until their instance stops; reconnect on deployment remains necessary.
[Render disks](https://render.com/docs/disks) persist files, but constrain a disk-backed service to
one instance and prevent zero-downtime deploys. [Railway volumes](https://docs.railway.com/volumes)
provide persistent mounted storage. Neither product choice is approved by this comparison.

Railway's [Hobby pricing](https://docs.railway.com/pricing/plans) starts at $5/month including $5
resource usage; excess usage is billed. That is not an all-in estimate: backend memory/CPU/egress,
auth persistence and Jazz Cloud usage still depend on the actual deployment. No supported all-in
Jazz Cloud price was established, so do not quote one.

### Netlify-specific constraints

[Functions configuration](https://docs.netlify.com/build/functions/configuration/) documents a
60-second synchronous execution limit. [Proxy rewrites](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)
have a documented 26-second timeout. A plain rewrite is not evidence of a correct persistent sync
proxy; do not put it in the architecture as if transport were already solved.

[Edge APIs](https://docs.netlify.com/build/edge-functions/api/) list a WebSocket API. That is not
proof that the platform upgrades inbound HTTP requests to WebSocket servers or can run this Node
backend unchanged. The backend imports `jazz-napi` at module scope even for a remote store.
The existing Cloudflare Wasm smoke fixture in Jazz explicitly does not qualify authentication,
durable storage or production sync; it is not evidence for a Netlify edge deployment.

### OAuth feasibility and how to keep the first slice small

The official [AT Protocol OAuth specification](https://atproto.com/specs/oauth) supports identity-only
`atproto` scope. It also supports browser-only OAuth, so AT Protocol itself does not mandate an
always-running server. The app-owned backend requirement here comes from the selected Jazz trust
boundary and confidential-client integration, not from the fact that the SDK is unreleased.

The official [Node SDK README](https://github.com/bluesky-social/atproto/blob/main/packages/oauth/oauth-client-node/README.md)
provides maintained discovery, PKCE/DPoP, callback verification, state/session stores and refresh.
Its `requestLock` coordinates session access across instances. The
[official Next.js tutorial](https://atproto.com/guides/oauth-tutorial) demonstrates durable SQLite
storage and links a Railway-hosted demo. That validates a conventional Node/durable-store approach
for OAuth, not Jazz integration or a requirement to adopt Next.js, Kysely or those exact schemas.

The [OAuth session-storage guidance](https://atproto.com/guides/oauth-patterns) distinguishes provider
OAuth sessions from the app session the browser uses. No requirement was found to contact the PDS
on each local edit or each Jazz operation. Local authority, app authentication and optional future
publication remain separate. For authentication-only use the protocol permits completing identity
verification without making PDS content requests. Long-term OAuth-token retention and app-session
lifetimes still need design; do not assume they are the same thing.

A single backend instance with durable state can avoid designing distributed refresh coordination
for the initial deployment. Multiple instances require working locking and shared stores; do not
pretend an in-memory store survives restarts. Storage mechanism and record shapes remain open.
Backup archives intentionally exclude login secrets; do not put OAuth/session credentials into the
shared content archive or make future data transfer responsible for authentication storage.

### Recommendation and concrete next evidence

Recommend retaining Netlify's frontend and evaluating **one conventional Node backend with Jazz
Cloud as the first storage candidate**. Railway and Render both expose the runtime/network primitives;
Railway is a reasonable first host candidate, not a selected provider. Keep OAuth and Jazz admission
in that one backend rather than splitting OAuth into another service. DLF supplies shared integration;
Clipper keeps schemas and its server entry point. No new login app is needed.

Before spending effort on host-specific deployment, demonstrate the built SDK with synthetic data
on one local origin, then qualify a disposable managed Jazz Cloud app against the pinned remote API.
Managed compatibility is the decisive unknown; local remote-core tests do not answer it. Confirm
account connection, fresh-device lookup, ordinary writes and reconnect—not merely a health response.
Do not provision or alter a Cloud tenant as a read-only research action.

If Cloud is incompatible, use the matching core on a single persistent service as a concrete fallback,
or revisit the build with evidence. Do not silently upgrade production or invent a token bridge.
Validate the Netlify split-origin cookie/account-request/WebSocket path before calling retained
Netlify hosting complete. If it needs extensive customization, report that tradeoff against serving
the UI and backend on one origin; no frontend migration is selected by this research.

A deployment also needs matching Linux native artifacts built from the approved commit. Local
macOS artifacts are enough for local investigation, not deployment. Test offline startup with the
explicit local-first loader: this build otherwise defaults to a thin client and upgrades in the
background. First-use and retained offline behavior must meet the product requirement, not merely
match a default configuration.

### Research limits

No tenant was created, no existing service/data changed, no new dependency installed, and no hosted
end-to-end test run. Shell egress remains restricted; the web tool could read the Cloud dashboard
landing page but could not access the sync root. That says nothing about an authenticated tenant's
compatibility. Platform documentation establishes available primitives, not our deployed integration.
No questions or user choices are required to report these findings. Further account/hosting writes
and choices of data shapes/processes remain outside this research.

## Deployment roles and code ownership

| Role                                              | Recommended deployment                                                   | Code/configuration owner                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Finance / Clipper frontend                        | Retain existing Netlify sites                                            | Respective app repository                                            |
| App OAuth/session and Jazz backend                | Persistent service per app, operator to be selected                      | App-owned server entry point imports reusable DLF helpers            |
| OAuth state, sessions and refresh coordination    | Durable server-side storage and qualified cross-instance coordination    | App deployment; supported storage adapter through shared integration |
| Jazz Core                                         | Existing remote Core where compatible, or separately reviewed deployment | App/operator; no implicit relocation                                 |
| Shared identity workflows and integration helpers | Library imported by consumers                                            | DLF repository/package; no standalone hosted DLF login app required  |

A different runtime deployment is not a different product or repository. Each app keeps independent
Jazz namespace, sessions, policy and server secrets. This design does not introduce a central SSO
broker, shared cross-app cookie, second token issuer or shared domain database. Provider-managed
sign-in session reuse remains distinct from each app’s own authenticated session.

## Source evidence

The inspected [Jazz create-jazz implementation at daa5d1c](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/packages/jazz-tools/src/backend/create-jazz.ts)
provides `createJazz({ authenticate })`, a request handler, WebSocket adapters and HTTP stream
fallback. `remote()` documents forwarding to a separate Core while browsers use the application
backend. This establishes separate app-backend/storage roles; it does not establish compatibility
with the user’s actual current hosted Core.

Crucially, HTTP stream sessions are retained in a process-local `Map`. `ownStream` explicitly
returns an error stating that HTTP stream sessions require a single backend instance or sticky
routing when a session is missing. A generic request handler surface alone therefore does not
prove safe deployment on stateless function instances. WebSocket and HTTP fallback behavior must
be qualified on the exact adopted build and chosen host.

[Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/) documents
finite execution limits, including 60 seconds for synchronous functions. This supports request-based
OAuth endpoints, but is not evidence of the persistent instance/routing behavior the inspected
Jazz stream implementation requires. The recommendation is one persistent backend for the combined
OAuth/session/Jazz boundary; Netlify frontend retention does not depend on forcing that boundary
into Netlify Functions. This is scoped to inspected code, not a claim that every future Jazz
adapter or every Netlify runtime is inherently incompatible.

The [official AT Protocol Node OAuth SDK documentation](https://github.com/bluesky-social/atproto/blob/main/packages/oauth/oauth-client-node/README.md)
describes caller-supplied state/session stores and `requestLock` for coordination across multiple
instances. The prior investigation inspected npm `@atproto/oauth-client-node@0.5.13` and core
`@atproto/oauth-client@0.9.0`. In-memory stores and process-local locks do not suffice across
independently executing function instances. Durable storage and distributed coordination remain
application hosting responsibilities, not a new DLF credential protocol. No storage product or
persistent compute provider is selected solely from these documents.

## Local-first operation

The sign-in server establishes verified identity and supports authorized sync. Supported local
reads/edits continue against retained device data/authority. After linking, offline cold restart and
edits surviving a second restart are required even when remote sessions expire; remote outages
must not manufacture replacement accounts or erase pending work. Known revocation and explicit
logout follow reviewed policy, and local usability never asserts fresh remote authentication.

First external sign-in on a new device and new linking require connectivity. Reconnect may require
reauthentication; pending edits stay owned while that occurs. Remote rejection/conflict must remain
visible and distinct from prior local durability. Uncached records/attachments remain unavailable;
local-first does not promise a fully downloaded workspace or unlimited protection from device
storage eviction. Backups provide a separate recovery layer.

Clipper public publication is an explicit online action with separate consent and acceptance.
Ordinary saves and sync do not publish; Finance has no publication dependency.

No offline behavior is considered proven by this hosting review. The alpha.59/source comparison
already found post-link restart risks; the selected build and adapter must demonstrate the outcomes
in [Q-21–23](qualification.md), alongside existing recovery and transition checks. Persistent hosting
alone cannot fix account-selection or browser-durability defects.

## Clipper-first OAuth preparation — 2026-11-06

The approved first slice uses Jazz-native linking/session following in the Clipper web app. The
backend direction already selected above remains: retain the Netlify frontend and operate an
app-owned persistent authentication/Jazz backend. Do not reopen that architecture as an unmade
decision; the service operator and storage implementation are still unselected.

The official Node OAuth SDK README was checked again (file blob
`ddeedd359d28c81b62d54e8346c27e609ee457db`). It requires client metadata at the client ID URL,
callback configuration, signing keys for a confidential web client, and caller-supplied OAuth
state/session stores. Its `requestLock` supports concurrent session access across instances.
Use identity-only authorization for the current scope, not the README's broad publication example.
Jazz's `authenticate` integration consumes app-verified identity; OAuth credentials do not become
Jazz credentials. Application session representation and exact callback process remain open.

Read-only Clipper repository inspection found Netlify frontend/gateway and existing Jazz service
configuration, but no selected separate persistent host in the inspected tooling documentation.
Next ask whether the user has an existing persistent host to reuse before comparing new providers.
No provider, database, OAuth SDK package version, new dependency or server credential shape was
selected or installed by this preparation.

## Published-version bridge follow-up

The user requested reconsidering alpha.59 with an app-owned authentication/JWT bridge, before a
temporary Clipper proof. See the [renewed feasibility research](auth-feasibility.md#published-alpha59-jwt-bridge-reconsideration--2026-11-06).
That route can keep sync off the auth backend, unlike the selected unreleased backend-owned path.
Managed Cloud trust configuration remains unverified; a local core allows a meaningful disposable
proof without asserting Cloud/Netlify compatibility. No production architecture is replaced here.
