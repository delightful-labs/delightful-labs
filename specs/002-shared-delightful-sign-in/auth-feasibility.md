# AT Protocol identity to Jazz: version and authentication feasibility

Investigated: 2026-11-03. Branch: `research/atproto-jazz-auth`.
Baseline: merged shared-sign-in spec at DLF `04e7659` (PR #14).
Status: **source/package investigation complete; integration not runtime-qualified**.
No authentication implementation, account provisioning, dependency upgrade or implementation tests.

**Later user direction:** proceed for the user's own apps using a pinned source build if needed,
preserving existing data. [Delivery sequence](delivery.md) supersedes all published-release
prerequisites and continued specification-only restrictions in this historical investigation.
Backend-owned auth is the implementation target; a JWT bridge is not the default. The source
findings and data/identity preservation obligations below still apply.

Follow-up PR/issue review on the same date establishes that backend-owned authentication is
**merged, approved upstream direction**, rather than an experimental candidate inferred only from
code. See [upstream delivery status](#upstream-delivery-status). Target that architecture in the
next spec decision, retaining publication, migration and local-first qualification gates. A JWT
provider bridge is now a fallback for a separately demonstrated delivery constraint, not an equally
preferred new architecture. This recommendation does not itself approve an SDK upgrade.

## Conclusion and recommendation

There is no evidenced drop-in AT Protocol login integration for this project's published Jazz
version. Keep `jazz-tools@2.0.0-alpha.59` as the project baseline while making the authentication
boundary an explicit implementation gate. Do not install classic Jazz, track raw upstream main,
forward PDS access tokens to Jazz, or create a DLF token issuer to bypass that gate.

The preferred architecture to qualify is an app-owned backend session established by the maintained
AT Protocol OAuth SDK, using the verified DID as its stable user identifier, then admitted through
Jazz's backend-owned authentication boundary. That boundary exists in upstream source but is **not
available in a newer published Jazz 2 release found in this investigation**. It is a conditional
recommendation for a future reviewed release, not an implementation-ready dependency selection.

If delivery must stay on alpha.59, the alternative is an operated, maintained identity-provider
integration that authenticates AT Protocol users and issues ordinary, app-audience JWTs trusted by
Jazz. The JWT half is evidenced; the end-to-end provider integration remains unqualified. Better
Auth is a plausible candidate, not a selected solution. A community AT Protocol adapter examined
below does not meet our adoption bar without further review and qualification.

The practical decision is therefore: qualify a published successor's backend-auth path when
available, or separately qualify a provider bridge for alpha.59 if sign-in must ship sooner.
No upstream release date or hosting choice is assumed. Product requirements can be finalized with
this dependency gate explicit; implementation planning must not claim the gate has passed.

## Reproducible package and source provenance

Registry metadata was retrieved with `npm view`, packages with `npm pack`, and relevant JS/type
files extracted into temporary storage. Downloaded SHA-512 digests matched registry `dist.integrity`.
No package code or install scripts were executed, and the repository manifest/lockfile were not
changed. Temporary paths are inspection scratch space, not required repository artifacts.

| Artifact                                                                                                     | Exact observation                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`jazz-tools` registry metadata](https://registry.npmjs.org/jazz-tools)                                      | `alpha` = `2.0.0-alpha.59`; `latest` = classic `0.20.19`. Full published-version enumeration found no Jazz 2 release newer than alpha.59. Tags can move; recheck before implementation.                                                                                   |
| [`jazz-tools@2.0.0-alpha.59` tarball](https://registry.npmjs.org/jazz-tools/-/jazz-tools-2.0.0-alpha.59.tgz) | Integrity: `sha512-LwRv/QU5QuJIM5tAUj+Mw/0M9O1GdSYTC5KzIjF+dYRoOWDYyXMFOrNMP3iA407nbNhDNtXVRY8BzVbdNt7E6A==`. Inspected actual distributed `dist/accounts`, `dist/session`, backend types and public exports.                                                             |
| [Jazz release tag](https://github.com/garden-co/jazz/tree/f0ada4cefcf52a4ebe478413419440da13b06508)          | `v2.0.0-alpha.59` points to `f0ada4c`; tagged package manifest also says alpha.59. Rust registry/server findings below use this commit, not current main. This is source provenance, not verification that a deployed server or packaged native binary was built from it. |
| [Jazz main snapshot](https://github.com/garden-co/jazz/tree/daa5d1ce70525f2c990c7feeb735dd70928b867a)        | `daa5d1c`, also the snapshot previously reviewed in PR #14. Its backend authentication surface differs from the published alpha.59 package.                                                                                                                               |
| [`@atproto/oauth-client-node@0.5.13`](https://registry.npmjs.org/@atproto/oauth-client-node/0.5.13)          | Published Node client inspected from tarball; requires Node >=22. Integrity: `sha512-44CGFsVXEY/xMq66f4EgYT1mQd7pPaFJdwxjpfJ3HCNQN/bLD8ipaeVuICsER2143XGibSc8b4v/TFhOMYLTfQ==`.                                                                                           |
| [`@atproto/oauth-client@0.9.0`](https://registry.npmjs.org/@atproto/oauth-client/0.9.0)                      | Node package declares `^0.9.0`; this investigation explicitly inspected 0.9.0, not a qualified resolved dependency graph. Integrity: `sha512-7yweZVCW4E52mpprrmU23oU0iZwdIjb6tybgJEwIOjN3HgJ5eXrL+afUY5bckDC5IkvrKfnj1QljW+3e6t9G9g==`.                                   |

Reproduce version discovery with `npm view jazz-tools dist-tags --json` and
`npm view jazz-tools versions --json`; obtain exact metadata with
`npm view jazz-tools@2.0.0-alpha.59 dist --json`. Use `npm pack` into a temporary directory and
inspect files without installing the project or running the downloaded SDK. Links below pin the
corresponding release-tag sources where available; distributed JS/types are the API evidence.

## What alpha.59 actually supports

The distributed `dist/session/state.d.ts` exposes `registerJWT`, `loginJWT`, `loginOrRegisterJWT`
and `linkJWT`. `dist/backend/index.d.ts` exports `createJazzSession`/`createJazzContext`; it does
not export the newer `createJazz` authentication surface. Neither `loginWithBackend` nor
`linkWithBackend` is present in the distributed account/session API.

[Release-tag enrollment source](https://github.com/garden-co/jazz/blob/f0ada4cefcf52a4ebe478413419440da13b06508/packages/jazz-tools/src/accounts/enrollment.ts)
matches the inspected behavior: external identity is an exact issuer/subject pair, and the core
independently verifies its credential. Account requests use `Authorization: Bearer`, reject
redirects and omit ambient cookies. The token response from an unrelated OAuth system is not a
credential Jazz can automatically accept.

The [tagged server verifier](https://github.com/garden-co/jazz/blob/f0ada4cefcf52a4ebe478413419440da13b06508/crates/jazz-server/src/middleware/auth.rs)
requires configured external issuer and audience as well as signature/key validation; EdDSA and
ES256 are among supported asymmetric algorithms. Configuring JWKS alone is insufficient. Each
app/environment must have deliberately scoped trust and token audiences. Backend impersonation
is not a shortcut: account-control handlers require actual user bearer authentication and reject
the impersonated-session header.

Jazz's distributed Better Auth connector requests `/token`. Better Auth's official
[JWT plugin](https://better-auth.com/docs/plugins/jwt) supplies signed JWT/JWKS endpoints separate
from its session cookie. This establishes a compatible architectural boundary, **not** an already
working AT Protocol provider or cross-origin sign-in deployment. Use a provider's supported JWT
facility if that route is chosen; do not hand-roll an issuer in DLF.

## The AT Protocol verification boundary

The [OAuth specification](https://atproto.com/specs/oauth) permits authentication-only use with
minimal `atproto` scope. Finance needs no repository-write permission. AT Protocol is not generic
OIDC: issuer/PDS discovery and verification of the returned DID's authority matter, including when
accounts migrate. Its access tokens are DPoP-bound, unlike Jazz's ordinary bearer admission.

In the inspected published OAuth core:

- `dist/oauth-client.js`, `authorize` stores authorization state, PKCE verifier and DPoP material;
  `callback` requires stored state, removes it, checks response issuer and exchanges the code.
- `dist/oauth-server-agent.js`, `exchangeCode` calls `verifyIssuer(sub)` before returning the
  identity. That method resolves the DID without stale/cache allowance and checks the resolved
  authorization-server issuer. A foreign server cannot establish a DID by merely claiming it.
- Refresh rechecks authority. A migrated account may need fresh authentication; the old session
  failing refresh is not a new identity or permission to create another Jazz account.
- `NodeOAuthClient` requires supplied state/session stores and warns when no cross-instance lock
  is provided. Durable OAuth material and coordinated refresh are hosting responsibilities, not
  ordinary Jazz domain rows or DLF actor snapshots.

These are SDK responsibilities, not DLF protocol work. The host still owns browser/session binding,
the intended DID, login versus linking intent, allowed return destinations, and stale/cancelled
callback rejection. OAuth state verification alone is not evidence that a callback belongs to the
currently selected Jazz account. Verify the expected DID before admission and confirm an account
change explicitly; mutable handle text is display/discovery metadata.

The official [OAuth patterns guide](https://atproto.com/guides/oauth-patterns) also documents
requesting a subset of declared scopes and later reauthorization for expanded scopes. This
supports identity-only first, optional publication later. The selected SDK/server deployment and
replacement-session semantics still require qualification; publication remains outside this task.

## Newer upstream backend authentication

At [`daa5d1c`, `backend/create-jazz.ts`](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/packages/jazz-tools/src/backend/create-jazz.ts),
`createJazz({ authenticate })` asks the application backend to identify the request. The backend
resolves/registers an app user at Core; user IDs become subjects under the backend's issuer.
[`accounts/enrollment.ts`](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/packages/jazz-tools/src/accounts/enrollment.ts)
contains `loginWithBackend` and `linkWithBackend`; local-first linking proves control using a
challenge. Direct JWT enrollment is labeled fixture use in this source, unlike published alpha.59.

An operated app session established by the official AT Protocol SDK could supply verified DID as
`userId` through that boundary. This is an inference from the public-facing upstream interface;
no bundled AT Protocol adapter was established. It avoids introducing an extra JWT provider solely
to translate protocols. It does not eliminate authentication hosting, durable OAuth state,
browser-session security, or per-app Jazz mappings. Each app may authenticate the same DID while
keeping independent sessions; this alone does not create a universal Delightful SSO session.

An upgrade must qualify existing storage, account IDs, app/issuer namespaces, local-first root
compatibility, linking, source policies and offline restart. `guestKeyAfterLink` can keep or revoke
guest authority; preserving existing recovery is mandatory for this spec. A build from raw main
is not an approved substitute for a pinned, reviewed release.

## Registry questions resolved at the release-tag source level

Sources: [account HTTP handlers](https://github.com/garden-co/jazz/blob/f0ada4cefcf52a4ebe478413419440da13b06508/crates/jazz-server/src/server/routes/accounts.rs),
[registry decisions](https://github.com/garden-co/jazz/blob/f0ada4cefcf52a4ebe478413419440da13b06508/crates/jazz/layers/types/src/account_registry.rs),
and [durable registry adapter](https://github.com/garden-co/jazz/blob/f0ada4cefcf52a4ebe478413419440da13b06508/crates/jazz/layers/types/src/account_registry/storage.rs).
Included upstream tests were read, **not run**.

| Question                                    | Observed source behavior                                                                                                                                                                                                                     | Remaining limit                                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is there a non-creating lookup?             | Authenticated `POST .../accounts/login` calls registry login without registration.                                                                                                                                                           | Public session `loginJWT` also changes selection. A safe reconciliation design must preserve the old selection; do not copy internal HTTP helpers into DLF or assume a read-only public SDK probe exists.    |
| What happens on collision?                  | `AlreadyAssigned` maps to HTTP 409 / `identity_already_assigned`; absent assignment to 404 / `identity_not_assigned`; unauthorized/revoked to 403 / `identity_not_authorized`; unavailable registry to 503 / `account_registry_unavailable`. | These are pinned source findings, not guesses or evidence about deployed infrastructure. A timeout/503 is never absence.                                                                                     |
| Can a link move an identity?                | Candidate must be unassigned, even when its existing assignment is to the same account. No implicit account merging/reassignment.                                                                                                            | Repeating high-level `linkJWT` after success is not a same-account idempotent operation: it starts a new link request.                                                                                       |
| Is accepted-nonce replay supported?         | Reaccepting the same completed nonce returns the active candidate assignment; it does not reactivate a revoked identity. New incomplete intents expire after 300 seconds at this HTTP boundary.                                              | `linkJWT` retains the nonce only inside the method and does not expose a durable recovery receipt. Do not equate server replay handling with a restart-safe public SDK linking workflow.                     |
| How can unknown acceptance be investigated? | Read-only login can establish the candidate's current active assignment, which can be compared with the retained original app account. Durable state retains accepted decisions.                                                             | A matching assignment establishes access to the intended account, not proof of which invocation won. Supported SDK integration, races and crash recovery still need design and real-authority qualification. |

## Recovery and offline resumption are different gates

Distributed `dist/accounts/enrollment.js` allows recovery-secret export only from a live local-first
handle. A linked external handle cannot export that secret. Linking adds an identity without
revoking the founder in the inspected registry, preserving the existing recovery route in principle.

However, `dist/accounts/persistence.js` retains root material but sets persisted `selected = null`
when an external identity is selected. `dist/session/state.js` may ensure a local-first account
when startup has no selection and `initial: "local-first"`. This is not evidence of automatically
resuming the linked account offline. A naive startup can select/create unrelated local work while
provider restoration is unavailable. Retained roots are not an approved implicit account-selection
mechanism, and must never become provider payloads or cross-app transport.

Before approving the integration, specify and qualify explicit recovery/continuation of the intended
local account after linking and provider outage. Do not promise seamless offline cold restart on an
external handle, or solve it with a second DLF credential store. New external-only accounts still
need a product decision on recovery; no local phrase exists merely because Jazz stores local data.

## Community bridge examined, not selected

[`vineyardbovines/better-auth-atproto` at `a2a6d1d`](https://github.com/vineyardbovines/better-auth-atproto/tree/a2a6d1d291b7fe792366c4118b5fd23d3b9c9515)
declares version 0.1.0 and wraps `@atproto/oauth-client-node ^0.3.17`. Its
[`src/index.ts`](https://github.com/vineyardbovines/better-auth-atproto/blob/a2a6d1d291b7fe792366c4118b5fd23d3b9c9515/src/index.ts)
does use the maintained SDK, a DID account key and Better Auth sessions. It is not a first-party
Better Auth integration established by this research.

Adoption concerns observed directly in its code:

- Default scope is `atproto transition:generic`, broader than Finance identity-only use.
- Callback infers linking from a current signed session cookie rather than a separately bound
  link intent. The shown session-row lookup does not check expiry; existing-DID users are selected
  before the current-user linking branch. These behaviors need reconciliation with our explicit
  intent/conflict requirements, not automatic adoption.
- `callbackURL` is stored from input and later redirected to; no return-destination allowlist is
  visible in that handler. Framework protections would need independent verification.
- A single DID-keyed OAuth session store is shared, and no `requestLock` is passed to the SDK;
  production refresh concurrency and device/session semantics are unqualified.
- It calls Better Auth `internalAdapter` methods and fabricates placeholder email metadata.
  Exact version compatibility, identity uniqueness and non-email-based linking need qualification.

These findings are an adoption assessment, not a completed security audit or a claim of an
exploitable vulnerability. Do not fork this adapter into DLF as an unreviewed workaround. Other
OIDC bridge services surfaced during discovery but were not source-qualified; their marketing
claims do not establish a replacement recommendation.

## What this resolves, and what comes next

Resolved by inspection: exact published version; absence of newer published backend-auth APIs;
the AT Protocol/Jazz credential mismatch; identity-only scopes; registry error/lookup/replay
semantics in tagged source; external-selection/offline risk; candidate bridge adoption concerns.

Still open before implementation: supported release/provider path; operator and domains; browser
session/consent ownership; public-SDK reconciliation and offline continuation; recovery/logout
product choices. Existing qualification rows Q-02–11, Q-13, Q-19–20 remain unrun.

Next reviewed task should confirm the backend-auth target and scope a disposable identity-only
qualification after its implementation is separately authorized/reviewed. Required evidence includes
real bearer admission in two app namespaces, preserved local-account linking, lost responses and
restart, recovery, expired/revoked sessions, handle/PDS changes and denied repository writes.
Clipper publication and infrastructure provisioning remain subsequent tasks.

For the newer backend path, qualify backend session admission rather than assuming the older user
bearer API remains public. The bearer exercise above applies to the alpha.59/provider fallback.

## Upstream delivery status

Checked public PR metadata, descriptions, issue conversations and available release PRs on
2026-11-03. npm tags were rechecked: `alpha` still points to alpha.59. GitHub's repository metadata
reports `has_discussions: false`; the Discussions URL returns 404. There are no repository GitHub
Discussions available to inspect. No comments, issues or requests were posted upstream.

| Upstream item                                                                           | Observed status                      | Relevance                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#4560: `createJazz` inside the backend](https://github.com/garden-co/jazz/pull/4560)   | Merged 2026-11-02 17:31 UTC          | Establishes `authenticate(request)`, same-origin sync/sign-in, backend account resolution and embedded/remote Core. This is delivered on main, not just a proposal.                                                                                              |
| [#4566: remove client JWT sign-in](https://github.com/garden-co/jazz/pull/4566)         | Merged 2026-11-02 19:02 UTC          | Explicitly removes public client JWT enrollment/linking and moves consumers to backend sign-in. Examples remove Better Auth's JWT plugin/token plumbing. This makes a new alpha.59 JWT bridge a likely migration burden.                                         |
| [#4597: harden backend linking](https://github.com/garden-co/jazz/pull/4597)            | Merged 2026-11-02 21:03 UTC          | Purpose-specific, single-use guest proof; keep/revoke guest key options. Approval comment records same-guest/user idempotence for retrying failed revocation. Those details matter for preserving recovery and handling partial completion.                      |
| [#4571: SvelteKit hybrid example](https://github.com/garden-co/jazz/pull/4571)          | Open                                 | Description exercises `linkWithBackend` preserving local guest work, reload and backend login in SvelteKit. Relevant future reference, not merged or independently reproduced qualification.                                                                     |
| [#4570: adopter-style release gate](https://github.com/garden-co/jazz/pull/4570)        | Open                                 | Proposed release validation packs and installs example apps outside the monorepo before production builds/browser tests. The PR describes local passes; that is not a passing published-release gate.                                                            |
| [#4644: pinned-session serializable reads](https://github.com/garden-co/jazz/pull/4644) | Open                                 | Fixes a reported regression where `createJazz` serializable transactions reject with `serialization_conflict` after the permissions-bundle change. #4570 explicitly depends on this fix. Track it before consumers requiring those transactions upgrade.         |
| [#4274: alpha.59 server migration](https://github.com/garden-co/jazz/pull/4274)         | Open, draft                          | One-time RocksDB-to-SQLite server data migration; preserves account journal/history in its described scope. Tool is not shipped, has unsupported cases and needs its destination ref repinned. It does not establish migration of browser-local unsynced writes. |
| [#4631: thin browser default](https://github.com/garden-co/jazz/pull/4631)              | Open                                 | Proposes thin-first provider startup and optional local-first upgrade. Thin-only operation cannot be treated as satisfying DLF's offline persistence requirements; qualify an explicit supported local-first configuration.                                      |
| [#4565: hosting documentation](https://github.com/garden-co/jazz/pull/4565)             | Open, draft; framed as alpha.61 docs | Vercel/Cloudflare/self-hosting guidance is still changing. Do not confuse the merged authentication boundary with universal hosting readiness or select an operator from docs placeholders.                                                                      |
| [#3914: Version Packages](https://github.com/garden-co/jazz/pull/3914)                  | Closed; describes alpha.59           | Recent matching release-PR search found no newer Version Packages release candidate. npm remains the evidence for public package availability.                                                                                                                   |

### Approval evidence and limits

The [`aeplay` approval comment on #4560](https://github.com/garden-co/jazz/pull/4560#issuecomment-6583595552)
records Anselm's approval via project chat. Similar approval records exist on
[#4566](https://github.com/garden-co/jazz/pull/4566#issuecomment-6585518627) and
[#4597](https://github.com/garden-co/jazz/pull/4597#issuecomment-6587693566). These comments explicitly
identify themselves as generated summaries of project-chat approval; they are not public transcripts
of the underlying chat. Merged state was checked independently through PR metadata.

This supports deliberate maintainer adoption of backend-owned authentication. It does not establish
a promised release date. References to alpha.60 describe the current workstream; no public ship date
or guaranteed final version was found in the inspected conversations. Do not label every remaining
PR above a release blocker: #4570's dependency on #4644 is explicit, while the broader adoption gates
are ours.

### Issue evidence must be read with its resolution

- [#4061](https://github.com/garden-co/jazz/issues/4061) documented a retained external-account
  revalidation trap on a later main snapshot. It is closed as completed. It is corroboration that
  external-session readiness changed during development, not proof that the exact alpha.59 package
  or current backend path has that same bug. Our alpha.59 offline observation comes from its tarball.
- [#3728](https://github.com/garden-co/jazz/issues/3728) originally recorded an alpha.60 decision
  to refuse old local stores, with unsynced-write loss on wipe/resync. Its later
  [closure comment](https://github.com/garden-co/jazz/issues/3728#issuecomment-6432241899) says the
  Groove engine was replaced by SQLite and the issue no longer describes main. Do not present the
  earlier decision as a current SQLite migration contract. The draft server importer and actual
  browser-upgrade behavior must be evaluated separately.

### Revised spec handoff

Recommend specifying the supported backend-auth contract as the target now, with the exact
published release pinned before implementation. Keep AT Protocol verification/session ownership
outside DLF's domain data; use the verified DID as app user identity under a stable app authority.
Keep separate app mappings and independent local-first adoption.

Before upgrading, require: a published compatible SDK/server set; the relevant linking/security
fixes; preserved account mapping/recovery; a supported server-data migration; a browser-local
pending-write upgrade strategy; and explicit local-first setup rather than reliance on defaults.
For serializable consumers, also require the pinned-session fix or equivalent demonstrated behavior.
These are concrete readiness conditions, not a recommendation to wait indefinitely or to treat
merged code as production-qualified.
