# Jazz private creation adapter mapping

**Status**: Source mapping for Jazz 2.0.0-alpha.59, now complemented by ten isolated fixture tests.
See [qualification results](creation-qualification.md#exclusive-and-browser-restart-result) for observed
exclusive confirmation, collision and browser restart behavior. Reusable creation orchestration and
durable journal recovery remain unimplemented. Source-evidence limits below still apply.

## Evidence and public boundary

Inspected installed `jazz-tools` package version, root/runtime exports, `dist/runtime/db.{d.ts,js}` and `dist/runtime/client.{d.ts,js}` under `/Users/matt/Projects/delightful-finances/node_modules/jazz-tools`. Root exports the runtime entry point; package public exports, not arbitrary deep imports, govern implementation.

| Contract responsibility | Observed SDK mapping | Limit |
| --- | --- | --- |
| Acquire mergeable resource | `db.beginTransaction()` | Eventually consistent; not cross-device uniqueness proof. |
| Acquire exclusive resource | `db.beginExclusiveTransaction()` | Authority-validated mode when an authority is configured; deployment/policies still need qualification. |
| Mutable resource identity | `transaction.openTransactionId()` | Mutable transaction identity differs from committed transaction ID. No inspected public API reopens it after restart. |
| Read/check within resource | `transaction.one(query)` / `all(query)` | Reads must have the required completeness/freshness; null alone is not proven global absence. |
| Stage stable identities | `transaction.insert(table, data, { id })`; scoped updates/upserts | Upsert is not automatically safe: it must not overwrite an existing workspace or another operation's marker. |
| Commit once | `transaction.commit()` returns a commit handle with `txId` promise | Issuance precedes eventual transaction-ID availability; retain ownership across that gap. Pending reads can defer physical commit. |
| Mergeable persistence | `handle.wait({ tier: 'local' })`, separately global | Immediate row/handle return is not durable completion. |
| Exclusive confirmation | `handle.wait()` | Implementation chooses global when `serverUrl` or native upstream is configured, otherwise local. Never infer authority acceptance solely from resolved `wait()`. |
| Precommit rollback | `transaction.rollback(): Promise<boolean>` | SDK docs say pending rows remain pending, and transaction cannot commit. Do not claim it erases every local trace. False/error/uncertainty require classification. |
| Later rejection | `onMutationError` includes transaction record and rejection details | Event fallback is not an enumerated durable recovery log. Establish subscription lifecycle/disposal in the adapter before adoption. |
| Restart reconciliation | App-owned stable operation/workspace records; supported read paths | Exported `TransactionFate`/`LocalTransactionRecord` types do not establish a public query API for historical fate. No such lookup was found in inspected Db/client declarations. |

Do not depend on `getRuntime()`, native internals, internal exclusive-wait helpers or private fields to manufacture a recovery contract. Do not cast serialized strings into SDK-branded transaction IDs without a supported decoding boundary.

## Minimal qualification record set

Use an integration-owned private workspace row and creation-operation marker, plus any ownership record actually required by the deployed policy. The marker relates authenticated owner, operation ID and intended workspace ID; all required rows are staged atomically. This is a logical fixture, not a new universal schema or approved field/API definition.

Read eligibility inside the chosen transaction. A matching marker and workspace can identify an already-created operation when the observation's durability/authority evidence is adequate. An unrelated operation or incompatible owner is a conflict/denial, never permission to upsert over it. Marker contents alone do not certify remote acceptance.

The foundation returns workspace identity and evidenced outcome, leaving Clipper's one-library rule and Finance's financial starter records in their integrations. A generic fixture cannot establish either application's complete invariants.

## Recovery decision table

| Observation | Allowed classification/action |
| --- | --- |
| Journal exists; mutation definitively never issued | Retry the same operation after current authorization/readiness checks. |
| Same operation marker and workspace observed with required guarantee | Reconcile as existing result; do not create again. |
| Known rejection with adequate bound evidence | Report rejected; retain recovery facts and domain drafts; new attempt requires deliberate retry policy. |
| Marker/workspace missing on incomplete offline replica | Unresolved; do not infer absence or allocate replacement IDs. |
| Commit issued; committed ID not journaled; outcome unknown | Reconcile stable intended IDs/marker; remain unresolved if evidence is insufficient. |
| Positive authoritative evidence of no committed operation, with no pending issued owner | Adapter may authorize retry with the same identities; this evidence path still needs qualification. |
| Mismatched marker/owner or partial required record set | Conflict/integrity failure; no automatic repair, ownership substitution or destructive cleanup. |

Bounded waiting may stop a foreground progress indicator, but cannot turn uncertainty into failure-before-commit. Preserve a recovery-required result for the host rather than blocking shutdown indefinitely or claiming successful cancellation.

## Proposed transaction policy, pending validation

For the first private-creation qualification, prefer a configured authority and an exclusive transaction. This is a technical validation proposal, not approval of an online-only Clipper onboarding requirement. It provides a focused way to examine atomic eligibility and authorization before promising offline bootstrap.

Existing library use, notes, highlights and captures must retain their accepted offline requirements. If initial library creation must work before authority contact, qualify a separate deterministic identity/convergence design; do not reuse exclusive confirmation labels or presume a client-side lookup guarantees uniqueness. Deterministic IDs can support idempotency but cannot replace owner policy or prove all other rows converge safely.

## Remaining evidence before implementation

1. Exact deployed policy for workspace ownership, creation markers and cross-owner rejection, including immutable owner/reference rules.
2. Supported complete/authoritative read and transaction admission behavior for eligibility checks. Authority configuration is necessary but does not by itself prove serializable application invariants.
3. Restart recovery path when a transaction ID is known and when it was not journaled; clarify whether a supported fate lookup exists elsewhere or stable-record evidence suffices.
4. Real exclusive confirmation/rejection, offline interruption, rollback and local persistence results; schema deployment and required atomic record set.
5. Safe ownership and subscription cleanup through account replacement and drain.

The contract can map acquisition, staging and live settlement today at source level. Crash-safe reconciliation and deployed authorization remain unresolved. G1 is not closed; do not publish a creation export or generate dependent implementation tasks as if it were.
