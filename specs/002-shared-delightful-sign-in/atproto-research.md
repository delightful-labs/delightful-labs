# Jazz-native storage with AT Protocol identity and public publication

Research date: 2026-11-03. Status: source/specification inspection, **not runtime qualification**.
This continues PR #14. No SDK upgrade, authentication service, publication implementation or
consumer migration is authorized. Product requirements are in [spec.md](spec.md); exercises remain
unrun in [qualification.md](qualification.md).

## Selected exploration and consumer constraints

The user selected Jazz-native application storage, AT Protocol identity, and explicit social
publication as the first architecture to explore. Finance is the identity-only case: financial
records remain in Jazz and it needs no public-write capability. Clipper's notes and highlights
are the publication case: keep originals in Jazz and export only explicitly confirmed content.
These are requirements from the user, not conclusions inferred from other apps' code.

“Private” needs two meanings kept separate. Staying unpublished preserves the app's existing
storage/access scope; it does not establish host-blind encryption or exclude existing workspace
members. Publishing to selected AT Protocol recipients would require a different permissioned
distribution design. MVP can defer the latter without making all notes public or weakening Jazz
authorization. Identity adoption must not require publication adoption.

## Evidence and its limits

| Primary source inspected | Finding | Consequence |
| --- | --- | --- |
| [AT Protocol OAuth specification](https://atproto.com/specs/oauth) and [`OAuthSession` source](https://github.com/bluesky-social/atproto/blob/727701085829daf8e0440253346b5e70fc3810ad/packages/oauth/oauth-client/src/oauth-session.ts) | OAuth includes account authentication with DID validation, PDS/auth-server discovery, PKCE and DPoP. SDK sessions expose the DID as `sub`; requests use the token's audience and DPoP fetch wrapper. | Use the maintained protocol integration. A caller-supplied DID or raw token is not proof of identity to Jazz. AT Protocol OAuth is not an arbitrary OIDC ID-token issuer. |
| [Permission specification](https://atproto.com/specs/permission) | Public repository permissions can constrain collections and actions; user consent grants application authority. | Finance should not request public writes. Clipper publication requires its own scoped consent. The exact initial/renewed consent journey needs SDK/provider qualification; incremental consent is not presumed available. |
| [Public repository specification](https://atproto.com/specs/repository) | Public records have collection/rkey identities and verifiable content. Repository location is resolved from the DID document. | Public records are an export destination; handle and PDS location are not stable identity keys. Account migration and metadata refresh need qualification. |
| [`com.atproto.repo.putRecord` Lexicon](https://github.com/bluesky-social/atproto/blob/727701085829daf8e0440253346b5e70fc3810ad/lexicons/com/atproto/repo/putRecord.json) | Caller supplies repo, collection, rkey and record; response carries URI/CID. `swapRecord`/`swapCommit` support conditional writes, with `InvalidSwap` declared. | A retained target and conditional writes are tools for reconciliation. They do not prove exactly-once publication, cross-service atomicity or a complete crash/multi-device recovery design. |
| [Spaces alpha announcement](https://atproto.com/blog/atproto-spaces-alpha), [proposal 0016](https://github.com/bluesky-social/proposals/blob/main/0016-permissioned-data/README.md), and [implementation PR #5187](https://github.com/bluesky-social/atproto/pull/5187) | Permissioned records exist as an evolving alpha. Spaces provide access control rather than E2EE and have their own sync path. | Public-only export need not depend on Spaces. Deferral avoids making alpha private distribution a shared-login prerequisite; it does not claim Spaces is infeasible. |
| [Jazz active sync implementation](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/crates/jazz/layers/db/src/sync.rs) | Authority orders accepted writes, replicas retain pending writes, and acceptance/rejection rebases pending transactions. Server subscriptions evaluate the client's permissions. | Retain Jazz's native authority and synchronization. A PDS write receipt cannot stand in for Jazz acceptance. |
| [Jazz account enrollment](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/packages/jazz-tools/src/accounts/enrollment.ts) and [registry client](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/packages/jazz-tools/src/accounts/registry-client.ts) | Current source labels direct JWT enrollment as test-fixture use and exposes backend sign-in/linking. Registry JWT requests still use bearer authorization rather than the AT Protocol DPoP client. | Do not equate current upstream with the pinned alpha.59 API, or treat a PDS access token as a Jazz credential. |
| [Jazz `createJazz` backend](https://github.com/garden-co/jazz/blob/daa5d1ce70525f2c990c7feeb735dd70928b867a/packages/jazz-tools/src/backend/create-jazz.ts) | `authenticate(request)` supplies an app-verified user; backend sign-in resolves the account. `linkWithBackend` uses a local-first challenge proof. `guestKeyAfterLink` can keep or revoke guest authority. | Backend-owned integration is a source-evidenced candidate for AT Protocol identity. It is not proof of a working AT Protocol adapter or compatibility with existing accounts. Keeping recovery is an explicit qualification obligation, not an assumed default across releases. |

AT Protocol source above is pinned to main commit `7277010`; Spaces PR head observed as
`d009736` was still draft/open. Jazz source is pinned to main commit `daa5d1c`.
Living specifications/announcements were reviewed on the research date and can change.

### Critical version boundary

DLF's declared Jazz peer remains `2.0.0-alpha.59`. The earlier [research](research.md) records
inspection of that installed version and its JWT linking flow. This continuation had no local
installed Jazz package in the DLF or Finance worktree to reproduce that inspection; it read
upstream source at the explicit commit instead. No dependency installation or version change was
made. Upstream backend authentication findings are **not** a qualification receipt for alpha.59.

Before design selects an API, compare a reproducibly installed alpha.59 with the chosen release
and establish its supported public authentication surface. Evaluate a maintained external identity
integration compatible with alpha.59, or a separately reviewed SDK upgrade/backend integration.
Neither an improvised DLF JWT issuer/token exchange nor copying current upstream internals is an
approved workaround. If no supported path preserves existing accounts/recovery, sign-in remains
unqualified. The baseline JWT research and newer backend research are alternatives to investigate,
not two protocols to combine into an assumed implementation.

## Identity integration questions that remain open

1. Which maintained OAuth client and operated authentication boundary verify DID control? If a
   separate provider is necessary, which supported integration exposes stable identity to Jazz?
   If newer Jazz backend authentication is selected, which public release supports it?
2. What stable subject representation maps the verified DID into each app's Jazz namespace?
   Handle changes and PDS migration must preserve that association. A provider's subject stability,
   issuer changes and existing mapping collisions need evidence, not a guessed UUID formula.
3. How does independent-origin authentication reuse consent/session state, if supported? Shared DID
   continuity is required; seamless prompts or sibling-cookie/token access are not assumed. Each
   app establishes its own trusted session. Operator, domains, recovery and logout remain decisions.
4. How are current local-first accounts linked without premature registration of a second account?
   Verify unknown acceptance, retained recovery, revoked identities and account conflicts against
   the selected release's actual account authority before planning implementation.

The shared capability must distinguish verified identity, app-account mapping, Jazz readiness and
optional PDS publication authority. Failure or expiry of publication authority must not silently
replace the app account. No application-specific content belongs in an identity proof or token.

## Public export design constraints for the later Clipper slice

This is a design handoff, not a new DLF publication engine or settled statechart/API.

- Clipper defines the public Lexicon, source attribution/anchors and destination behavior. A custom
  public record is not automatically a Bluesky feed post; discovery and any cross-post are separate
  product decisions. Do not pick an unverified highlight schema or publish the whole source page.
- A reviewed snapshot binds exact content, destination DID and source authorization. Public payloads
  exclude unselected context and sensitive reference URLs. Jazz keeps the source and app permissions;
  a public export does not open its workspace or make Jazz IDs useful access credentials.
- A durable publication journal needs intent/target identity before issuance and receipt recovery
  after issuance. Model ownership and states for review, eligibility, consent, issuance, acceptance,
  unknown outcome, reconciliation and removal before async actors. Identity change invalidates
  unissued intent and isolates in-flight work without claiming cancellation undoes a PDS write.
- Saving the Jazz source and publishing are separate effects. Design must establish when source
  authority is sufficient to issue publication, including pending/rejected Jazz writes. A PDS write
  can succeed while receipt persistence fails; a later Jazz rejection cannot retract public copies.
- Reconcile the known public target after an unknown response. Reuse its identity and validate
  revision/content before retrying; absence, overwrite conflicts, multi-device races and account
  migration need real qualification. Do not infer idempotency from the existence of `putRecord`.
- Public updates require renewed explicit intent. Removal targets the public repository record,
  preserves the Jazz original, and cannot guarantee erasure from relays, indexes or third-party copies.

The first implementation planning task is identity feasibility/version selection. Public export
design and consumer adoption follow separately, so Finance and shared sign-in are not blocked on
Clipper schemas, feeds, Spaces or a general-purpose sharing platform.
