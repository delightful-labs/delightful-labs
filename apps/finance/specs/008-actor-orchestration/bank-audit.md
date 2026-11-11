# Bank orchestration audit (D001)

This is a source audit, not runtime verification. No production code or tests changed.
The next implementation should address settlement before changing reporting contracts.

## Current ownership and contracts

```text
workspace coordinator (one database attachment)
└── bank
    ├── availability (fixed, bank lifetime)
    ├── history (fixed, bank lifetime)
    ├── mapping rows (dynamic, discovered provider accounts)
    ├── setup (invoked during setup, including parent draining substates)
    │   ├── lock (one explicit setup stage)
    │   ├── preparation / authorization / baseline checks
    │   ├── passkey / claim / sealing leaf effects
    │   └── setup persistence
    └── operation (invoked during work, including parent draining substates)
        ├── lock (operation lifetime)
        ├── preparation / authorization
        ├── unlock / provider request / outcome persistence
        ├── mapping → create / write / unlink
        └── import → account traversal → transaction processing
```

`readiness.ts` owns the bank actor; `BankSyncIntegration.svelte` subscribes directly
for presentation and forwards commands through the workspace. Retain that boundary.
Presentation snapshot observation is intentional and differs from a parent interpreting
a child's private policy.

The bank accepts observations, explicit connect/discover/sync/map/create/disconnect
commands, setup confirmations, cancellation, reset and shutdown. Setup and operation
return finite results through invocation output. Import counts travel upward through
`IMPORT_PROGRESS`. Availability and history currently communicate through `onSnapshot`;
the bank stores the complete availability snapshot and reads its context and tags.

## Findings and decisions

### 1. Fix settlement ownership first

`operation.ts` handles `CANCEL` by immediately entering its final `cancelled` state.
That stops an active mapping/import child or disconnect/outcome promise and releases
the lock callback. `setup.ts` likewise finalizes cancellation immediately, including
while its persistence child is running. The parent bank's cancelling/resetting/shutting
down substates wait for these children, but a child's completion currently does not
prove that issued writes have settled.

The persistence promises in `setup-persist.ts`, `import-transaction.ts`,
`account-unlink.ts` and `operation.ts` issue writes and await local settlement. An abort
check before issuing a write cannot cancel that write after issuance. These paths
need a domain drain protocol propagated through each live resource-owning descendant.
Keep the original scope and progress counts while draining. Do not interpret actor
stopping as rollback. Do not await failed/completed children.

Retain the setup/operation split: setup owns a staged passkey and one-use token flow;
operation owns a command and, when needed, a transient unlocked credential/provider
response. Retain fixed invocation across parent working/draining substates. Preserve
stage-specific setup lock lifetimes rather than holding a lock during user prompts
without a separately justified requirement.

### 2. Expose the mapping transaction workflow

`account-write.ts`'s `commit` promise opens a transaction, queries provider links,
decides whether creation is already satisfied, queries destination links and account,
checks eligibility, chooses inserts/updates, and awaits settlement. Preflight checks
do not make this nested orchestration a leaf operation.

Retain one atomic transaction and move its resource lifetime and decisions into a
transaction child, following the existing workspace transaction pattern only after
checking the installed SDK's actual transaction API. Model open → read → eligibility
→ stage → commit → settle, with interruption/rollback paths and actual outcomes.
Keep necessary atomic invariant rechecks. Do not split related writes into separate
transactions or treat rollback as established before settlement.

### 3. Replace private availability coupling with a public report

`index.ts` stores `SnapshotFrom<typeof bankAvailabilityMachine>`, accesses
`availability.context.source/connection`, and interprets tags for command guards.
It also initializes a separate availability snapshot through `getInitialSnapshot`.
Replace parent policy inspection with a typed report containing the selected
connection, explicit command capabilities and relevant observation facts. Correlate
it with attachment/observation generation; reject obsolete reports, including A → B
→ A changes. Invalidate capabilities when observations change, before accepting new
commands. Keep availability as the owner of observed credential/access readiness.

Keep operation-time authorization checks: checking fresh persisted authority before
an external request/write is a different boundary from publishing UI readiness.
Do not remove those checks merely to eliminate repeated predicates.

### 4. Retain focused children unless evidence supports consolidation

History owns saved historical outcome presentation independently of the active
attempt. Mapping rows have a genuine dynamic population. Import/account/transaction
children own traversal and individual acceptance outcomes. Preparation, baseline and
authorization expose meaningful guarded decisions. The audit does not justify
merging these into a controller or introducing a registry, generic supervisor or bus.
History can publish its small summary rather than exposing private context when the
reporting boundary is revised; it does not need resource-drain machinery.

## Proposed review sequence

1. Setup persistence settlement: define cancellation/credential replacement/shutdown
   ownership, retain issued-write settlement, and clear transient setup material.
2. Mapping transaction ownership: expose the atomic workflow and its drain contract.
3. Operation/import settlement: propagate cancellation through mapping/import/write
   owners, retain lock ownership until required settlement, and preserve counts.
4. Availability/history reports: remove private snapshot policy coupling and define
   correlated observation replacement behavior.

Each item needs its statechart and concrete file scope recorded before implementation,
implementation review before tests, then focused unit/browser verification. A larger
batch requires explicit discussion under the repository working agreements.

Verification must cover cancellation before/after write issuance, local settlement
failure or uncertainty, lock release ordering, late provider/passkey completion,
credential replacement, authority revocation, identity/workspace replacement, reset
versus shutdown priority, child crashes and already-completed descendants. Preserve
explicit provider initiation, discovery without transaction fetching, partial counts,
secret cleanup and original write scope. No new automatic retry/fetch behavior.

## Evidence limits

Inspected bank machine definitions and invocation/effect boundaries, the bank
presentation contract/integration and workspace bank ownership. These findings are
based on source control flow; no race was executed. SDK transaction and XState runtime
semantics must be inspected before implementing the proposed resource protocols.
Forms, root/session supervision and diagnostics remain separate pending audits.
