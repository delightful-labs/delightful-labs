import { createAsyncLogic, setup, types } from "xstate";
import { object } from "../../leaflet/values";
import { rpcUrl } from "./client";
import { parseDocumentKey } from "./config";
import { readJson } from "./http";
import type { Article, ConfiguredReader } from "./model";
import {
  articleMetadataSchema,
  contentSchema,
  pagesSchema,
  type DocumentRecord,
} from "./schemas";

type Input = { record: DocumentRecord; config: ConfiguredReader; pds: string };
type LeafletContent = ReturnType<typeof contentSchema.parse>;
type Prepared = { article: Article; content: LeafletContent | null };
type Context = Input & Partial<Prepared & { pages: unknown }>;

export const articleMachine = setup({
  schemas: {
    input: types<Input>(),
    context: types<Context>(),
    output: types<Article>(),
  },
  actors: {
    prepareArticle: createAsyncLogic({
      schemas: { input: types<Input>() },
      run: async ({ input }): Promise<Prepared> => {
        const { record, config, pds } = input;
        const key = parseDocumentKey(record.uri, config.ownerDid);
        const metadata = articleMetadataSchema.parse(record.value);
        const raw = record.value.content;
        return {
          article: {
            uri: record.uri,
            cid: record.cid,
            key,
            title: metadata.title,
            description: metadata.description ?? "",
            publishedAt: metadata.publishedAt,
            updatedAt: metadata.updatedAt,
            path: `/open-thoughts/${encodeURIComponent(key)}/`,
            sourceUrl: `https://leaflet.pub/lish/${encodeURIComponent(config.ownerDid)}/${encodeURIComponent(config.publicationKey)}/${encodeURIComponent(key)}`,
            document: { content: raw, authorDid: config.ownerDid },
            pds,
          },
          content:
            object(raw).$type === "pub.leaflet.content"
              ? contentSchema.parse(raw)
              : null,
        };
      },
    }),
    fetchPages: createAsyncLogic({
      schemas: {
        input: types<{ pds: string; ownerDid: string; cid: string }>(),
      },
      run: ({ input, signal }) =>
        readJson(
          rpcUrl(input.pds, "com.atproto.sync.getBlob", {
            did: input.ownerDid,
            cid: input.cid,
          }),
          signal,
        ),
    }),
    hydratePages: createAsyncLogic({
      schemas: {
        input: types<{
          article: Article;
          content: LeafletContent;
          pages: unknown;
        }>(),
      },
      run: async ({ input }): Promise<Article> => ({
        ...input.article,
        document: {
          ...input.article.document,
          content: { ...input.content, pages: pagesSchema.parse(input.pages) },
        },
      }),
    }),
  },
  states: {
    selectingContent: { schemas: { context: types<Prepared>() } },
    fetchingPages: {
      schemas: {
        context: types<
          Prepared & {
            content: LeafletContent & {
              blobPages: NonNullable<LeafletContent["blobPages"]>;
            };
          }
        >(),
      },
    },
    hydratingPages: {
      schemas: {
        context: types<
          Prepared & { content: LeafletContent; pages: unknown }
        >(),
      },
    },
    complete: { schemas: { context: types<{ article: Article }>() } },
  },
}).createMachine({
  id: "articleLoad",
  context: ({ input }) => ({ ...input }),
  initial: "preparing",
  states: {
    preparing: {
      invoke: {
        src: "prepareArticle",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "selectingContent",
          context: event.output,
        }),
      },
    },
    selectingContent: {
      type: "choice",
      choice: ({ context }) => {
        if (!context.content)
          return { target: "complete", context: { article: context.article } };
        if (context.content.blobPages)
          return {
            target: "fetchingPages",
            context: {
              ...context,
              content: {
                ...context.content,
                blobPages: context.content.blobPages,
              },
            },
          };
        return {
          target: "hydratingPages",
          context: {
            ...context,
            content: context.content,
            pages: context.content.pages,
          },
        };
      },
    },
    fetchingPages: {
      invoke: {
        src: "fetchPages",
        input: ({ context }) => ({
          pds: context.pds,
          ownerDid: context.config.ownerDid,
          cid: context.content.blobPages.ref.$link,
        }),
        onDone: ({ context, event }) => ({
          target: "hydratingPages",
          context: { ...context, pages: event.output },
        }),
      },
    },
    hydratingPages: {
      invoke: {
        src: "hydratePages",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "complete",
          context: { article: event.output },
        }),
      },
    },
    complete: { type: "final", output: ({ context }) => context.article },
  },
  output: ({ output }) => output,
});
