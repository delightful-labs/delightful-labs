import { createAsyncLogic, setup, types, type ActorRefFrom } from "xstate";
import {
  CACHE_FRESH_MS,
  CACHE_STALE_MS,
  type Snapshot,
  type SnapshotLoader,
} from "./model";

type Reply = {
  resolve: (snapshot: Snapshot | null) => void;
  reject: (reason: unknown) => void;
};
type ReaderInput = {
  configured: boolean;
  shared?: boolean;
  load: SnapshotLoader;
  now: () => number;
};
type ReaderContext = ReaderInput & { cache: Snapshot | null; waiters: Reply[] };
type LoadFailure = { reason: unknown; at: number };

const refresh = createAsyncLogic({
  schemas: {
    input: types<Pick<ReaderInput, "load" | "now">>(),
    error: types<LoadFailure>(),
  },
  run: async ({ input, signal }): Promise<Snapshot> => {
    try {
      return await input.load(signal);
    } catch (reason) {
      throw { reason, at: input.now() } satisfies LoadFailure;
    }
  },
});

const readerSetup = setup({
  schemas: {
    context: types<ReaderContext>(),
    input: types<ReaderInput>(),
    events: { READ: types<{ at: number; reply: Reply }>(), STOP: types<{}>() },
  },
});

const refreshInvocation = readerSetup.createInvoke({
  src: refresh,
  input: ({ context }) => ({ load: context.load, now: context.now }),
  onDone: ({ context, event }, enq) => {
    for (const waiter of context.waiters) enq(waiter.resolve, event.output);
    return {
      target: event.output.stale ? "stale" : "ready",
      context: { cache: event.output, waiters: [] },
    };
  },
  onError: ({ context, event }, enq) => {
    if (
      !context.shared &&
      context.cache &&
      event.error.at - context.cache.verifiedAt <= CACHE_STALE_MS
    ) {
      const stale = { ...context.cache, stale: true };
      for (const waiter of context.waiters) enq(waiter.resolve, stale);
      return { target: "stale", context: { waiters: [] } };
    }
    for (const waiter of context.waiters)
      enq(waiter.reject, event.error.reason);
    return { target: "unavailable", context: { cache: null, waiters: [] } };
  },
});

export const readerMachine = readerSetup.createMachine({
  id: "publicationReader",
  context: ({ input }) => ({ ...input, cache: null, waiters: [] }),
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
        context.configured ? { target: "empty" } : { target: "unconfigured" },
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
      invoke: refreshInvocation,
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
            !context.shared &&
            context.cache &&
            event.at - context.cache.verifiedAt < CACHE_FRESH_MS
          ) {
            enq(event.reply.resolve, context.cache);
            return;
          }
          return { target: "refreshing", context: { waiters: [event.reply] } };
        },
      },
    },
    refreshing: {
      invoke: refreshInvocation,
      on: {
        READ: ({ context, event }) => ({
          context: { waiters: [...context.waiters, event.reply] },
        }),
      },
    },
    stale: {
      on: {
        READ: ({ event }) => ({
          target: "refreshing",
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
    stopped: { type: "final" },
  },
});

export type ReaderActor = ActorRefFrom<typeof readerMachine>;
