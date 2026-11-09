import { setup, types } from "xstate";
import { articleMachine } from "./article-machine";
import type { Article, ConfiguredReader } from "./model";
import type { DocumentRecord } from "./schemas";

type Input = {
  records: DocumentRecord[];
  config: ConfiguredReader;
  pds: string;
};
type Context = Input & {
  articles: Article[];
  index: number;
  record?: DocumentRecord;
};

export const articlesMachine = setup({
  schemas: {
    input: types<Input>(),
    context: types<Context>(),
    output: types<Article[]>(),
  },
  actors: { loadArticle: articleMachine },
  states: {
    loadingArticle: {
      schemas: { context: types<{ record: DocumentRecord }>() },
    },
  },
}).createMachine({
  id: "publicationArticles",
  context: ({ input }) => ({
    ...input,
    records: input.records.filter(
      (record) => record.value.site === input.config.publicationUri,
    ),
    articles: [],
    index: 0,
  }),
  initial: "selectingArticle",
  states: {
    selectingArticle: {
      type: "choice",
      choice: ({ context }) => {
        const record = context.records[context.index];
        if (!record) return { target: "complete" };
        return { target: "loadingArticle", context: { record } };
      },
    },
    loadingArticle: {
      invoke: {
        src: "loadArticle",
        input: ({ context }) => ({
          record: context.record,
          config: context.config,
          pds: context.pds,
        }),
        onDone: ({ context, event }) => ({
          target: "selectingArticle",
          context: {
            articles: [...context.articles, event.output],
            index: context.index + 1,
          },
        }),
      },
    },
    complete: {
      type: "final",
      output: ({ context }) =>
        [...context.articles].sort(
          (a, b) =>
            Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
            a.uri.localeCompare(b.uri),
        ),
    },
  },
  output: ({ output }) => output,
});
