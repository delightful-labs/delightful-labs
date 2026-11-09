import { createAsyncLogic, setup, types } from "xstate";
import {
  CACHE_FRESH_MS,
  CACHE_STALE_MS,
  type Snapshot,
  type SnapshotLoader,
} from "./model";
import type { SnapshotStore, StoredSnapshot } from "./snapshot-store";

type Input = { store: SnapshotStore; load: SnapshotLoader; now: () => number };
type Observed = { stored: StoredSnapshot | null; age: number | null };
type Context = Input & {
  baseVersion: string | null;
  current?: Observed;
  candidate?: Snapshot;
  result?: Snapshot;
  error: unknown;
};
type Result =
  | {
      ok: true;
      snapshot: Snapshot;
      outcome: "fresh" | "saved" | "winner" | "stale";
    }
  | { ok: false; error: unknown };
const read = createAsyncLogic({
  schemas: { input: types<Pick<Input, "store" | "now">>() },
  run: async ({ input, signal }): Promise<Observed> => {
    const stored = await input.store.read(signal);
    // Capture age after I/O, outside transition calculations.
    return {
      stored,
      age: stored ? input.now() - stored.snapshot.verifiedAt : null,
    };
  },
});
const refresh = createAsyncLogic({
  schemas: { input: types<{ load: SnapshotLoader }>() },
  run: ({ input, signal }) => input.load(signal),
});
const commit = createAsyncLogic({
  schemas: {
    input: types<{
      store: SnapshotStore;
      candidate: Snapshot;
      baseVersion: string | null;
    }>(),
  },
  run: ({ input, signal }) =>
    input.store.write(input.candidate, input.baseVersion, signal),
});
export const durableMachine = setup({
  schemas: {
    input: types<Input>(),
    context: types<Context>(),
    output: types<Result>(),
  },
  states: {
    checkingFreshness: { schemas: { context: types<{ current: Observed }>() } },
    committing: { schemas: { context: types<{ candidate: Snapshot }>() } },
    checkingRecovery: { schemas: { context: types<{ current: Observed }>() } },
    fresh: { schemas: { context: types<{ result: Snapshot }>() } },
    saved: { schemas: { context: types<{ result: Snapshot }>() } },
    winner: { schemas: { context: types<{ result: Snapshot }>() } },
    stale: { schemas: { context: types<{ result: Snapshot }>() } },
  },
}).createMachine({
  id: "durableSnapshot",
  context: ({ input }) => ({
    ...input,
    baseVersion: null,
    error: undefined,
  }),
  initial: "reading",
  states: {
    reading: {
      invoke: {
        src: read,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "checkingFreshness",
          context: {
            current: event.output,
            baseVersion: event.output.stored?.version ?? null,
          },
        }),
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    checkingFreshness: {
      type: "choice",
      choice: ({ context }) => {
        const { stored, age } = context.current;
        if (!stored || age === null) return { target: "refreshing" };
        if (age < 0)
          return {
            target: "failed",
            context: { error: new Error("Durable snapshot expired") },
          };
        if (age < CACHE_FRESH_MS)
          return {
            target: "fresh",
            context: { result: { ...stored.snapshot, stale: false } },
          };
        return { target: "refreshing" };
      },
    },
    refreshing: {
      invoke: {
        src: refresh,
        input: ({ context }) => ({ load: context.load }),
        onDone: ({ event }) => ({
          target: "committing",
          context: { candidate: event.output },
        }),
        onError: ({ event }) => ({
          target: "recovering",
          context: { error: event.error },
        }),
      },
    },
    committing: {
      invoke: {
        src: commit,
        input: ({ context }) => ({
          store: context.store,
          candidate: context.candidate,
          baseVersion: context.baseVersion,
        }),
        onDone: ({ context, event }) =>
          event.output
            ? { target: "saved", context: { result: context.candidate } }
            : {
                target: "recovering",
                context: {
                  error: new Error("Concurrent snapshot refresh; retry"),
                },
              },
        onError: ({ event }) => ({
          target: "recovering",
          context: { error: event.error },
        }),
      },
    },
    recovering: {
      invoke: {
        src: read,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "checkingRecovery",
          context: { current: event.output },
        }),
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    checkingRecovery: {
      type: "choice",
      choice: ({ context }) => {
        const { stored, age } = context.current;
        if (!stored || age === null) return { target: "failed" };
        if (age < 0 || age > CACHE_STALE_MS)
          return {
            target: "failed",
            context: { error: new Error("Durable snapshot expired") },
          };
        return age < CACHE_FRESH_MS
          ? {
              target: "winner",
              context: { result: { ...stored.snapshot, stale: false } },
            }
          : {
              target: "stale",
              context: { result: { ...stored.snapshot, stale: true } },
            };
      },
    },
    fresh: {
      type: "final",
      output: ({ context }) => ({
        ok: true as const,
        outcome: "fresh" as const,
        snapshot: context.result,
      }),
    },
    saved: {
      type: "final",
      output: ({ context }) => ({
        ok: true as const,
        outcome: "saved" as const,
        snapshot: context.result,
      }),
    },
    winner: {
      type: "final",
      output: ({ context }) => ({
        ok: true as const,
        outcome: "winner" as const,
        snapshot: context.result,
      }),
    },
    stale: {
      type: "final",
      output: ({ context }) => ({
        ok: true as const,
        outcome: "stale" as const,
        snapshot: context.result,
      }),
    },
    failed: {
      type: "final",
      output: ({ context }) => ({ ok: false as const, error: context.error }),
    },
  },
  output: ({ output }) => output,
});
