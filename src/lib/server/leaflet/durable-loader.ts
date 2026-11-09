import {
  CACHE_FRESH_MS,
  CACHE_STALE_MS,
  type Snapshot,
  type SnapshotLoader,
} from "./model";
import type { SnapshotStore } from "./snapshot-store";

export function durableLoader(
  store: SnapshotStore,
  load: SnapshotLoader,
  now: () => number,
): SnapshotLoader {
  function reusable(snapshot: Snapshot): Snapshot {
    const age = now() - snapshot.verifiedAt;
    if (age < 0 || age > CACHE_STALE_MS)
      throw new Error("Durable snapshot expired");
    return { ...snapshot, stale: age >= CACHE_FRESH_MS };
  }
  return async (signal) => {
    signal.throwIfAborted();
    const previous = await store.read(signal);
    if (previous && now() - previous.snapshot.verifiedAt < CACHE_FRESH_MS) {
      console.info("Leaflet snapshot", {
        outcome: "fresh",
        verifiedAt: previous.snapshot.verifiedAt,
      });
      return reusable(previous.snapshot);
    }
    let failure: unknown = new Error("Concurrent snapshot refresh; retry");
    try {
      const snapshot = await load(signal);
      signal.throwIfAborted();
      if (await store.write(snapshot, previous?.version ?? null, signal)) {
        console.info("Leaflet snapshot", {
          outcome: "saved",
          verifiedAt: snapshot.verifiedAt,
        });
        return snapshot;
      }
    } catch (error) {
      signal.throwIfAborted();
      failure = error;
    }
    // Re-read after every failure/conflict: another instance may have removed posts.
    const current = await store.read(signal);
    if (!current) throw failure;
    const snapshot = reusable(current.snapshot);
    console.info("Leaflet snapshot", {
      outcome: snapshot.stale ? "stale" : "winner",
      verifiedAt: snapshot.verifiedAt,
    });
    return snapshot;
  };
}
