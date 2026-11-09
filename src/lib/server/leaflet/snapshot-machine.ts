import { createAsyncLogic, setup, types } from "xstate";
import { readArticle } from "./article";
import { createRpc, readCommit, type Rpc } from "./client";
import { resolvePds } from "./identity";
import type { Article, ConfiguredReader, JsonReader, Snapshot } from "./model";
import { readDocumentRecords } from "./records";
import { publicationSchema, type DocumentRecord } from "./schemas";

type Input = {
  config: ConfiguredReader;
  json: JsonReader;
  now: () => number;
  startedAt: number;
};
type Connection = { pds: URL };
type Publication = Snapshot["publication"];
type Context = Input & {
  connection?: Connection;
  commit?: string;
  publication?: Publication;
  records?: DocumentRecord[];
  articles?: Article[];
  snapshot?: Snapshot;
};

const connect = createAsyncLogic({
  schemas: { input: types<Input>() },
  run: async ({ input, signal }): Promise<Connection> => {
    const pds = await resolvePds(input.config.ownerDid, input.json, signal);
    return { pds };
  },
});
const commit = createAsyncLogic({
  schemas: { input: types<Context>() },
  run: ({ input, signal }) =>
    readCommit(rpc(input, signal), input.config.ownerDid),
});
const publication = createAsyncLogic({
  schemas: { input: types<Context>() },
  run: async ({ input, signal }): Promise<Publication> => {
    const record = publicationSchema.parse(
      await rpc(input, signal)("com.atproto.repo.getRecord", {
        repo: input.config.ownerDid,
        collection: "site.standard.publication",
        rkey: input.config.publicationKey,
      }),
    );
    if (record.uri !== input.config.publicationUri)
      throw new Error("Publication mismatch");
    return {
      uri: record.uri,
      name: record.value.name,
      sourceUrl: new URL(record.value.url).href,
    };
  },
});
const enumerate = createAsyncLogic({
  schemas: { input: types<Context>() },
  run: ({ input, signal }) =>
    readDocumentRecords(rpc(input, signal), input.config.ownerDid),
});
const normalize = createAsyncLogic({
  schemas: { input: types<Context>() },
  run: async ({ input, signal }): Promise<Article[]> => {
    const articles: Article[] = [];
    for (const record of input.records!) {
      signal.throwIfAborted();
      if (record.value.site === input.config.publicationUri)
        articles.push(
          await readArticle(
            record,
            input.config,
            input.connection!.pds,
            rpc(input, signal),
          ),
        );
    }
    return articles.sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        a.uri.localeCompare(b.uri),
    );
  },
});
const verify = createAsyncLogic({
  schemas: { input: types<Context>() },
  run: async ({ input, signal }): Promise<Snapshot> => {
    if (
      input.commit !==
      (await readCommit(rpc(input, signal), input.config.ownerDid))
    )
      throw new Error("Repository changed during scan; retry later");
    signal.throwIfAborted();
    return {
      publication: input.publication!,
      articles: input.articles!,
      verifiedAt: input.now(),
      stale: false,
    };
  },
});

// Bind RPC cancellation to the active stage, rather than a completed actor.
function rpc(context: Context, signal: AbortSignal): Rpc {
  return createRpc(
    context.connection!.pds,
    context.json,
    context.now,
    context.startedAt,
    signal,
  );
}
export const snapshotMachine = setup({
  schemas: {
    context: types<Context>(),
    input: types<Input>(),
    output: types<Snapshot>(),
  },
}).createMachine({
  id: "snapshotLoad",
  context: ({ input }) => ({ ...input }),
  initial: "resolvingIdentity",
  states: {
    resolvingIdentity: {
      invoke: {
        src: connect,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "readingInitialCommit",
          context: { connection: event.output },
        }),
      },
    },
    readingInitialCommit: {
      invoke: {
        src: commit,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "readingPublication",
          context: { commit: event.output },
        }),
      },
    },
    readingPublication: {
      invoke: {
        src: publication,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "enumeratingRecords",
          context: { publication: event.output },
        }),
      },
    },
    enumeratingRecords: {
      invoke: {
        src: enumerate,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "normalizingArticles",
          context: { records: event.output },
        }),
      },
    },
    normalizingArticles: {
      invoke: {
        src: normalize,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "verifyingCommit",
          context: { articles: event.output },
        }),
      },
    },
    verifyingCommit: {
      invoke: {
        src: verify,
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "complete",
          context: { snapshot: event.output },
        }),
      },
    },
    complete: { type: "final" },
  },
  output: ({ context }) => context.snapshot!,
});
