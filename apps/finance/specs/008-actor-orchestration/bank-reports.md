# Bank availability and history reports

Status: implementation reviewed and scoped runtime verification passed.

## Model and ownership

The bank retains two fixed, pure children for its entire lifetime. Availability owns access,
credential completeness and control selection. Its existing parallel access/credential/control
statechart remains authoritative. History independently owns saved outcome classification:
connection → timestamp → outcome → absent/succeeded/partial/failed. Neither child acquires a
resource or performs asynchronous I/O; report publication is a leaf message action. There is no
new promise actor or procedural workflow.

Availability's stable control states publish `AVAILABILITY_REPORTED` to the typed recipient
supplied at invocation. The report contains observation generation, presentation mode, connect
and operation capabilities, selected encrypted connection and the environment facts needed by
existing cancellation transitions. `SETUP_STARTED`/`SETUP_ENDED` also publish the resulting
control choice. Standalone synchronous authorization evaluation continues to use the same
statechart without a reporting recipient; fresh operation authorization is retained.

History receives a selected connection and generation through its reporting input, then publishes `HISTORY_REPORTED` with
that generation and its optional saved summary. Outcome selection and summary construction stay
inside history. Standalone synchronous history projection remains available without a recipient.
The bank no longer initializes or stores either child's complete snapshot, reads
private child context, or interprets availability tags. Presentation consumes the public mode.

## Observation replacement and interruption

Each bank instance belongs to one existing workspace/database attachment. Typed recipient actor
references bind child reports to that exact bank lifetime. Within that lifetime, every `OBSERVED`
increments a monotonic generation, clears command capabilities and saved history immediately,
and forwards the new source and generation to availability. This distinguishes A → B → A even
when scope IDs repeat. Commands remain disabled until a current report arrives.

The bank rejects availability and history reports from older generations. A current availability
report raises the existing internal environment event in the same macrostep, preserving existing
scope/credential-change cancellation and write-draining behavior. History receives only accepted
availability results and publishes independently of active-attempt outcomes. Bank initialization
starts conservatively restricted with no history until its actual children report; it does not
construct parallel synthetic child snapshots.

Existing observer startup/error supervision, shutdown priority, mapping actors, operation-time
persisted authorization and original-scope resource settlement remain in place. No automatic
provider request, unlock, retry or persistence is added.

## Review and verification

Production scope: `availability.ts`, `history.ts`, `index.ts`. Changed actions and their helpers
were inspected for hidden orchestration: publication only constructs and sends a typed report;
existing pure environment/data projections remain functions. Installed XState's `enqueueActions`
checks guards against its transition snapshot, avoiding reads of `self.getSnapshot()` during entry.

Approved verification passed without production fixes:

- 104 unit tests across six files: public reports, availability decisions, bank supervisor,
  import settlement, operation ownership and mapping settlement. Real typed recipient actors
  capture availability/history reports. A deliberately muted availability publisher lets supervisor
  tests hold and reorder reports without relying on private child tags.
- Report coverage includes startup gating, setup transitions, credential completeness/replacement,
  owner-scoped connection selection, revoked access, saved success/partial/failure, immediate
  invalidation, delayed reports, A → B → A generations, active-operation cancellation, observer
  failure with pending cleanup, shutdown priority and absence of observation-triggered work.
- Seven Playwright checks passed against disposable in-memory Jazz: explicit connect/import,
  mapping/remapping, lock startup recovery, cancelled passkey completion, cancelled provider
  response and explicit retry, offline setup, and offline sync/reconnection. The explicit import
  check now also verifies saved history after reload and a new discovery without replacement or
  automatic provider requests.
- `pnpm check` passed with zero errors/warnings; `pnpm check:tests`, focused Prettier and
  `git diff --check` passed.

Commands:

```sh
pnpm exec vitest run src/lib/machines/bank-sync/reports.test.ts src/lib/machines/bank-sync/availability.test.ts src/lib/machines/bank-sync/index.test.ts src/lib/machines/bank-sync/import-settlement.test.ts src/lib/machines/bank-sync/operation.test.ts src/lib/machines/bank-sync/mapping.test.ts
pnpm exec playwright test --config playwright.bank-sync.config.ts tests/bank-sync.e2e.ts tests/bank-sync-offline.e2e.ts --grep 'connects explicitly|maps and remaps|lock actor startup failure|cancelled passkey creation|cancels a pending sync|offline'
```

The report-generation races and supervisor failures use controlled unit actors; browser coverage
checks rendered behavior with actual Jazz persistence and synthetic passkeys/provider responses.
This is scoped bank verification, not a full application/PWA or real-device passkey compatibility
run. Settlement evidence for the other bank review cycles remains in their linked design notes.
