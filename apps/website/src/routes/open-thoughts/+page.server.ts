import { readPublication } from "#lib/server/publication/read.ts";

export async function load() {
  const snapshot = await readPublication();
  return {
    articles:
      snapshot?.articles.map(({ document, pds, ...article }) => article) ?? [],
  };
}
