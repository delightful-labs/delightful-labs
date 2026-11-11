import { createAsyncLogic, setup, types } from "xstate";
import { durableMachine } from "./durable-machine";
import type { ConfiguredReader, Snapshot, SnapshotStorage } from "./model";
import { snapshotMachine } from "./snapshot-machine";

type Input = { config: ConfiguredReader; storage?: SnapshotStorage };
type Context = Input & { snapshot?: Snapshot; error?: unknown };

export const requestMachine = setup({
  schemas: {
    input: types<Input>(),
    context: types<Context>(),
    output: types<Snapshot>(),
  },
  actors: {
    loadSource: snapshotMachine,
    loadDurable: durableMachine,
    fail: createAsyncLogic({
      schemas: { input: types<{ error: unknown }>() },
      run: async ({ input }) => {
        throw input.error;
      },
    }),
  },
  states: {
    durable: { schemas: { context: types<{ storage: SnapshotStorage }>() } },
    complete: { schemas: { context: types<{ snapshot: Snapshot }>() } },
  },
}).createMachine({
  id: "snapshotRequest",
  context: ({ input }) => ({ ...input }),
  initial: "selecting",
  states: {
    selecting: {
      type: "choice",
      choice: ({ context }) =>
        context.storage
          ? { target: "durable", context: { storage: context.storage } }
          : { target: "source" },
    },
    source: {
      invoke: {
        src: "loadSource",
        input: ({ context }) => ({ config: context.config }),
        onDone: ({ event }) => ({
          target: "complete",
          context: { snapshot: event.output },
        }),
      },
    },
    durable: {
      invoke: {
        src: "loadDurable",
        input: ({ context }) => ({
          config: context.config,
          storage: context.storage,
        }),
        onDone: ({ event }, enq) => {
          if (!event.output.ok)
            return { target: "failed", context: { error: event.output.error } };
          const { outcome, snapshot } = event.output;
          enq(() =>
            console.info("Leaflet snapshot", {
              outcome,
              verifiedAt: snapshot.verifiedAt,
            }),
          );
          return {
            target: "complete",
            context: { snapshot: event.output.snapshot },
          };
        },
      },
    },
    failed: {
      invoke: {
        src: "fail",
        input: ({ context }) => ({ error: context.error }),
      },
    },
    complete: { type: "final", output: ({ context }) => context.snapshot },
  },
  output: ({ output }) => output,
});
