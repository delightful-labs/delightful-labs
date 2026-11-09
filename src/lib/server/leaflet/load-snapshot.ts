import { readArticle } from "./article";
import { createRpc, readCommit } from "./client";
import { resolvePds } from "./identity";
import type { ConfiguredReader, JsonReader, Snapshot } from "./model";
import { readDocumentRecords } from "./records";
import { publicationSchema } from "./schemas";

export async function loadSnapshot(
  config: ConfiguredReader,
  json: JsonReader,
  now: () => number,
  signal: AbortSignal,
): Promise<Snapshot> {
  signal.throwIfAborted();
  const startedAt = now();
  const pds = await resolvePds(config.ownerDid, json, signal);
  const rpc = createRpc(pds, json, now, startedAt, signal);
  const before = await readCommit(rpc, config.ownerDid);
  const publication = publicationSchema.parse(
    await rpc("com.atproto.repo.getRecord", {
      repo: config.ownerDid,
      collection: "site.standard.publication",
      rkey: config.publicationKey,
    }),
  );
  if (publication.uri !== config.publicationUri)
    throw new Error("Publication mismatch");
  const records = await readDocumentRecords(rpc, config.ownerDid);
  const articles = [];
  for (const record of records.filter(
    (record) => record.value.site === config.publicationUri,
  )) {
    articles.push(await readArticle(record, config, pds, rpc));
  }
  if (before !== (await readCommit(rpc, config.ownerDid)))
    throw new Error("Repository changed during scan; retry later");
  signal.throwIfAborted();
  articles.sort(
    (a, b) =>
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
      a.uri.localeCompare(b.uri),
  );
  return {
    publication: {
      uri: config.publicationUri,
      name: publication.value.name,
      sourceUrl: new URL(publication.value.url).href,
    },
    articles,
    verifiedAt: now(),
    stale: false,
  };
}
