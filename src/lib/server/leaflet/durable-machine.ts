import { createAsyncLogic, setup, types } from "xstate";
import {
  CACHE_FRESH_MS,
  CACHE_STALE_MS,
  type Snapshot,
  type ConfiguredReader,
  type SnapshotStorage,
  type StoredSnapshot,
} from "./model";
import { blobStoreMachine } from "./blob-store-machine";
import { snapshotMachine } from "./snapshot-machine";

type Input = { config: ConfiguredReader; storage: SnapshotStorage };
type Observed = { stored: StoredSnapshot | null; age: number | null };
type Context = Input & {
  baseVersion: string | null;
  current?: Observed;
  stored: StoredSnapshot | null;
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
export const durableMachine = setup({
  schemas: {
    input: types<Input>(),
    context: types<Context>(),
    output: types<Result>(),
  },
  actors: {
    blobOperation: blobStoreMachine,
    refreshSnapshot: snapshotMachine,
    readClock: createAsyncLogic({ run: async () => Date.now() }),
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
    stored: null,
    error: undefined,
  }),
  initial: "reading",
  states: {
    reading: {
      invoke: {
        src: "blobOperation",
        input: ({ context }) => ({
          config: context.config,
          ...context.storage,
          kind: "read",
        }),
        onDone: ({ event }) =>
          event.output.ok
            ? {
                target: "capturingReadTime",
                context: {
                  stored: event.output.snapshot,
                  baseVersion: event.output.snapshot?.version ?? null,
                },
              }
            : { target: "failed", context: { error: event.output.error } },
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    capturingReadTime: {
      invoke: {
        src: "readClock",
        onDone: ({ context, event }) => ({
          target: "checkingFreshness",
          context: {
            current: {
              stored: context.stored,
              age: context.stored
                ? event.output - context.stored.snapshot.verifiedAt
                : null,
            },
          },
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
        src: "refreshSnapshot",
        input: ({ context }) => ({ config: context.config }),
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
        src: "blobOperation",
        input: ({ context }) => ({
          config: context.config,
          ...context.storage,
          kind: "write",
          snapshot: context.candidate,
          version: context.baseVersion,
        }),
        onDone: ({ context, event }) =>
          !event.output.ok
            ? { target: "recovering", context: { error: event.output.error } }
            : event.output.written
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
        src: "blobOperation",
        input: ({ context }) => ({
          config: context.config,
          ...context.storage,
          kind: "read",
        }),
        onDone: ({ event }) =>
          event.output.ok
            ? {
                target: "capturingRecoveryTime",
                context: { stored: event.output.snapshot },
              }
            : { target: "failed", context: { error: event.output.error } },
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    capturingRecoveryTime: {
      invoke: {
        src: "readClock",
        onDone: ({ context, event }) => ({
          target: "checkingRecovery",
          context: {
            current: {
              stored: context.stored,
              age: context.stored
                ? event.output - context.stored.snapshot.verifiedAt
                : null,
            },
          },
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
