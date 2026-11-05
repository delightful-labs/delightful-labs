# Single-user implementation and data-preserving adoption

Direction updated: 2026-11-03, following the user's instruction that Finance and Clipper currently
serve only them and that implementation should proceed without waiting for a published Jazz release.
This replaces the research recommendation to require publication before consumer adoption. Preserving
the user's data remains a delivery requirement. No live data has been changed by this document.

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

The shared backup foundation and complete notebook reference are implemented and qualified through
[PR #26](https://github.com/delightful-labs/delightful-local-first/pull/26), ready for the user's merge.
PR #20 and PRs #23–#25 are already merged. The current [backup specification](../003-verified-backup/spec.md)
and [task ledger](../003-verified-backup/tasks.md#current-handoff) track what remains: T007 deployed
Finance inventory, T004 consumer/platform performance, T008 capture/profile/interaction, T009 isolated
restore and T010 actual retained-file recovery. T014 separately tracks explicit confirmed-rejection
retry integration; conservative notebook resume already avoids unknown-write replay.

Finance adoption and the authentication changes below remain unimplemented. Complete actual deployed
backup/recovery before changing deployed identity or storage; the notebook fixture is not that proof.
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

Finance adoption first proves identity-only sign-in, existing records, recovery, explicit local-first
startup and offline cold restart on the new build. Use the preserved instance until the migrated
copy and account linking work. Cutover remains explicit; no deployment or user-storage mutation is
implied by building a branch. Then apply reusable identity behavior to Clipper, keeping its domain
schemas/private root app-owned. Public publishing follows separately.

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
[completed shared-library follow-ups](../003-verified-backup/tasks.md#completed-shared-and-notebook-work).
