# Clipper workflow extensions

Read the authoritative [shared state/resource guide](../../../../docs/engineering/state-machines.md)
and [scope/approval rules](../../../../docs/engineering/scope.md) first. The shared
stricter engineering requirements apply. This file retains Clipper's native
boundaries and installed v6 qualification; product scope remains in its active spec.

## Clipper native boundaries

DLF owns transaction acquisition, commit, rollback and settlement. Domain charts
own eligibility and selected mutation paths. Use the existing
[transaction bridge](../../apps/web/src/lib/machines/storage/domain-transaction.ts)
and [domain model](../../apps/web/src/lib/machines/storage/domain-model.ts) where
the callback boundary composes with a chart. Keep read/stage messages private to
that lifecycle and do not copy DLF transaction ownership or store domain facts on
native resources.

The [draft mutation chart](../../apps/web/src/lib/notes/draft-mutation-machine.ts)
keeps IndexedDB comparisons/writes synchronous and acknowledges transaction
completion. The [extension notification chart](../../apps/extension/src/notification-machine.ts)
models sender admission, optional lookup, validation, display and acknowledgment;
reject before private reads and acknowledge only completed display. Verify exact
capture matching, native errors, account scope and cleanup through real adapters.

Main-thread/worker boundaries are detailed in [worker-runtime.md](worker-runtime.md).
Current native proof, custody, unknown-write and offline qualification remains
there and in the active feature; moving guidance does not qualify new platform
support or repair existing extension failures.

## Installed v6 contracts

The web, extension and workers use published `xstate@6.0.0-beta.1`. Read the
installed `xstate/docs` mechanism guides and `xstate/docs/agents.md` when changing a
chart. `setup({ schemas })` declares context, inputs, event payload maps, outputs
and children. Selection and `.can()` may evaluate calculation functions: return
context patches, use `enq` for effects, and obtain native observations through
owned logic. Only self-originated coordination belongs in `internalEvents`;
callback, worker and subscribed-child reports belong in `events`.

Use `type: 'choice'` with a total, effect-free `choice` for pure routing. Keep
conditional waits, context-producing steps and effect-producing transitions as
`always`. Consume `event.output` from completion; completed children need not
remain in `children`. Relative state predicates include the full root nesting,
including `active.flow`, and cancellation joins must observe the correct region.

Generic native capability contracts accept the typed `ChildSpawner` capability
and return an owned `ActorInstance` with its actual command protocol. This avoids
pretending that a child with additional internal events has a narrower generic
`ActorLogic` protocol. Keep the concrete source at its producer and explicitly
stop retained refs on their owner’s exit. Preserve `.provide()` source injection.

A queued mutation is acknowledged with `STAGED` before producing a receipt;
terminal output calculation must not assume an entry effect has already run.
Native commit/receipt handles remain in adapter closures, while domain facts
remain immutable chart context. See the migration specification for exact shared
artifact provenance and qualification results.

Use `@xstate/test@2.0.0-beta.0` for generated campaigns against independent
contracts and real actor SUTs. Keep explicit generators, bounds, seeds and
coverage requirements, retain shrinking/replay artifacts through the built-in
failure store, and preserve native browser/Jazz tests.

Use schema-driven contextual inference and checked producer/DTO contracts.
The shared strict type rules supersede the historical tuple-assertion allowance.

State-level `schemas.context` should express facts guaranteed by the active
state. Pass validated temporary payloads through state input, rather than root
nullable fields; retain write receipts and custody facts through their full drain
lifetime. Private coordination belongs in `schemas.internalEvents`, not a
public command map. Observe clocks and native cancellation in owned actors and
consume their returned facts in pure transitions, including deadline checks when
a timer callback is delayed. Dynamic per-job capabilities are actor input; the
extension invokes its clip workflow directly and supervises errors explicitly.

The generic transaction bridge accepts a typed domain spawn capability, keeping
the concrete source and its checked input at the producer. Its controller owns
the spawned child through completion or failure and stops its retained ref on
exit; DLF still owns acquisition, commit, rollback and settlement. Avoid erasing
these contracts with `AnyActorRef` or `AnyStateMachine`.
