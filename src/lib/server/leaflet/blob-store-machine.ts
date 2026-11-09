import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { createAsyncLogic, setup, types } from "xstate";
import type { ConfiguredReader, Snapshot } from "./model";
import {
  decodeSnapshot,
  encodeSnapshot,
  MAX_SNAPSHOT_BYTES,
  snapshotPath,
} from "./snapshot-codec";
import type { StoredSnapshot } from "./model";

type Location = {
  config: ConfiguredReader;
  storeId: string;
  namespace: string;
};
type Write = Location & {
  kind: "write";
  snapshot: Snapshot;
  version: string | null;
};
export type BlobOperation = (Location & { kind: "read" }) | Write;
type Downloaded = { body: string; version: string };
type Context = {
  operation: BlobOperation;
  body?: string;
  downloaded?: Downloaded;
  snapshot: StoredSnapshot | null;
  error: unknown;
};
type Result =
  | { ok: true; snapshot: StoredSnapshot | null; written: boolean }
  | { ok: false; error: unknown };

export const blobStoreMachine = setup({
  schemas: {
    input: types<BlobOperation>(),
    context: types<Context>(),
    output: types<Result>(),
  },
  actors: {
    downloadSnapshot: createAsyncLogic({
      schemas: { input: types<Location>() },
      run: async ({ input, signal }): Promise<Downloaded | null> => {
        const result = await get(snapshotPath(input.config, input.namespace), {
          storeId: input.storeId,
          access: "private",
          useCache: false,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
        });
        if (!result) return null;
        if (result.statusCode !== 200)
          throw new Error("Unexpected snapshot response");
        let size = 0;
        const chunks: Uint8Array[] = [];
        for await (const chunk of result.stream) {
          size += chunk.length;
          if (size > MAX_SNAPSHOT_BYTES)
            throw new Error("Durable snapshot size limit");
          chunks.push(chunk);
        }
        return {
          body: Buffer.concat(chunks).toString("utf8"),
          version: result.blob.etag,
        };
      },
    }),
    validateSnapshot: createAsyncLogic({
      schemas: { input: types<Location & { downloaded: Downloaded }>() },
      run: async ({ input }): Promise<StoredSnapshot> => ({
        snapshot: decodeSnapshot(
          JSON.parse(input.downloaded.body),
          input.config,
          input.namespace,
        ),
        version: input.downloaded.version,
      }),
    }),
    prepareSnapshot: createAsyncLogic({
      schemas: { input: types<Write>() },
      run: async ({ input }) =>
        encodeSnapshot(input.snapshot, input.config, input.namespace),
    }),
    uploadSnapshot: createAsyncLogic({
      schemas: { input: types<Write & { body: string }>() },
      run: async ({ input, signal }) => {
        await put(snapshotPath(input.config, input.namespace), input.body, {
          storeId: input.storeId,
          access: "private",
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
          addRandomSuffix: false,
          contentType: "application/json",
          cacheControlMaxAge: 60,
          allowOverwrite: input.version !== null,
          ...(input.version ? { ifMatch: input.version } : {}),
        });
      },
    }),
  },
  states: {
    preparing: { schemas: { context: types<{ operation: Write }>() } },
    writing: {
      schemas: { context: types<{ operation: Write; body: string }>() },
    },
    validatingRead: {
      schemas: { context: types<{ downloaded: Downloaded }>() },
    },
    validatingFirstWriter: {
      schemas: { context: types<{ downloaded: Downloaded }>() },
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
        src: "downloadSnapshot",
        input: ({ context }) => context.operation,
        onDone: ({ event }) =>
          event.output
            ? {
                target: "validatingRead",
                context: { downloaded: event.output },
              }
            : { target: "readComplete" },
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    validatingRead: {
      invoke: {
        src: "validateSnapshot",
        input: ({ context }) => ({
          ...context.operation,
          downloaded: context.downloaded,
        }),
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
        src: "prepareSnapshot",
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
        src: "uploadSnapshot",
        input: ({ context }) => ({ ...context.operation, body: context.body }),
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
        src: "downloadSnapshot",
        input: ({ context }) => context.operation,
        onDone: ({ event }) =>
          event.output
            ? {
                target: "validatingFirstWriter",
                context: { downloaded: event.output },
              }
            : { target: "failed" },
        onError: ({ event }) => ({
          target: "failed",
          context: { error: event.error },
        }),
      },
    },
    validatingFirstWriter: {
      invoke: {
        src: "validateSnapshot",
        input: ({ context }) => ({
          ...context.operation,
          downloaded: context.downloaded,
        }),
        onDone: { target: "conflict" },
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
