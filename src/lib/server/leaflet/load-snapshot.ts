import { createActor } from "xstate";
import type { ConfiguredReader, JsonReader, Snapshot } from "./model";
import { runActor } from "./run-actor";
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
  try {
    return await runActor(actor, cancellation);
  } finally {
    clearTimeout(timer);
  }
}
