# Private creation qualification plan

Status: ten focused tests pass: four local-authority policy cases and six Chromium exclusive/restart
cases. Reusable creation orchestration and durable journal recovery remain unimplemented.
This is the next bounded task for the [resource contract](private-creation.md) and
[Jazz mapping](jazz-creation-mapping.md). G1 remains open.

## Qualification boundary

Use an isolated Jazz fixture with two unrelated accounts and a separately restored profile for
one account. Pin the actual SDK, authority build, deployed policy and configuration in each result.
Record whether an authority is configured; exclusive wait completion alone is insufficient evidence
of remote acceptance. The first investigation uses exclusive transactions against a configured
authority. It does not decide whether product onboarding requires connectivity.

The fixture owns its schemas. Its minimal atomic set is a private workspace and immutable operation
marker, plus an owner membership only if the actual policy requires it. The marker binds authenticated
owner, operation ID and intended workspace ID. Explicitly document policy dependencies before staging;
never use Finance financial rows or Clipper library records as universal foundation schemas.

## Evidence to collect after fixture review

| Case | Required observation | Failure consequence |
| --- | --- | --- |
| Owner creation | All required records accepted together and readable by the owner | Block creation adapter |
| Foreign identity | Reads denied; forged owner/parent insertion and ownership mutation rejected | Block private-workspace claim |
| Atomic rejection | One invalid required record prevents acceptance of the complete set | Block atomic creation claim |
| Same operation on two clients | Matching stable IDs reconcile without overwriting another operation | Keep retry unresolved |
| Conflicting operation | Existing incompatible marker/workspace is reported as conflict | Prohibit upsert/replay |
| Authority unavailable | Actual acquisition/commit/wait behavior recorded without relabeling local evidence | Retain unknown outcome |
| Rollback | True, false and rejected rollback distinguished; resulting visibility inspected | No false cancellation claim |
| Commit before journal update | Complete process restart recovers through stable IDs and marker | Block crash recovery claim |
| Local persistence then restart | Exact rows survive full browser-process closure in the same profile | Block local durability claim |
| Restored account | Independent profile reads the authority-accepted required set | Block cross-profile claim |
| Account replacement | Old view invalidates immediately; issued resource drains with correlated outcome | Block consumer adoption |

Storage authorization and durability require the real deployed boundary. Synthetic actor coverage
can later qualify orchestration but cannot satisfy those rows.

## Recovery evidence rules

Persist operation identity and intended IDs before mutation. Record commit issuance separately from
transaction-ID availability. A crash between those events remains possible even with a journal.
A public supported fate lookup must be demonstrated before relying on historical transaction IDs;
exported types and internal runtime methods do not establish such a lookup.

A matching complete marker/workspace set establishes only the guarantee actually observed. Missing
rows in an incomplete replica remain unresolved. A partial set is an integrity failure, never a
repair instruction. Retry requires positive evidence that mutation was never issued or an adequately
qualified authoritative absence path with no pending owner. Preserve stable identities throughout.

## Review artifact and exit

For each case retain versions, configuration, policy, event ordering, observed local and remote
results, cleanup classification and remaining uncertainty, excluding credentials and recovery secrets.
Mark each case passed, failed or unqualified; timeouts remain unqualified outcomes rather than proof
of rejection. Document the supported reconciliation path and its limits explicitly.

Present the proposed fixture and policy for review before creating or running implementation tests,
as required by AGENTS.md. After approved qualification, revise the resource contract against actual
results and present the next implementation task. Do not close G1, publish creation exports, migrate
consumers or introduce a production schema from this plan alone.

## Concrete fixture proposed for the next review

Keep the fixture under `fixtures/private-creation/`, outside library exports. Use the pinned
`jazz-tools` version from this repository. The fixture must supply its own deployed app identifier,
authority configuration and temporary profile directories. Do not reuse a consumer authority,
credentials, schema deployment or browser profile. Deployment is a later explicit action.

Proposed fixture-only records:

| Table | Fields beyond the stable row ID | Insert invariant |
| --- | --- | --- |
| workspaces | ownerId, creationOperationId | ownerId equals authenticated account; matching marker points back to this workspace and owner |
| creationOperations | ownerId, workspaceId, requestFingerprint | ownerId equals authenticated account; intended workspace and fingerprint fixed for the operation |

Both IDs are allocated before journaling. The fingerprint identifies the normalized immutable
creation request, not credentials. The workspace points to its operation; the operation stores the
intended workspace ID. Only the workspace insertion policy depends on marker existence, keeping the
policy dependency graph acyclic. An orphan marker cannot establish creation success. Qualify that
same-transaction marker visibility supports this dependency before adopting the design.

