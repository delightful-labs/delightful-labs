import { createAsyncLogic, setup, types } from "xstate";
import { rpcUrl } from "./client";
import { parseDocumentKey } from "./config";
import { readJson } from "./http";
import { recordPageSchema, type DocumentRecord } from "./schemas";

type Input = { pds: string; ownerDid: string };
type Page = ReturnType<typeof recordPageSchema.parse>;
type Context = Input & {
  records: DocumentRecord[];
  cursors: string[];
  cursor: string;
  page?: Page;
};

export const recordsMachine = setup({
  schemas: {
    input: types<Input>(),
    context: types<Context>(),
    output: types<DocumentRecord[]>(),
  },
  actors: {
    fetchPage: createAsyncLogic({
      schemas: { input: types<Input & { cursor: string }>() },
      run: async ({ input, signal }) =>
        recordPageSchema.parse(
          await readJson(
            rpcUrl(input.pds, "com.atproto.repo.listRecords", {
              repo: input.ownerDid,
              collection: "site.standard.document",
              limit: "100",
              ...(input.cursor ? { cursor: input.cursor } : {}),
            }),
            signal,
          ),
        ),
    }),
    validatePage: createAsyncLogic({
      schemas: { input: types<Context & { page: Page }>() },
      run: async ({ input }) => {
        const seen = new Set(input.records.map((record) => record.uri));
        for (const record of input.page.records) {
          parseDocumentKey(record.uri, input.ownerDid);
          if (seen.has(record.uri))
            throw new Error("Duplicate record identity");
          seen.add(record.uri);
        }
        const records = [...input.records, ...input.page.records];
        if (records.length > 10_000) throw new Error("Archive size limit");
        const cursor = input.page.cursor ?? "";
        if (cursor && input.cursors.includes(cursor))
          throw new Error("Repeated cursor");
        const cursors = cursor ? [...input.cursors, cursor] : input.cursors;
        if (cursors.length > 200) throw new Error("Pagination limit");
        return { records, cursor, cursors };
      },
    }),
  },
  states: { validatingPage: { schemas: { context: types<{ page: Page }>() } } },
}).createMachine({
  id: "documentRecords",
  context: ({ input }) => ({ ...input, records: [], cursors: [], cursor: "" }),
  initial: "fetchingPage",
  states: {
    fetchingPage: {
      invoke: {
        src: "fetchPage",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "validatingPage",
          context: { page: event.output },
        }),
      },
    },
    validatingPage: {
      invoke: {
        src: "validatePage",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "checkingCursor",
          context: event.output,
        }),
      },
    },
    checkingCursor: {
      type: "choice",
      choice: ({ context }) => ({
        target: context.cursor ? "fetchingPage" : "complete",
      }),
    },
    complete: { type: "final", output: ({ context }) => context.records },
  },
  output: ({ output }) => output,
});
