# Private workspace creation resource contract

> Supplemental qualification and internal journal work. The merged local-first creation workflow
> and extracted journal remain governed by [creation/plan.md](creation/plan.md), the
> [current delivery ledger](../tasks.md), and their public package entries. This proposal does not
> replace them, impose authority waits on ordinary creation, or authorize a consumer migration.
> Design-history references below to an unbuilt owner concern this supplemental integration;
> they are not the status of the already shipped creation capability.

**Status**: Resource contract design with an implemented isolated qualification fixture. Ten fixture
SDK tests and sixteen journal tests pass; reusable creation orchestration, public exports and
consumer migration remain unbuilt.
Complements the selection plan; does not supersede its implemented protocol.

## Scope and evidence

The foundation owns reusable creation operation lifetime and outcomes. The host supplies concrete Jazz schemas, policies, eligibility rules and the atomic set of records. Finance starter records and Clipper article/library models remain host-owned. Selection, navigation, invitations, naming UI and device linking are separate responsibilities.

Read against the adopted constitution, XState memory, active foundation contract and workspace selection plan. Installed Jazz `2.0.0-alpha.59` declarations at `/Users/matt/Projects/delightful-finances/node_modules/jazz-tools/dist/runtime/{db,client}.d.ts` expose `beginTransaction`, `beginExclusiveTransaction`, explicit commit/rollback, write transaction IDs, tiered mergeable durability waits and authority-confirmed exclusive waits. Signatures are design evidence, not proof of deployed policy behavior or crash recovery.

## Request and operation identity

A request carries a fixed identity/client binding, generation, operation ID, intended workspace ID and validated creation input. IDs are allocated before writes and retained across retries. A new binding cannot inherit an old operation implicitly. The host authorizes explicit intent; automatic first creation additionally needs trustworthy new-identity provenance. Empty directory/replica observations supply neither intent nor provenance.

The generic contract does not define a global workspace count, a universal name format or an account-to-workspace schema. A host may require one personal library while another allows many workspaces. Those eligibility and uniqueness constraints must be validated by its concrete storage integration.

## Ownership tree

Host session owner → creation workflow owner → transaction resource owner.

The creation owner also invokes finite journal operations. The transaction owner retains its acquired SDK handle, issued commit handle and transaction identity until settlement and release are classified. It does not close the host session. UI dismissal only detaches presentation or requests cancellation; it cannot stop this ownership tree prematurely. No general actor registry or event bus is needed.

## State-owned steps

| State            | Responsibility and next evidence                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| validating       | Pure request/name/intent checks; failure issues no write.                                                                                                            |
| journaling       | Persist account-bound operation identity and intended IDs; failure issues no database mutation.                                                                      |
| acquiring        | Acquire transaction resource; a late result after cancellation is retained and cleaned up.                                                                           |
| assessing        | Read required records inside the transaction; classify eligible, already-created, conflict, denied or unavailable. Empty cached enumeration is insufficient.         |
| staging          | Stage workspace, ownership and required host records in the same transaction; recheck write-boundary invariants.                                                     |
| committing       | Issue commit once; retain handle and transaction ID. Cancellation cannot imply rollback once commit is issued.                                                       |
| settling         | Await the selected real guarantee; distinguish local persistence from authority acceptance.                                                                          |
| rollingBack      | Roll back only an acquired, still-mutable transaction; false/rejected/unknown rollback is not successful cancellation.                                               |
| reconciling      | Resolve journaled IDs and known transaction fate after interruption; incomplete observations cannot authorize replay.                                                |
| recordingOutcome | Persist known result/recovery facts before releasing operation ownership. Journal failure after commit preserves committed evidence and a recovery-required outcome. |
| releasing        | Release adapter-owned resources; report cleanup failure or uncertainty explicitly.                                                                                   |

These are responsibilities for a reviewed statechart, not a requirement to create an asynchronous boundary around each SDK expression. An adapter must expose real resource operations or a backend-specific child statechart. It must not hide all read/check/stage/commit/journal/reconcile behavior in a single promise leaf.

## Public protocol proposal

Names and TypeScript signatures remain provisional until adapter qualification.

