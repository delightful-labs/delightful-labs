import { BlobPreconditionFailedError } from "@vercel/blob";
import { createAsyncLogic, setup, types } from "xstate";
import type { StoredSnapshot } from "./snapshot-store";

type Read = (signal: AbortSignal) => Promise<StoredSnapshot | null>;
type Write = {
  kind: "write";
  read: Read;
  version: string | null;
  prepare: () => string;
  upload: (body: string, signal: AbortSignal) => Promise<void>;
};
export type BlobOperation = { kind: "read"; read: Read } | Write;
type Context = {
  operation: BlobOperation;
  body?: string;
  snapshot: StoredSnapshot | null;
  error: unknown;
};
type Result =
  | { ok: true; snapshot: StoredSnapshot | null; written: boolean }
  | { ok: false; error: unknown };
const read = createAsyncLogic({
  schemas: { input: types<{ read: Read }>() },
  run: ({ input, signal }) => input.read(signal),
});
const prepare = createAsyncLogic({
  schemas: { input: types<Write>() },
  run: async ({ input }) => input.prepare(),
});
const upload = createAsyncLogic({
  schemas: { input: types<{ operation: Write; body: string }>() },
  run: ({ input, signal }) => input.operation.upload(input.body, signal),
});

export const blobStoreMachine = setup({
  schemas: {
    input: types<BlobOperation>(),
    context: types<Context>(),
    output: types<Result>(),
  },
  states: {
    preparing: { schemas: { context: types<{ operation: Write }>() } },
    writing: {
      schemas: { context: types<{ operation: Write; body: string }>() },
    },
  },
}).createMachine({
  id: "blobOperation",
  context: ({ input }) => ({
    operation: input,
    snapshot: null,
    error: undefined,
  }),
  initial: "selecting",
  states: {
    selecting: {
      type: "choice",
      choice: ({ context }) =>
        context.operation.kind === "read"
          ? { target: "reading" }
          : { target: "preparing", context: { operation: context.operation } },
    },
    reading: {
      invoke: {
        src: read,
        input: ({ context }) => context.operation,
        onDone: ({ event }) => ({
          target: "readComplete",
          context: { snapshot: event.output },
        }),
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    preparing: {
      invoke: {
        src: prepare,
        input: ({ context }) => context.operation,
        onDone: ({ event }) => ({
          target: "writing",
          context: { body: event.output },
        }),
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    writing: {
      invoke: {
        src: upload,
        input: ({ context }) => ({
          operation: context.operation,
          body: context.body,
        }),
        onDone: { target: "saved" },
        onError: ({ context, event }) => {
          if (event.error instanceof BlobPreconditionFailedError)
            return { target: "conflict" };
          return {
            target:
              context.operation.version === null
                ? "checkingFirstWriter"
                : "failed",
            context: { error: event.error },
          };
        },
      },
    },
    checkingFirstWriter: {
      invoke: {
        src: read,
        input: ({ context }) => context.operation,
        onDone: ({ event }) => ({
          target: event.output ? "conflict" : "failed",
        }),
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    readComplete: {
      type: "final",
      output: ({ context }) => ({
        ok: true as const,
        snapshot: context.snapshot,
        written: false,
      }),
    },
    saved: {
      type: "final",
      output: { ok: true as const, snapshot: null, written: true },
    },
    conflict: {
      type: "final",
      output: { ok: true as const, snapshot: null, written: false },
    },
    failed: {
      type: "final",
      output: ({ context }) => ({ ok: false as const, error: context.error }),
    },
  },
  output: ({ output }) => output,
});
