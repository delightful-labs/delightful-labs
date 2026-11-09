import { createAsyncLogic, setup, types, type ActorRefFrom } from "xstate";
import { requestMachine } from "./request-machine";
import {
  CACHE_FRESH_MS,
  CACHE_STALE_MS,
  type Snapshot,
  type ConfiguredReader,
  type SnapshotStorage,
} from "./model";

type Reply = {
  resolve: (snapshot: Snapshot | null) => void;
  reject: (reason: unknown) => void;
};
type ReaderInput = {
  config: ConfiguredReader | null;
  storage?: SnapshotStorage;
};
type ReaderContext = ReaderInput & {
  cache: Snapshot | null;
  waiters: Reply[];
  error: unknown;
};

const readerSetup = setup({
  schemas: {
    context: types<ReaderContext>(),
    input: types<ReaderInput>(),
    events: { READ: types<{ at: number; reply: Reply }>(), STOP: types<{}>() },
  },
  states: {
    stopped: {},
    empty: { schemas: { context: types<{ config: ConfiguredReader }>() } },
    loading: { schemas: { context: types<{ config: ConfiguredReader }>() } },
    ready: { schemas: { context: types<{ config: ConfiguredReader }>() } },
    stale: { schemas: { context: types<{ config: ConfiguredReader }>() } },
    unavailable: {
      schemas: { context: types<{ config: ConfiguredReader }>() },
    },
    checkingFailure: {
      schemas: { context: types<{ config: ConfiguredReader }>() },
    },
  },
  actors: {
    requestSnapshot: requestMachine,
    readClock: createAsyncLogic({ run: async () => Date.now() }),
  },
});

export const readerMachine = readerSetup.createMachine({
  id: "publicationReader",
  context: ({ input }) => ({
    ...input,
    cache: null,
    waiters: [],
    error: undefined,
  }),
  initial: "configuration",
  on: {
    STOP: ({ context }, enq) => {
      for (const waiter of context.waiters)
        enq(waiter.reject, new Error("Reader stopped"));
      return { target: ".stopped", context: { waiters: [] } };
    },
  },
  states: {
    configuration: {
      type: "choice",
      choice: ({ context }) =>
        context.config
          ? { target: "empty", context: { config: context.config } }
          : { target: "unconfigured" },
    },
    unconfigured: {
      on: {
        READ: ({ event }, enq) => {
          enq(event.reply.resolve, null);
        },
      },
    },
    empty: {
      on: {
        READ: ({ event }) => ({
          target: "loading",
          context: { waiters: [event.reply] },
        }),
      },
    },
    loading: {
      invoke: {
        src: "requestSnapshot",
        input: ({ context }) => ({
          config: context.config,
          storage: context.storage,
        }),
        onDone: ({ context, event }, enq) => {
          for (const waiter of context.waiters)
            enq(waiter.resolve, event.output);
          return {
            target: event.output.stale ? "stale" : "ready",
            context: { cache: event.output, waiters: [] },
          };
        },
        onError: ({ event }) => ({
          target: "checkingFailure",
          context: { error: event.error },
        }),
      },
      on: {
        READ: ({ context, event }) => ({
          context: { waiters: [...context.waiters, event.reply] },
        }),
      },
    },
    ready: {
      on: {
        READ: ({ context, event }, enq) => {
          if (
            !context.storage &&
            context.cache &&
            event.at - context.cache.verifiedAt < CACHE_FRESH_MS
          ) {
            enq(event.reply.resolve, context.cache);
            return;
          }
          return { target: "loading", context: { waiters: [event.reply] } };
        },
      },
    },
    stale: {
      on: {
        READ: ({ event }) => ({
          target: "loading",
          context: { waiters: [event.reply] },
        }),
      },
    },
    unavailable: {
      on: {
        READ: ({ event }) => ({
          target: "loading",
          context: { waiters: [event.reply] },
        }),
      },
    },
    checkingFailure: {
      invoke: {
        src: "readClock",
        onDone: ({ context, event }, enq) => {
          if (
            !context.storage &&
            context.cache &&
            event.output - context.cache.verifiedAt <= CACHE_STALE_MS
          ) {
            const stale = { ...context.cache, stale: true };
            for (const waiter of context.waiters) enq(waiter.resolve, stale);
            return { target: "stale", context: { waiters: [] } };
          }
          for (const waiter of context.waiters)
            enq(waiter.reject, context.error);
          return {
            target: "unavailable",
            context: { cache: null, waiters: [] },
          };
        },
      },
      on: {
        READ: ({ context, event }) => ({
          context: { waiters: [...context.waiters, event.reply] },
        }),
      },
    },
    stopped: { type: "final" },
  },
});

export type ReaderActor = ActorRefFrom<typeof readerMachine>;
