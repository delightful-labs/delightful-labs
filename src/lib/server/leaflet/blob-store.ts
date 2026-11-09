import { createActor } from "xstate";
import { blobStoreMachine, type BlobOperation } from "./blob-store-machine";
import type { ConfiguredReader } from "./model";
import { runActor } from "./run-actor";
import type { SnapshotStore } from "./snapshot-store";
export { snapshotPath } from "./snapshot-codec";

async function perform(operation: BlobOperation, signal: AbortSignal) {
  const result = await runActor(
    createActor(blobStoreMachine, { input: operation }),
    signal,
  );
  if (!result.ok) throw result.error;
  return result;
}

export function blobSnapshotStore(
  config: ConfiguredReader,
  storeId: string,
  namespace: string,
): SnapshotStore {
  const location = { config, storeId, namespace };
  return {
    async read(signal) {
      return (await perform({ ...location, kind: "read" }, signal)).snapshot;
    },
    async write(snapshot, version, signal) {
      return (
        await perform({ ...location, kind: "write", snapshot, version }, signal)
      ).written;
    },
  };
}
