# Backend Capability Evidence and Design Implications

**Status**: Historical source evidence, not runtime qualification. Jazz alone is required for v1;
DXOS and portable-schema comparison below are deferred research. Current capability-specific plans
record executed Jazz/Finance checks. No second-backend qualification gate applies to the [active MVP](spec.md).

## Evidence Revisions

- Jazz: `45905c42946a07465ca33ec8a84e4180771aff74`.
- DXOS: `0d811677577e239ae9a0f8b6ab035cb9c986835b`.

Both are source snapshots already downloaded for identity investigation, not selected released
SDK/server combinations. Upstream tests were read as evidence where relevant, not executed.
A declared enum or method is not proof of enforcement, persistence, or crash safety.

## Compatibility Status (Source Review Only)

This matrix separates source evidence from runtime qualification. **Source-supported** means the
pinned code or documentation contains relevant primitives; it does not establish that a proposed
adapter preserves the portable contract. **Open** means the current evidence is insufficient to
claim compatibility. No row below is runtime-qualified.

| Mandatory area                                             | Jazz                                                                                         | DXOS                                                                                                          | Current conclusion                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity reuse across apps                                 | Source-supported: same root identity can map to separate app accounts                        | Source-supported: joining identity authority can expose existing native spaces                                | Plausible in both with backend-specific disclosure; identity reuse does not imply shared app data. Portable cross-app sharing is deferred from v1. Recovery and exact selected-version behavior remain unqualified |
| Portable schema and CRUD                                   | Source-supported primitives                                                                  | Source-supported primitives                                                                                   | Plausible; exact scalar mapping, validation, deletion behavior, and round-trips remain to design and qualify                                                                                                       |
| Query/filter baseline                                      | Source-supported queries and null lowering                                                   | Source-supported filter/query builders                                                                        | Plausible, not established parity; comparison boundaries, collation, null/absence normalization, proposed deterministic ordering, and bounded reactive results need conformance                                    |
| Reactive observations and lifecycle cleanup                | Subscription teardown observed in source                                                     | Query-result cleanup observed in source                                                                       | Primitives exist; session/workspace invalidation, detached snapshots, stale callback suppression, and error behavior remain unqualified                                                                            |
| Local durability and later settlement                      | Local persistence and remote rejection are distinct in cited evidence                        | Disk/host flush paths are visible in cited source                                                             | Required offline-restart durability and settlement behavior remain unqualified for both                                                                                                                            |
| Private workspace protection                               | Authorization primitives are present; exact deployment mapping remains unqualified           | Native identity/space membership exists; private data isolation mapping remains unqualified                   | Must verify that unrelated identities cannot access private workspace data at the relevant storage boundary                                                                                                        |
| Invited shared workspaces                                  | Sharing primitives exist; invitation and membership mapping need qualification               | Space invitation/membership primitives exist; invitation and membership mapping need qualification            | Required behavior is shared access via invitation; map backend-native membership without requiring normalized read-only/read-write roles                                                                           |
| Additional app-specific domain restrictions (not baseline) | Row-policy primitives are source-supported                                                   | Current traced native peer path has permissive inbound replication; other enforcement mappings are unverified | Not a v1 qualification area. Finance permission-checking code is not a product requirement; revisit only if a consumer explicitly approves a restriction.                                                          |
| Recovery and second-device linking                         | Recovery/passkey mechanisms are documented; end-to-end flow and device semantics remain open | HALO join/recovery APIs exist; enrollment, service, offline, and recovery behavior remain open                | Not qualified for either backend                                                                                                                                                                                   |
| Optional local-atomic transaction                          | Related API exists; exact crash/restart guarantee and visibility remain open                 | Multi-object crash atomicity not established                                                                  | Optional; do not advertise until separately qualified                                                                                                                                                              |
| Optional authority-validated transaction                   | Related API exists; exact conflict/authority semantics remain open                           | Not established by current review                                                                             | Optional; do not advertise until separately qualified                                                                                                                                                              |

