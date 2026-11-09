import { get, put } from "@vercel/blob";
import { createActor } from "xstate";
import { blobStoreMachine, type BlobOperation } from "./blob-store-machine";
import type { ConfiguredReader } from "./model";
import { runActor } from "./run-actor";
import {
  decodeSnapshot,
  encodeSnapshot,
  MAX_SNAPSHOT_BYTES,
  snapshotPath,
} from "./snapshot-codec";
import type { SnapshotStore, StoredSnapshot } from "./snapshot-store";
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
  const path = snapshotPath(config, namespace);
  const options = (signal: AbortSignal) => ({
    storeId,
    access: "private" as const,
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
  });
  const read = async (signal: AbortSignal): Promise<StoredSnapshot | null> => {
    const result = await get(path, { ...options(signal), useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200)
      throw new Error("Unexpected snapshot response");
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.stream) {
      size += chunk.length;
      if (size > MAX_SNAPSHOT_BYTES)
        throw new Error("Durable snapshot size limit");
      chunks.push(chunk);
    }
    return {
      snapshot: decodeSnapshot(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
        config,
        namespace,
      ),
      version: result.blob.etag,
    };
  };
  return {
    async read(signal) {
      return (await perform({ kind: "read", read }, signal)).snapshot;
    },
    async write(snapshot, version, signal) {
      return (
        await perform(
          {
            kind: "write",
            version,
            read,
            prepare: () => encodeSnapshot(snapshot, config, namespace),
            upload: async (body, activeSignal) => {
              await put(path, body, {
                ...options(activeSignal),
                addRandomSuffix: false,
                contentType: "application/json",
                cacheControlMaxAge: 60,
                allowOverwrite: version !== null,
                ...(version ? { ifMatch: version } : {}),
              });
            },
          },
          signal,
        )
      ).written;
    },
  };
}