- Start input fixes binding, generation, operation identity, intended IDs, host intent and concrete integration capabilities.
- Continuing commands: cancel, request drain, and request reconciliation with fresh bound readiness/access facts. Retry retains operation identity; it is not an unconditional repeat-create command.
- Reports carry binding, generation and operation ID. Resource reports additionally carry the exact resource token; stale reports, including A → B → A observations, cannot advance the current operation.
- Finite outcomes: created with evidenced guarantee; already-created for the same operation; conflict; denied; invalid; failed-before-commit; cancelled-with-release; rejected-after-commit; or unresolved with retained recovery facts. Never call an unknown commit “failed-before-commit”.
- Local persistence and authority acceptance are separate evidence variants, not a generic success boolean. Later rejection is correlated to the operation and reported to the host owner after a locally durable result.
- Drain acknowledgement includes whether ownership is released or unresolved. If the child has crashed, the parent classifies actual retained resources instead of waiting for an impossible acknowledgement.

Every I/O invocation has an unexpected-error path. No asynchronous entry/exit action owns persistence or cleanup. Stopping an actor is not evidence that SDK side effects stopped.

## Required integration capabilities

The adapter supplies finite operations or a resource-owned child protocol for acquisition, transaction-scoped reads, guarded staging, commit, supported rollback, settlement observation, reconciliation and release. Opaque resource handles stay in the backend integration; secrets never enter journals or presentation props.

The journal stores operation and intended record IDs, account binding identity, known transaction ID when available, and observed durability/settlement evidence. Persisting it before commit leaves a possible crash window between commit issuance and transaction-ID recording. Reconciliation must cover that window through stable intended IDs and an operation marker in the atomic record set. A missing row on an incomplete replica is not proof that commit never occurred.

## Transaction choice remains qualified, not assumed

The [Jazz adapter mapping](jazz-creation-mapping.md) records exact source evidence and gaps.
In particular, installed exclusive waiting falls back to local confirmation without a configured
authority, and exported transaction-fate types do not establish a public restart lookup API.

Mergeable transactions provide eventually consistent grouped writes; their handles expose `wait({ tier: 'local' })` and global waits. Exclusive transactions provide authority-validated serializable writes; their documented confirmation is `wait()` without a chosen durability tier. Do not advertise an exclusive transaction as locally confirmed offline using a guessed API.

A host requiring authority-checked uniqueness must qualify exclusive creation and its connectivity behavior. A host allowing offline provisional creation must qualify deterministic identity/convergence and later rejection without losing domain work. The foundation accepts only the guarantee actually supported by the chosen adapter. No product policy or online-only restriction is adopted here.

## Permission and interruption qualification

Before production adoption, identify focused coverage for:

- Unrelated identities cannot read private rows or create ownership for another account; updates cannot transfer ownership or substitute foreign parents.
- Required workspace/owner/host records share one atomic boundary under deployed policies.
- Journal failure before mutation; acquire failure; cancel during acquire/stage; commit issued before cancellation; rollback refusal/error; cleanup failure; child crash.
- Cold restart before commit, after commit before transaction-ID journal update, after local persistence and before remote acceptance.
- Same-operation retry and two-device creation conflict; recovered identity with incomplete/empty directory; rejected write retains recovery facts.
- Scope replacement invalidates old UI/access immediately but does not abandon issued writes; selection/navigation retry cannot create another workspace.

Stub-only scenarios cannot qualify storage authorization, offline durability or authority behavior. Implementation review precedes implementation tests under repository policy.

## Review result and next bounded task

The design follows Jazz-only boundaries, strict typed variants, machine-owned resource lifetime and
host-owned domain schemas. The isolated fixture now qualifies its concrete private policy, exclusive
confirmation/collision behavior and specific browser restart paths. The internal browser journal has
its own sixteen passing cases. These results do not establish a production creation workflow or a
historical transaction-fate lookup API.

Next: implement the reusable creation operation/resource owner against the reviewed journal contract,
retaining pre-issuance persistence and unknown settlement. Keep production consumer adoption separate
until that owner and its concrete integration receive review and their own qualification.

The [qualification plan](creation-qualification.md) defines the proposed evidence cases and review artifact for that next task. It now records twenty-six passing isolated authority/browser/journal cases and their limits; creation orchestration remains separate work.

The [workflow and durable journal boundary](creation-workflow.md) now defines the next internal
contract and statechart, including the durable pre-issuance marker required to close the commit gap.