Therefore, the current plan is **not yet demonstrated compatible end to end with both libraries**. The
portable contract can continue as a design draft. Identity reuse is distinct from data sharing. The user endorsed an explicit app/workspace request
and user approval flow but deferred it from v1 pending backend-capability evaluation. Do not promise
portable cross-workspace data sharing in v1. Qualification of the v1 baseline does not require a
cross-app data-sharing flow. To claim compatibility, first pin released SDK, server,
and configuration versions for each backend, then resolve the open design mappings and run approved
conformance/qualification scenarios. A failed mandatory behavior blocks that backend/app
combination; no capability is silently weakened. This matrix is a planning aid, not a task list or
runtime test report.

## Mandatory Data Baseline

| Behavior                         | Jazz source evidence                                              | DXOS source evidence                                            | Design consequence                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Typed records and ID references  | Schema scalar types, nullable columns, and UUID fields            | Typed ECHO objects and references                               | Translate app-owned schemas; never expose native live proxies as portable records                                      |
| Create/read/update/delete        | Mutation runtime and query interface                              | Database add/remove, explicit Entity.update, queries            | Explicit mutation entry points; deletion visibility/history is backend-specific                                        |
| Equality and null checks         | Adapter lowers null to IsNull/IsNotNull for schema columns        | Filter matcher uses strict equality, including null             | Explicit null must be distinguished from missing fields; reject incompatible schemas rather than dropping predicates   |
| Ranges and AND                   | Comparison predicates and conjunctions                            | Filter AST/comparison matcher and AND builder                   | Restrict operators to compatible declared types; specify boundary behavior before freezing API                         |
| Sorting and bounded lists        | Query adapter carries order_by and limit                          | Query.orderBy, Query.limit, Order.property                      | Specify deterministic ID tie-break and null ordering; a bound is not pagination or a replication limit                 |
| Reactive observation and cleanup | Subscription implementation owns unsubscribe/reset/error handling | QueryResult.subscribe returns cleanup                           | Publish detached snapshots and discard obsolete session/workspace generations                                          |
| Locally durable acknowledgement  | Write wait separates local persistence from remote acceptance     | EntityManager.flush defaults to disk, then RepoProxy/host flush | Adapter must await the real persistence path; offline restart and failure behavior still need executable qualification |

