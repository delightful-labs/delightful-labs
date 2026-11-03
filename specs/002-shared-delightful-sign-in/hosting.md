# Hosting and local-first architecture direction

Recorded 2026-11-03 following the user’s request to incorporate the hosting and offline discussion.
This is a selected direction with unrun deployment qualification, not a working hosting integration.

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
