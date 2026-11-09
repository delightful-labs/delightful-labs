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
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("Archive refresh timeout")),
    40_000,
  );
  timer.unref();
  const cancellation = AbortSignal.any([signal, deadline.signal]);
  const actor = createActor(snapshotMachine, {
    input: { config, json, now },
  });
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(cancellation.reason);
      actor.stop();
    };
    cancellation.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = toPromise(actor);
    actor.start();
    return await Promise.race([result, aborted]);
  } finally {
    cancellation.removeEventListener("abort", onAbort);
    clearTimeout(timer);
    actor.stop();
  }
}