Jazz sources: [schema types](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/schema.ts#L5),
[query lowering](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/runtime/query-adapter.ts#L320),
[null/comparison lowering](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/runtime/query-adapter.ts#L495),
[nullable operator examples in upstream tests](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/runtime/query-adapter.test.ts#L578),
[subscription teardown](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/svelte/query-subscription.svelte.ts#L72).

The source resolves the earlier generic-null uncertainty more positively than the abbreviated
documentation: IsNull/IsNotNull lowering is general, and upstream examples include nullable bytes
and arrays. This still does not choose those richer field types for the portable v1 schema.

DXOS sources: [add/remove](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo-client/src/proxy-db/database.ts#L599),
[explicit update](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo/src/Entity.ts#L339),
[filter comparison](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo/src/internal/Filter/match.ts#L150),
[filter builders](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo/src/Filter.ts#L336),
[sort and limit](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo/src/Query.ts#L452),
[reactive cleanup](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo-client/src/query/query-result.ts#L160),
[disk flush](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo-client/src/core-db/entity-manager.ts#L1203),
[host save acknowledgement](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo-client/src/automerge/repo-proxy.ts#L294).

Native query primitives make the practical baseline plausible for both backends. Comparison
precision, string collation, absent/null normalization, observation ordering, and crash behavior
are still design/conformance work. Do not claim parity merely because operator names match.

## Authorization: Backend Membership Models and Conditional Domain Restrictions

Jazz provides row policies for reads/inserts/updates/deletes, including correlated grants and
old/new-row checks. Finance code includes selected-account policy checks, but this behavior is not an approved
Finance requirement and must not be treated as v1 foundation scope or a required Finance consumer
capability. Core rejection is separate from optimistic local application: a local write can appear
or persist before the authority rejects it. The portable operation lifecycle must retain
later rejection and must not call local durability proof of final authorization.

Sources: [permission model](https://jazz.tools/docs/auth/permissions),
[mutation errors and durability](https://jazz.tools/docs/writing/writing-data),
[transaction acceptance](https://jazz.tools/docs/writing/transactions).
These documentation links complement the pinned source; they do not establish compatibility
with every published Jazz alpha.

DXOS's current traced native ECHO peer path admits nonremoved members to replication without a
reader/editor write distinction. This describes the backend's access model; a generic read-only
membership guarantee is not required by the active spec. Evidence is in the actual authorization
flow, not the absence of a tutorial:

1. Production service wiring supplies mesh replication unless P2P replication is disabled.
2. A space trusts every nonremoved member identity, including members labelled READER.
3. Successful peer authentication authorizes that device for the space's replication.
4. The mesh authorization set records space and device, with no read/write role distinction.
5. The host explicitly says classical sync has no inbound gate, and Subduction authorizePut
   is intentionally permissive. The inspected inbound policy does not reject a reader's writes.

Sources: [production wiring](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/internal/services/layer-specs.ts#L440),
[trusted members](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/internal/spaces/data-space.ts#L162),
[authenticated-device admission](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/internal/spaces/data-space-manager.ts#L1017),
[mesh sharing and authorization](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo-host/src/automerge/mesh-echo-replicator.ts#L145),
[inbound policy](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/echo/echo-host/src/automerge/automerge-host.ts#L1166).

Conclusion: the inspected native replication path has no reader/editor write distinction. That is
not by itself a failure against the active requirements. It remains relevant when assessing an
app-specific restriction: a foundation adapter wrapping only its own mutation functions does not
establish enforcement against direct native access. This is source-level analysis, not an executed
exploit result or a claim that no possible DXOS-based architecture could enforce a required policy.

Space partitioning can potentially express access to selected subsets by placing protected data
in separate spaces. A foundation adapter that only checks its own mutation calls does not establish enforcement
against direct native access for a consumer-approved domain restriction. A custom lower-level
enforcement mechanism or another version/replication path would require explicit architecture
review and qualification; neither is assumed to exist or silently added by this document.

## Identity, Recovery, and Optional Transactions

Native identity-reuse findings remain as documented in [research.md](research.md): separate app
accounts for Jazz; shared identity/space authority for DXOS. That earlier app-isolation issue
is not reopened by this access-model evidence. Cross-app authority and backend-specific membership
semantics are separate concerns.

Jazz source/docs support recovery-root export/restore and passkey backup; these can inform a
second-device flow without claiming independently revocable per-device credentials. DXOS HALO
has join and recovery operations, whose enrollment, service dependency, and offline behavior
still need mapping. Neither API presence alone completes recovery qualification.

Atomic local transactions and authority validation remain optional. Jazz has corresponding
mergeable/exclusive APIs, with different offline and visibility behavior. DXOS multi-object
atomic crash persistence and authority validation have not been established by this review.
Do not advertise those capabilities until separately qualified.

## Review Outcome and Next Work

The source review supports provisional design work for identity reuse, schema/CRUD, and query
primitives, but does not show end-to-end compatibility with either released backend configuration.
The DXOS
reader/editor write distinction is not a mandatory foundation capability. Private workspace
protection still needs evidence-backed qualification. Domain-restriction scenarios based on Finance
permission-checking code are out of scope unless explicitly approved as product requirements.

Before compatibility can be claimed, pin released SDK/server/configuration versions, finalize
portable semantic mappings, and approve/run the corresponding qualification scenarios. No
foundation/plugin code, implementation tests, service, backend replacement, or requirement
amendment is authorized by this source audit.

## Follow-up: Alternate DXOS Enforcement Paths

The follow-up inspected legacy feed admission, current host configuration, the proposed
HALO/Keyhive migration, and the source files included in published runtime packages.
No implementation tests or package scripts were executed.

### Published package cross-check

Registry metadata reported `@dxos/client` latest as `0.14.0` at inspection. The public
`@dxos/echo-host@0.14.0` and `@dxos/client-services@0.14.0` archives were downloaded and their
included TypeScript source inspected. They reproduce the same relevant behavior:

- `echo-host` source `automerge/automerge-host.ts`, line 1152: inbound puts are intentionally
  allow-all; line 1179 implements the permissive callback.
- `echo-host` source `automerge/mesh-echo-replicator.ts`, lines 149 and 177: document and
  collection replication check the space/device authorization set, not reader/editor roles.
- `client-services` source `internal/spaces/data-space.ts`, line 167: every nonremoved
  member identity is trusted, including a reader.

Archives: [echo-host 0.14.0](https://registry.npmjs.org/@dxos/echo-host/-/echo-host-0.14.0.tgz),
[client-services 0.14.0](https://registry.npmjs.org/@dxos/client-services/-/client-services-0.14.0.tgz).
The archives and extracted inspection files are under `/private/tmp/dxos-published-audit`.
Archive SHA-256 digests, recorded for reproducibility:

- echo-host: `a3c671175ad8b5c8fbbe705587cfee3b12775575ee28a2e1692ac0315ee3e1a2`.
- client-services: `3df4e84d5b2216f740cdf0a81bb20827ca42d03a464e685734bff73ec156c8f6`.

This cross-check concerns the named packages and paths, not every historical release or
possible custom deployment. The `dev`, `labs`, `main`, and `next` registry tags are not
accepted as alternative permission implementations merely because those tags exist.

### Legacy feed admission

The legacy credential state machine processes `AdmittedFeed` without adding role validation
there, with a comment that contained credentials receive their own validation. The separate
admin/owner restriction governs inviting members, not a general reader-write gate over ECHO
record data. This supplies no missing guarantee for the current native peer data path.

Source: [feed admission and membership administration](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/halo/credentials/src/state-machine/space-state-machine.ts#L236).

### Keyhive is not an installed DXOS solution

DXOS's migration document explicitly says draft. It describes replacing space membership and
access control with Keyhive and states that a prototype runtime was removed from the
now-definitions-only HALO package. No shipped HALO/Keyhive enforcement integration was located
in the audited tree. Selecting the Subduction transport alone does not add Keyhive permission
checks: the existing host wires its own permissive inbound policy.

Sources: [draft status](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/halo/halo/MIGRATION.md#L1),
[planned access-control rewrite and removed prototype](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/halo/halo/MIGRATION.md#L130).

Automerge separately documents an alpha `automerge-repo-keyhive` integration with document
read/edit/admin permissions and transport/storage integration. It is a relevant upstream
technology to watch, not proof of DXOS support or a drop-in addition to the current DXOS
identity/space implementation. Adopting it directly would be another backend integration or
substantial DXOS authorization work requiring separate review.

Source: [Automerge's alpha integration guide](https://automerge.org/docs/keyhive/ark-api-guide/).

### Recommended planning treatment

Keep private workspace protection in the mandatory core contract. Additional app-specific domain
grants are conditional on explicit consumer approval. Both backends remain unqualified;
source-supported primitives are not evidence that the complete contract maps to either backend.
The core contract and conformance design can describe required behavior without asserting
unverified mappings. Final two-real-backend acceptance remains pending until both pinned backend
configurations pass the mandatory scenarios.

Do not infer enforcement from a membership label or UI filtering. Any additional authorization
subsystem or replacement backend requires explicit architecture and scope review. Generic
read-only membership is not part of the active requirements.
