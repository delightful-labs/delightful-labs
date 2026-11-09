import { createActor, toPromise } from "xstate";
import type { ConfiguredReader, JsonReader, Snapshot } from "./model";
import { snapshotMachine } from "./snapshot-machine";

export async function loadSnapshot(
  config: ConfiguredReader,
  json: JsonReader,
  now: () => number,
  signal: AbortSignal,
): Promise<Snapshot> {
  signal.throwIfAborted();
  const actor = createActor(snapshotMachine, {
    input: { config, json, now, startedAt: now() },
  });
  let onAbort: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(signal.reason);
      actor.stop();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = toPromise(actor);
    actor.start();
    return await Promise.race([result, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort!);
    actor.stop();
  }
}