Read permission compares each row's ownerId with the authenticated account directly. Deny updates
and deletes on both tables in this fixture. Reject workspace insertion unless its referenced marker
has the same owner and intended workspace ID. The marker insertion policy checks authenticated owner;
it does not query the workspace. Application staging inserts both rows atomically. Directly inserted
owner-authorized orphan markers remain possible with this acyclic policy and must be classified as
incomplete/integrity evidence. The fixture must expose that limit rather than claim policies enforce
bidirectional existence. No membership table is needed for this proposed owner-only fixture.

This policy is a specification to verify against the installed public schema API, not deployed code
or a claim about Jazz policy evaluation. If same-transaction visibility or collision behavior fails,
report the failed invariant and revise this fixture before defining a reusable adapter.

### Transaction and reconciliation protocol

The reviewed fixture implementation should expose one transaction resource lifetime:

1. Persist the fixed binding, operation ID, workspace ID and fingerprint in a local journal.
2. Acquire an exclusive transaction against the explicitly configured isolated authority.
3. Read both stable IDs through that transaction. A complete matching set may reconcile only with
   adequate evidence; mismatched owner, IDs or fingerprint is conflict. Partial sets are integrity
   failures. Cached absence alone does not authorize insertion.
4. For an eligible new operation, stage marker and workspace within the same transaction, then issue
   commit once. Retain both the resource and commit handle while obtaining transaction identity and
   waiting for confirmation. Journal failure after issuance cannot become failed-before-commit.
5. Classify the actual guarantee, persist recovery evidence and release owned resources. A late
   cancellation drains issued work rather than attempting to reverse commit.

For the first fixture, stop at unresolved if the public SDK cannot establish sufficient transaction
admission/read evidence for step 3. Do not invent an authority-read API or turn an exclusive
transaction's name into proof of absence. Separately qualify whether insert-only collision rejection
can safely establish the creation outcome without a prior authoritative absence claim.

Reopening the journal starts reconciliation rather than a new write. Complete matching records on
an independently synced restored profile provide a positive acceptance witness; merely having an
open connection does not prove read completeness. Missing records, unknown fate or lost transaction
identity remain unresolved. A positive rejection is retained separately from record visibility.

### Ownership and interruption for the fixture implementation

The fixture session supervisor owns the session and mutation-error subscription. The creation actor
owns the journal operations and invokes a transaction resource owner spanning acquisition, assessment,
staging, committing, settlement and release. A cancellation during acquisition waits for the acquired
handle and then attempts rollback; it must not discard a late acquisition result. Cancellation before
commit rolls back a mutable resource. Cancellation after issuance waits for classification or yields
retained unresolved recovery facts. Released cleanup failure and uncertain release are distinct.

The supervisor invalidates displayed results on binding replacement immediately, then requests drain.
It retains responsibility for unresolved resources and late rejection reports after foreground
completion. No presentation unmount or completed operation child may dispose the shared session or
silently drop that reporting lifetime. Stale reports are rejected by binding, generation, operation
and resource identity. These responsibilities must be visible in the fixture statechart before any
async implementation, including helpers, is reviewed.

## Focused fixture result

The isolated fixture now exists at `fixtures/private-creation/`. All four local-authority policy
cases pass on Jazz 2.0.0-alpha.59, along with strict fixture TypeScript checks. The cases establish
same-transaction marker visibility, atomic invalid-reference rejection, owner-only reads, forged
owner/reference denial, immutable records and the documented orphan-marker limit. They use mergeable
transactions with global waits in the SDK testing harness; they do not establish exclusive admission,
production deployment or any cold-restart/reconciliation guarantee. G1 remains open. The subsequent exclusive/browser cycle below addresses confirmation, collisions and concrete
restart cases; creation orchestration remains separate work.

## Exclusive and browser restart result

The user requested direct qualification of exclusive transactions and restart recovery after policy
coverage. All ten fixture tests pass on Jazz 2.0.0-alpha.59, Playwright 1.60.0 and its matching Chromium
148.0.7778.96 on this macOS host. Six browser cases cover configured-authority exclusive confirmation,
process closure/reopen, SIGKILL before commit and after confirmation, SIGKILL immediately after issuance
without retaining the transaction ID, independent restored-profile contention for one workspace, and
exact local record recovery after SIGKILL with the authority stopped. The fixture shell remains served.

Both competing profiles observe exactly one accepted operation and no losing marker; the losing
commit must produce a rejection/conflict rather than an arbitrary caught error. The commit-gap case
asserts atomic matching records or complete absence, never permission to replay an unknown operation.
It does not deterministically force both transport race outcomes. No production journal or creation
workflow is exercised. G1 remains open for those orchestration/reconciliation boundaries, not because
exclusive confirmation or these specific process-restart cases are still untested.

Commands, exact scenarios and limits are recorded in the
[fixture README](../../../fixtures/private-creation/README.md). Fixture strict TypeScript, lint,
formatting and diff checks accompany the runtime results. No external deployment or consumer change
was needed. The next design task can use these observed guarantees while preserving unknown outcomes.
