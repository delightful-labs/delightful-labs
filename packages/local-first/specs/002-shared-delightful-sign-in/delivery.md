# Single-user implementation and data-preserving adoption

**Current status (2026-11-10):** [Merged Clipper implementation and remaining work](spec.md#current-implementation-checkpoint--2026-11-10) supersede historical source-build, JWT/Neon, Netlify-only and snapshot-publication instructions below. Jazz alpha.60/Vercel and native Jazz-backed identity are implemented in merged Clipper PR #20; shared DLF/Finance adoption, hosted live-provider qualification and public publication remain open. No existing research edits were discarded.

Direction updated: 2026-11-03, following the user's instruction that Finance and Clipper currently
serve only them and that implementation should proceed without waiting for a published Jazz release.
This replaces the research recommendation to require publication before consumer adoption. Preserving
the user's data remains a delivery requirement. No live data has been changed by this document.

## Clipper-first specification continuation — 2026-11-06

The user selected Clipper as the first integration consumer, with Finance following later. Begin
with specification of first use and returning access from scratch. The user selected starting
locally: clipping and writing require no AT Protocol sign-in, with optional connection later.
Clipper opens directly into local use on every device, without a startup choice or sign-in gate.
Optional connection and returning sign-in are available in settings without proactive prompts. The user selected
connection for access to the same library across devices first, with
Jazz retaining storage and synchronization responsibility. Local work created before signing in must join the existing library through standardized DLF
behavior shared across apps. Assess existing backup capabilities for reuse; current backup restore
targets new workspaces and does not already provide this existing-library behavior. The connection
and transfer processes and data shapes remain undecided. Initially keep both local and existing
content copies; real merging is deferred future shared DLF work. This does not authorize duplicate
transfer effects on retry. Bringing local work into an existing library requires confirmation;
declining discards the local work and continues into the existing library. The choice must make
that consequence clear. Exact presentation, deletion mechanics and timing remain undecided. A separate Clipper recovery option is deferred beyond this first slice; do not
promise independent new-device recovery if the connected AT Protocol account is inaccessible.
This does not authorize removing existing recovery behavior or changing Finance recovery. Public publication remains
a subsequent Clipper slice. Consult the user before new decisions, and do not select data shapes
or exact processes. See the [Clipper-first scope and open decisions](spec.md#clipper-first-continuation--2026-11-06).

This supersedes the Finance-first adoption order below. Finance backup work remains required before
changing deployed Finance identity/storage; it is not a prerequisite for Clipper specification work.
The user confirms Clipper has no real data to migrate. Its initial identity model and recovery
experience require user decisions; no existing-account migration is a prerequisite for this design.
The historical backup/build sequence below does not select that sequence for Clipper. No implementation, migration or deployment is authorized by this
specification continuation, and the active backup feature pointer is unchanged.

The user approved shared ownership: DLF handles the bring-or-discard decision, transfer lifecycle,
progress, interruption handling and prevention of repeated transfer effects. Consumers supply domain
content, relationships, validation, permissions and record access. Reuse suitable backup pieces;
exact extraction boundaries, interfaces, data shapes and transfer processes still require user decisions.

### Revised connection direction — Jazz-native first

The user approved using Jazz's built-in automatic linking and backend-session following to reduce
custom orchestration. This supersedes the fresh-settings-intent restriction below and the proposed
explicit DLF linking controller. Connecting may occur from discovery of an authenticated app session
without another settings action or confirmation. Local work plus a different existing library is
accepted as outside the supported first version; Jazz's account switch is not data transfer. Keep
the reusable SDK integration in DLF. Exact public contracts, backend OAuth/session data and hosting
remain unselected; local-first behavior still requires qualification.

### Earlier connection intent decision — superseded by Jazz-native direction

The user selected connecting the current local library after the settings Connect action and
successful AT Protocol sign-in, without a second confirmation, when the identity has no existing
Clipper library. This is not permission to connect from incidental backend session discovery or
to transfer local work into an existing library. SDK configuration and exact process remain open.

### Approved first-release reduction

First deliver local use, optional AT Protocol connection to the locally started Clipper library,
and returning access on another device with no local work, in the web app only. Extension AT
Protocol sign-in is deferred; preserve existing extension admission behavior. Bringing local work into a different
existing library is deferred, including bring-or-discard, transfer retry/interruption design and
real merging. The shared DLF responsibility boundary and user decisions above are future work,
not first-release gates. Future failed transfers retain local work for retry; only explicit discard
authorizes discard. Do not implement transfer machinery in this first slice. Handling a device with
local work attempting to enter another existing library remains a user decision before implementation.
Publication and separate Clipper recovery remain deferred.

## Target

Use AT Protocol's maintained OAuth SDK for identity, an application-owned backend session, and
Jazz's merged backend-authentication API. Keep Jazz-native application storage, explicit local-first
behavior, separate Finance/Clipper accounts and app permissions. Finance requires no repository-write
permission. Clipper publication remains a later, independently reviewed consumer slice.

A reproducible source-built Jazz artifact is acceptable for this single-user implementation. It must
identify an exact source commit and any reviewed patches, compatible JS/WASM/native artifacts and
their digests. No floating branch dependency, automatic SDK updates or second JWT-provider service
is required. Published packages can replace the build later after comparison; publication is not a
prerequisite for implementation or adoption.

## Implementation handoff (2026-11-05)

The shared backup foundation and complete test app reference are implemented and qualified through
[PR #26](https://github.com/delightful-labs/delightful-local-first/pull/26), now merged.
PR #20 and PRs #23–#25 are also merged. T007's
[deployed Finance inventory](../003-verified-backup/finance-deployment-inventory.md) is complete.
The current [backup specification](../003-verified-backup/spec.md)
and [task ledger](../003-verified-backup/tasks.md#current-handoff) track what remains:
T004 consumer/platform performance, T008 capture/profile/interaction, T009 isolated
restore and T010 actual retained-file recovery. T014 separately tracks explicit confirmed-rejection
retry integration; conservative test app resume already avoids unknown-write replay.

Finance adoption and the authentication changes below remain unimplemented. Complete actual deployed
backup/recovery before changing deployed identity or storage; the test app fixture is not that proof.
Resume from the active backup ledger rather than the historical research branch below.

## Research-time observations and missing inventory

- DLF's working branch is `research/atproto-jazz-auth`, based on merged spec PR #14 at `04e7659`.
  Research and this implementation direction are local changes, not deployed behavior.
- Supplied Finance checkout `3eec717` declares Jazz alpha.59. Its layout passes `initial: 'local-first'`
  with `PUBLIC_JAZZ_APP_ID` and `PUBLIC_JAZZ_SERVER_URL`; its dev plugin keeps the user's app/server
  on ports 5173/5174. Do not change the user's origin/endpoint as incidental setup or stop that server.
- Finance's production Netlify build currently runs `deploy:jazz` before build. A move to backend-owned
  auth also changes hosting/build integration; the existing static-oriented build is not assumed to
  provide the new backend automatically. Retain Netlify for the frontend; select a qualified persistent
  backend host for the combined authentication/sync boundary. The server entry point lives in the
  consumer repository and imports reusable DLF helpers; no separate login app/repository is required.
- Clipper's documented implementation has account/recovery plus a private library root; that document
  says it has no captured notes. This does not establish the contents of the user's current instance.
- The user confirmed that the important data is in deployed Finance. The actual deployed revision,
  complete data scope, and pending local writes still require read-only verification. Repository
  configuration alone does not establish that every browser write reached the server. No private
  records were inspected during this investigation.

## Deployment and local-first responsibilities

Follow [the hosting direction](hosting.md): Netlify serves each frontend, a persistent app-owned
service runs its authentication/Jazz sync boundary, and a compatible remote Core may continue to
store data. OAuth sessions/state need durable server storage and cross-instance refresh coordination.
No storage relocation is implied. DLF owns reusable library code, not a central deployed auth service.

Post-link local reads and edits must not require a live backend session per operation. Demonstrate
cold restart and durable offline edits with expired provider/backend sessions and separate outages,
then reconnect without losing pending work. Initial sign-in/linking still require network access.
Missing local attachments remain unavailable rather than being called fully offline. These are
required outcomes on the selected build, not capabilities already established by investigation.

## Work sequence

### 1. Implement verified backup on the existing deployed stack

The immediate feature is [verified workspace backup and restore](../003-verified-backup/spec.md),
with its [implementation plan](../003-verified-backup/plan.md). Build the reusable archive capability
in DLF and the Finance-owned capture/restore profile against the existing alpha.59 setup. Retain
the actual deployed workspace backup and demonstrate exact recovery into an isolated new destination
before changing deployed identity or storage. Independent archive work does not require a Jazz upgrade.
An application archive does not preserve the complete engine history or account registry; any server
transition below still needs its own supported preservation procedure.

### 2. Pin and prepare the Jazz build

The inspected upstream base is `daa5d1ce70525f2c990c7feeb735dd70928b867a`.
PR [#4644](https://github.com/garden-co/jazz/pull/4644), head
`0f93fc82075802dfb7e8fe783249373826a3bc8b` when checked, addresses pinned-session serializable reads.
It was still open; its description is not proof of correctness or permission to alter Jazz production.
Review that source delta and select a coherent exact build containing required fixes before building
the consumer. Record artifact provenance and an explicit local-first entry/configuration.

Build in task-owned storage, leaving Finance/Clipper manifests, user services, browser profile and
server directories untouched. Keep the current alpha.59 artifact available. Present the build and
adapter changes for the repository's normal focused implementation review; implementation tests
are added/run only after that review, as required by existing agreements.

### 3. Preserve and rehearse the user's storage transition

First identify each real app origin, app ID, account and server/storage owner. Then:

1. Arrange a stable backup of server data through the actual host's supported mechanism; distinguish
   a live file copy from a consistent backup. Preserve original account/registry state and attachments.
2. Preserve browser-local pending work and recovery through supported means. Do not wipe browser
   storage or assume a server backup includes unsynced edits. Recovery secrets never enter Git,
   diagnostics, URLs or ordinary workflow snapshots; backup locations must be outside the repository.
3. Work against a copy. Review/adapt the alpha.59 server importer for the chosen snapshot and the
   user's schema/history. It does not cover the browser-local pending-write problem by itself.
4. Compare original and migrated data: account mappings, record IDs/counts, relationships, attachments,
   ownership and representative financial values, including deleted/history records where retained.
   Keep private contents out of logs and reports. Counts alone are insufficient.
5. Preserve the original instance and backup for rollback. Before cutover, agree how writes made on
   the new instance would be retained if a rollback is needed; simply reopening a stale old database
   is not a lossless rollback once new writes exist.

Failure or ambiguity preserves the original working instance while we fix the migration. It does
not turn into automatic deletion, reset, account recreation or an indefinite release wait.

### 4. Implement backend sign-in and DLF integration

Use a maintained AT Protocol OAuth client, identity-only `atproto` scope, and server-owned session
storage/refresh coordination. Return the verified DID through Jazz's supported `authenticate`
boundary. Choose a stable application authority and preserve Jazz app/account mappings; handle/PDS
changes must not create replacement accounts. Each app establishes its own session.

Model sign-in/linking before async effects: the existing host session owns selection, DLF owns reusable
intent and transitions, and the backend/OAuth SDK owns credential verification. Bind callback intent
to browser session, expected DID, selected account and generation. Explicitly link an existing account
before any automatic backend registration can assign the external identity elsewhere. Keep existing
local recovery authority and handle uncertain acceptance without blind replay.

Present a small related implementation slice at each review. Test it after implementation approval.
Use disposable data for initial behavior checks, then repeat migration/read validation on the copied
user dataset. This is preparation for real adoption, not a substitute deliverable or a new product.

### 5. Adopt in the user's apps

Clipper adoption first must demonstrate its user-approved initial identity experience, returning
access, permissions and recovery, explicit local-first startup and offline cold restart on the
selected build. Work created after onboarding must remain preserved.
Its detailed adoption and preservation process requires user decisions before selection. Clipper
keeps its domain schemas/private root app-owned; public publishing follows separately. Finance later
reuses the qualified shared behavior, with its existing backup and data-preservation requirements.
Cutover remains explicit; no deployment or user-storage mutation is implied by building a branch.

## Outcomes to demonstrate

- Same Finance account and records before/after linking; no duplicate empty account selected.
- Complete copied-data migration and a usable rollback copy, including a strategy for unsynced work.
- Local saves survive browser closure/restart without the auth provider or Jazz server available.
- Reconnect, recovery, logout, cancelled sign-in and lost linking replies preserve the intended data.
- Finance performs no PDS content writes; independent app mappings remain independently authorized.

These are concrete implementation checks, not a publication requirement or claims already proven.
Hosting/operator, ordinary logout scope and recovery for brand-new external users still need decisions;
they do not prevent preparing the source build and existing-user preservation work.

## Zod validation TODOs

- [ ] ZOD-S01 — During sign-in backend implementation, use internal Zod schemas for application-owned
      callback/route inputs and environment configuration. Validate explicit origins, callbacks and
      environment-specific settings at their boundaries; keep secrets and raw input out of errors.
      Schema validity does not establish trusted origin, issuer, DID control or callback intent.
- [ ] ZOD-S02 — Define versioned schemas for app-owned persisted session/intent metadata and validate
      it before reuse across requests or deployments. Continue using the official OAuth SDK’s
      supported stores/serialization for SDK-owned state; do not duplicate its token verification,
      PKCE/DPoP handling or credential formats. Preserve correlation, expiry, distributed locking
      and unknown-outcome behavior in their existing owners; Zod checks do not replace those policies.

These tasks apply when the corresponding backend slices are implemented. They do not expand the
current archive implementation or require Zod-specific public consumer contracts. See the
[completed shared-library follow-ups](../003-verified-backup/tasks.md#completed-shared-and-test app-work).
