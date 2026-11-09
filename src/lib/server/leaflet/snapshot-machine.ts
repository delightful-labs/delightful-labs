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
};
type Publication = Snapshot["publication"];
type Connected = Input & { pds: URL };
type Committed = Connected & { commit: string };
type Published = Committed & { publication: Publication };
type Enumerated = Published & { records: DocumentRecord[] };
type Prepared = Published & { articles: Article[] };
type Context = Input & Partial<Enumerated & Prepared & { snapshot: Snapshot }>;

const connect = createAsyncLogic({
  schemas: { input: types<Input>() },
  run: ({ input, signal }) =>
    resolvePds(input.config.ownerDid, input.json, signal),
});
const commit = createAsyncLogic({
  schemas: { input: types<Connected>() },
  run: ({ input, signal }) =>
    readCommit(rpc(input, signal), input.config.ownerDid),
});
const publication = createAsyncLogic({
  schemas: { input: types<Committed>() },
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
  schemas: { input: types<Published>() },
  run: ({ input, signal }) =>
    readDocumentRecords(rpc(input, signal), input.config.ownerDid),
});
const prepare = createAsyncLogic({
  schemas: { input: types<Enumerated>() },
  run: async ({ input, signal }): Promise<Article[]> => {
    const articles: Article[] = [];
    const request = rpc(input, signal);
    for (const record of input.records) {
      signal.throwIfAborted();
      if (record.value.site === input.config.publicationUri)
        articles.push(
          await readArticle(record, input.config, input.pds, request),
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
  schemas: { input: types<Prepared>() },
  run: async ({ input, signal }): Promise<Snapshot> => {
    if (
      input.commit !==
      (await readCommit(rpc(input, signal), input.config.ownerDid))
    )
      throw new Error("Repository changed during scan; retry later");
    signal.throwIfAborted();
    return {
      publication: input.publication,
      articles: input.articles,
      verifiedAt: input.now(),
      stale: false,
    };
  },
});

// Bind RPC cancellation to the active stage, rather than a completed actor.
function rpc(context: Connected, signal: AbortSignal): Rpc {
  return createRpc(context.pds, context.json, signal);
}
export const snapshotMachine = setup({
  schemas: {
    context: types<Context>(),
    input: types<Input>(),
    output: types<Snapshot>(),
  },
  states: {
    readingInitialCommit: { schemas: { context: types<Connected>() } },
    readingPublication: { schemas: { context: types<Committed>() } },
    enumeratingRecords: { schemas: { context: types<Published>() } },
    preparingArticles: { schemas: { context: types<Enumerated>() } },
    verifyingCommit: { schemas: { context: types<Prepared>() } },
    complete: { schemas: { context: types<{ snapshot: Snapshot }>() } },
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
          context: { pds: event.output },
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
          target: "preparingArticles",
          context: { records: event.output },
        }),
      },
    },
    preparingArticles: {
      invoke: {
        src: prepare,
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
    complete: { type: "final", output: ({ context }) => context.snapshot },
  },
  output: ({ output }) => output,
});
