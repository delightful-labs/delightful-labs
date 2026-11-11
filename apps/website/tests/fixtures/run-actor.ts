import { toPromise, type AnyActorRef, type OutputFrom } from "xstate";

// Every short-lived operation shares the same cancellation and disposal rules.
export async function runActor<
  T extends AnyActorRef & { start(): unknown; stop(): unknown },
>(actor: T, signal: AbortSignal): Promise<OutputFrom<T>> {
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      // Reject first: stopping an actor can resolve toPromise with no output.
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
    signal.removeEventListener("abort", onAbort);
    actor.stop();
  }
}
