import { createActor } from "xstate";
import { durableMachine } from "./durable-machine";
import type { SnapshotLoader } from "./model";
import { runActor } from "./run-actor";
import type { SnapshotStore } from "./snapshot-store";

export function durableLoader(
  store: SnapshotStore,
  load: SnapshotLoader,
  now: () => number,
): SnapshotLoader {
  return async (signal) => {
    const result = await runActor(
      createActor(durableMachine, { input: { store, load, now } }),
      signal,
    );
    if (!result.ok) throw result.error;
    console.info("Leaflet snapshot", {
      outcome: result.outcome,
      verifiedAt: result.snapshot.verifiedAt,
    });
    return result.snapshot;
  };
}
